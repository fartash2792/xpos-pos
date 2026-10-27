import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db, jwtSecret } from './db.js';
import { allocSeq, applyChanges, getRecord, userToRecord } from './store.js';
import { uuid } from '../../shared/uuid.js';
import { createBusinessData } from '../../shared/seed.js';
import { can } from '../../shared/permissions.js';

const SECRET = jwtSecret();
export const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
// PIN hash format shared with the browser: sha256("pin:" + userId + ":" + pin)
export const pinHash = (userId, pin) => sha256(`pin:${userId}:${pin}`);

export function sign(user) {
  return jwt.sign({ uid: user.id, bid: user.business_id, role: user.role }, SECRET, { expiresIn: '30d' });
}

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const p = jwt.verify(token, SECRET);
    req.auth = { user_id: p.uid, business_id: p.bid, role: p.role };
    next();
  } catch (e) { return res.status(401).json({ error: 'Session expired, please log in again' }); }
}

export const requirePerm = perm => (req, res, next) => can(req.auth.role, perm) ? next() : res.status(403).json({ error: 'Permission denied' });

async function sessionPayload(user) {
  const settings = await getRecord(user.business_id, 'settings', user.business_id);
  return { token: sign(user), user: userToRecord(user), business: settings };
}

export async function createUser(trx, { business_id, name, email, password, role = 'cashier', pin = '1234' }) {
  const id = uuid();
  const seq = await allocSeq(trx, 1);
  const u = {
    id, business_id, name, email: String(email).toLowerCase().trim(), password_hash: await bcrypt.hash(password, 10),
    pin_hash: pinHash(id, pin), role, active: true, updated_at: Date.now(), deleted: false, seq
  };
  await trx('users').insert(u);
  return u;
}

export async function signup(body) {
  const { name, email, password, business = {} } = body;
  if (!name || !email || !password) throw Object.assign(new Error('Name, email and password are required'), { status: 400 });
  if (String(password).length < 6) throw Object.assign(new Error('Password must be at least 6 characters'), { status: 400 });
  const exists = await db('users').where({ email: String(email).toLowerCase().trim() }).first();
  if (exists) throw Object.assign(new Error('Email already registered'), { status: 409 });
  const business_id = uuid();
  let user;
  await db.transaction(async trx => {
    await trx('businesses').insert({ id: business_id, name: business.name || name + "'s Business", category: business.category || 'retail', created_at: Date.now() });
    user = await createUser(trx, { business_id, name, email, password, role: 'owner' });
  });
  const data = createBusinessData({ business_id, user_id: user.id, profile: { ...business, email }, demo: !!body.demo });
  const changes = [];
  for (const [entity, recs] of Object.entries(data)) for (const r of recs) changes.push({ entity, record: r });
  await applyChanges({ business_id, role: 'owner', device_id: 'server', changes });
  return sessionPayload(user);
}

export async function login({ email, password }) {
  const user = await db('users').where({ email: String(email || '').toLowerCase().trim() }).first();
  if (!user || !user.active || user.deleted || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }
  return sessionPayload(user);
}

export async function touchUser(trx, id, patch) {
  const seq = await allocSeq(trx, 1);
  await trx('users').where({ id }).update({ ...patch, updated_at: Date.now(), seq });
}
