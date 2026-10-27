// Izveštaj za lekara (PDF) – koriste ga aplikacija (pacijent) i admin strana (lekar).
// Ulaz je rezultat RPC-a preview_report() / send_report() iz baze (isti oblik podataka).
import { METRICS, PERIODS, SYMPTOMS, URGENCY, severity } from './rules.js';

const PDFMAKE = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/pdfmake.min.js';
const PDFMAKE_FONTS = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/vfs_fonts.min.js';

// Boje kao u aplikaciji (PDF ne zna za CSS promenljive).
const GREEN = '#2e7d5b';
const MUTED = '#6b7569';
const BORDER = '#e6e1d3';
const SEV = { 1: '#3fa66b', 2: '#9cc14a', 3: '#e9be3a', 4: '#e88b3a', 5: '#d4524a' };
const METRIC_COLOR = { dryness: '#3b82c4', clarity: '#2e7d5b', fatigue: '#d0902a', redness: '#cf5148', light: '#8a6cc9' };
const URGENCY_COLOR = { usual: '#3fa66b', sudden: '#e88b3a', doctor: '#d4524a' };

const PROFILE_LABELS = [
  ['ageRange', 'Starosna grupa'],
  ['sex', 'Pol'],
  ['screenHours', 'Rad za računarom dnevno'],
  ['aids', 'Naočare / sočiva'],
  ['diopterRight', 'Dioptrija – desno oko'],
  ['diopterLeft', 'Dioptrija – levo oko'],
  ['conditions', 'Očne bolesti'],
  ['surgeries', 'Operacije očiju'],
  ['medication', 'Lekovi za oči'],
  ['medicationTypes', 'Koji lekovi'],
  ['allergy', 'Alergija'],
];

let loading = null;
function loadPdfMake() {
  if (window.pdfMake?.vfs) return Promise.resolve(window.pdfMake);
  const add = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PDF alat nije mogao da se učita. Proverite internet vezu.'));
    document.head.appendChild(s);
  });
  loading ||= add(PDFMAKE).then(() => add(PDFMAKE_FONTS)).then(() => window.pdfMake)
    .catch((e) => { loading = null; throw e; });
  return loading;
}

/* ---------- Pomoćne ---------- */

const pad = (n) => String(n).padStart(2, '0');
const fmtDay = (key) => { const [y, m, d] = key.split('-'); return `${d}.${m}.${y}.`; };
const fmtDayShort = (key) => { const [, m, d] = key.split('-'); return `${Number(d)}.${Number(m)}.`; };
const fmtDateTime = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}. u ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtNum = (v) => v.toFixed(1).replace('.', ',');
const fmtDiopter = (v) => `${v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')} D`;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const DOW = ['ned', 'pon', 'uto', 'sre', 'čet', 'pet', 'sub'];
const dow = (key) => { const [y, m, d] = key.split('-').map(Number); return DOW[new Date(y, m - 1, d).getDay()]; };

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Ocena jednog oka ('r' / 'l'); stari unosi bez ocena po oku važe za oba oka.
const eyeVal = (e, key, eye) => e[`${key}_${eye}`] ?? e[key];
const eyesDiffer = (e, key) => e[`${key}_r`] != null && e[`${key}_r`] !== e[`${key}_l`];

function symptomText(e) {
  return (e.symptoms || []).map((k) => (k === 'other' ? `drugo${e.symptom_other ? ': ' + e.symptom_other : ''}`
    : (SYMPTOMS.find((x) => x.key === k)?.name || k).toLowerCase())).join(', ');
}

// Linijski grafikon kao SVG sa pravim bojama (za PDF).
function chartSvg(entries, days) {
  const W = 515, H = 190, pl = 26, pr = 10, pt = 10, pb = 24;
  const iw = W - pl - pr, ih = H - pt - pb;
  const x = (i) => pl + (days.length === 1 ? iw / 2 : (i * iw) / (days.length - 1));
  const y = (v) => pt + ((5 - v) * ih) / 4;
  let out = '';
  for (let v = 1; v <= 5; v++) {
    out += `<line x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}" stroke="${BORDER}" stroke-width="1"/>`;
    out += `<text x="${pl - 8}" y="${y(v) + 3}" font-size="8" fill="${MUTED}" text-anchor="end">${v}</text>`;
  }
  days.forEach((d, i) => { out += `<text x="${x(i)}" y="${H - 6}" font-size="8" fill="${MUTED}" text-anchor="middle">${fmtDayShort(d)}</text>`; });
  for (const m of METRICS) {
    const vals = days.map((d) => avg(entries.filter((e) => e.date === d).map((e) => e[m.key])));
    let path = '', pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      path += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    if (path) out += `<path d="${path}" fill="none" stroke="${METRIC_COLOR[m.key]}" stroke-width="1.8"/>`;
    vals.forEach((v, i) => { if (v != null) out += `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.4" fill="${METRIC_COLOR[m.key]}"/>`; });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out}</svg>`;
}

const sectionTitle = (text) => ({ text, style: 'h2', margin: [0, 16, 0, 6] });

function scoreCell(m, v) {
  const sev = severity(m, v);
  return { text: String(v), alignment: 'center', bold: true, color: sev === 2 || sev === 3 ? '#1f2a24' : '#ffffff', fillColor: SEV[sev] };
}

// Ćelija unosa: boja po oku sa više tegoba, tekst "D/L" kada se oči razlikuju.
function entryScoreCell(m, e) {
  return { ...scoreCell(m, e[m.key]), text: eyesDiffer(e, m.key) ? `${e[`${m.key}_r`]}/${e[`${m.key}_l`]}` : String(e[m.key]) };
}

/* ---------- Sastavljanje dokumenta ---------- */

export function buildReportDoc(data) {
  const entries = data.entries || [];
  const profile = data.profile || {};
  const days = Array.from({ length: 7 }, (_, i) => addDays(data.period_from, i));
  const daysLogged = new Set(entries.map((e) => e.date)).size;
  const count = (u) => entries.filter((e) => e.urgency === u).length;
  const patient = data.patient?.name ? `${data.patient.name} (${data.patient.email || ''})` : (data.patient?.email || '–');

  const profileRows = PROFILE_LABELS
    .filter(([k]) => profile[k] != null && profile[k] !== '' && !(Array.isArray(profile[k]) && !profile[k].length))
    .map(([k, label]) => [
      { text: label, color: MUTED },
      { text: Array.isArray(profile[k]) ? profile[k].join(', ') : k.startsWith('diopter') ? fmtDiopter(profile[k]) : String(profile[k]) },
    ]);

  const symptomCounts = SYMPTOMS
    .map((x) => ({ x, n: entries.filter((e) => (e.symptoms || []).includes(x.key)).length }))
    .filter((r) => r.n).sort((a, b) => b.n - a.n);
  const others = [...new Set(entries.map((e) => e.symptom_other).filter(Boolean))];

  const statBox = (label, value, color = '#1f2a24') => ({
    stack: [{ text: label, fontSize: 8, color: MUTED }, { text: value, fontSize: 16, bold: true, color, margin: [0, 2, 0, 0] }],
    margin: [8, 6, 8, 6],
  });

  const content = [
    {
      columns: [
        { stack: [{ text: 'Visus', fontSize: 22, bold: true, color: GREEN }, { text: 'Dnevnik stanja očiju', fontSize: 9, color: MUTED }] },
        { stack: [{ text: 'Izveštaj za oftalmologa', fontSize: 14, bold: true, alignment: 'right' },
          { text: `${fmtDay(data.period_from)} – ${fmtDay(data.period_to)}`, fontSize: 10, alignment: 'right', color: MUTED }] },
      ],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1.5, lineColor: GREEN }], margin: [0, 4, 0, 10] },
    {
      table: { widths: [110, '*'], body: [
        [{ text: 'Pacijent', color: MUTED }, { text: patient, bold: true }],
        [{ text: 'Period', color: MUTED }, `${fmtDay(data.period_from)} – ${fmtDay(data.period_to)} (poslednjih 7 dana)`],
        [{ text: 'Izveštaj napravljen', color: MUTED }, fmtDateTime(data.generated_at)],
      ] },
      layout: 'noBorders',
    },

    sectionTitle('Pregled nedelje'),
    {
      table: { widths: ['*', '*', '*', '*'], body: [[
        statBox('Unosa', String(entries.length)),
        statBox('Dana sa unosom', `${daysLogged} / 7`),
        statBox('Naglo nastali simptomi', String(count('sudden')), count('sudden') ? URGENCY_COLOR.sudden : '#1f2a24'),
        statBox('Potreban oftalmolog', String(count('doctor')), count('doctor') ? URGENCY_COLOR.doctor : '#1f2a24'),
      ]] },
      layout: { hLineColor: BORDER, vLineColor: BORDER, fillColor: '#faf7f0' },
    },
  ];

  if (!entries.length) {
    content.push({ text: 'Pacijent nije imao unosa u ovom periodu.', italics: true, color: MUTED, margin: [0, 12, 0, 0] });
  } else {
    content.push(
      sectionTitle('Prosečne ocene (1–5)'),
      {
        table: {
          widths: ['*', 58, 58, 58, 58],
          headerRows: 1,
          body: [
            [{ text: 'Simptom', style: 'th' }, ...['Prosek – desno', 'Prosek – levo', 'Najbolje', 'Najgore'].map((t) => ({ text: t, style: 'th', alignment: 'center' }))],
            ...METRICS.map((m) => {
              const vals = entries.flatMap((e) => [eyeVal(e, m.key, 'r'), eyeVal(e, m.key, 'l')]);
              const eyeAvg = (eye) => { const a = avg(entries.map((e) => eyeVal(e, m.key, eye))); return { ...scoreCell(m, Math.round(a)), text: fmtNum(a) }; };
              const best = m.invert ? Math.max(...vals) : Math.min(...vals);
              const worst = m.invert ? Math.min(...vals) : Math.max(...vals);
              return [
                m.name + (m.invert ? '  (5 = potpuno jasno)' : ''),
                eyeAvg('r'),
                eyeAvg('l'),
                scoreCell(m, best),
                scoreCell(m, worst),
              ];
            }),
          ],
        },
        layout: { hLineColor: BORDER, vLineColor: BORDER },
      },
      sectionTitle('Kretanje po danima (prosek dana, oko sa više tegoba)'),
      { svg: chartSvg(entries, days), width: 515 },
      {
        columns: METRICS.map((m) => ({
          width: 'auto',
          margin: [0, 0, 12, 0],
          columns: [
            { canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 8, r: 2, color: METRIC_COLOR[m.key] }], width: 12 },
            { text: m.name, fontSize: 8, color: MUTED, width: 'auto' },
          ],
        })),
        margin: [0, 4, 0, 0],
      },
      sectionTitle('Prisutni simptomi'),
      symptomCounts.length
        ? { ul: symptomCounts.map(({ x, n }) => `${x.name}: ${n} od ${entries.length} unosa`).concat(others.length ? [`Opis za „drugo“: ${others.join('; ')}`] : []) }
        : { text: 'Pacijent nije označio dodatne simptome.', color: MUTED },
      sectionTitle('Svi unosi'),
      {
        table: {
          headerRows: 1,
          widths: [52, 44, 22, 22, 22, 22, 22, 62, '*'],
          body: [
            ['Datum', 'Doba dana', 'Suv.', 'Jas.', 'Zam.', 'Crv.', 'Svet.', 'Stanje', 'Simptomi i beleška'].map((t) => ({ text: t, style: 'th' })),
            ...entries.map((e) => {
              const u = URGENCY.find((x) => x.key === e.urgency);
              const details = [symptomText(e), e.note ? `„${e.note}“` : ''].filter(Boolean);
              return [
                { text: [`${dow(e.date)} ${fmtDayShort(e.date)}`, e.retroactive ? { text: '\nnaknadno', fontSize: 7, color: MUTED } : ''] },
                PERIODS.find((p) => p.key === e.period)?.name || e.period,
                ...METRICS.map((m) => entryScoreCell(m, e)),
                u ? { text: u.name, color: URGENCY_COLOR[u.key], bold: u.key !== 'usual' } : { text: '–', color: MUTED },
                details.length ? details.join('\n') : { text: '–', color: MUTED },
              ];
            }),
          ],
        },
        layout: { hLineColor: BORDER, vLineColor: BORDER, paddingTop: () => 3, paddingBottom: () => 3 },
        fontSize: 8,
      },
      ...(entries.some((e) => METRICS.some((m) => eyesDiffer(e, m.key)))
        ? [{ text: 'Ocena „2/3“ = desno oko / levo oko, kada se razlikuju. Boja ćelije prati oko sa više tegoba.', fontSize: 7.5, color: MUTED, margin: [0, 4, 0, 0] }]
        : []),
    );
  }

  content.push(
    sectionTitle('Profil pacijenta'),
    profileRows.length
      ? { table: { widths: [150, '*'], body: profileRows }, layout: { hLineColor: BORDER, vLineColor: () => '#ffffff' } }
      : { text: 'Pacijent nije popunio profil.', color: MUTED },
  );

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 56],
    info: { title: `Visus izveštaj ${fmtDay(data.period_from)} – ${fmtDay(data.period_to)}`, author: 'Visus' },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: '#1f2a24' },
    styles: {
      h2: { fontSize: 11.5, bold: true, color: GREEN },
      th: { bold: true, fontSize: 8, color: MUTED, fillColor: '#f3f0e6' },
    },
    footer: (page, pages) => ({
      margin: [40, 10, 40, 0],
      columns: [
        { text: 'Subjektivne ocene pacijenta: 1 = bez tegoba, 5 = jake tegobe (kod jasnoće vida 5 = potpuno jasno). Visus nije medicinski uređaj.', fontSize: 7, color: MUTED, width: '*' },
        { text: `${page} / ${pages}`, fontSize: 8, color: MUTED, alignment: 'right', width: 40 },
      ],
    }),
    content,
  };
}

export function reportFileName(data) {
  const who = (data.patient?.name || 'pacijent').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'dj')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `visus-izvestaj-${who}-${data.period_to}.pdf`;
}

export async function downloadReportPdf(data) {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildReportDoc(data)).download(reportFileName(data));
}

// Za testove: PDF kao base64.
export async function reportPdfBase64(data) {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve) => pdfMake.createPdf(buildReportDoc(data)).getBase64(resolve));
}
