/* ==========================================================================
   Visus – web aplikacija (desktop), podaci u Supabase-u.
   Pravila (validacija, naknadni unosi, nagrade, istraživanje) sprovodi baza:
   vidi supabase/schema.sql. Ovaj fajl je samo korisnički interfejs.
   ========================================================================== */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_LOGIN } from '../config.js';
import {
  CONSENT_VERSION, STREAK_MIN, XP_PER_ENTRY, XP_PER_STREAK_DAY, NOTE_MAX,
  METRICS, PERIODS, LEVELS, MILESTONES, BADGES, DEMOGRAPHIC_OPTIONS, DEMOGRAPHIC_MULTI,
  dayKey, parseKey, addDays, severity, computeStats,
} from './rules.js';

const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];
const DOW = ['nedelja', 'ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota'];
const DOW_SHORT = ['Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub', 'Ned'];
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const APP_URL = location.origin + location.pathname;

const sb = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
  : null;

let state = null; // null = nije prijavljen

// Privremeno stanje interfejsa (ne čuva se)
const ui = {
  authTab: 'login',
  authMsg: null,
  authEmail: '',
  onb: null,
  draft: null,
  calMonth: null,
  selDate: null,
  range: 30,
  trendMetrics: new Set(METRICS.map((m) => m.key)),
  demoEdit: null,
  returnTo: null,
  afterNav: null,
  busy: false,
  menuOpen: false,
};

/* ---------- Podaci (Supabase) ---------- */

class AppError extends Error {}

function check({ data, error }) {
  if (error) {
    if (error.code === '23505') throw new AppError('Unos za ovaj termin već postoji');
    if (error.code === 'PGRST301' || /JWT/i.test(error.message)) throw Object.assign(new AppError('Sesija je istekla, prijavite se ponovo'), { auth: true });
    throw new AppError(error.message || 'Došlo je do greške');
  }
  return data;
}

// PostgREST vraća najviše 1000 redova po zahtevu, pa se veliki skupovi učitavaju u delovima.
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function entryFromRow(r) {
  return {
    id: r.id,
    date: r.date,
    period: r.period,
    scores: Object.fromEntries(METRICS.map((m) => [m.key, r[m.key]])),
    note: r.note,
    retroactive: r.retroactive,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const redemptionFromRow = (r) => ({ milestoneId: r.milestone_id, code: r.code, createdAt: r.created_at, redeemedAt: r.redeemed_at });

const researchHistory = (consents) => consents
  .filter((c) => c.kind === 'research')
  .map((c) => ({ optIn: c.granted, at: c.created_at, consentVersion: c.version }));

async function loadState(user) {
  const [profile, entries, redemptions, consents] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).single().then(check),
    fetchAll(() => sb.from('entries').select('*').order('date').order('period')),
    sb.from('redemptions').select('*').order('created_at').then(check),
    sb.from('consent_events').select('*').order('id').then(check),
  ]);

  if (profile.timezone !== TIMEZONE) {
    await sb.from('profiles').update({ timezone: TIMEZONE }).eq('id', user.id).then(check).catch(() => {});
  }

  state = {
    user: {
      id: user.id,
      email: user.email || '',
      name: profile.name || '',
      provider: user.app_metadata?.provider || 'email',
      createdAt: user.created_at,
    },
    onboarded: !!profile.onboarded_at,
    consent: profile.consent_version ? { version: profile.consent_version, acceptedAt: profile.consent_accepted_at } : null,
    consentLog: consents,
    research: { optIn: profile.research_opt_in, history: researchHistory(consents) },
    demographics: profile.demographics || {},
    notifications: profile.notifications,
    entries: entries.map(entryFromRow),
    redemptions: redemptions.map(redemptionFromRow),
  };
}

async function reloadConsents() {
  const consents = check(await sb.from('consent_events').select('*').order('id'));
  state.consentLog = consents;
  state.research.history = researchHistory(consents);
}

async function updateProfile(fields) {
  const row = check(await sb.from('profiles').update(fields).eq('id', state.user.id).select().single());
  state.user.name = row.name || '';
  state.onboarded = !!row.onboarded_at;
  state.consent = row.consent_version ? { version: row.consent_version, acceptedAt: row.consent_accepted_at } : null;
  state.research.optIn = row.research_opt_in;
  state.demographics = row.demographics;
  state.notifications = row.notifications;
  return row;
}

function handleError(err) {
  console.error(err);
  if (err.auth) {
    state = null;
    closeModal();
    go('/login');
  }
  toast(err.message || 'Došlo je do greške');
}

/* ---------- Pomoćne funkcije ---------- */

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const todayKey = () => dayKey();

function fmtDate(key, withDow = true) {
  const d = parseKey(key);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}.`;
  const base = `${d.getDate()}. ${MONTHS[d.getMonth()]}${year}`;
  return withDow ? `${DOW[d.getDay()]}, ${base}` : base;
}

function fmtShort(key) {
  const d = parseKey(key);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

function relDay(key) {
  const t = todayKey();
  if (key === t) return 'Danas';
  if (key === addDays(t, -1)) return 'Juče';
  return fmtDate(key);
}

const sevColor = (sev) => `var(--s${Math.min(5, Math.max(1, Math.round(sev)))})`;
const entrySeverity = (e) => METRICS.reduce((sum, m) => sum + severity(m, e.scores[m.key]), 0) / METRICS.length;
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
// Gost vidi isti interfejs kao korisnik, nad praznim (nesačuvanim) nalogom.
const GUEST_VIEW = { user: { id: null, name: '', email: '' }, entries: [], redemptions: [], research: { optIn: false } };
const view = () => state || GUEST_VIEW;
const findEntry = (date, period) => view().entries.find((e) => e.date === date && e.period === period);
const entriesOn = (date) => view().entries.filter((e) => e.date === date);
const periodOf = (key) => PERIODS.find((p) => p.key === key);
const stats = () => computeStats(view().entries, todayKey(), view().research.optIn);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function openModal(html) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $('#modal-root input, #modal-root button.btn-primary')?.focus();
}

function closeModal() {
  $('#modal-root').innerHTML = '';
}

function downloadJSON(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Ruter ---------- */

function parseHash() {
  const h = location.hash.slice(1) || '/home';
  const [path, qs] = h.split('?');
  return { path, params: new URLSearchParams(qs || '') };
}

function go(path) {
  if (location.hash === '#' + path) render();
  else location.hash = path;
}

const NAV = [
  { path: '/home', icon: '🏠', label: 'Početna' },
  { path: '/history', icon: '📅', label: 'Istorija' },
  { path: '/trends', icon: '📈', label: 'Trendovi' },
  { path: '/rewards', icon: '🏆', label: 'Nagrade' },
  { path: '/settings', icon: '⚙️', label: 'Podešavanja' },
];

const ROUTES = {
  '/login': renderLogin,
  '/onboarding': renderOnboarding,
  '/reconsent': renderReconsent,
  '/home': renderHome,
  '/log': renderLog,
  '/history': renderHistory,
  '/trends': renderTrends,
  '/rewards': renderRewards,
  '/settings': renderSettings,
};
const GATE = ['/login', '/onboarding', '/reconsent'];

let lastPath = null;

function render() {
  if (!sb) return renderSetup();
  const { path, params } = parseHash();

  // Gost (neprijavljen) vidi početnu i unos; ostale strane traže prijavu.
  if (!state) {
    if (!['/home', '/log', '/login'].includes(path)) {
      if (ROUTES[path]) ui.authMsg = { ok: true, text: 'Prijavite se da biste videli ovu stranu.' };
      return go(ROUTES[path] ? '/login' : '/home');
    }
  }
  else if (!state.onboarded) { if (path !== '/onboarding') return go('/onboarding'); }
  else if (state.consent?.version !== CONSENT_VERSION) { if (path !== '/reconsent') return go('/reconsent'); }
  else if (GATE.includes(path) || !ROUTES[path]) return go('/home');

  const bare = GATE.includes(path);
  $('#layout').classList.toggle('bare', bare);
  $('#sidebar').innerHTML = bare ? '' : renderSidebar(path);
  $('#sidebar').classList.toggle('open', ui.menuOpen && !bare);
  $('#app').innerHTML = bare ? ROUTES[path](params) : `<div class="page">${ROUTES[path](params)}</div>`;

  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
}

function renderSidebar(path) {
  const foot = state ? (() => {
    const u = state.user;
    const initial = (u.name || u.email || '?').trim()[0].toUpperCase();
    return `
      <div class="avatar">${esc(initial)}</div>
      <div class="who"><div><strong>${esc(u.name || 'Bez imena')}</strong></div><div class="small muted">${esc(u.email)}</div></div>
      <button class="icon-btn" title="Odjavi se" aria-label="Odjavi se" data-action="logout">⎋</button>`;
  })() : `
      <div class="guest-foot">
        <button class="btn btn-primary btn-sm" data-action="go-signup">Napravi nalog</button>
        <button class="btn btn-ghost btn-sm" data-action="go-login">Prijava</button>
        <a class="small muted" href="o-aplikaciji">O aplikaciji</a>
      </div>`;
  return `
    <a class="brand" href="#/home"><img src="../assets/logo.svg" alt=""><span>Visus</span></a>
    <button class="icon-btn menu-toggle" data-action="toggle-menu" aria-label="Meni" aria-expanded="${ui.menuOpen}" aria-controls="sidebar">
      ${ui.menuOpen
        ? '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'}
    </button>
    <button class="btn btn-primary nav-cta" data-action="new-entry">+ Novi unos</button>
    <nav class="nav">
      ${NAV.map((n) => `<a href="#${n.path}" class="${n.path === path ? 'on' : ''}"><span class="ni">${n.icon}</span>${n.label}</a>`).join('')}
    </nav>
    <div class="sidebar-foot">${foot}</div>`;
}

function renderSetup() {
  $('#layout').classList.add('bare');
  $('#app').innerHTML = `
    <div class="setup">
      <h1>Supabase nije podešen</h1>
      <p class="muted">Aplikacija čuva podatke u Supabase-u. Potrebno je jednom podesiti projekat:</p>
      <ol>
        <li>Na <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com</a> napravite projekat (region: <b>Central EU (Frankfurt)</b>).</li>
        <li>U <b>SQL Editor</b> nalepite i pokrenite ceo fajl <code>supabase/schema.sql</code>.</li>
        <li>Iz <b>Project Settings → API</b> kopirajte <b>Project URL</b> i <b>anon public</b> ključ u <code>public/config.js</code>.</li>
        <li>Osvežite ovu stranicu.</li>
      </ol>
    </div>`;
}

/* ---------- Prijava ---------- */

function renderLogin() {
  const tab = ui.authTab;
  const msg = ui.authMsg ? `<div class="form-msg ${ui.authMsg.ok ? 'ok' : 'err'}">${esc(ui.authMsg.text)}</div>` : '';
  const forms = {
    login: `
      <h2>Prijava</h2>
      <p class="muted" style="margin:0 0 20px">Dobro došli nazad.</p>
      ${msg}
      <form data-form="login">
        <label class="field">Email<input type="email" name="email" autocomplete="email" value="${esc(ui.authEmail)}" required></label>
        <label class="field">Lozinka<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn btn-primary btn-block" type="submit">Prijavi se</button>
      </form>
      <p class="small center" style="margin-top:14px"><button class="link-btn" data-action="auth-tab" data-tab="forgot">Zaboravili ste lozinku?</button></p>
      <p class="small center muted">Nemate nalog? <button class="link-btn" data-action="auth-tab" data-tab="signup">Registrujte se</button></p>`,
    signup: `
      <h2>Novi nalog</h2>
      <p class="muted" style="margin:0 0 20px">Registracija traje manje od minuta.</p>
      ${msg}
      <form data-form="signup">
        <label class="field">Ime <span class="hint">(opciono)</span><input type="text" name="name" autocomplete="given-name" maxlength="80"></label>
        <label class="field">Email<input type="email" name="email" autocomplete="email" value="${esc(ui.authEmail)}" required></label>
        <label class="field">Lozinka <span class="hint">(najmanje 8 znakova)</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <button class="btn btn-primary btn-block" type="submit">Napravi nalog</button>
      </form>
      <p class="small center muted" style="margin-top:14px">Već imate nalog? <button class="link-btn" data-action="auth-tab" data-tab="login">Prijavite se</button></p>`,
    forgot: `
      <h2>Nova lozinka</h2>
      <p class="muted" style="margin:0 0 20px">Poslaćemo vam link za postavljanje nove lozinke.</p>
      ${msg}
      <form data-form="forgot">
        <label class="field">Email<input type="email" name="email" autocomplete="email" value="${esc(ui.authEmail)}" required></label>
        <button class="btn btn-primary btn-block" type="submit">Pošalji link</button>
      </form>
      <p class="small center" style="margin-top:14px"><button class="link-btn" data-action="auth-tab" data-tab="login">← Nazad na prijavu</button></p>`,
  };

  return `
  <div class="auth">
    <div class="auth-hero">
      <a class="brand" href="o-aplikaciji"><img src="../assets/logo.svg" alt=""><span>Visus</span></a>
      <div>
        <h1>Pratite kako se vaše oči osećaju, iz dana u dan.</h1>
        <p>Tri kratka unosa dnevno. Visus pokazuje obrasce koje biste inače propustili.</p>
        <ul>
          <li><span>📝</span> Pet simptoma, ocena od 1 do 5</li>
          <li><span>📈</span> Trendovi i istorija na jednom mestu</li>
          <li><span>🏆</span> Nagrade partnera Vizim Dom Zdravlja</li>
          <li><span>🔒</span> Podaci se čuvaju u EU, pod vašom kontrolom</li>
        </ul>
      </div>
      <div class="small" style="opacity:.75">Demo verzija</div>
    </div>
    <div class="auth-form">
      <div class="auth-card">
        <button class="link-btn small" style="margin-bottom:18px" data-action="go-guest-log">← Nazad</button>
        ${forms[tab]}
        ${GOOGLE_LOGIN && tab !== 'forgot' ? `
          <div class="divider">ili</div>
          <button class="btn btn-google" data-action="login-google">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>
            Nastavi sa Google nalogom
          </button>` : ''}
        <p class="center small muted" style="margin-top:22px">Nastavkom prihvatate <a href="../terms.html">Uslove korišćenja</a> i <a href="../privacy.html">Politiku privatnosti</a>.</p>
      </div>
    </div>
  </div>`;
}

const authForms = {
  async login(f) {
    ui.authEmail = f.email.value.trim();
    const { data, error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) {
      ui.authMsg = { text: /confirm/i.test(error.message) ? 'Prvo potvrdite email adresu (proverite inbox).' : 'Pogrešan email ili lozinka.' };
      return render();
    }
    await afterSignIn(data.user);
  },
  async signup(f) {
    ui.authEmail = f.email.value.trim();
    const { data, error } = await sb.auth.signUp({
      email: f.email.value.trim(),
      password: f.password.value,
      options: { data: { full_name: f.name.value.trim() }, emailRedirectTo: APP_URL },
    });
    if (error) {
      ui.authMsg = { text: /registered/i.test(error.message) ? 'Nalog sa ovim emailom već postoji.' : error.message };
      return render();
    }
    if (!data.session) {
      ui.authTab = 'login';
      ui.authMsg = { ok: true, text: 'Poslali smo vam email. Kliknite na link da potvrdite nalog, pa se prijavite.' };
      return render();
    }
    await afterSignIn(data.user);
  },
  async forgot(f) {
    ui.authEmail = f.email.value.trim();
    const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: APP_URL });
    ui.authMsg = error ? { text: error.message } : { ok: true, text: 'Ako nalog postoji, poslali smo link na vaš email.' };
    render();
  },
  // Posle klika na link "zaboravljena lozinka" iz emaila.
  async 'new-password'(f) {
    if (f.password.value.length < 8) return toast('Lozinka mora imati najmanje 8 znakova');
    const { error } = await sb.auth.updateUser({ password: f.password.value });
    if (error) throw new AppError(error.message);
    closeModal();
    toast('Lozinka je promenjena');
  },
};

// Prijavu mogu istovremeno da završe forma i Supabase događaj SIGNED_IN – radi se samo jednom.
let signInTask = null;
function afterSignIn(user) {
  if (signInTask?.id === user.id) return signInTask.promise;
  const promise = (async () => {
    ui.authMsg = null;
    await loadState(user);
    if (await resumePending()) return;
    go(state.onboarded ? '/home' : '/onboarding');
  })();
  signInTask = { id: user.id, promise };
  promise.finally(() => { if (signInTask?.promise === promise) signInTask = null; });
  return promise;
}

function showNewPasswordModal() {
  openModal(`
    <h2>Postavite novu lozinku</h2>
    <form data-form="new-password">
      <label class="field">Nova lozinka<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <div class="modal-actions"><button class="btn btn-primary" type="submit">Sačuvaj lozinku</button></div>
    </form>`);
}

/* ---------- Onboarding ---------- */

function stepsBar(i) {
  return `<div class="steps">${[0, 1, 2, 3].map((k) => `<span class="${k <= i ? 'on' : ''}"></span>`).join('')}</div>`;
}

function renderOnboarding() {
  if (!ui.onb) {
    ui.onb = { step: 0, health: false, terms: false, research: null, demo: { ...state.demographics }, notif: { ...state.notifications } };
  }
  const o = ui.onb;
  const first = state.user.name ? ', ' + esc(state.user.name.split(' ')[0]) : '';
  const shell = (body) => `<div class="onb"><div class="brand"><img src="../assets/logo.svg" alt=""><span>Visus</span></div>${stepsBar(o.step)}${body}</div>`;

  if (o.step === 0) {
    return shell(`
      <h1>Dobro došli${first} 👋</h1>
      <p class="lead">Pre početka potrebna nam je vaša saglasnost. Sve možete kasnije pregledati u Podešavanjima.</p>
      <div class="card">
        <label class="consent-item">
          <input type="checkbox" data-bind="health" data-scope="onb" data-rerender ${o.health ? 'checked' : ''}>
          <div><strong>Obrada podataka o zdravlju</strong>
            <div class="small muted">Pristajem da Visus čuva moje unose o simptomima očiju <b>isključivo</b> radi praćenja simptoma.</div></div>
        </label>
        <label class="consent-item">
          <input type="checkbox" data-bind="terms" data-scope="onb" data-rerender ${o.terms ? 'checked' : ''}>
          <div><strong>Uslovi i privatnost</strong>
            <div class="small muted">Pročitao/la sam <a href="../terms.html" target="_blank">Uslove korišćenja</a> i <a href="../privacy.html" target="_blank">Politiku privatnosti</a> (verzija ${CONSENT_VERSION}).</div></div>
        </label>
      </div>
      <div class="card flat small muted" style="margin-top:16px">🇪🇺 Podaci se čuvaju u EU · 🗂️ Čuvamo samo ono što sami unesete · 🗑️ Sve možete izvesti ili obrisati</div>
      <div class="onb-actions">
        <button class="btn btn-ghost" data-action="logout">Odustani</button>
        <button class="btn btn-primary" data-action="onb-next" ${o.health && o.terms ? '' : 'disabled'}>Nastavi →</button>
      </div>`);
  }

  if (o.step === 1) {
    return shell(`
      <h1>Pomozite istraživanju 🔬</h1>
      <p class="lead">Ovo je <b>posebna i dobrovoljna</b> odluka. Aplikaciju koristite potpuno isto i ako odbijete.</p>
      <div class="grid cols-2">
        <div class="card"><h3>Šta se deli ako pristanete</h3><ul class="bullets small"><li>Pet ocena simptoma</li><li>Doba dana i vreme unosa</li><li>Opciono: isečak regiona oka</li></ul></div>
        <div class="card"><h3>Šta se nikada ne deli</h3><ul class="bullets small"><li>Ime, email, ID uređaja</li><li>Vaše beleške</li><li>Demografski podaci</li></ul></div>
      </div>
      <p class="small muted">Identitet se zamenjuje pseudonimom (jednosmerni heš). Podatke koristi samo istraživački tim. Učešće možete povući bilo kada.</p>
      <div class="grid cols-2">
        <button class="option-card ${o.research === true ? 'on' : ''}" data-action="onb-research" data-value="yes"><strong>✅ Da, učestvujem</strong><div class="small muted">Anonimni podaci idu u istraživačku arhivu</div></button>
        <button class="option-card ${o.research === false ? 'on' : ''}" data-action="onb-research" data-value="no"><strong>Ne, hvala</strong><div class="small muted">Koristim samo lični dnevnik</div></button>
      </div>
      <div class="onb-actions">
        <button class="btn btn-ghost" data-action="onb-back">← Nazad</button>
        <button class="btn btn-primary" data-action="onb-next" ${o.research === null ? 'disabled' : ''}>Nastavi →</button>
      </div>`);
  }

  if (o.step === 2) {
    return shell(`
      <h1>O vama</h1>
      <p class="lead">Sva polja su opciona. Popunite samo ono što želite.</p>
      <div class="card">${demographicsForm(o.demo, 'onb')}</div>
      <div class="onb-actions">
        <button class="btn btn-ghost" data-action="onb-back">← Nazad</button>
        <div class="row"><button class="btn btn-ghost" data-action="onb-skip-demo">Preskoči</button><button class="btn btn-primary" data-action="onb-next">Nastavi →</button></div>
      </div>`);
  }

  return shell(`
    <h1>Podsetnici ⏰</h1>
    <p class="lead">Tri podsetnika dnevno pomažu da ne propustite unos. Stižu kao obaveštenja pregledača dok je Visus otvoren.</p>
    <div class="card">
      <div class="set-row"><div class="grow"><strong>Uključi podsetnike</strong></div>
        <label class="switch"><input type="checkbox" data-bind="notif.enabled" data-scope="onb" data-rerender ${o.notif.enabled ? 'checked' : ''}><span></span></label></div>
      ${o.notif.enabled ? PERIODS.map((p) => `<div class="set-row"><div class="grow">${p.emoji} ${p.name}</div><input type="time" value="${o.notif[p.key]}" data-bind="notif.${p.key}" data-scope="onb"></div>`).join('') : ''}
    </div>
    <div class="onb-actions">
      <button class="btn btn-ghost" data-action="onb-back">← Nazad</button>
      <button class="btn btn-primary" data-action="onb-finish">Počni sa praćenjem</button>
    </div>`);
}

function choiceGroup(field, value, scope) {
  const multi = DEMOGRAPHIC_MULTI.includes(field);
  const sel = multi ? (value || []) : [value];
  return `<div class="choice-grid">${DEMOGRAPHIC_OPTIONS[field].map((opt) => `
    <button type="button" class="choice ${sel.includes(opt) ? 'on' : ''}" data-action="choice" data-scope="${scope}" data-field="${field}" data-value="${esc(opt)}" ${multi ? 'data-multi' : ''}>${esc(opt)}</button>`).join('')}</div>`;
}

function demographicsForm(d, scope) {
  return `
    <label class="field">Starosna grupa
      <select data-bind="ageRange" data-scope="${scope}">
        <option value="">Ne želim da navedem</option>
        ${DEMOGRAPHIC_OPTIONS.ageRange.map((a) => `<option ${d.ageRange === a ? 'selected' : ''}>${a}</option>`).join('')}
      </select>
    </label>
    <div class="field"><span>Pol</span>${choiceGroup('sex', d.sex, scope)}</div>
    <div class="field"><span>Pomagala za vid</span>${choiceGroup('aids', d.aids, scope)}</div>
    <div class="field"><span>Dijagnostikovana stanja</span>${choiceGroup('conditions', d.conditions, scope)}</div>
    <div class="field" style="margin-bottom:0"><span>Vreme pred ekranom dnevno</span>${choiceGroup('screenHours', d.screenHours, scope)}</div>`;
}

// Minimizacija podataka: čuvaju se samo poznata, popunjena polja.
function cleanDemographics(d) {
  const out = {};
  for (const [key, options] of Object.entries(DEMOGRAPHIC_OPTIONS)) {
    const v = d[key];
    if (DEMOGRAPHIC_MULTI.includes(key)) {
      const arr = (Array.isArray(v) ? v : []).filter((x) => options.includes(x));
      if (arr.length) out[key] = arr;
    } else if (options.includes(v)) {
      out[key] = v;
    }
  }
  return out;
}

function renderReconsent() {
  return `
    <div class="onb">
      <div class="brand"><img src="../assets/logo.svg" alt=""><span>Visus</span></div>
      <h1>Ažurirali smo uslove</h1>
      <p class="lead">Politika privatnosti je promenjena (verzija ${esc(state.consent?.version || '–')} → ${CONSENT_VERSION}). Da biste nastavili, potrebna je ponovna saglasnost.</p>
      <div class="card">
        <p style="margin-top:0"><a href="../privacy.html" target="_blank">Pročitaj celu politiku privatnosti →</a></p>
        <label class="consent-item"><input type="checkbox" id="reconsent-check">
          <div class="small">Pročitao/la sam i prihvatam Politiku privatnosti i Uslove korišćenja, verzija ${CONSENT_VERSION}.</div></label>
      </div>
      <p class="small muted">Vaš izbor o učešću u istraživanju (${state.research.optIn ? 'uključeno' : 'isključeno'}) ostaje nepromenjen.</p>
      <div class="onb-actions">
        <button class="btn btn-danger" data-action="delete-account-confirm">Ne prihvatam, obriši nalog</button>
        <button class="btn btn-primary" data-action="reconsent-accept">Prihvatam</button>
      </div>
    </div>`;
}

/* ---------- Početna ---------- */

function renderHome() {
  const s = stats();
  const t = todayKey();
  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'Dobro jutro' : hour < 18 ? 'Dobar dan' : 'Dobro veče';
  const name = view().user.name ? ', ' + esc(view().user.name.split(' ')[0]) : '';
  const done = PERIODS.filter((p) => findEntry(t, p.key)).length;
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const recent = [...view().entries].sort((a, b) => (b.date + b.period).localeCompare(a.date + a.period)).slice(0, 6);

  return `
    <div class="page-head">
      <div><h1>${greeting}${name}</h1><div class="sub">${fmtDate(t)}</div></div>
      <button class="btn btn-primary" data-action="new-entry">+ Novi unos</button>
    </div>

    <div class="grid main-side">
      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>Današnji unosi</h2><span class="small muted">${done} od 3</span></div>
          <div class="slots">
            ${PERIODS.map((p) => {
              const e = findEntry(t, p.key);
              return `<button class="slot ${e ? 'done' : ''}" data-action="open-log" data-date="${t}" data-period="${p.key}">
                <div class="slot-top"><span class="slot-emoji">${p.emoji}</span><span class="slot-state">${e ? '✓ Uneto' : 'Čeka'}</span></div>
                <div><strong>${p.name}</strong><div class="small muted">${p.hint}</div></div>
                ${e ? scoreBars(e) : '<span class="add">+ Dodaj unos</span>'}
              </button>`;
            }).join('')}
          </div>
        </div>

        <div class="card chart">
          <div class="card-head"><h2>Poslednjih 14 dana</h2><a class="small" href="#/trends">Svi trendovi →</a></div>
          ${view().entries.some((e) => e.date >= days[0])
            ? lineChart(dailySeries(days), days, { W: 760, H: 220 }) + legendRow()
            : '<div class="empty small">Grafikon se pojavljuje posle prvih unosa.</div>'}
        </div>

        <div class="card">
          <div class="card-head"><h2>Poslednji unosi</h2><a class="small" href="#/history">Istorija →</a></div>
          ${recent.length ? entriesTable(recent) : '<div class="empty small">Još nema unosa. Počnite današnjim unosom iznad.</div>'}
        </div>
      </div>

      <div class="stack">
        <a href="#/rewards" class="card hero-card" style="display:block;text-decoration:none">
          <div class="row between">
            <div class="streak-num">🔥 ${s.streak}</div>
            <span class="level-pill">Nivo ${s.level.n}</span>
          </div>
          <div class="muted small" style="margin-top:6px">${s.streak === 1 ? 'dan' : 'dana'} zaredom · ${streakText(s)}</div>
          <div style="margin-top:18px" class="row between small"><span>${s.level.name}</span><span>${s.xp} XP${s.next ? ' / ' + s.next.xp : ''}</span></div>
          <div class="progress" style="margin-top:6px"><span style="width:${Math.round(s.progress * 100)}%"></span></div>
        </a>
        ${sponsorCard(s)}
        <div class="card">
          <div class="card-head"><h2>Bedževi</h2><span class="small muted">${s.badges.length}/${BADGES.length}</span></div>
          <div class="row" style="flex-wrap:wrap;gap:10px">
            ${BADGES.map((b) => { const got = s.badges.includes(b.id); return `<span class="badge-icon ${got ? '' : 'locked'}" tabindex="0" data-tip="${b.name}${got ? '' : ' · zaključano'}" aria-label="${b.name}">${b.icon}</span>`; }).join('')}
          </div>
        </div>
        ${!state ? `<div class="card flat small">👋 <b>Dobro došli!</b> <span class="muted">Dodajte prvi unos. Za čuvanje unosa potrebna je besplatna prijava.</span></div>` : ''}
        ${view().entries.length === 0 ? `<div class="card flat small muted">💡 Ocenjujte kako se oči osećaju <b>u tom trenutku</b>. Nema tačnih i pogrešnih odgovora, važna je redovnost.</div>` : ''}
      </div>
    </div>`;
}

function streakText(s) {
  if (s.streakActive) return `aktivan niz, +${s.streak * XP_PER_STREAK_DAY} XP`;
  if (s.streak > 0) { const left = STREAK_MIN - s.streak; return `još ${left} ${left === 1 ? 'dan' : 'dana'} do aktivnog niza`; }
  return 'unesite simptome 3 dana zaredom';
}

function sponsorCard(s) {
  const next = MILESTONES.find((m) => m.level > s.level.n);
  const claimable = MILESTONES.find((m) => m.level <= s.level.n && !view().redemptions.some((r) => r.milestoneId === m.id));
  let body;
  if (claimable) {
    body = `<div style="margin:8px 0 12px"><strong>🎉 Nagrada je spremna: ${claimable.title}</strong></div><a class="btn btn-sm btn-on-dark" href="#/rewards">Preuzmi nagradu</a>`;
  } else if (next) {
    const target = LEVELS[next.level - 1].xp;
    body = `<div class="small muted" style="margin:6px 0 10px">Sledeća nagrada: <b style="color:#fff">${next.title}</b> na nivou ${next.level} · još ${target - s.xp} XP</div>
      <div class="progress"><span style="width:${Math.min(100, (s.xp / target) * 100)}%"></span></div>`;
  } else {
    body = '<div class="small muted">Osvojili ste sve nagrade. Hvala vam! 💚</div>';
  }
  return `<div class="card sponsor-card"><div class="sponsor-badge">Partner programa</div><h3 style="margin:2px 0 0;font-size:1.1rem">Vizim Dom Zdravlja</h3>${body}</div>`;
}

function scoreBars(e) {
  return `<div class="score-bars">${METRICS.map((m) => {
    const v = e.scores[m.key];
    return `<div class="score-bar"><span>${m.name.split(' ')[0]}</span><i style="width:${v * 20}%;background:${sevColor(severity(m, v))}"></i></div>`;
  }).join('')}</div>`;
}

function entriesTable(list) {
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Datum</th><th>Doba dana</th>${METRICS.map((m) => `<th title="${m.name}">${m.emoji}</th>`).join('')}<th>Beleška</th></tr></thead>
    <tbody>${list.map((e) => `
      <tr class="clickable" data-action="open-log" data-date="${e.date}" data-period="${e.period}">
        <td>${relDay(e.date)}${e.retroactive ? ' <span class="tag warn">naknadno</span>' : ''}</td>
        <td>${periodOf(e.period).emoji} ${periodOf(e.period).name}</td>
        ${METRICS.map((m) => `<td><span class="pill-score" style="background:${sevColor(severity(m, e.scores[m.key]))}">${e.scores[m.key]}</span></td>`).join('')}
        <td class="note-cell">${esc(e.note) || '–'}</td>
      </tr>`).join('')}</tbody></table></div>`;
}

/* ---------- Unos ---------- */

function defaultPeriod(date = todayKey()) {
  const h = new Date().getHours();
  const byTime = h < 11 ? 'morning' : h < 18 ? 'working' : 'evening';
  if (date === todayKey() && !findEntry(date, byTime)) return byTime;
  return PERIODS.find((p) => !findEntry(date, p.key))?.key || byTime;
}

// Unos gosta čeka u ovom pregledaču dok se korisnik ne prijavi i ne da saglasnost.
// Ništa se ne šalje na server pre saglasnosti (GDPR).
const PENDING_KEY = 'visus.pendingEntry';

function setPending(p) {
  try { p ? localStorage.setItem(PENDING_KEY, JSON.stringify(p)) : localStorage.removeItem(PENDING_KEY); } catch {}
}

function getPending() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY));
    if (p && Date.now() - p.savedAt < 7 * 864e5) return p;
  } catch {}
  setPending(null);
  return null;
}

function guestSave() {
  const d = ui.draft;
  if (!METRICS.every((m) => d.scores[m.key])) return;
  setPending({ date: d.date, period: d.period, scores: { ...d.scores }, note: d.note, savedAt: Date.now() });
  ui.draft = null;
  ui.authTab = 'signup';
  ui.authMsg = { ok: true, text: 'Unos je spreman. Napravite besplatan nalog ili se prijavite da ga sačuvate.' };
  go('/login');
}

// Posle prijave (i saglasnosti) sačuvaj unos koji je čekao. Vraća true ako je preusmerio korisnika.
async function resumePending() {
  if (!state?.onboarded || state.consent?.version !== CONSENT_VERSION) return false;
  const p = getPending();
  if (!p) return false;
  setPending(null);
  const existing = findEntry(p.date, p.period);
  if (existing) {
    ui.draft = { date: p.date, period: p.period, id: existing.id, scores: p.scores, note: p.note };
    ui.returnTo = '/home';
    go(`/log?date=${p.date}&period=${p.period}`);
    toast('Za ovaj termin već imate unos. Proverite nove ocene i sačuvajte.');
    return true;
  }
  const row = check(await sb.from('entries').insert({ ...p.scores, note: p.note, date: p.date, period: p.period }).select().single());
  state.entries.push(entryFromRow(row));
  go('/home');
  toast(`Vaš unos je sačuvan · +${XP_PER_ENTRY} XP`);
  return true;
}

function loadDraft(date, period) {
  const existing = findEntry(date, period);
  const pending = !state && getPending();
  if (pending && pending.date === date && pending.period === period) {
    ui.draft = { date, period, id: null, scores: { ...pending.scores }, note: pending.note };
    return;
  }
  ui.draft = { date, period, id: existing?.id || null, scores: existing ? { ...existing.scores } : {}, note: existing?.note || '' };
}

function renderLog(params) {
  const t = todayKey();
  let date = params.get('date') || t;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > t) date = t;
  const period = periodOf(params.get('period')) ? params.get('period') : defaultPeriod(date);
  if (!ui.draft || ui.draft.date !== date || ui.draft.period !== period) loadDraft(date, period);
  const d = ui.draft;
  const complete = METRICS.every((m) => d.scores[m.key]);
  const filled = Object.keys(d.scores).length;
  const guest = !state;

  const head = `
    <div class="page-head">
      <div>
        <button class="link-btn small" data-action="back">← Nazad</button>
        <h1 style="margin-top:6px">${d.id ? 'Izmena unosa' : 'Novi unos'}</h1>
        <div class="sub">${relDay(date)} · ${periodOf(period).emoji} ${periodOf(period).name}</div>
      </div>
    </div>`;

  const saveLabel = guest
    ? (complete ? 'Sačuvaj unos' : `Ocenite svih 5 simptoma (${filled}/5)`)
    : d.id ? 'Sačuvaj izmene' : complete ? `Sačuvaj · +${XP_PER_ENTRY} XP` : `Ocenite svih 5 simptoma (${filled}/5)`;

  const body = `${head}

    <div class="grid main-side">
      <div class="card">
        ${METRICS.map((m) => {
          const v = d.scores[m.key];
          return `<div class="metric-row">
            <div class="metric-name"><span class="emoji">${m.emoji}</span><div><strong>${m.name}</strong><div class="value-label">${v ? m.labels[v - 1] : 'Izaberite ocenu'}</div></div></div>
            <div>
              <div class="scale" role="radiogroup" aria-label="${m.name}">
                ${[1, 2, 3, 4, 5].map((n) => `<button role="radio" aria-checked="${v === n}" class="${v === n ? 'on' : ''}" style="${v === n ? 'background:' + sevColor(severity(m, n)) : ''}" data-action="score" data-metric="${m.key}" data-value="${n}">${n}</button>`).join('')}
              </div>
              <div class="scale-ends"><span>${m.labels[0]}</span><span>${m.labels[4]}</span></div>
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="card side-panel">
        <label class="field">Datum
          <input type="date" value="${date}" max="${t}" data-action-change="log-date" ${d.id ? 'disabled' : ''}>
        </label>
        <div class="field"><span>Doba dana</span>
          <div class="seg full">${PERIODS.map((p) => `<button class="${p.key === period ? 'on' : ''}" data-action="log-period" data-period="${p.key}">${p.emoji} ${p.name}</button>`).join('')}</div>
        </div>
        ${date !== t && !d.id && !guest ? `<div class="retro-note">⏪ Naknadni unos donosi ${XP_PER_ENTRY} XP, ali se ne računa u niz uzastopnih dana.</div>` : ''}
        <label class="field">Beleška <span class="hint">opciono, vidite je samo vi</span>
          <textarea data-bind="note" data-scope="draft" maxlength="${NOTE_MAX}" placeholder="Npr. dugo za računarom, klima, nove kapi...">${esc(d.note)}</textarea>
        </label>
        <div class="card flat small muted" style="padding:12px;margin-bottom:16px">📷 <b>Fotografija oka</b> · uskoro</div>
        <button class="btn btn-primary btn-block" data-action="save-entry" ${complete ? '' : 'disabled'}>${saveLabel}</button>
        ${guest ? '<p class="small muted" style="margin:10px 0 0">Za čuvanje je potrebna besplatna prijava. Do tada unos ostaje samo u ovom pregledaču.</p>' : ''}
        ${d.id ? `<button class="btn btn-danger btn-block" style="margin-top:10px" data-action="delete-entry" data-id="${d.id}">Obriši unos</button>` : ''}
        <div class="kbd-hint"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> čuva unos</div>
      </div>
    </div>`;

  return body;
}

async function saveEntry() {
  if (!state) return guestSave();
  const d = ui.draft;
  if (!METRICS.every((m) => d.scores[m.key])) return;
  const before = stats();
  const fields = { ...d.scores, note: d.note };

  if (d.id) {
    const row = check(await sb.from('entries').update(fields).eq('id', d.id).select().single());
    state.entries = state.entries.map((e) => (e.id === row.id ? entryFromRow(row) : e));
    toast('Izmene su sačuvane');
  } else {
    const row = check(await sb.from('entries').insert({ ...fields, date: d.date, period: d.period }).select().single());
    const created = entryFromRow(row);
    state.entries.push(created);
    const after = stats();
    if (after.level.n > before.level.n) {
      ui.afterNav = () => showLevelUp(after);
    } else {
      toast(`Sačuvano · +${after.xp - before.xp} XP${after.streakActive && !before.loggedToday && !created.retroactive ? ' 🔥' : ''}`);
    }
    const badge = BADGES.find((b) => after.badges.includes(b.id) && !before.badges.includes(b.id));
    if (badge && after.level.n === before.level.n) setTimeout(() => toast(`Novi bedž: ${badge.icon} ${badge.name}`), 2700);
  }
  leaveLog();
}

function leaveLog() {
  ui.draft = null;
  go(ui.returnTo || '/home');
}

function showLevelUp(s) {
  const m = MILESTONES.find((x) => x.level === s.level.n);
  openModal(`
    <div class="confetti">🎉</div>
    <h2 class="center">Novi nivo: ${s.level.n}</h2>
    <p class="center muted">Postali ste <b>${s.level.name}</b>. Samo tako nastavite!</p>
    ${m ? `<div class="card sponsor-card"><div class="sponsor-badge">Vizim Dom Zdravlja</div><strong>${m.icon} Otključali ste nagradu: ${m.title}</strong><div class="small muted">${m.desc}</div></div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-ghost" data-action="close-modal">Zatvori</button>
      ${m ? '<button class="btn btn-primary" data-action="close-modal" data-go="/rewards">Pogledaj nagradu</button>' : ''}
    </div>`);
}

/* ---------- Istorija ---------- */

function renderHistory() {
  const t = todayKey();
  if (!ui.calMonth) { const d = new Date(); ui.calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
  if (!ui.selDate) ui.selDate = t;
  const year = ui.calMonth.getFullYear(), month = ui.calMonth.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = year === new Date().getFullYear() && month === new Date().getMonth();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEntries = state.entries.filter((e) => e.date.startsWith(prefix)).sort((a, b) => (b.date + b.period).localeCompare(a.date + a.period));

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<div></div>');
  for (let day = 1; day <= daysInMonth; day++) {
    const key = dayKey(new Date(year, month, day));
    const es = entriesOn(key);
    const future = key > t;
    const cls = ['cal-day', es.length ? 'has' : '', key === t ? 'today' : '', key === ui.selDate ? 'sel' : '', future ? 'future' : ''].join(' ');
    cells.push(`<button class="${cls}" ${future ? 'disabled' : `data-action="select-day" data-date="${key}"`}>
      <span>${day}</span><span class="cal-dots">${es.map((e) => `<i style="background:${sevColor(entrySeverity(e))}"></i>`).join('')}</span></button>`);
  }

  const sel = ui.selDate;
  return `
    <div class="page-head"><div><h1>Istorija</h1><div class="sub">Svi unosi po danima. Kliknite na dan za detalje.</div></div></div>

    <div class="grid main-side">
      <div class="card">
        <div class="cal-head">
          <button class="icon-btn" data-action="cal-prev" aria-label="Prethodni mesec">‹</button>
          <h2 style="margin:0;text-transform:capitalize">${MONTHS[month]} ${year}</h2>
          <button class="icon-btn" data-action="cal-next" aria-label="Sledeći mesec" ${isCurrentMonth ? 'disabled' : ''}>›</button>
        </div>
        <div class="cal-grid">${DOW_SHORT.map((d) => `<div class="cal-dow">${d}</div>`).join('')}${cells.join('')}</div>
        <div class="legend">
          <span>Tegobe:</span>${[1, 2, 3, 4, 5].map((n) => `<span><i style="background:var(--s${n})"></i>${['bez', 'blage', 'umerene', 'izražene', 'jake'][n - 1]}</span>`).join('')}
          <span style="margin-left:auto">${new Set(monthEntries.map((e) => e.date)).size} dana sa unosom</span>
        </div>
      </div>

      <div class="card">
        <h2>${relDay(sel)}</h2>
        ${PERIODS.map((p) => {
          const e = findEntry(sel, p.key);
          if (!e) {
            return `<div class="empty-slot"><span>${p.emoji} ${p.name} <span class="small muted">· nema unosa</span></span>
              <button class="btn btn-ghost btn-sm" data-action="open-log" data-date="${sel}" data-period="${p.key}">+ Dodaj</button></div>`;
          }
          return `<div class="entry">
            <div class="row between">
              <div class="row" style="gap:8px"><span>${p.emoji}</span><strong>${p.name}</strong>${e.retroactive ? '<span class="tag warn">naknadno</span>' : ''}</div>
              <button class="btn btn-ghost btn-sm" data-action="open-log" data-date="${sel}" data-period="${p.key}">Izmeni</button>
            </div>
            <div class="entry-scores">${METRICS.map((m) => `<div><b style="background:${sevColor(severity(m, e.scores[m.key]))}">${e.scores[m.key]}</b>${m.name.split(' ')[0]}</div>`).join('')}</div>
            ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <div class="card-head"><h2>Svi unosi: ${MONTHS[month]} ${year}</h2><span class="small muted">${monthEntries.length} unosa</span></div>
      ${monthEntries.length ? entriesTable(monthEntries) : '<div class="empty small">Nema unosa u ovom mesecu.</div>'}
    </div>`;
}

/* ---------- Trendovi ---------- */

function dailySeries(days) {
  const map = {};
  for (const e of view().entries) (map[e.date] ||= []).push(e);
  return METRICS.filter((m) => ui.trendMetrics.has(m.key)).map((m) => ({
    metric: m,
    values: days.map((d) => (map[d] ? avg(map[d].map((e) => e.scores[m.key])) : null)),
  }));
}

function legendRow() {
  return `<div class="legend">${METRICS.filter((m) => ui.trendMetrics.has(m.key)).map((m) => `<span><i style="background:${m.color}"></i>${m.name}</span>`).join('')}</div>`;
}

function lineChart(series, days, { W = 900, H = 320 } = {}) {
  const pl = 28, pr = 12, pt = 12, pb = 28;
  const iw = W - pl - pr, ih = H - pt - pb;
  const x = (i) => pl + (days.length === 1 ? iw / 2 : (i * iw) / (days.length - 1));
  const y = (v) => pt + ((5 - v) * ih) / 4;

  let out = '';
  for (let v = 1; v <= 5; v++) {
    out += `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="axis-label" x="${pl - 10}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const step = Math.max(1, Math.ceil(days.length / 10));
  days.forEach((d, i) => {
    if (i % step && i !== days.length - 1) return;
    if (i !== days.length - 1 && days.length - 1 - i < step / 2) return; // izbegni preklapanje sa poslednjom oznakom
    const anchor = i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle';
    out += `<text class="axis-label" x="${x(i)}" y="${H - 8}" text-anchor="${anchor}">${fmtShort(d)}</text>`;
  });
  for (const s of series) {
    let path = '', pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    out += `<path d="${path}" fill="none" stroke="${s.metric.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (days.length <= 31) {
      s.values.forEach((v, i) => {
        if (v != null) out += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${s.metric.color}"><title>${s.metric.name}, ${fmtShort(days[i])}: ${v.toFixed(1)}</title></circle>`;
      });
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafikon simptoma po danima">${out}</svg>`;
}

function renderTrends() {
  const t = todayKey();
  const n = ui.range;
  const days = Array.from({ length: n }, (_, i) => addDays(t, i - n + 1));
  const inRange = state.entries.filter((e) => e.date >= days[0] && e.date <= t);
  const prevRange = state.entries.filter((e) => e.date >= addDays(days[0], -n) && e.date < days[0]);
  const s = stats();

  const head = `
    <div class="page-head">
      <div><h1>Trendovi</h1><div class="sub">Kako se simptomi menjaju kroz vreme.</div></div>
      <div class="seg">${[7, 30, 90].map((r) => `<button class="${r === n ? 'on' : ''}" data-action="range" data-value="${r}">${r} dana</button>`).join('')}</div>
    </div>`;

  if (!inRange.length) {
    return head + `<div class="card empty"><div class="big">📈</div>Nema unosa u poslednjih ${n} dana.<br>Grafikoni se pojavljuju posle prvih unosa.
      <div style="margin-top:16px"><button class="btn btn-primary" data-action="new-entry">+ Novi unos</button></div></div>`;
  }

  const daysLogged = new Set(inRange.map((e) => e.date)).size;
  const metricStats = METRICS.map((m) => {
    const cur = avg(inRange.map((e) => e.scores[m.key]));
    const prev = avg(prevRange.map((e) => e.scores[m.key]));
    let trend = '';
    if (prev != null) {
      const diff = severity(m, cur) - severity(m, prev);
      trend = Math.abs(diff) < 0.2 ? '<span class="muted">→ stabilno</span>'
        : diff < 0 ? '<span style="color:var(--s1)">↓ bolje</span>' : '<span style="color:var(--s5)">↑ lošije</span>';
    }
    return { m, cur, trend };
  });
  const periodSev = PERIODS.map((p) => ({ p, v: avg(inRange.filter((e) => e.period === p.key).map(entrySeverity)) }));
  const series = dailySeries(days);

  return head + `
    <div class="grid cols-4" style="margin-bottom:20px">
      <div class="card stat"><div class="label">Unosa</div><div class="v">${inRange.length}</div></div>
      <div class="card stat"><div class="label">Dana sa unosom</div><div class="v">${daysLogged}<span class="small muted"> / ${n}</span></div></div>
      <div class="card stat"><div class="label">Unosa po danu</div><div class="v">${(inRange.length / daysLogged).toFixed(1)}</div></div>
      <div class="card stat"><div class="label">Najduži niz</div><div class="v">${s.bestStreak} <span class="small muted">dana</span></div></div>
    </div>

    <div class="card chart" style="margin-bottom:20px">
      <div class="card-head" style="flex-wrap:wrap">
        <h2>Prosek po danu</h2>
        <div class="metric-chips">${METRICS.map((m) => `<button class="${ui.trendMetrics.has(m.key) ? 'on' : ''}" data-action="toggle-metric" data-metric="${m.key}"><i style="background:${m.color}"></i>${m.name}</button>`).join('')}</div>
      </div>
      ${series.length ? lineChart(series, days) : '<div class="empty small">Izaberite bar jedan simptom.</div>'}
      <p class="small muted" style="margin:10px 0 0">Kod jasnoće vida viša ocena je bolja, a kod ostalih simptoma niža.</p>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h2>Prosek po simptomu</h2>
        <div class="bars">
          ${metricStats.map(({ m, cur, trend }) => `
            <div>
              <div class="bar-row"><span>${m.emoji} ${m.name}</span>
                <div class="bar-track"><span style="width:${(cur / 5) * 100}%;background:${sevColor(severity(m, cur))}"></span></div>
                <b>${cur.toFixed(1)}</b></div>
              ${trend ? `<div class="small" style="margin-left:182px">${trend}</div>` : ''}
            </div>`).join('')}
        </div>
        <p class="small muted" style="margin:14px 0 0">${prevRange.length ? `Poređenje sa prethodnih ${n} dana.` : `Za poređenje je potrebno još podataka iz prethodnih ${n} dana.`}</p>
      </div>
      <div class="card">
        <h2>Kada su tegobe najjače</h2>
        <div class="bars">
          ${periodSev.map(({ p, v }) => `
            <div class="bar-row"><span>${p.emoji} ${p.name}</span>
              <div class="bar-track"><span style="width:${v == null ? 0 : ((v - 1) / 4) * 100}%;background:${v == null ? 'transparent' : sevColor(v)}"></span></div>
              <b>${v == null ? '–' : v.toFixed(1)}</b></div>`).join('')}
        </div>
        <p class="small muted" style="margin:14px 0 0">Ukupni indeks tegoba: 1 = bez tegoba, 5 = jake tegobe.</p>
      </div>
    </div>`;
}

/* ---------- Nagrade ---------- */

function renderRewards() {
  const s = stats();
  return `
    <div class="page-head"><div><h1>Nagrade</h1><div class="sub">Redovni unosi donose XP, nivoe i nagrade partnera.</div></div></div>

    <div class="grid main-side" style="margin-bottom:20px">
      <div class="card hero-card">
        <div class="row between"><span class="level-pill">Nivo ${s.level.n}</span><span>${s.xp} XP</span></div>
        <h2 style="margin:14px 0 4px;color:#fff;font-size:1.6rem">${s.level.name}</h2>
        <div class="muted">${s.next ? `Još ${s.next.xp - s.xp} XP do nivoa ${s.next.n} (${s.next.name})` : 'Dostigli ste najviši nivo!'}</div>
        <div class="progress" style="margin-top:14px"><span style="width:${Math.round(s.progress * 100)}%"></span></div>
      </div>
      <div class="card">
        <h2>Kako se računa XP</h2>
        <p class="small muted" style="margin:0 0 12px">${XP_PER_ENTRY} XP po unosu + ${XP_PER_STREAK_DAY} XP za svaki dan aktivnog niza. Niz je aktivan od ${STREAK_MIN} uzastopna dana. Naknadni unosi se ne računaju u niz.</p>
        <div class="row" style="gap:20px"><span>📝 <b>${s.entryCount}</b> unosa</span><span>🔥 <b>${s.streak}</b> dana (rekord ${s.bestStreak})</span></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h2>Nivoi</h2>
      <div class="level-track">
        ${LEVELS.map((l) => `<div class="level-step ${l.n === s.level.n ? 'cur' : l.n < s.level.n ? 'done' : ''}" title="${l.name}"><b>${l.n}</b>${l.xp} XP${MILESTONES.some((m) => m.level === l.n) ? ' 🎁' : ''}</div>`).join('')}
      </div>
    </div>

    <h2 style="margin-top:28px">Nagrade partnera · Vizim Dom Zdravlja</h2>
    <div class="grid cols-4" style="margin-bottom:28px">
      ${MILESTONES.map((m) => {
        const r = state.redemptions.find((x) => x.milestoneId === m.id);
        const unlocked = s.level.n >= m.level;
        const action = r
          ? `<button class="btn btn-secondary btn-sm" data-action="show-code" data-id="${m.id}">Prikaži kod</button>`
          : unlocked
            ? `<button class="btn btn-primary btn-sm" data-action="claim" data-id="${m.id}">Preuzmi</button>`
            : `<span class="tag">Otključava se na nivou ${m.level}</span>`;
        return `<div class="card milestone ${unlocked || r ? '' : 'locked'}">
          <div class="m-icon">${m.icon}</div>
          <div><strong>${m.title}</strong><div class="small muted">${m.desc}</div></div>
          ${r ? `<div class="small" style="color:var(--primary)">✓ ${r.redeemedAt ? 'Iskorišćeno' : 'Preuzeto'}</div>` : ''}
          <div>${action}</div>
        </div>`;
      }).join('')}
    </div>

    <h2>Bedževi <span class="small muted">${s.badges.length}/${BADGES.length}</span></h2>
    <div class="badge-grid">
      ${BADGES.map((b) => `<div class="badge ${s.badges.includes(b.id) ? '' : 'locked'}"><span class="b-icon">${b.icon}</span><strong>${b.name}</strong><div class="muted">${b.desc}</div></div>`).join('')}
    </div>`;
}

function showCode(milestoneId) {
  const m = MILESTONES.find((x) => x.id === milestoneId);
  const r = state.redemptions.find((x) => x.milestoneId === milestoneId);
  openModal(`
    <h2>${m.icon} ${m.title}</h2>
    <p class="muted small" style="margin:0">${m.desc}</p>
    <div class="code-box">${esc(r.code)}</div>
    <div class="card flat small">
      <b>Kako preuzeti nagradu</b>
      <ol class="bullets" style="color:var(--text)"><li>Posetite Vizim Dom Zdravlja</li><li>Pokažite ovaj kod na šalteru</li><li>Kod je jednokratan</li></ol>
      <div class="muted">Partner vidi samo kod, ne i vaše podatke iz dnevnika.</div>
    </div>
    <p class="small muted">Generisano: ${fmtDate(dayKey(new Date(r.createdAt)))}</p>
    <div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Zatvori</button></div>`);
}

/* ---------- Podešavanja ---------- */

function renderSettings() {
  const u = state.user;
  const n = state.notifications;
  if (!ui.demoEdit) ui.demoEdit = JSON.parse(JSON.stringify(state.demographics));
  const permission = 'Notification' in window ? Notification.permission : 'unsupported';
  const providerName = { google: 'Google', apple: 'Apple', email: 'email i lozinka' }[u.provider] || u.provider;

  return `
    <div class="page-head"><div><h1>Podešavanja</h1><div class="sub">Nalog, podsetnici, privatnost i vaši podaci.</div></div></div>

    <div class="grid cols-2">
      <div class="stack">
        <div class="card">
          <h2>Profil</h2>
          <label class="field">Ime<input type="text" id="name-input" maxlength="80" value="${esc(u.name)}" placeholder="Kako da vas oslovljavamo?"></label>
          <div class="set-row"><div class="grow"><div class="small muted">Email</div>${esc(u.email)}</div><div class="small muted">Prijava: ${providerName}</div></div>
          <button class="btn btn-primary btn-sm" data-action="save-name" style="margin-top:6px">Sačuvaj ime</button>
        </div>

        <div class="card">
          <h2>Podsetnici</h2>
          <div class="set-row"><div class="grow"><strong>Dnevni podsetnici</strong><div class="small muted">Obaveštenja pregledača dok je Visus otvoren u nekoj kartici</div></div>
            <label class="switch"><input type="checkbox" data-action-change="notif-toggle" ${n.enabled ? 'checked' : ''}><span></span></label></div>
          ${n.enabled ? PERIODS.map((p) => `<div class="set-row"><div class="grow">${p.emoji} ${p.name}</div><input type="time" value="${n[p.key]}" data-action-change="notif-time" data-period="${p.key}"></div>`).join('') : ''}
          ${n.enabled && permission === 'denied' ? '<p class="small" style="color:var(--danger);margin-bottom:0">Pregledač blokira obaveštenja. Dozvolite ih u podešavanjima pregledača (ikonica katanca pored adrese).</p>' : ''}
          ${n.enabled && permission === 'granted' ? '<button class="btn btn-ghost btn-sm" data-action="test-notif" style="margin-top:8px">Pošalji probno obaveštenje</button>' : ''}
          ${n.enabled && permission === 'default' ? '<button class="btn btn-ghost btn-sm" data-action="ask-notif" style="margin-top:8px">Dozvoli obaveštenja</button>' : ''}
        </div>

        <div class="card">
          <h2>Istraživanje</h2>
          <div class="set-row"><div class="grow"><strong>${state.research.optIn ? '✅ Učestvujete' : 'Ne učestvujete'}</strong>
            <div class="small muted">${state.research.optIn ? 'Anonimne ocene se dele sa istraživačkim timom.' : 'Ništa se ne deli sa istraživačkim timom.'}</div></div>
            <button class="btn btn-ghost btn-sm" data-action="research-modal">${state.research.optIn ? 'Isključi' : 'Uključi'}</button></div>
          <button class="link-btn small" data-action="research-preview">Šta tačno delim →</button>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <h2>Demografski podaci</h2>
          <p class="small muted" style="margin-top:-6px">Sva polja su opciona.</p>
          ${demographicsForm(ui.demoEdit, 'edit')}
          <div class="row" style="margin-top:18px">
            <button class="btn btn-primary btn-sm" data-action="save-demo">Sačuvaj</button>
            <button class="btn btn-ghost btn-sm" data-action="clear-demo">Obriši sve</button>
          </div>
        </div>

        <div class="card">
          <h2>Privatnost i podaci</h2>
          <div class="set-actions">
            <button class="btn btn-ghost" data-action="export">⬇️ Izvezi sve moje podatke (JSON)</button>
            <button class="btn btn-ghost" data-action="consent-info">📜 Moje saglasnosti (verzija ${esc(state.consent?.version)})</button>
            <div class="row small"><a href="../privacy.html" target="_blank">Politika privatnosti</a> · <a href="../terms.html" target="_blank">Uslovi korišćenja</a></div>
            <button class="btn btn-danger" data-action="delete-entries">Obriši sve unose</button>
            <button class="btn btn-danger" data-action="delete-account-confirm">Obriši nalog</button>
          </div>
        </div>
      </div>
    </div>`;
}

function researchModal() {
  openModal(state.research.optIn ? `
    <h2>Povlačenje iz istraživanja</h2>
    <ul class="bullets"><li>Novi unosi se više neće deliti</li><li>Aplikaciju i dalje koristite potpuno isto</li><li>Već podeljeni pseudonimni zapisi ostaju u istraživačkoj arhivi</li></ul>
    <div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal">Ostavi uključeno</button><button class="btn btn-danger" data-action="research-set" data-value="off">Isključi učešće</button></div>` : `
    <h2>Učešće u istraživanju</h2>
    <p class="muted">Delićete samo ocene simptoma, doba dana i vreme unosa, pod pseudonimom. Bez imena, emaila i beleški.</p>
    <p class="small muted">Deljenje počinje od sledećeg unosa. Ranije unose ne delimo naknadno.</p>
    <div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal">Ne sada</button><button class="btn btn-primary" data-action="research-set" data-value="on">Uključi učešće</button></div>`);
}

async function researchPreview() {
  const { count, last } = check(await sb.rpc('research_preview'));
  const sample = last || { pseudonym: '3f9a…(jednosmerni heš)', timestamp: new Date().toISOString(), period: 'morning', scores: { dryness: 3, clarity: 4, fatigue: 2, redness: 1, light: 2 }, eyeCrop: null };
  const intro = last
    ? `Do sada podeljeno zapisa: <b>${count}</b>. Ovo je poslednji:`
    : state.research.optIn ? 'Još niste podelili nijedan zapis. Ovako će izgledati:' : 'Trenutno ne delite ništa. Ovako bi izgledao jedan zapis:';
  openModal(`
    <h2>Šta tačno delim</h2>
    <p class="small muted">${intro}</p>
    <pre class="json">${esc(JSON.stringify(sample, null, 2))}</pre>
    <p class="small muted">Nema imena, emaila, ID-ja uređaja, beleški ni demografskih podataka.</p>
    <div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Zatvori</button></div>`);
}

function consentInfo() {
  const label = { app: 'Obrada podataka i uslovi', research: 'Istraživanje' };
  openModal(`
    <h2>Moje saglasnosti</h2>
    <table class="table small">
      <thead><tr><th>Datum</th><th>Saglasnost</th><th>Odluka</th><th>Verzija</th></tr></thead>
      <tbody>${state.consentLog.map((c) => `<tr><td>${fmtDate(dayKey(new Date(c.created_at)), false)}</td><td>${label[c.kind]}</td><td>${c.granted ? 'prihvaćeno' : 'odbijeno'}</td><td>${esc(c.version)}</td></tr>`).join('')}</tbody>
    </table>
    <p class="small muted">Saglasnost za obradu podataka povlačite brisanjem naloga. Učešće u istraživanju menjate posebno.</p>
    <div class="modal-actions"><button class="btn btn-primary" data-action="close-modal">Zatvori</button></div>`);
}

function exportData() {
  downloadJSON(`visus-podaci-${todayKey()}.json`, {
    format: 'visus-export-v1',
    exportedAt: new Date().toISOString(),
    account: { ...state.user },
    consent: state.consent,
    consentLog: state.consentLog.map((c) => ({ kind: c.kind, granted: c.granted, version: c.version, at: c.created_at })),
    research: state.research,
    demographics: state.demographics,
    notifications: state.notifications,
    entries: state.entries,
    rewards: state.redemptions,
  });
  toast('Podaci su preuzeti');
}

/* ---------- Podsetnici (obaveštenja pregledača) ---------- */

function checkReminders() {
  const n = state?.notifications;
  if (!n?.enabled || !state.onboarded || !('Notification' in window) || Notification.permission !== 'granted') return;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const t = todayKey();
  for (const p of PERIODS) {
    const [h, m] = n[p.key].split(':').map(Number);
    const due = h * 60 + m;
    if (mins < due || mins - due > 15 || findEntry(t, p.key)) continue;
    const key = `visus.reminded.${state.user.id}.${t}.${p.key}`;
    try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch {}
    const notif = new Notification('Visus', { body: `${p.emoji} Vreme je za unos: ${p.name.toLowerCase()}.`, icon: '../assets/logo.svg', tag: key });
    notif.onclick = () => { window.focus(); openLog(t, p.key); notif.close(); };
  }
}
setInterval(checkReminders, 30_000);

/* ---------- Događaji ---------- */

function demoTarget(scope) {
  return scope === 'onb' ? ui.onb.demo : ui.demoEdit;
}

function handleBind(el) {
  const { scope, bind } = el.dataset;
  const root = bind === 'ageRange' ? demoTarget(scope) : scope === 'onb' ? ui.onb : scope === 'draft' ? ui.draft : null;
  if (!root) return;
  const keys = bind.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], root);
  target[last] = el.type === 'checkbox' ? el.checked : el.value;
  if ('rerender' in el.dataset) render();
}

function signedOut() {
  state = null;
  setPending(null); // npr. "Odustani" u onboardingu: bez saglasnosti se unos ne čuva
  Object.assign(ui, { onb: null, draft: null, selDate: null, calMonth: null, demoEdit: null, authTab: 'login' });
  closeModal();
  go('/home');
}

function openLog(date, period) {
  if (parseHash().path !== '/log') ui.returnTo = location.hash.slice(1) || '/home';
  go(`/log?date=${date}&period=${period}`);
}

function setMenu(open) {
  ui.menuOpen = open;
  render();
}

const actions = {
  reload() { location.reload(); },
  'toggle-menu'() { setMenu(!ui.menuOpen); },
  'go-login'() { ui.authTab = 'login'; ui.authMsg = null; go('/login'); },
  'go-signup'() { ui.authTab = 'signup'; ui.authMsg = null; go('/login'); },
  'go-guest-log'() {
    const p = getPending();
    ui.authMsg = null;
    go(p ? `/log?date=${p.date}&period=${p.period}` : '/home');
  },
  'auth-tab'(el) { ui.authTab = el.dataset.tab; ui.authMsg = null; render(); },
  async 'login-google'() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: APP_URL } });
    if (error) throw new AppError(error.message);
  },
  async logout() {
    await sb.auth.signOut();
    signedOut();
  },
  'onb-next'() { ui.onb.step++; render(); },
  'onb-back'() { ui.onb.step--; render(); },
  'onb-skip-demo'() { ui.onb.demo = {}; ui.onb.step++; render(); },
  'onb-research'(el) { ui.onb.research = el.dataset.value === 'yes'; render(); },
  async 'onb-finish'() {
    const o = ui.onb;
    await updateProfile({
      consent_version: CONSENT_VERSION,
      research_opt_in: o.research,
      demographics: cleanDemographics(o.demo),
      notifications: o.notif,
      timezone: TIMEZONE,
      onboarded_at: new Date().toISOString(),
    });
    await reloadConsents();
    if (o.notif.enabled && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    ui.onb = null;
    if (!(await resumePending())) go('/home');
  },
  choice(el) {
    const target = demoTarget(el.dataset.scope);
    const { field, value } = el.dataset;
    if ('multi' in el.dataset) {
      const arr = target[field] || [];
      target[field] = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
      el.classList.toggle('on');
    } else {
      const same = target[field] === value;
      target[field] = same ? '' : value;
      el.parentElement.querySelectorAll('.choice').forEach((c) => c.classList.remove('on'));
      if (!same) el.classList.add('on');
    }
  },
  async 'reconsent-accept'() {
    if (!$('#reconsent-check').checked) return toast('Označite polje za saglasnost');
    await updateProfile({ consent_version: CONSENT_VERSION });
    await reloadConsents();
    toast('Hvala!');
    if (!(await resumePending())) go('/home');
  },
  'new-entry'() { openLog(todayKey(), defaultPeriod()); },
  'open-log'(el) { openLog(el.dataset.date, el.dataset.period); },
  'log-period'(el) {
    const date = parseHash().params.get('date') || todayKey();
    location.replace(`#/log?date=${date}&period=${el.dataset.period}`);
  },
  score(el) {
    ui.draft.scores[el.dataset.metric] = Number(el.dataset.value);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },
  'save-entry'() { return saveEntry(); },
  'delete-entry'(el) {
    openModal(`<h2>Obrisati unos?</h2><p class="muted">Ova radnja se ne može poništiti.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal">Otkaži</button><button class="btn btn-danger" data-action="delete-entry-yes" data-id="${el.dataset.id}">Obriši</button></div>`);
  },
  async 'delete-entry-yes'(el) {
    check(await sb.from('entries').delete().eq('id', el.dataset.id));
    state.entries = state.entries.filter((e) => e.id !== el.dataset.id);
    closeModal();
    toast('Unos je obrisan');
    leaveLog();
  },
  back() { leaveLog(); },
  'select-day'(el) { ui.selDate = el.dataset.date; render(); },
  'cal-prev'() { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() - 1, 1); render(); },
  'cal-next'() { ui.calMonth = new Date(ui.calMonth.getFullYear(), ui.calMonth.getMonth() + 1, 1); render(); },
  range(el) { ui.range = Number(el.dataset.value); render(); },
  'toggle-metric'(el) {
    const k = el.dataset.metric;
    ui.trendMetrics.has(k) ? ui.trendMetrics.delete(k) : ui.trendMetrics.add(k);
    render();
  },
  async claim(el) {
    const row = check(await sb.rpc('claim_reward', { p_milestone: el.dataset.id }));
    const r = redemptionFromRow(row);
    if (!state.redemptions.some((x) => x.milestoneId === r.milestoneId)) state.redemptions.push(r);
    render();
    showCode(r.milestoneId);
  },
  'show-code'(el) { showCode(el.dataset.id); },
  'close-modal'(el) {
    closeModal();
    if (el.dataset.go) go(el.dataset.go);
  },
  'modal-backdrop'(el, e) { if (e.target === el) closeModal(); },
  async 'save-name'() {
    await updateProfile({ name: $('#name-input').value.trim().slice(0, 80) || null });
    render();
    toast('Ime je sačuvano');
  },
  async 'save-demo'() {
    await updateProfile({ demographics: cleanDemographics(ui.demoEdit) });
    ui.demoEdit = null;
    render();
    toast('Demografski podaci su sačuvani');
  },
  async 'clear-demo'() {
    await updateProfile({ demographics: {} });
    ui.demoEdit = null;
    render();
    toast('Demografski podaci su obrisani');
  },
  'research-modal'() { researchModal(); },
  async 'research-set'(el) {
    await updateProfile({ research_opt_in: el.dataset.value === 'on' });
    await reloadConsents();
    closeModal();
    render();
    toast(state.research.optIn ? 'Hvala što pomažete istraživanju! 🔬' : 'Učešće je isključeno');
  },
  'research-preview'() { return researchPreview(); },
  'consent-info'() { consentInfo(); },
  async 'ask-notif'() { await Notification.requestPermission(); render(); },
  'test-notif'() { new Notification('Visus', { body: '🌅 Ovako izgleda podsetnik za unos.', icon: '../assets/logo.svg' }); },
  export() { exportData(); },
  'delete-entries'() {
    openModal(`<h2>Obrisati sve unose?</h2><p class="muted">Brišu se svi unosi iz dnevnika (${state.entries.length}). Nalog i podešavanja ostaju. Ova radnja se ne može poništiti.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal">Otkaži</button><button class="btn btn-danger" data-action="delete-entries-yes">Obriši sve unose</button></div>`);
  },
  async 'delete-entries-yes'() {
    check(await sb.from('entries').delete().eq('user_id', state.user.id));
    state.entries = [];
    closeModal();
    render();
    toast('Svi unosi su obrisani');
  },
  'delete-account-confirm'() {
    openModal(`<h2>Obrisati nalog?</h2>
      <p class="muted">Trajno se brišu nalog, svi unosi, beleške, demografski podaci, podešavanja i kodovi nagrada.</p>
      <p class="small muted">Pseudonimni istraživački zapisi ostaju u arhivi.</p>
      <p class="small">Savet: pre brisanja <button class="link-btn" data-action="export">izvezite svoje podatke</button>.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-action="close-modal">Otkaži</button><button class="btn btn-danger" data-action="delete-account">Trajno obriši nalog</button></div>`);
  },
  async 'delete-account'() {
    check(await sb.rpc('delete_account'));
    await sb.auth.signOut({ scope: 'local' });
    toast('Nalog je obrisan');
    signedOut();
  },
};

const changeActions = {
  async 'notif-toggle'(el) {
    await updateProfile({ notifications: { ...state.notifications, enabled: el.checked } });
    if (el.checked && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    render();
  },
  async 'notif-time'(el) {
    if (!el.value) return;
    await updateProfile({ notifications: { ...state.notifications, [el.dataset.period]: el.value } });
    toast('Vreme podsetnika je sačuvano');
  },
  'log-date'(el) {
    if (!el.value) return;
    const date = el.value > todayKey() ? todayKey() : el.value;
    location.replace(`#/log?date=${date}&period=${defaultPeriod(date)}`);
  },
};

function run(fn, el, e) {
  if (ui.busy) return;
  let result;
  try { result = fn(el, e); } catch (err) { return handleError(err); }
  if (result && typeof result.then === 'function') {
    ui.busy = true;
    document.body.classList.add('busy');
    result.catch(handleError).finally(() => { ui.busy = false; document.body.classList.remove('busy'); });
  }
}

document.addEventListener('click', (e) => {
  if (ui.menuOpen && e.target.closest('#sidebar a, #sidebar .btn')) {
    ui.menuOpen = false;
    setTimeout(render, 0); // zatvori meni i kada se klikne strana na kojoj smo već
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) run(fn, el, e);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  run(authForms[form.dataset.form], form, e);
});

document.addEventListener('input', (e) => {
  if (e.target.dataset.bind && e.target.type !== 'checkbox') handleBind(e.target);
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.bind && (el.type === 'checkbox' || el.tagName === 'SELECT')) handleBind(el);
  const fn = changeActions[el.dataset.actionChange];
  if (fn) run(fn, el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && parseHash().path === '/log' && ui.draft) {
    e.preventDefault();
    run(saveEntry);
  }
});

window.addEventListener('hashchange', () => {
  ui.menuOpen = false;
  closeModal();
  render();
  if (ui.afterNav) { const fn = ui.afterNav; ui.afterNav = null; fn(); }
});

/* ---------- Pokretanje ---------- */

(async function boot() {
  if (!sb) return render();
  try {
    const { data: { session } } = await sb.auth.getSession();
    // Posle povratka sa Google-a / linka iz emaila u adresi ostaje ?code=…, pa se uklanja.
    if (location.search) history.replaceState(null, '', location.pathname + location.hash);
    if (session) await loadState(session.user);
    render();
    if (state) await resumePending().catch(handleError); // npr. povratak sa Google prijave
    checkReminders();

    sb.auth.onAuthStateChange((event, s) => {
      // Supabase preporučuje da se iz ovog callback-a ne čeka direktno na druge pozive.
      setTimeout(async () => {
        if (event === 'PASSWORD_RECOVERY') return showNewPasswordModal();
        if (event === 'SIGNED_OUT' && state) return signedOut();
        if (event === 'SIGNED_IN' && s && (!state || state.user.id !== s.user.id)) {
          try { await afterSignIn(s.user); } catch (err) { handleError(err); }
        }
      }, 0);
    });
  } catch (err) {
    $('#layout').classList.add('bare');
    $('#app').innerHTML = `<div class="setup center"><div style="font-size:2.4rem">⚠️</div><p>${esc(err.message)}</p><button class="btn btn-primary" data-action="reload">Pokušaj ponovo</button></div>`;
  }
})();
