// End-to-end API smoke test. Usage: BASE=http://localhost:3000 node scripts/smoke-test.js
import { buildSale } from '../../shared/posting.js';
import { uuid } from '../../shared/uuid.js';

// Without BASE, the test boots its own in-process server (migrate + seed) on a random port
// against whatever database the env selects (SQLite by default, Postgres when DATABASE_URL is set).
let BASE = process.env.BASE, server, dbHandle;
if (!BASE) {
  const { start } = await import('../src/index.js');
  const { seedDemo } = await import('../src/seed.js');
  dbHandle = (await import('../src/db.js')).db;
  server = await start({ port: 0, host: '127.0.0.1', quiet: true });
  await seedDemo();
  BASE = `http://127.0.0.1:${server.address().port}`;
}
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✔', msg); } else { fail++; console.log('  ✘', msg); } };
async function call(path, { method = 'GET', body, token } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}
const stockOf = async (token, id) => (await call('/api/reports/stock', { token })).body.find(p => p.id === id)?.stock;

console.log('XPOS smoke test against', BASE, dbHandle ? `(in-process, ${dbHandle.client.config.client})` : '');
const h = await call('/api/health');
ok(h.status === 200 && h.body.ok, 'health endpoint');

const bad = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@xpos.local', password: 'wrong' } });
ok(bad.status === 401, 'wrong password rejected');
const login = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@xpos.local', password: 'admin123' } });
ok(login.status === 200 && login.body.token, 'login admin@xpos.local / admin123');
const T = login.body.token;
const bid = login.body.user.business_id;

// create product through REST
const pid = uuid();
const cp = await call('/api/data/products', { method: 'POST', token: T, body: { id: pid, name: 'Smoke Test Soap', sku: 'SMOKE-1', barcode: '999000111', cost_price: 50, sale_price: 80, tax_rate: 0, unit: 'pcs', variants: [] } });
ok(cp.status === 200 && cp.body.id === pid, 'create product via REST');

// opening stock via sync push (as an offline device would)
const wh = (await call('/api/data/warehouses', { token: T })).body[0].id;
const push1 = await call('/api/sync/push', { method: 'POST', token: T, body: { device_id: 'dev-A', changes: [{ entity: 'stock_movements', record: { id: uuid(), product_id: pid, warehouse_id: wh, qty: 20, type: 'opening', date: '2026-01-01', updated_at: Date.now(), deleted: false } }] } });
ok(push1.body.applied === 1, 'sync push applies opening stock movement');
ok(await stockOf(T, pid) === 20, 'stock = 20 after opening movement');

// pull returns the product
const pull = await call('/api/sync/pull?since=0', { token: T });
ok(pull.body.changes.products.some(p => p.id === pid) && pull.body.cursor > 0, `sync pull since=0 returns product (cursor ${pull.body.cursor})`);
const cursor = pull.body.cursor;

// server-side sale reduces stock
const sale = await call('/api/pos/sale', { method: 'POST', token: T, body: { items: [{ product_id: pid, name: 'Smoke Test Soap', qty: 3, price: 80, cost: 50, tax_rate: 0 }], payments: [{ method: 'cash', amount: 300 }] } });
ok(sale.status === 200 && /^INV-\d+/.test(sale.body.sale.invoice_no), `POS sale created with server invoice no ${sale.body.sale?.invoice_no}`);
ok(sale.body.sale.change === 60 && sale.body.sale.total === 240, 'change calculated (300 tendered, 240 total → 60)');
ok(await stockOf(T, pid) === 17, 'sale reduced stock 20 → 17');

// two offline devices sell the same product; movements add up, no clobbering
const mk = (dev, qty) => buildSale({ items: [{ product_id: pid, name: 'Smoke Test Soap', qty, price: 80, cost: 50 }], payments: [{ method: 'cash', amount: qty * 80 }], ctx: { business_id: bid, user_id: login.body.user.id, warehouse_id: wh, local_no: `${dev}-0001` } });
const a = mk('AAAA', 2), b = mk('BBBB', 5);
const toChanges = bundle => Object.entries(bundle).filter(([k]) => k !== 'serials_patch').flatMap(([entity, recs]) => recs.map(record => ({ entity, record })));
const pa = await call('/api/sync/push', { method: 'POST', token: T, body: { device_id: 'dev-A', changes: toChanges(a) } });
const pb = await call('/api/sync/push', { method: 'POST', token: T, body: { device_id: 'dev-B', changes: toChanges(b) } });
ok(pa.body.assigned[a.sales[0].id] && pb.body.assigned[b.sales[0].id] && pa.body.assigned[a.sales[0].id] !== pb.body.assigned[b.sales[0].id], `offline invoices AAAA-0001/BBBB-0001 got sequential numbers ${pa.body.assigned[a.sales[0].id]}, ${pb.body.assigned[b.sales[0].id]}`);
ok(await stockOf(T, pid) === 10, 'two offline devices: stock 17 − 2 − 5 = 10 (movements, not overwrites)');
const repush = await call('/api/sync/push', { method: 'POST', token: T, body: { device_id: 'dev-A', changes: toChanges(a) } });
ok(repush.body.applied === toChanges(a).length && await stockOf(T, pid) === 10, 'idempotent re-push (same ids) does not double-count stock');
const kept = (await call('/api/data/sales/' + a.sales[0].id, { token: T })).body.invoice_no;
ok(kept === pa.body.assigned[a.sales[0].id], 'server invoice number preserved on re-push');

// last-write-wins
const prod = (await call('/api/data/products/' + pid, { token: T })).body;
const older = await call('/api/sync/push', { method: 'POST', token: T, body: { device_id: 'dev-B', changes: [{ entity: 'products', record: { ...prod, sale_price: 1, updated_at: prod.updated_at - 10000 } }] } });
ok(older.body.conflicts.length === 1 && older.body.applied === 0, 'older edit loses (LWW conflict returned to client)');
const newer = await call('/api/sync/push', { method: 'POST', token: T, body: { device_id: 'dev-B', changes: [{ entity: 'products', record: { ...prod, sale_price: 85, updated_at: Date.now() + 1 } }] } });
ok(newer.body.applied === 1 && (await call('/api/data/products/' + pid, { token: T })).body.sale_price === 85, 'newer edit wins');

// incremental pull only returns new changes
const pull2 = await call('/api/sync/pull?since=' + cursor, { token: T });
ok(pull2.body.changes.sales?.length === 3 && !pull2.body.changes.units, `incremental pull since ${cursor} returns only new changes`);

// journal balanced
const tb = await call('/api/reports/trial-balance', { token: T });
ok(tb.body.balanced && tb.body.unbalanced_entries.length === 0, `trial balance balanced: Dr ${tb.body.totals.debit} = Cr ${tb.body.totals.credit} across ${tb.body.entries} entries`);
const cash = tb.body.rows.find(r => r.code === '1000');
ok(cash && cash.debit > 0, `cash account debited by sales (balance ${cash.debit})`);

// roles & permissions
const email = `cashier${Date.now()}@xpos.local`;
const cu = await call('/api/users', { method: 'POST', token: T, body: { name: 'Cashier', email, password: 'cash123', role: 'cashier', pin: '4321' } });
ok(cu.status === 200, 'owner creates cashier user');
const cl = await call('/api/auth/login', { method: 'POST', body: { email, password: 'cash123' } });
const CT = cl.body.token;
const forb = await call('/api/sync/push', { method: 'POST', token: CT, body: { device_id: 'dev-C', changes: [{ entity: 'products', record: { ...prod, sale_price: 1, updated_at: Date.now() + 5 } }] } });
ok(forb.body.rejected.length === 1 && forb.body.applied === 0, 'cashier cannot modify products via sync');
const cu2 = await call('/api/users', { token: CT });
ok(cu2.status === 403, 'cashier cannot list users');
const cs = await call('/api/pos/sale', { method: 'POST', token: CT, body: { items: [{ product_id: pid, name: 'Smoke Test Soap', qty: 1, price: 85, cost: 50 }], payments: [{ method: 'jazzcash', amount: 85 }] } });
ok(cs.status === 200 && await stockOf(T, pid) === 9, 'cashier can sell (JazzCash) → stock 9');

// credit sale requires customer
const cr = await call('/api/pos/sale', { method: 'POST', token: T, body: { items: [{ product_id: pid, name: 'Soap', qty: 1, price: 85, cost: 50 }], payments: [] } });
ok(cr.status === 400, 'credit sale without customer rejected');

// business isolation
const other = await call('/api/auth/signup', { method: 'POST', body: { name: 'Other', email: `other${Date.now()}@x.pk`, password: 'secret1', business: { name: 'Other Shop', category: 'pharmacy', opening_balance: 1000 } } });
ok(other.status === 200 && other.body.business.name === 'Other Shop', 'signup creates a separate business');
const iso = await call('/api/data/products/' + pid, { token: other.body.token });
ok(iso.status === 404, 'other business cannot read our product');
const steal = await call('/api/sync/push', { method: 'POST', token: other.body.token, body: { changes: [{ entity: 'products', record: { ...prod, updated_at: Date.now() + 10 } }] } });
ok(steal.body.rejected.length === 1, 'other business cannot overwrite our record id');

console.log(`\n${pass} passed, ${fail} failed`);
if (server) { server.close(); await dbHandle.destroy(); }
process.exit(fail ? 1 : 0);
