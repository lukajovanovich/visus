// Linijski grafikon (SVG) sa skalom 1–5 – koriste ga aplikacija i admin strana.
import { parseKey } from './rules.js';

export function fmtShort(key) {
  const d = parseKey(key);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

// series: [{ metric: { name, color }, values: [broj | null po danu] }], days: ['YYYY-MM-DD', ...]
export function lineChart(series, days, { W = 900, H = 320 } = {}) {
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
