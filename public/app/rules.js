// Shared product rules – imported by the web app and by the server
// (the server uses them to validate input and reward claims).

export const CONSENT_VERSION = '1.0';
export const STREAK_MIN = 3;
export const XP_PER_ENTRY = 15;
export const XP_PER_STREAK_DAY = 5;
export const NOTE_MAX = 500;

export const METRICS = [
  { key: 'dryness', name: 'Suvoća', emoji: '💧', color: 'var(--c-dryness)',
    labels: ['Bez suvoće', 'Blaga', 'Umerena', 'Izražena', 'Jaka'] },
  { key: 'clarity', name: 'Jasnoća vida', emoji: '👓', color: 'var(--c-clarity)', invert: true,
    labels: ['Veoma mutno', 'Mutno', 'Delimično jasno', 'Jasno', 'Potpuno jasno'] },
  { key: 'fatigue', name: 'Zamor očiju', emoji: '😮‍💨', color: 'var(--c-fatigue)',
    labels: ['Bez zamora', 'Blag', 'Umeren', 'Izražen', 'Jak'] },
  { key: 'redness', name: 'Crvenilo', emoji: '🔴', color: 'var(--c-redness)',
    labels: ['Bez crvenila', 'Blago', 'Umereno', 'Izraženo', 'Jako'] },
  { key: 'light', name: 'Osetljivost na svetlo', emoji: '☀️', color: 'var(--c-light)',
    labels: ['Nimalo', 'Blaga', 'Umerena', 'Izražena', 'Jaka'] },
];

export const PERIODS = [
  { key: 'morning', name: 'Jutro', emoji: '🌅', hint: 'Posle buđenja' },
  { key: 'working', name: 'Tokom dana', emoji: '🌤️', hint: 'Sredina dana' },
  { key: 'evening', name: 'Veče', emoji: '🌙', hint: 'Pre spavanja' },
];

export const LEVELS = [
  { n: 1, name: 'Početnik', xp: 0 },
  { n: 2, name: 'Posmatrač', xp: 60 },
  { n: 3, name: 'Redovan', xp: 150 },
  { n: 4, name: 'Posvećen', xp: 300 },
  { n: 5, name: 'Istrajan', xp: 500 },
  { n: 6, name: 'Iskusan', xp: 750 },
  { n: 7, name: 'Stručnjak', xp: 1050 },
  { n: 8, name: 'Majstor', xp: 1400 },
  { n: 9, name: 'Šampion', xp: 1800 },
  { n: 10, name: 'Legenda', xp: 2300 },
];

// Placeholder rewards – to be confirmed with the sponsor.
export const MILESTONES = [
  { id: 'm3', level: 3, icon: '💧', title: 'Veštačke suze', desc: 'Pakovanje kapi za vlaženje očiju' },
  { id: 'm5', level: 5, icon: '👁️', title: 'Pregled vida', desc: 'Besplatan osnovni oftalmološki pregled' },
  { id: 'm7', level: 7, icon: '🕶️', title: '20% popusta', desc: 'Na naočare za sunce ili zaštitu od ekrana' },
  { id: 'm10', level: 10, icon: '🎁', title: 'Komplet za negu očiju', desc: 'Kapi, maramice i topla maska za oči' },
];

export const BADGES = [
  { id: 'first', icon: '✨', name: 'Prvi unos', desc: 'Sačuvajte prvi unos', test: (s) => s.entryCount >= 1 },
  { id: 'fullday', icon: '🌗', name: 'Pun dan', desc: 'Sva 3 unosa u jednom danu', test: (s) => s.fullDays >= 1 },
  { id: 'streak3', icon: '🔥', name: 'Niz od 3 dana', desc: '3 dana zaredom', test: (s) => s.bestStreak >= 3 },
  { id: 'streak7', icon: '📅', name: 'Nedelja zaredom', desc: '7 dana zaredom', test: (s) => s.bestStreak >= 7 },
  { id: 'e50', icon: '📚', name: '50 unosa', desc: 'Ukupno 50 unosa', test: (s) => s.entryCount >= 50 },
];

export const DEMOGRAPHIC_OPTIONS = {
  ageRange: ['18–29', '30–44', '45–59', '60–74', '75+'],
  sex: ['Žensko', 'Muško', 'Drugo', 'Ne želim da navedem'],
  aids: ['Naočare', 'Kontaktna sočiva', 'Ništa od navedenog'],
  conditions: ['Sindrom suvog oka', 'Glaukom', 'Alergijski konjunktivitis', 'Katarakta', 'Makularna degeneracija', 'Drugo', 'Nemam dijagnozu'],
  screenHours: ['Manje od 2h', '2–4h', '4–8h', 'Više od 8h'],
};
export const DEMOGRAPHIC_MULTI = ['aids', 'conditions'];

/* ---------- Dates (YYYY-MM-DD keys, calendar arithmetic in UTC to avoid DST drift) ---------- */

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function severity(metric, v) {
  return metric.invert ? 6 - v : v;
}

/* ---------- Gamification ---------- */

export function computeStats(entries, today, researchOptIn = false) {
  const live = new Set(entries.filter((e) => !e.retroactive).map((e) => e.date));

  // Current streak: today not being logged yet does not break the streak.
  const start = live.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (live.has(addDays(start, -current))) current++;

  let best = 0, run = 0, prev = null;
  for (const d of [...live].sort()) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }

  const perDay = {};
  const byPeriod = { morning: 0, working: 0, evening: 0 };
  for (const e of entries) {
    perDay[e.date] = (perDay[e.date] || 0) + 1;
    byPeriod[e.period]++;
  }
  const fullDays = Object.values(perDay).filter((n) => n >= 3).length;

  const entryCount = entries.length;
  const streakActive = current >= STREAK_MIN;
  const xp = entryCount * XP_PER_ENTRY + (streakActive ? current : 0) * XP_PER_STREAK_DAY;

  let level = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.xp) level = l;
  const next = LEVELS.find((l) => l.n === level.n + 1) || null;
  const progress = next ? (xp - level.xp) / (next.xp - level.xp) : 1;

  const s = { entryCount, streak: current, streakActive, bestStreak: best, loggedToday: live.has(today), xp, level, next, progress, fullDays, byPeriod, researchOptIn };
  s.badges = BADGES.filter((b) => b.test(s)).map((b) => b.id);
  return s;
}
