/* ==========================================================================
   Visus – admin strana (/admin) za istraživački tim.
   Prikazuje samo anonimne istraživačke zapise (Tier 1) i ukupne brojeve.
   Pristup proverava baza (private.admins, public.is_admin / admin_*).
   ========================================================================== */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, GOOGLE_LOGIN } from '../config.js';
import { METRICS, PERIODS, SYMPTOMS, URGENCY, dayKey, addDays, severity } from './rules.js';
import { lineChart } from './chart.js';

const ADMIN_URL = location.origin + location.pathname;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });

const ui = {
  range: 30,        // broj dana, ili null = svi zapisi
  session: null,
  isAdmin: false,
  overview: null,
  records: [],
  msg: null,
  busy: false,
};

/* ---------- Pomoćne funkcije ---------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const sevColor = (sev) => `var(--s${Math.min(5, Math.max(1, Math.round(sev)))})`;
const periodOf = (key) => PERIODS.find((p) => p.key === key);
const shortId = (p) => p.slice(0, 10) + '…';
const fmtNum = (n) => new Intl.NumberFormat('sr-Latn-RS').format(n);

function fmtDateTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDay(key) {
  const [y, m, d] = key.split('-');
  return `${d}.${m}.${y}.`;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function check({ data, error }) {
  if (error) throw new Error(error.message || 'Došlo je do greške');
  return data;
}

// PostgREST vraća najviše 1000 redova po zahtevu.
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await build().range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/* ---------- Podaci ---------- */

async function loadData() {
  const from = ui.range ? new Date(Date.now() - ui.range * 864e5).toISOString() : null;
  const [overview, rows] = await Promise.all([
    sb.rpc('admin_overview').then(check),
    fetchAll(() => sb.rpc('admin_research', { p_from: from, p_to: null })),
  ]);
  ui.overview = overview;
  ui.records = rows.map((r) => ({
    pseudonym: r.pseudonym,
    timestamp: r.timestamp,
    date: dayKey(new Date(r.timestamp)),
    period: r.period,
    scores: Object.fromEntries(METRICS.map((m) => [m.key, r[m.key]])),
    symptoms: r.symptoms || [],
    urgency: r.urgency || null,
  }));
}

async function refresh() {
  const { data: { session } } = await sb.auth.getSession();
  ui.session = session;
  ui.isAdmin = false;
  if (session) {
    ui.isAdmin = check(await sb.rpc('is_admin'));
    if (ui.isAdmin) await loadData();
  }
  render();
}

/* ---------- Prikaz ---------- */

function render() {
  const root = $('#admin');
  if (!ui.session) return (root.innerHTML = renderLogin());
  if (!ui.isAdmin) return (root.innerHTML = renderNoAccess());
  root.innerHTML = renderBar() + `<main class="admin-main"><div class="page">${renderDashboard()}</div></main>`;
}

function renderBar() {
  return `
    <header class="admin-bar">
      <a class="brand" href="/"><img src="assets/logo.svg" alt=""><span>Visus</span></a>
      <span class="admin-tag">Admin</span>
      <a class="btn btn-ghost btn-sm" href="/">← Aplikacija</a>
      <span class="who">${esc(ui.session.user.email)}</span>
      <button class="btn btn-ghost btn-sm" data-action="logout">Odjavi se</button>
    </header>`;
}

function renderLogin() {
  const msg = ui.msg ? `<div class="form-msg err">${esc(ui.msg)}</div>` : '';
  return `
    <div class="admin-login">
      <div class="brand"><img src="assets/logo.svg" alt=""><span>Visus</span><span class="admin-tag">Admin</span></div>
      <div class="card">
        <h2>Prijava za istraživački tim</h2>
        <p class="small muted" style="margin-top:0">Pristup imaju samo nalozi koje je administrator baze dodao kao admin.</p>
        ${msg}
        <form data-form="login">
          <label class="field">Email<input type="email" name="email" autocomplete="email" required></label>
          <label class="field">Lozinka<input type="password" name="password" autocomplete="current-password" required></label>
          <button class="btn btn-primary btn-block" type="submit">Prijavi se</button>
        </form>
        ${GOOGLE_LOGIN ? `<div class="divider">ili</div><button class="btn btn-google" data-action="login-google">Nastavi sa Google nalogom</button>` : ''}
      </div>
      <p class="center small"><a href="/">← Nazad u aplikaciju</a></p>
    </div>`;
}

function renderNoAccess() {
  return `
    <div class="admin-login">
      <div class="brand"><img src="assets/logo.svg" alt=""><span>Visus</span><span class="admin-tag">Admin</span></div>
      <div class="card">
        <h2>Nemate pristup</h2>
        <p class="muted">Nalog <b>${esc(ui.session.user.email)}</b> nije administrator. Ako treba da imate pristup, javite se administratoru baze.</p>
        <div class="row">
          <a class="btn btn-ghost" href="/">Nazad u aplikaciju</a>
          <button class="btn btn-ghost" data-action="logout">Odjavi se</button>
        </div>
      </div>
    </div>`;
}

function renderDashboard() {
  const o = ui.overview;
  const recs = ui.records;
  const rangeLabel = ui.range ? `poslednjih ${ui.range} dana` : 'svi zapisi';
  const optInPct = o.users ? Math.round((o.research_participants / o.users) * 100) : 0;

  const head = `
    <div class="page-head">
      <div><h1>Istraživački podaci</h1><div class="sub">Anonimni zapisi korisnika koji su pristali na istraživanje.</div></div>
      <div class="row" style="flex-wrap:wrap">
        <div class="seg">${[[30, '30 dana'], [90, '90 dana'], [365, '12 meseci'], [null, 'Sve']].map(([v, l]) => `<button class="${ui.range === v ? 'on' : ''}" data-action="range" data-value="${v ?? ''}">${l}</button>`).join('')}</div>
        <button class="btn btn-primary" data-action="export" ${recs.length ? '' : 'disabled'}>⬇️ Izvezi CSV</button>
      </div>
    </div>

    <div class="grid cols-4">
      <div class="card stat"><div class="label">Korisnika</div><div class="v">${fmtNum(o.users)}</div><div class="hint">završilo podešavanje naloga</div></div>
      <div class="card stat"><div class="label">U istraživanju</div><div class="v">${fmtNum(o.research_participants)}</div><div class="hint">${optInPct}% korisnika</div></div>
      <div class="card stat"><div class="label">Unosa ukupno</div><div class="v">${fmtNum(o.entries)}</div><div class="hint">${fmtNum(o.research_records)} anonimnih zapisa</div></div>
      <div class="card stat"><div class="label">Lista čekanja</div><div class="v">${fmtNum(o.waitlist)}</div><div class="hint">za mobilnu aplikaciju</div></div>
    </div>`;

  if (!recs.length) {
    return head + `<h2 class="section-title">Zapisi · <span class="small muted">${rangeLabel}</span></h2>
      <div class="card empty"><div class="big">🔬</div>Nema istraživačkih zapisa u ovom periodu.</div>`;
  }

  return head + `
    <h2 class="section-title">Zapisi · <span class="small muted">${rangeLabel}</span></h2>
    ${renderRangeStats(recs)}
    ${renderChart(recs)}
    <div class="grid cols-2" style="margin-top:20px">${renderMetricAverages(recs)}${renderPeriods(recs)}</div>
    <div class="grid cols-2" style="margin-top:20px">${renderSymptoms(recs)}${renderUrgency(recs)}</div>
    <div style="margin-top:20px">${renderDistribution(recs)}</div>
    <div class="grid cols-2" style="margin-top:20px">${renderParticipants(recs)}${renderLatest(recs)}</div>`;
}

function renderRangeStats(recs) {
  const participants = new Set(recs.map((r) => r.pseudonym)).size;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const active7 = new Set(recs.filter((r) => r.timestamp >= weekAgo).map((r) => r.pseudonym)).size;
  return `
    <div class="grid cols-4">
      <div class="card stat"><div class="label">Zapisa</div><div class="v">${fmtNum(recs.length)}</div></div>
      <div class="card stat"><div class="label">Učesnika</div><div class="v">${fmtNum(participants)}</div></div>
      <div class="card stat"><div class="label">Zapisa po učesniku</div><div class="v">${(recs.length / participants).toFixed(1)}</div></div>
      <div class="card stat"><div class="label">Aktivnih (7 dana)</div><div class="v">${fmtNum(active7)}</div></div>
    </div>`;
}

function renderChart(recs) {
  const today = dayKey();
  const first = recs.reduce((min, r) => (r.date < min ? r.date : min), today);
  let n = ui.range || 1;
  if (!ui.range) { n = 1; while (addDays(today, -n + 1) > first && n < 365) n++; }
  const days = Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
  const byDay = {};
  for (const r of recs) (byDay[r.date] ||= []).push(r);
  const series = METRICS.map((m) => ({ metric: m, values: days.map((d) => (byDay[d] ? avg(byDay[d].map((r) => r.scores[m.key])) : null)) }));
  return `
    <div class="card chart" style="margin-top:20px">
      <div class="card-head"><h2>Prosek svih učesnika po danu</h2></div>
      ${lineChart(series, days)}
      <div class="legend">${METRICS.map((m) => `<span><i style="background:${m.color}"></i>${m.name}</span>`).join('')}</div>
      <p class="small muted" style="margin:10px 0 0">Kod jasnoće vida viša ocena je bolja, a kod ostalih simptoma niža.</p>
    </div>`;
}

function renderMetricAverages(recs) {
  return `
    <div class="card">
      <h2>Prosek po simptomu</h2>
      <div class="bars">
        ${METRICS.map((m) => {
          const v = avg(recs.map((r) => r.scores[m.key]));
          return `<div class="bar-row"><span>${m.emoji} ${m.name}</span>
            <div class="bar-track"><span style="width:${(v / 5) * 100}%;background:${sevColor(severity(m, v))}"></span></div><b>${v.toFixed(2)}</b></div>`;
        }).join('')}
      </div>
    </div>`;
}

function renderPeriods(recs) {
  const sev = (r) => METRICS.reduce((s, m) => s + severity(m, r.scores[m.key]), 0) / METRICS.length;
  return `
    <div class="card">
      <h2>Tegobe po dobu dana</h2>
      <div class="bars">
        ${PERIODS.map((p) => {
          const list = recs.filter((r) => r.period === p.key);
          const v = avg(list.map(sev));
          return `<div class="bar-row"><span>${p.emoji} ${p.name}</span>
            <div class="bar-track"><span style="width:${v == null ? 0 : ((v - 1) / 4) * 100}%;background:${v == null ? 'transparent' : sevColor(v)}"></span></div>
            <b>${v == null ? '–' : v.toFixed(2)}</b></div>
            <div class="small muted" style="margin:-8px 0 0 182px">${fmtNum(list.length)} zapisa</div>`;
        }).join('')}
      </div>
      <p class="small muted" style="margin:14px 0 0">Ukupni indeks tegoba: 1 = bez tegoba, 5 = jake tegobe.</p>
    </div>`;
}

function renderSymptoms(recs) {
  const rows = SYMPTOMS.map((x) => ({ x, n: recs.filter((r) => r.symptoms.includes(x.key)).length })).sort((a, b) => b.n - a.n);
  return `
    <div class="card">
      <h2>Prisutni simptomi</h2>
      <div class="bars">
        ${rows.map(({ x, n }) => `<div class="bar-row"><span>${x.name}</span>
          <div class="bar-track"><span style="width:${(n / recs.length) * 100}%;background:var(--accent)"></span></div>
          <b title="${fmtNum(n)} zapisa">${Math.round((n / recs.length) * 100)}%</b></div>`).join('')}
      </div>
      <p class="small muted" style="margin:14px 0 0">Procenat zapisa u kojima je simptom označen.</p>
    </div>`;
}

function renderUrgency(recs) {
  const withU = recs.filter((r) => r.urgency);
  const colors = { usual: 'var(--s1)', sudden: 'var(--s4)', doctor: 'var(--s5)' };
  return `
    <div class="card">
      <h2>Stanje hitnosti</h2>
      ${withU.length ? `<div class="bars">
        ${URGENCY.map((u) => {
          const n = withU.filter((r) => r.urgency === u.key).length;
          return `<div class="bar-row"><span>${u.icon} ${u.name}</span>
            <div class="bar-track"><span style="width:${(n / withU.length) * 100}%;background:${colors[u.key]}"></span></div>
            <b title="${fmtNum(n)} zapisa">${Math.round((n / withU.length) * 100)}%</b></div>`;
        }).join('')}
      </div>` : '<div class="empty small">Još nema zapisa sa stanjem hitnosti.</div>'}
      ${withU.length < recs.length ? `<p class="small muted" style="margin:14px 0 0">${fmtNum(recs.length - withU.length)} starijih zapisa nema ovaj podatak.</p>` : ''}
    </div>`;
}

function renderDistribution(recs) {
  return `
    <div class="card">
      <div class="card-head"><h2>Raspodela ocena</h2></div>
      <div class="dist">
        ${METRICS.map((m) => {
          const counts = [1, 2, 3, 4, 5].map((n) => recs.filter((r) => r.scores[m.key] === n).length);
          return `<div class="dist-row"><span>${m.emoji} ${m.name}</span>
            <div class="dist-bar">${counts.map((c, i) => c ? `<span title="Ocena ${i + 1}: ${c} (${Math.round((c / recs.length) * 100)}%)" style="width:${(c / recs.length) * 100}%;background:${sevColor(severity(m, i + 1))}"></span>` : '').join('')}</div></div>`;
        }).join('')}
      </div>
      <p class="small muted" style="margin:14px 0 0">Boja pokazuje težinu tegobe (zeleno = bez tegoba, crveno = jake). Pređite mišem preko dela trake za broj zapisa.</p>
    </div>`;
}

function renderParticipants(recs) {
  const map = new Map();
  for (const r of recs) {
    const p = map.get(r.pseudonym) || { pseudonym: r.pseudonym, n: 0, first: r.date, last: r.date };
    p.n++;
    if (r.date < p.first) p.first = r.date;
    if (r.date > p.last) p.last = r.date;
    map.set(r.pseudonym, p);
  }
  const list = [...map.values()].sort((a, b) => b.n - a.n);
  return `
    <div class="card">
      <div class="card-head"><h2>Učesnici</h2><span class="small muted">${fmtNum(list.length)}</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Pseudonim</th><th>Zapisa</th><th>Prvi</th><th>Poslednji</th></tr></thead>
        <tbody>${list.slice(0, 15).map((p) => `<tr><td class="mono" title="${esc(p.pseudonym)}">${esc(shortId(p.pseudonym))}</td><td>${p.n}</td><td>${fmtDay(p.first)}</td><td>${fmtDay(p.last)}</td></tr>`).join('')}</tbody>
      </table></div>
      ${list.length > 15 ? `<p class="small muted" style="margin:10px 0 0">i još ${list.length - 15} – svi su u CSV izvozu.</p>` : ''}
    </div>`;
}

function renderLatest(recs) {
  const latest = recs.slice(-15).reverse();
  return `
    <div class="card">
      <div class="card-head"><h2>Poslednji zapisi</h2></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Vreme</th><th>Doba</th>${METRICS.map((m) => `<th title="${m.name}">${m.emoji}</th>`).join('')}<th>Stanje</th></tr></thead>
        <tbody>${latest.map((r) => `<tr>
          <td>${fmtDateTime(r.timestamp)}</td><td>${periodOf(r.period)?.emoji || ''}</td>
          ${METRICS.map((m) => `<td><span class="pill-score" style="background:${sevColor(severity(m, r.scores[m.key]))}">${r.scores[m.key]}</span></td>`).join('')}
          <td title="${URGENCY.find((u) => u.key === r.urgency)?.name || ''}">${URGENCY.find((u) => u.key === r.urgency)?.icon || '–'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`;
}

/* ---------- CSV izvoz (za Excel / Power BI) ---------- */

function exportCsv() {
  // Simptomi: jedna kolona 0/1 po simptomu, da bi se lako analizirali u Excel-u / Power BI-ju.
  const cols = ['pseudonym', 'timestamp', 'period', ...METRICS.map((m) => m.key), 'urgency', ...SYMPTOMS.map((x) => `symptom_${x.key}`)];
  const lines = [cols.join(',')].concat(ui.records.map((r) => [
    r.pseudonym, r.timestamp, r.period, ...METRICS.map((m) => r.scores[m.key]), r.urgency ?? '',
    ...SYMPTOMS.map((x) => (r.symptoms.includes(x.key) ? 1 : 0)),
  ].join(',')));
  // BOM da bi Excel ispravno prepoznao UTF-8
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: `visus-istrazivanje-${dayKey()}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Izvezeno ${fmtNum(ui.records.length)} zapisa`);
}

/* ---------- Događaji ---------- */

const actions = {
  async range(el) {
    ui.range = el.dataset.value ? Number(el.dataset.value) : null;
    await loadData();
    render();
  },
  export() { exportCsv(); },
  async logout() {
    await sb.auth.signOut();
    ui.session = null;
    ui.isAdmin = false;
    render();
  },
  async 'login-google'() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: ADMIN_URL } });
    if (error) throw new Error(error.message);
  },
};

async function login(form) {
  const { error } = await sb.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
  ui.msg = error ? 'Pogrešan email ili lozinka.' : null;
  if (error) return render();
  await refresh();
}

function run(promiseOrValue) {
  if (!promiseOrValue?.then) return;
  ui.busy = true;
  document.body.classList.add('busy');
  promiseOrValue
    .catch((err) => { console.error(err); toast(err.message || 'Došlo je do greške'); })
    .finally(() => { ui.busy = false; document.body.classList.remove('busy'); });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || ui.busy) return;
  const fn = actions[el.dataset.action];
  if (fn) run(fn(el, e));
});

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-form=login]')) return;
  e.preventDefault();
  if (!ui.busy) run(login(e.target));
});

/* ---------- Pokretanje ---------- */

(async function boot() {
  try {
    await sb.auth.getSession();
    if (location.search) history.replaceState(null, '', location.pathname); // posle Google prijave
    await refresh();
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setTimeout(() => { ui.session = null; ui.isAdmin = false; render(); }, 0);
    });
  } catch (err) {
    $('#admin').innerHTML = `<div class="admin-login"><div class="card center"><div style="font-size:2.4rem">⚠️</div><p>${esc(err.message)}</p><a class="btn btn-primary" href="">Pokušaj ponovo</a></div></div>`;
  }
})();
