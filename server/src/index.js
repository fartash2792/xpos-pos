import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { db, ROOT, IS_SERVERLESS, isPg, withInitLock } from './db.js';
import { seedDemoIfEmpty } from './seed.js';
import { requireAuth, requirePerm, signup, login, createUser, touchUser, pinHash } from './auth.js';
import { applyChanges, pullChanges, listRecords, getRecord, saveBundle, userToRecord, SYNCABLE } from './store.js';
import { buildSale, accountBalances, stockMap, r2 } from '../../shared/posting.js';
import { DEFAULT_ACCOUNTS } from '../../shared/accounts.js';
import { uuid } from '../../shared/uuid.js';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message || 'Server error' });
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now(), version: '1.0.0' }));

// ---------- auth ----------
app.post('/api/auth/signup', wrap(async (req, res) => res.json(await signup(req.body || {}))));
app.post('/api/auth/login', wrap(async (req, res) => res.json(await login(req.body || {}))));
app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const u = await db('users').where({ id: req.auth.user_id }).first();
  if (!u || !u.active) return res.status(401).json({ error: 'User disabled' });
  res.json({ user: userToRecord(u), business: await getRecord(req.auth.business_id, 'settings', req.auth.business_id) });
}));
app.post('/api/auth/pin', requireAuth, wrap(async (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });
  const target = req.body.user_id && req.auth.role === 'owner' ? req.body.user_id : req.auth.user_id;
  await db.transaction(trx => touchUser(trx, target, { pin_hash: pinHash(target, pin) }));
  res.json({ ok: true, pin_hash: pinHash(target, pin) });
}));
app.post('/api/auth/password', requireAuth, wrap(async (req, res) => {
  const u = await db('users').where({ id: req.auth.user_id }).first();
  if (!(await bcrypt.compare(String(req.body.current || ''), u.password_hash))) return res.status(400).json({ error: 'Current password is wrong' });
  if (String(req.body.password || '').length < 6) return res.status(400).json({ error: 'Password too short' });
  await db.transaction(async trx => touchUser(trx, u.id, { password_hash: await bcrypt.hash(req.body.password, 10) }));
  res.json({ ok: true });
}));

// ---------- users (owner only) ----------
app.get('/api/users', requireAuth, requirePerm('users'), wrap(async (req, res) => {
  res.json((await db('users').where({ business_id: req.auth.business_id, deleted: false })).map(userToRecord));
}));
app.post('/api/users', requireAuth, requirePerm('users'), wrap(async (req, res) => {
  const { name, email, password, role, pin } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, password required' });
  if (!['owner', 'manager', 'cashier'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (await db('users').where({ email: String(email).toLowerCase().trim() }).first()) return res.status(409).json({ error: 'Email already in use' });
  let u;
  await db.transaction(async trx => { u = await createUser(trx, { business_id: req.auth.business_id, name, email, password, role, pin: pin || '1234' }); });
  await audit(req, 'user.create', `Created user ${email} (${role})`);
  res.json(userToRecord(u));
}));
app.put('/api/users/:id', requireAuth, requirePerm('users'), wrap(async (req, res) => {
  const u = await db('users').where({ id: req.params.id, business_id: req.auth.business_id }).first();
  if (!u) return res.status(404).json({ error: 'Not found' });
  const patch = {};
  for (const k of ['name', 'role', 'active']) if (k in req.body) patch[k] = req.body[k];
  if (req.body.password) patch.password_hash = await bcrypt.hash(req.body.password, 10);
  if (req.body.pin) patch.pin_hash = pinHash(u.id, req.body.pin);
  if (u.id === req.auth.user_id && (patch.role && patch.role !== 'owner' || patch.active === false)) return res.status(400).json({ error: 'You cannot demote or disable yourself' });
  await db.transaction(trx => touchUser(trx, u.id, patch));
  await audit(req, 'user.update', `Updated user ${u.email}`);
  res.json(userToRecord(await db('users').where({ id: u.id }).first()));
}));
app.delete('/api/users/:id', requireAuth, requirePerm('users'), wrap(async (req, res) => {
  if (req.params.id === req.auth.user_id) return res.status(400).json({ error: 'You cannot delete yourself' });
  await db.transaction(trx => touchUser(trx, req.params.id, { deleted: true, active: false }));
  await audit(req, 'user.delete', `Deleted user ${req.params.id}`);
  res.json({ ok: true });
}));

async function audit(req, action, detail) {
  await applyChanges({ business_id: req.auth.business_id, role: 'owner', device_id: 'server', changes: [{ entity: 'audit_logs', record: { id: uuid(), at: Date.now(), updated_at: Date.now(), user_id: req.auth.user_id, action, detail, device: 'server' } }] });
}

// ---------- sync ----------
app.post('/api/sync/push', requireAuth, wrap(async (req, res) => {
  const { device_id, changes } = req.body || {};
  res.json(await applyChanges({ business_id: req.auth.business_id, role: req.auth.role, device_id, changes: changes || [] }));
}));
app.get('/api/sync/pull', requireAuth, wrap(async (req, res) => {
  res.json(await pullChanges({ business_id: req.auth.business_id, since: req.query.since }));
}));

// ---------- generic REST over every entity ----------
const checkEntity = (req, res, next) => SYNCABLE.includes(req.params.entity) ? next() : res.status(404).json({ error: 'Unknown entity' });
app.get('/api/data/:entity', requireAuth, checkEntity, wrap(async (req, res) => {
  res.json(await listRecords(req.auth.business_id, req.params.entity, { includeDeleted: req.query.include_deleted === '1' }));
}));
app.get('/api/data/:entity/:id', requireAuth, checkEntity, wrap(async (req, res) => {
  const r = await getRecord(req.auth.business_id, req.params.entity, req.params.id);
  r ? res.json(r) : res.status(404).json({ error: 'Not found' });
}));
app.post('/api/data/:entity', requireAuth, checkEntity, wrap(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : [req.body];
  const recs = list.map(r => ({ id: r.id || uuid(), ...r, updated_at: Date.now(), deleted: !!r.deleted }));
  const out = await applyChanges({ business_id: req.auth.business_id, role: req.auth.role, device_id: 'api', changes: recs.map(record => ({ entity: req.params.entity, record })) });
  if (out.rejected.length) return res.status(403).json(out);
  const saved = await Promise.all(recs.map(r => getRecord(req.auth.business_id, req.params.entity, r.id)));
  res.json(Array.isArray(req.body) ? saved : saved[0]);
}));
app.delete('/api/data/:entity/:id', requireAuth, checkEntity, wrap(async (req, res) => {
  const r = await getRecord(req.auth.business_id, req.params.entity, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const out = await applyChanges({ business_id: req.auth.business_id, role: req.auth.role, device_id: 'api', changes: [{ entity: req.params.entity, record: { ...r, deleted: true, updated_at: Date.now() } }] });
  res.json({ ok: out.applied === 1 });
}));

// ---------- server-side POS sale (same logic as the offline client) ----------
app.post('/api/pos/sale', requireAuth, requirePerm('pos'), wrap(async (req, res) => {
  const { items, invoice, payments, warehouse_id } = req.body || {};
  const bid = req.auth.business_id;
  const settings = await getRecord(bid, 'settings', bid);
  const wh = warehouse_id || (await listRecords(bid, 'warehouses')).find(w => w.is_default)?.id;
  let bundle;
  try {
    bundle = buildSale({ items, invoice, payments, settings, ctx: { business_id: bid, user_id: req.auth.user_id, warehouse_id: wh, local_no: 'API-' + Date.now().toString(36).toUpperCase() } });
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const out = await saveBundle({ business_id: bid, role: req.auth.role, device_id: 'api', bundle });
  const sale = await getRecord(bid, 'sales', bundle.sales[0].id);
  res.json({ sale, result: out });
}));

// ---------- server reports ----------
app.get('/api/reports/stock', requireAuth, wrap(async (req, res) => {
  const bid = req.auth.business_id;
  const [products, mv] = await Promise.all([listRecords(bid, 'products'), listRecords(bid, 'stock_movements')]);
  const m = stockMap(mv, req.query.warehouse_id);
  res.json(products.map(p => ({ id: p.id, name: p.name, sku: p.sku, stock: r2(m[p.id] || 0), value: r2((m[p.id] || 0) * (p.cost_price || 0)) })));
}));
app.get('/api/reports/trial-balance', requireAuth, requirePerm('accounts'), wrap(async (req, res) => {
  const bid = req.auth.business_id;
  const [entries, accounts] = await Promise.all([listRecords(bid, 'journal_entries'), listRecords(bid, 'accounts')]);
  const bal = accountBalances(entries, { from: req.query.from, to: req.query.to });
  const rows = Object.entries(bal).map(([code, b]) => {
    const a = accounts.find(x => x.code === code) || DEFAULT_ACCOUNTS.find(x => x.code === code) || { name: code };
    const net = r2(b.debit - b.credit);
    return { code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  }).sort((a, b) => a.code.localeCompare(b.code));
  const totals = { debit: r2(rows.reduce((s, r) => s + r.debit, 0)), credit: r2(rows.reduce((s, r) => s + r.credit, 0)) };
  const unbalanced = entries.filter(e => Math.abs(r2(e.lines.reduce((s, l) => s + l.debit - l.credit, 0))) > 0.009).map(e => e.id);
  res.json({ rows, totals, balanced: Math.abs(totals.debit - totals.credit) < 0.01, entries: entries.length, unbalanced_entries: unbalanced });
}));

// ---------- frontend ----------
// (On Vercel the CDN serves frontend/dist; the function only handles /api/*.)
const dist = path.resolve(ROOT, '..', 'frontend', 'dist');
if (!IS_SERVERLESS && fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js') || p.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Migrate, then seed the demo business on an empty database. Safe to run from several
// processes at once (e.g. concurrent serverless cold starts): knex's migration lock is
// retried, and a losing seed (unique email) rolls back in its transaction and is ignored.
async function prepareDatabase({ quiet = false } = {}) {
  // On Postgres we hold the advisory init lock (withInitLock), so no other process can be
  // migrating: clear any knex lock row left behind by an instance that was killed mid-migration.
  if (isPg) await db.migrate.forceFreeMigrationsLock().catch(() => {});
  for (let attempt = 0; ; attempt++) {
    try {
      const [batch, log] = await db.migrate.latest();
      if (log.length && !quiet) console.log(`Migrated batch ${batch}: ${log.join(', ')}`);
      break;
    } catch (e) {
      // Another process is migrating (lock held) or created knex's own tables at the same moment.
      const racing = /already locked/i.test(e.message) || ['23505', '42P07', '42710'].includes(e.code) || /already exists/i.test(e.message);
      if (!racing || attempt >= 20) throw e;
      await sleep(500);
    }
  }
  if (process.env.SEED_DEMO === 'false') return;
  try {
    if (await seedDemoIfEmpty() && !quiet) {
      console.log('Fresh database: seeded demo business (admin@xpos.local / admin123, POS PIN 1234). Change this password!');
    }
  } catch (e) {
    const row = await db('users').count({ n: '*' }).first();
    if (!(Number(row?.n || 0) > 0)) throw e; // another instance seeded first: fine
  }
}

// Memoized: runs once per process (once per serverless cold start). A failure is not cached,
// so the next request retries instead of the instance being stuck.
let readyPromise = null;
export function ready(opts) {
  if (!readyPromise) readyPromise = withInitLock(() => prepareDatabase(opts)).catch(e => { readyPromise = null; throw e; });
  return readyPromise;
}

export async function start({ port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0', quiet = false } = {}) {
  await ready({ quiet });
  return new Promise(resolve => {
    const server = app.listen(port, host, () => {
      if (!quiet) console.log(`XPOS server (${db.client.config.client}) listening on http://${host}:${server.address().port}`);
      resolve(server);
    });
  });
}

function shutdown(sig) {
  console.log(`${sig} received, shutting down`);
  db.destroy().finally(() => process.exit(0));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain || process.env.XPOS_AUTOSTART === '1') {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  start().catch(e => { console.error('Startup failed:', e); process.exit(1); });
}
