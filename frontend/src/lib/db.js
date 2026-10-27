import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { ENTITIES, INDEXES } from '@shared/entities.js';
import { uuid } from '@shared/uuid.js';

export const db = new Dexie('xpos');
const schema = { outbox: '&key, at', meta: '&key' };
for (const e of ENTITIES) schema[e] = ['&id', 'updated_at', 'deleted', INDEXES[e]].filter(Boolean).join(', ');
db.version(1).stores(schema);

let listeners = [];
export const onLocalWrite = fn => { listeners.push(fn); return () => { listeners = listeners.filter(x => x !== fn); }; };
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { /* noop */ } });

// Context of the logged in user (set by session)
export const ctxStore = { business_id: null, user_id: null, user_name: '', role: null };
export function setCtx(c) { Object.assign(ctxStore, c); }

export async function getMeta(key, def = null) { const r = await db.meta.get(key); return r ? r.value : def; }
export async function setMeta(key, value) { await db.meta.put({ key, value }); }

function stamp(entity, rec) {
  return { ...rec, id: rec.id || uuid(), business_id: ctxStore.business_id, updated_at: Date.now(), deleted: !!rec.deleted };
}

/** Save records for several entities atomically + queue them for sync. bundle = {entity: [records]} */
export async function saveBundle(bundle, auditMsg) {
  const tables = [...new Set([...Object.keys(bundle).map(k => (k === 'serials_patch' ? 'serials' : k)), 'outbox', 'audit_logs'])].map(t => db.table(t));
  const saved = {};
  await db.transaction('rw', tables, async () => {
    for (const [k, recs] of Object.entries(bundle)) {
      if (!recs || !recs.length) continue;
      const entity = k === 'serials_patch' ? 'serials' : k;
      for (let r of recs) {
        if (k === 'serials_patch') { const cur = await db.serials.get(r.id); if (!cur) continue; r = { ...cur, ...r }; }
        const rec = stamp(entity, r);
        await db.table(entity).put(rec);
        await db.outbox.put({ key: `${entity}:${rec.id}`, entity, id: rec.id, at: Date.now() });
        (saved[entity] = saved[entity] || []).push(rec);
      }
    }
    if (auditMsg) {
      const a = stamp('audit_logs', { at: Date.now(), user_id: ctxStore.user_id, user_name: ctxStore.user_name, action: auditMsg.action || 'change', detail: auditMsg.detail || String(auditMsg) });
      await db.audit_logs.put(a);
      await db.outbox.put({ key: `audit_logs:${a.id}`, entity: 'audit_logs', id: a.id, at: Date.now() });
    }
  });
  notify();
  return saved;
}

export async function save(entity, record, auditMsg) {
  const s = await saveBundle({ [entity]: [record] }, auditMsg);
  return s[entity][0];
}

export async function remove(entity, id, auditMsg) {
  const cur = await db.table(entity).get(id);
  if (!cur) return;
  return save(entity, { ...cur, deleted: true }, auditMsg || { action: `${entity}.delete`, detail: `Deleted ${entity} ${cur.name || cur.invoice_no || cur.local_no || id}` });
}

// ---------- React hooks ----------
export function useTable(entity, filterFn, deps = []) {
  return useLiveQuery(async () => {
    const all = await db.table(entity).toArray();
    const rows = all.filter(r => !r.deleted);
    return filterFn ? rows.filter(filterFn) : rows;
  }, [entity, ...deps]) || [];
}
export function useRecord(entity, id) {
  return useLiveQuery(() => (id ? db.table(entity).get(id) : undefined), [entity, id]);
}
export function useSettings() {
  return useLiveQuery(() => (ctxStore.business_id ? db.settings.get(ctxStore.business_id) : undefined), [ctxStore.business_id]) || {};
}
export function usePendingCount() {
  return useLiveQuery(() => db.outbox.count(), []) || 0;
}

export async function clearAll() {
  await db.transaction('rw', db.tables, async () => { for (const t of db.tables) await t.clear(); });
}

// ---------- device & local invoice numbers ----------
export function device() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem('xpos_device') || 'null'); } catch (e) { /* noop */ }
  if (!d) {
    const id = uuid();
    d = { id, prefix: id.replace(/-/g, '').slice(0, 4).toUpperCase(), counter: 0 };
    localStorage.setItem('xpos_device', JSON.stringify(d));
  }
  return d;
}
export function nextLocalNo() {
  const d = device();
  d.counter = (d.counter || 0) + 1;
  localStorage.setItem('xpos_device', JSON.stringify(d));
  return `${d.prefix}-${String(d.counter).padStart(4, '0')}`;
}
export function activeWarehouse() { return localStorage.getItem('xpos_wh') || null; }
export function setActiveWarehouse(id) { localStorage.setItem('xpos_wh', id); notify(); }

export function ctx(extra = {}) {
  return { business_id: ctxStore.business_id, user_id: ctxStore.user_id, warehouse_id: activeWarehouse(), ...extra };
}
