// Local stand-in for Vercel: serves frontend/dist like the CDN (with vercel.json headers and
// SPA fallback) and sends /api/* to the serverless handler in api/index.js.
// Usage: DATABASE_URL=... JWT_SECRET=... PORT=3100 node scripts/vercel-local.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VERCEL = process.env.VERCEL || '1';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const dist = path.join(root, cfg.outputDirectory);
const { default: handler } = await import('../api/index.js');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const toRe = src => new RegExp('^' + src.replace(/\(\.\*\)/g, '(.*)') + '$');

function applyHeaders(res, p) {
  for (const h of cfg.headers) if (toRe(h.source).test(p)) for (const { key, value } of h.headers) res.setHeader(key, value);
}

http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  applyHeaders(res, p);
  if (/^\/api(\/|$)/.test(p)) return handler(req, res);
  let file = path.join(dist, p);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html');
    applyHeaders(res, '/index.html');
  }
  res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT || 3100), '127.0.0.1', function () { console.log('vercel-local on http://127.0.0.1:' + this.address().port); });
