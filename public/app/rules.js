// Shared product rules – imported by the web app and by the server
// (the server uses them to validate input and reward claims).

export const CONSENT_VERSION = '1.1';
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

export const BADGES = [
  { id: 'first', icon: '✨', name: 'Prvi unos', desc: 'Sačuvajte prvi unos', test: (s) => s.entryCount >= 1 },
  { id: 'fullday', icon: '🌗', name: 'Pun dan', desc: 'Sva 3 unosa u jednom danu', test: (s) => s.fullDays >= 1 },
  { id: 'streak3', icon: '🔥', name: 'Niz od 3 dana', desc: '3 dana zaredom', test: (s) => s.bestStreak >= 3 },
  { id: 'streak7', icon: '📅', name: 'Nedelja zaredom', desc: '7 dana zaredom', test: (s) => s.bestStreak >= 7 },
  { id: 'e50', icon: '📚', name: '50 unosa', desc: 'Ukupno 50 unosa', test: (s) => s.entryCount >= 50 },
];

// Prisutni simptomi u unosu (više izbora). Ključevi se čuvaju u bazi – menjati zajedno sa schema.sql.
export const SYMPTOMS = [
  { key: 'tearing', name: 'Suzenje' },
  { key: 'discharge', name: 'Krmeljenje' },
  { key: 'red_eye', name: 'Crveno oko' },
  { key: 'foreign_body', name: 'Osećaj stranog tela' },
  { key: 'burning', name: 'Peckanje' },
  { key: 'itching', name: 'Svrab' },
  { key: 'pain', name: 'Bol u oku' },
  { key: 'pressure', name: 'Osećaj pritiska' },
  { key: 'reduced_acuity', name: 'Smanjena vidna oštrina' },
  { key: 'other', name: 'Drugo' }, // uz opis u entries.symptom_other (ne deli se sa istraživanjem)
];
export const SYMPTOM_OTHER_MAX = 120;

// Stanje hitnosti u unosu (obavezno, jedan izbor).
export const URGENCY = [
  { key: 'usual', icon: '🟢', name: 'Uobičajeni simptomi', desc: 'Kao i inače' },
  { key: 'sudden', icon: '🟠', name: 'Naglo nastali simptomi', desc: 'Pojavili su se ili pogoršali naglo' },
  { key: 'doctor', icon: '🔴', name: 'Potreban oftalmolog', desc: 'Mislim da treba da me pregleda lekar' },
];

// Kontakt koji se nudi kada korisnik označi "Potreban oftalmolog".
export const CLINIC = { name: 'Vizim Dom Zdravlja', phone: '011 785 7777', tel: '+381117857777' };
export const EMERGENCY_PHONE = '194';

// Profil korisnika (sva polja opciona). Čuva se u profiles.demographics.
export const DEMOGRAPHIC_OPTIONS = {
  ageRange: ['18–29', '30–44', '45–59', '60–74', '75+'],
  sex: ['Žensko', 'Muško', 'Drugo', 'Ne želim da navedem'],
  aids: ['Naočare', 'Kontaktna sočiva', 'Ništa od navedenog'],
  screenHours: ['Manje od 2h', '2–4h', '4–8h', 'Više od 8h'],
  conditions: ['Sindrom suvog oka', 'Glaukom', 'Alergijski konjunktivitis', 'Katarakta', 'Makularna degeneracija', 'Drugo', 'Nemam dijagnozu'],
  surgeries: ['Laserska korekcija vida', 'Operacija katarakte', 'Operacija glaukoma', 'Operacija mrežnjače', 'Drugo', 'Nisam imao/la operaciju'],
  medication: ['Već koristim', 'Koristio/la sam ranije', 'Do sada nisam koristio/la'],
  medicationTypes: ['Veštačke suze', 'Kapi za glaukom', 'Antialergijske kapi', 'Antibiotske kapi', 'Kortikosteroidne kapi', 'Drugo'],
  allergy: ['Nemam alergiju', 'Sezonska (npr. polen)', 'Tokom cele godine', 'Ne znam'],
};
export const DEMOGRAPHIC_MULTI = ['aids', 'conditions', 'surgeries', 'medicationTypes'];
// Dioptrija (desno / levo oko), opciono, od −30 do +30 u koracima od 0,25.
export const DIOPTER_KEYS = ['diopterRight', 'diopterLeft'];

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
