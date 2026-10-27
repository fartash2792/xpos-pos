import { api, NetworkError, STANDALONE } from './api.js';
import { db, setCtx, clearAll, getMeta, setMeta, saveBundle, setActiveWarehouse, activeWarehouse } from './db.js';
import { sha256, pinHash } from './sha256.js';
import { createBusinessData } from '@shared/seed.js';
import { uuid } from '@shared/uuid.js';

const KEY = 'xpos_session';
const CREDS = 'xpos_creds';

export function getSession() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
}
function setSession(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
  applySessionCtx(s);
}
export function applySessionCtx(s) {
  if (!s) return setCtx({ business_id: null, user_id: null, role: null, user_name: '' });
  setCtx({ business_id: s.business_id, user_id: s.user.id, role: s.user.role, user_name: s.user.name });
}
export function updateSessionUser(patch) {
  const s = getSession(); if (!s) return;
  s.user = { ...s.user, ...patch }; setSession(s);
}

function cacheCreds(email, password, session) {
  const all = JSON.parse(localStorage.getItem(CREDS) || '{}');
  const salt = uuid();
  all[email.toLowerCase()] = { salt, hash: sha256(salt + ':' + password), session };
  localStorage.setItem(CREDS, JSON.stringify(all));
}

async function prepareDb(business_id) {
  const current = await getMeta('business_id');
  if (current && current !== business_id) {
    await clearAll();
    localStorage.removeItem('xpos_wh');
  }
  await setMeta('business_id', business_id);
}

export async function ensureWarehouse() {
  const whs = (await db.warehouses.toArray()).filter(w => !w.deleted);
  if (!whs.length) return;
  if (!activeWarehouse() || !whs.find(w => w.id === activeWarehouse())) {
    setActiveWarehouse((whs.find(w => w.is_default) || whs[0]).id);
  }
}

async function onlineSession(data, email, password) {
  const s = { token: data.token, user: data.user, business_id: data.user.business_id, business_name: data.business && data.business.name, at: Date.now() };
  await prepareDb(s.business_id);
  if (data.business) await db.settings.put(data.business);
  if (data.user) await db.users.put(data.user);
  setSession(s);
  if (password) cacheCreds(email, password, s);
  return s;
}

export async function login(email, password) {
  email = String(email || '').trim().toLowerCase();
  if (STANDALONE) return localLogin(email, password);
  try {
    const data = await api('auth/login', { method: 'POST', body: { email, password } });
    return await onlineSession(data, email, password);
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    // Offline: check cached credential hash from last online login
    const all = JSON.parse(localStorage.getItem(CREDS) || '{}');
    const c = all[email];
    if (!c) throw new Error('You are offline. Log in online once on this device to enable offline login.');
    if (sha256(c.salt + ':' + password) !== c.hash) throw new Error('Invalid email or password (offline check)');
    const s = { ...c.session, offline_login: true };
    await prepareDb(s.business_id);
    setSession(s);
    return s;
  }
}

export async function signup(payload) {
  if (STANDALONE) throw new Error('Sign-up needs the server. The standalone demo uses admin@xpos.local / admin123.');
  const data = await api('auth/signup', { method: 'POST', body: payload });
  return onlineSession(data, payload.email, payload.password);
}

export function logout() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem('xpos_pos_unlocked');
  applySessionCtx(null);
}

// ---------- PIN ----------
export async function currentUserRecord() {
  const s = getSession(); if (!s) return null;
  return (await db.users.get(s.user.id)) || s.user;
}
export async function verifyPin(pin) {
  const s = getSession(); if (!s) return false;
  const u = await currentUserRecord();
  const h = pinHash(s.user.id, pin);
  return h === (u && u.pin_hash) || (!u?.pin_hash && pin === '1234');
}
export async function changePin(pin) {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits');
  const s = getSession();
  const h = pinHash(s.user.id, pin);
  const u = await currentUserRecord();
  await db.users.put({ ...u, pin_hash: h, updated_at: Date.now() });
  updateSessionUser({ pin_hash: h });
  if (STANDALONE) return;
  try { await api('auth/pin', { method: 'POST', body: { pin }, token: s.token }); localStorage.removeItem('xpos_pending_pin'); }
  catch (e) { if (e instanceof NetworkError) localStorage.setItem('xpos_pending_pin', pin); else throw e; }
}

// ---------- standalone (no server) ----------
const DEMO_BID = 'demo-business-0001';
async function localLogin(email, password) {
  await prepareDb(DEMO_BID);
  setCtx({ business_id: DEMO_BID });
  let users = await db.users.toArray();
  if (!users.length) {
    const owner = { id: 'demo-owner-0001', business_id: DEMO_BID, name: 'Admin', email: 'admin@xpos.local', role: 'owner', active: true, pass_hash: sha256('local:admin123'), pin_hash: pinHash('demo-owner-0001', '1234'), updated_at: Date.now(), deleted: false };
    await db.users.put(owner);
    users = [owner];
    const data = createBusinessData({ business_id: DEMO_BID, user_id: owner.id, demo: true, profile: { name: 'XPOS Demo Store (Offline)', phone: '0300-0000000', address: 'Multan, Pakistan', opening_balance: 50000 } });
    await saveBundle(data);
    await db.outbox.clear();
  }
  const u = users.find(x => x.email === email && !x.deleted && x.active !== false);
  if (!u || u.pass_hash !== sha256('local:' + password)) throw new Error('Invalid email or password');
  const s = { token: null, user: u, business_id: DEMO_BID, standalone: true, at: Date.now() };
  setSession(s);
  return s;
}
export async function createLocalUser({ name, email, password, role, pin }) {
  const id = uuid();
  await db.users.put({ id, business_id: DEMO_BID, name, email: email.toLowerCase(), role, active: true, pass_hash: sha256('local:' + password), pin_hash: pinHash(id, pin || '1234'), updated_at: Date.now(), deleted: false });
}
