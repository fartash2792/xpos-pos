// Offline-first sync engine: push outbox -> pull changes since cursor.
import { db, getMeta, setMeta, device, onLocalWrite } from './db.js';
import { api, NetworkError, STANDALONE } from './api.js';
import { getSession, ensureWarehouse } from './session.js';

const state = { online: navigator.onLine, serverReachable: false, syncing: false, lastSynced: null, error: null, authError: false };
let subs = [];
export const subscribe = fn => { subs.push(fn); fn({ ...state }); return () => { subs = subs.filter(x => x !== fn); }; };
const set = p => { Object.assign(state, p); subs.forEach(fn => fn({ ...state })); };
export const getSyncState = () => ({ ...state });

let running = null;
let timer = null;
let debounce = null;

async function ping() {
  if (!navigator.onLine) return false;
  try { await api('health', { timeout: 5000 }); return true; } catch (e) { return false; }
}

async function push(token) {
  const dev = device();
  for (let round = 0; round < 50; round++) {
    const items = await db.outbox.orderBy('at').limit(300).toArray();
    if (!items.length) return;
    const snapshot = [];
    const changes = [];
    for (const it of items) {
      const rec = await db.table(it.entity).get(it.id);
      if (!rec) { await db.outbox.delete(it.key); continue; }
      snapshot.push({ key: it.key, updated_at: rec.updated_at, at: it.at });
      changes.push({ entity: it.entity, record: rec });
    }
    if (!changes.length) continue;
    const res = await api('sync/push', { method: 'POST', token, body: { device_id: dev.id, changes }, timeout: 60000 });
    await db.transaction('rw', db.tables, async () => {
      for (const s of snapshot) {
        const cur = await db.outbox.get(s.key);
        const [entity, id] = s.key.split(/:(.+)/);
        const rec = await db.table(entity).get(id);
        // only clear if it wasn't modified again while we were pushing
        if (cur && cur.at === s.at && (!rec || rec.updated_at === s.updated_at)) await db.outbox.delete(s.key);
      }
      for (const [id, no] of Object.entries(res.assigned || {})) {
        const sale = await db.sales.get(id);
        if (sale) await db.sales.put({ ...sale, invoice_no: no });
        const q = await db.quotations.get(id);
        if (q) await db.quotations.put({ ...q, quote_no: no });
      }
      for (const c of res.conflicts || []) await db.table(c.entity).put(c.record);
    });
    if (res.rejected && res.rejected.length) {
      console.warn('Sync rejected', res.rejected);
      for (const r of res.rejected) for (const s of snapshot) if (s.key.endsWith(':' + r.id)) await db.outbox.delete(s.key);
      set({ error: `${res.rejected.length} change(s) rejected by server (permissions)` });
    }
  }
}

async function pull(token) {
  let cursor = Number(await getMeta('cursor', 0));
  for (let round = 0; round < 500; round++) {
    const res = await api('sync/pull?since=' + cursor, { token, timeout: 60000 });
    const pendingKeys = new Set((await db.outbox.toArray()).map(o => o.key));
    const entities = Object.keys(res.changes || {});
    if (entities.length) {
      await db.transaction('rw', entities.map(e => db.table(e)), async () => {
        for (const e of entities) {
          const recs = res.changes[e].filter(r => !pendingKeys.has(`${e}:${r.id}`));
          if (!recs.length) continue;
          const local = await db.table(e).bulkGet(recs.map(r => r.id));
          const toPut = recs.filter((r, i) => !local[i] || (Number(r.updated_at) >= Number(local[i].updated_at)));
          if (toPut.length) await db.table(e).bulkPut(toPut);
        }
      });
    }
    cursor = res.cursor;
    await setMeta('cursor', cursor);
    if (!res.has_more) return;
  }
}

async function flushPendingPin(token) {
  const pin = localStorage.getItem('xpos_pending_pin');
  if (!pin) return;
  try { await api('auth/pin', { method: 'POST', body: { pin }, token }); localStorage.removeItem('xpos_pending_pin'); } catch (e) { /* retry later */ }
}

export async function syncNow() {
  if (STANDALONE) { set({ online: navigator.onLine, serverReachable: false }); return; }
  if (running) return running;
  running = (async () => {
    const s = getSession();
    set({ online: navigator.onLine });
    if (!s || !s.token) return;
    const reachable = await ping();
    set({ serverReachable: reachable });
    if (!reachable) return;
    set({ syncing: true, error: null });
    try {
      await flushPendingPin(s.token);
      await push(s.token);
      await pull(s.token);
      await ensureWarehouse();
      const now = Date.now();
      await setMeta('last_synced', now);
      set({ lastSynced: now, authError: false });
    } catch (e) {
      if (e.status === 401) set({ authError: true, error: 'Session expired. Log in again to resume syncing.' });
      else if (e instanceof NetworkError) set({ serverReachable: false });
      else set({ error: e.message });
    } finally { set({ syncing: false }); }
  })();
  try { await running; } finally { running = null; }
}

export async function startSync() {
  set({ lastSynced: await getMeta('last_synced', null) });
  if (timer) return;
  window.addEventListener('online', () => { set({ online: true }); syncNow(); });
  window.addEventListener('offline', () => set({ online: false, serverReachable: false }));
  onLocalWrite(() => { clearTimeout(debounce); debounce = setTimeout(syncNow, 1500); });
  timer = setInterval(syncNow, 30000);
  syncNow();
}

export async function resetCursor() { await setMeta('cursor', 0); }
