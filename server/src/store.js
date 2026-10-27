// Generic record store + sync primitives on top of Knex.
import { db, isPg, lockRows } from './db.js';
import { ENTITIES, SERVER_ONLY } from '../../shared/entities.js';
import { canWriteEntity } from '../../shared/permissions.js';

export const SYNCABLE = ENTITIES.filter(e => !SERVER_ONLY.includes(e));
const PULL_WINDOW = 2000;

export async function allocSeq(trx, n = 1) {
  if (isPg) {
    // Single atomic statement; the row lock is held until the transaction ends.
    const [row] = await trx('sync_state').where({ id: 1 }).increment('seq', n).returning('seq');
    return Number(row.seq) - n + 1;
  }
  await trx('sync_state').where({ id: 1 }).increment('seq', n);
  let q = trx('sync_state').where({ id: 1 });
  if (lockRows) q = q.forUpdate();
  const row = await q.first();
  return Number(row.seq) - n + 1; // first seq of the allocated block
}

export async function nextCounter(trx, business_id, name) {
  if (isPg) {
    const [row] = await trx('counters').insert({ business_id, name, value: 1 })
      .onConflict(['business_id', 'name']).merge({ value: trx.raw('?? + 1', ['counters.value']) }).returning('value');
    return Number(row.value);
  }
  const updated = await trx('counters').where({ business_id, name }).increment('value', 1);
  if (!updated) await trx('counters').insert({ business_id, name, value: 1 });
  const row = await trx('counters').where({ business_id, name }).first();
  return Number(row.value);
}

export function rowToRecord(row) {
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch (e) { /* ignore */ }
  return { ...data, id: row.id, business_id: row.business_id, updated_at: Number(row.updated_at), deleted: !!row.deleted, _seq: Number(row.seq) };
}

export function userToRecord(u) {
  return { id: u.id, business_id: u.business_id, name: u.name, email: u.email, role: u.role, active: !!u.active, pin_hash: u.pin_hash, updated_at: Number(u.updated_at), deleted: !!u.deleted, _seq: Number(u.seq) };
}

/**
 * Apply a list of {entity, record} changes with last-write-wins.
 * Returns {applied, conflicts:[serverRecord], rejected:[{id,reason}], assigned:{saleId: invoice_no}}
 */
export async function applyChanges({ business_id, role, device_id, changes }) {
  const result = { applied: 0, conflicts: [], rejected: [], assigned: {} };
  if (!changes || !changes.length) return result;
  await db.transaction(async trx => {
    let seq = await allocSeq(trx, changes.length);
    const settingsRow = await trx('settings').where({ id: business_id }).first();
    const prefix = settingsRow ? (rowToRecord(settingsRow).invoice_prefix || 'INV-') : 'INV-';
    for (const ch of changes) {
      const { entity } = ch;
      const rec = { ...(ch.record || {}) };
      delete rec._seq;
      if (!SYNCABLE.includes(entity)) { result.rejected.push({ id: rec.id, reason: 'unknown entity ' + entity }); continue; }
      if (!rec.id) { result.rejected.push({ id: null, reason: 'missing id' }); continue; }
      if (!canWriteEntity(role, entity)) { result.rejected.push({ id: rec.id, entity, reason: 'forbidden' }); continue; }
      rec.business_id = business_id;
      rec.updated_at = Number(rec.updated_at) || Date.now();
      rec.deleted = !!rec.deleted;
      const existing = await trx(entity).where({ id: rec.id }).first();
      if (existing && existing.business_id !== business_id) { result.rejected.push({ id: rec.id, reason: 'id belongs to another business' }); continue; }
      if (existing && Number(existing.updated_at) > rec.updated_at) { result.conflicts.push({ entity, record: rowToRecord(existing) }); continue; }
      if (entity === 'sales') {
        const old = existing ? rowToRecord(existing) : null;
        if (old && old.invoice_no) rec.invoice_no = old.invoice_no;
        if (!rec.invoice_no) {
          const n = await nextCounter(trx, business_id, 'invoice');
          rec.invoice_no = prefix + String(n).padStart(6, '0');
          result.assigned[rec.id] = rec.invoice_no;
        }
      }
      if (entity === 'quotations' && !rec.quote_no) {
        const n = await nextCounter(trx, business_id, 'quotation');
        rec.quote_no = 'QT-' + String(n).padStart(5, '0');
        result.assigned[rec.id] = rec.quote_no;
      }
      const row = { id: rec.id, business_id, data: JSON.stringify(rec), updated_at: rec.updated_at, deleted: rec.deleted, seq: seq++, device_id: device_id || null };
      if (existing) await trx(entity).where({ id: rec.id }).update(row);
      else await trx(entity).insert(row);
      result.applied++;
    }
  });
  return result;
}

export async function pullChanges({ business_id, since = 0 }) {
  since = Number(since) || 0;
  const state = await db('sync_state').where({ id: 1 }).first();
  const maxSeq = Number(state.seq);
  const upper = Math.min(since + PULL_WINDOW, maxSeq);
  const changes = {};
  let count = 0;
  for (const e of SYNCABLE) {
    const rows = await db(e).where({ business_id }).andWhere('seq', '>', since).andWhere('seq', '<=', upper);
    if (rows.length) { changes[e] = rows.map(rowToRecord); count += rows.length; }
  }
  const users = await db('users').where({ business_id }).andWhere('seq', '>', since).andWhere('seq', '<=', upper);
  if (users.length) { changes.users = users.map(userToRecord); count += users.length; }
  return { changes, cursor: upper, has_more: upper < maxSeq, count, server_time: Date.now() };
}

export async function listRecords(business_id, entity, { includeDeleted = false } = {}) {
  let q = db(entity).where({ business_id });
  if (!includeDeleted) q = q.andWhere({ deleted: false });
  return (await q).map(rowToRecord);
}

export async function getRecord(business_id, entity, id) {
  const row = await db(entity).where({ business_id, id }).first();
  return row ? rowToRecord(row) : null;
}

// Save a dictionary {entity: [records]} produced by shared posting functions
export async function saveBundle({ business_id, role, device_id, bundle }) {
  const changes = [];
  for (const [entity, recs] of Object.entries(bundle)) {
    if (entity === 'serials_patch') {
      for (const p of recs) {
        const cur = await getRecord(business_id, 'serials', p.id);
        if (cur) changes.push({ entity: 'serials', record: { ...cur, ...p, updated_at: Date.now() } });
      }
      continue;
    }
    for (const r of recs) changes.push({ entity, record: r });
  }
  return applyChanges({ business_id, role, device_id, changes });
}
