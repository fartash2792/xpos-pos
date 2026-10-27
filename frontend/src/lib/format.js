import { db, ctxStore } from './db.js';

let currency = { symbol: 'Rs', code: 'PKR' };
export function setCurrency(s) { if (s) currency = { symbol: s.currency_symbol || s.currency || 'Rs', code: s.currency || 'PKR' }; }
export function money(n, withSymbol = true) {
  const v = Number(n) || 0;
  const s = v.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return withSymbol ? `${currency.symbol} ${s}` : s;
}
export const num = n => (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
export const fmtDate = d => (d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
export const fmtDateTime = ms => (ms ? new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
export const daysAgo = n => { const d = new Date(Date.now() - n * 86400000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// ---------- CSV ----------
export function toCSV(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]).map(k => ({ key: k, label: k })) : []);
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map(c => esc(c.label)).join(','), ...rows.map(r => cols.map(c => esc(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','))].join('\n');
}
export function downloadFile(name, content, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function parseCSV(text) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x !== ''));
  if (!head) return [];
  return body.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

// ---------- printing via hidden iframe (no popup blockers) ----------
export function printHtml(html, { width } = {}) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const doc = f.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: ${width ? '2mm' : '12mm'}; ${width ? `size: ${width}mm auto;` : ''} }
    body { font-family: ${width ? "'Courier New', monospace" : 'Arial, sans-serif'}; font-size: ${width === 58 ? '10px' : width ? '12px' : '13px'}; color:#000; margin:0; ${width ? `width:${width - 4}mm;` : ''} }
    table { width:100%; border-collapse: collapse; } td, th { padding: 2px 0; vertical-align: top; }
    .a4 th, .a4 td { border-bottom: 1px solid #ddd; padding: 6px 4px; text-align:left; }
    .r { text-align:right !important; } .c { text-align:center; } .b { font-weight:bold; } hr { border:0; border-top:1px dashed #000; }
    h1,h2,h3 { margin: 4px 0; } .muted { color:#555; }
  </style></head><body>${html}</body></html>`);
  doc.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); }, 300);
}

export async function lookupMaps() {
  const [customers, suppliers, products, users, warehouses] = await Promise.all(['customers', 'suppliers', 'products', 'users', 'warehouses'].map(t => db.table(t).toArray()));
  const m = a => Object.fromEntries(a.map(x => [x.id, x]));
  return { customers: m(customers), suppliers: m(suppliers), products: m(products), users: m(users), warehouses: m(warehouses) };
}
export { ctxStore };
