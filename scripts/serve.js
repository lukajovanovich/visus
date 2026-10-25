// Mali lokalni server za razvoj: služi folder public/ na http://localhost:3000
// (bez zavisnosti). Primenjuje iste sigurnosne zaglavlja kao vercel.json,
// pa se lokalno ponaša isto kao na produkciji.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../public');
const port = Number(process.env.PORT || 3000);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png',
};
const vercel = JSON.parse(fs.readFileSync(path.resolve(root, '../vercel.json'), 'utf8'));
const headers = Object.fromEntries((vercel.headers || []).flatMap((h) => h.headers.map((x) => [x.key, x.value])));

http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(root, pathname);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  else if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html'; // cleanUrls kao na Vercel-u
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...headers }).end('Nije pronađeno'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...headers }).end(data);
  });
}).listen(port, () => console.log(`Visus: http://localhost:${port}  (aplikacija: http://localhost:${port}/app/)`));
