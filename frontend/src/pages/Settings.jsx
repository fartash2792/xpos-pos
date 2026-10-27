import React, { useEffect, useMemo, useState } from 'react';
import { db, useTable, useSettings, save, remove, saveBundle, ctxStore, setMeta } from '../lib/db.js';
import { api, STANDALONE } from '../lib/api.js';
import { getSession, changePin, createLocalUser } from '../lib/session.js';
import { syncNow, resetCursor } from '../lib/sync.js';
import { downloadFile, fmtDateTime } from '../lib/format.js';
import { ENTITIES } from '@shared/entities.js';
import { CATEGORIES } from '@shared/seed.js';
import { PageHeader, Tabs, Field, Modal, Table, Badge, toast, attempt } from '../components/ui.jsx';

export default function Settings() {
  const [tab, setTab] = useState('business');
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'business', label: 'Business' }, { key: 'invoice', label: 'Invoice & POS' }, { key: 'tax', label: 'Tax rates' }, { key: 'branches', label: 'Branches / Warehouses' }, { key: 'catalog', label: 'Categories, brands, units' }, { key: 'users', label: 'Users & roles' }, { key: 'security', label: 'Security (PIN)' }, { key: 'backup', label: 'Backup & restore' }, { key: 'audit', label: 'Audit log' }]} />
      {tab === 'business' && <BusinessForm />}
      {tab === 'invoice' && <InvoiceForm />}
      {tab === 'tax' && <SimpleList entity="tax_rates" title="Tax rates" fields={[{ key: 'name', label: 'Name' }, { key: 'rate', label: 'Rate %', type: 'number' }]} />}
      {tab === 'branches' && <SimpleList entity="warehouses" title="Branches / warehouses" fields={[{ key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'address', label: 'Address' }]} />}
      {tab === 'catalog' && <div className="grid gap-4 lg:grid-cols-3">
        <SimpleList entity="categories" title="Categories" fields={[{ key: 'name', label: 'Name' }]} />
        <SimpleList entity="brands" title="Brands" fields={[{ key: 'name', label: 'Name' }]} />
        <SimpleList entity="units" title="Units" fields={[{ key: 'name', label: 'Name' }]} />
      </div>}
      {tab === 'users' && <Users />}
      {tab === 'security' && <Security />}
      {tab === 'backup' && <Backup />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

function useSettingsForm() {
  const s = useSettings();
  const [f, setF] = useState(null);
  useEffect(() => { if (s.id && !f) setF(s); }, [s.id]);
  const submit = () => attempt(() => save('settings', f, { action: 'settings.update', detail: 'Updated settings' }), 'Settings saved');
  return [f, setF, submit];
}

function BusinessForm() {
  const [f, setF, submit] = useSettingsForm();
  if (!f) return null;
  const onLogo = e => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); const r = Math.min(1, 300 / img.width); c.width = img.width * r; c.height = img.height * r; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); setF({ ...f, logo: c.toDataURL('image/png') }); };
    img.src = URL.createObjectURL(file);
  };
  return (
    <div className="card max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Business type"><select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" value={f.email || ''} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="NTN / STRN"><input className="input" value={f.ntn || ''} onChange={e => setF({ ...f, ntn: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Currency code"><input className="input" value={f.currency} onChange={e => setF({ ...f, currency: e.target.value })} /></Field>
          <Field label="Symbol"><input className="input" value={f.currency_symbol} onChange={e => setF({ ...f, currency_symbol: e.target.value })} /></Field>
        </div>
        <Field label="Logo"><input type="file" accept="image/*" onChange={onLogo} /></Field>
        {f.logo && <div className="flex items-center gap-2"><img src={f.logo} className="h-14 rounded border" alt="logo" /><button className="btn-secondary btn-sm" onClick={() => setF({ ...f, logo: '' })}>Remove</button></div>}
      </div>
      <button className="btn-primary mt-4" onClick={submit}>Save</button>
    </div>
  );
}

function InvoiceForm() {
  const [f, setF, submit] = useSettingsForm();
  if (!f) return null;
  const loy = f.loyalty || {};
  return (
    <div className="card max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice number prefix (server-assigned numbers)"><input className="input" value={f.invoice_prefix || 'INV-'} onChange={e => setF({ ...f, invoice_prefix: e.target.value })} /></Field>
        <Field label="Receipt size"><select className="input" value={f.receipt_size} onChange={e => setF({ ...f, receipt_size: e.target.value })}><option value="58">58mm thermal</option><option value="80">80mm thermal</option><option value="a4">A4 invoice</option></select></Field>
        <Field label="Receipt header text" className="sm:col-span-2"><input className="input" value={f.invoice_header || ''} onChange={e => setF({ ...f, invoice_header: e.target.value })} /></Field>
        <Field label="Receipt / invoice footer" className="sm:col-span-2"><textarea className="input" value={f.invoice_footer || ''} onChange={e => setF({ ...f, invoice_footer: e.target.value })} /></Field>
        <Field label="Default tax rate % for new products"><input className="input" type="number" value={f.default_tax_rate} onChange={e => setF({ ...f, default_tax_rate: Number(e.target.value) })} /></Field>
        <Field label="Default low-stock alert qty"><input className="input" type="number" value={f.low_stock_default} onChange={e => setF({ ...f, low_stock_default: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.pin_required_for_pos !== false} onChange={e => setF({ ...f, pin_required_for_pos: e.target.checked })} /> Require 4-digit PIN to open POS counter</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.allow_negative_stock} onChange={e => setF({ ...f, allow_negative_stock: e.target.checked })} /> Allow selling when stock is zero</label>
      </div>
      <h3 className="mb-2 mt-5 font-medium">Customer loyalty points</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!loy.enabled} onChange={e => setF({ ...f, loyalty: { ...loy, enabled: e.target.checked } })} /> Enabled</label>
        <Field label="1 point per (amount spent)"><input className="input" type="number" value={loy.earn_per || 100} onChange={e => setF({ ...f, loyalty: { ...loy, earn_per: Number(e.target.value) } })} /></Field>
        <Field label="Value of 1 point when redeemed"><input className="input" type="number" value={loy.point_value || 1} onChange={e => setF({ ...f, loyalty: { ...loy, point_value: Number(e.target.value) } })} /></Field>
      </div>
      <button className="btn-primary mt-4" onClick={submit}>Save</button>
    </div>
  );
}

export function SimpleList({ entity, title, fields }) {
  const rows = useTable(entity);
  const [f, setF] = useState(null);
  const submit = () => attempt(async () => {
    if (!f[fields[0].key]) throw new Error(fields[0].label + ' required');
    const rec = { ...f }; for (const fl of fields) if (fl.type === 'number') rec[fl.key] = Number(rec[fl.key]) || 0;
    await save(entity, rec, { action: `${entity}.save`, detail: `${title}: ${rec[fields[0].key]}` }); setF(null);
  }, 'Saved');
  return (
    <div className="card p-0">
      <div className="flex items-center justify-between p-3"><h3 className="font-medium">{title}</h3><button className="btn-primary btn-sm" onClick={() => setF(Object.fromEntries(fields.map(x => [x.key, ''])))}>+ Add</button></div>
      <Table rows={rows} columns={[...fields.map(x => ({ key: x.key, label: x.label })), { label: '', render: r => <div className="flex justify-end gap-1"><button className="btn-secondary btn-sm" onClick={() => setF({ ...r })}>Edit</button><button className="btn-secondary btn-sm" onClick={() => confirm('Delete?') && remove(entity, r.id)}>×</button></div> }]} />
      {f && <Modal open onClose={() => setF(null)} title={title} footer={<button className="btn-primary" onClick={submit}>Save</button>}>
        <div className="space-y-2">{fields.map(x => <Field key={x.key} label={x.label}><input className="input" type={x.type || 'text'} value={f[x.key] ?? ''} onChange={e => setF({ ...f, [x.key]: e.target.value })} /></Field>)}</div>
      </Modal>}
    </div>
  );
}

function Users() {
  const local = useTable('users');
  const [list, setList] = useState(null);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const load = async () => {
    if (STANDALONE) return setList(null);
    try { setList(await api('users', { token: getSession().token })); setErr(''); } catch (e) { setErr(e.message + ' — user management needs a connection to the server.'); }
  };
  useEffect(() => { load(); }, []);
  const rows = STANDALONE ? local : (list || local);
  const submit = () => attempt(async () => {
    if (STANDALONE) { if (f.id) throw new Error('Editing users needs the server version'); await createLocalUser(f); setF(null); return; }
    const token = getSession().token;
    if (f.id) await api('users/' + f.id, { method: 'PUT', token, body: { name: f.name, role: f.role, active: f.active, ...(f.password ? { password: f.password } : {}), ...(f.pin ? { pin: f.pin } : {}) } });
    else await api('users', { method: 'POST', token, body: f });
    setF(null); await load(); syncNow();
  }, 'User saved');
  return (
    <div className="card p-0">
      <div className="flex items-center justify-between p-3"><div className="text-sm text-slate-500">Owner: full access · Manager: everything except settings & users · Cashier: POS, sales, quotations, customers, cash register.</div>
        <button className="btn-primary" onClick={() => setF({ name: '', email: '', password: '', role: 'cashier', pin: '1234', active: true })}>+ Add user</button></div>
      {err && <div className="px-3 pb-2 text-sm text-amber-700">{err}</div>}
      <Table rows={rows} columns={[{ label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Role', render: u => <Badge tone={u.role === 'owner' ? 'brand' : 'slate'}>{u.role}</Badge> }, { label: 'Status', render: u => (u.active === false ? <Badge tone="red">disabled</Badge> : <Badge tone="green">active</Badge>) },
        { label: '', render: u => !STANDALONE && <div className="flex justify-end gap-1"><button className="btn-secondary btn-sm" onClick={() => setF({ ...u, password: '', pin: '' })}>Edit</button>
          {u.id !== ctxStore.user_id && <button className="btn-secondary btn-sm" onClick={() => confirm('Delete user?') && attempt(async () => { await api('users/' + u.id, { method: 'DELETE', token: getSession().token }); await load(); }, 'Deleted')}>×</button>}</div> }]} />
      {f && <Modal open onClose={() => setF(null)} title={f.id ? 'Edit user' : 'Add user'} footer={<button className="btn-primary" onClick={submit}>Save</button>}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" disabled={!!f.id} value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={f.id ? 'New password (optional)' : 'Password'}><input className="input" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} /></Field>
          <Field label={f.id ? 'New POS PIN (optional)' : 'POS PIN'}><input className="input" maxLength={4} value={f.pin} onChange={e => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Role"><select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="owner">Owner</option><option value="manager">Manager</option><option value="cashier">Cashier</option></select></Field>
          {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active !== false} onChange={e => setF({ ...f, active: e.target.checked })} /> Active</label>}
        </div>
      </Modal>}
    </div>
  );
}

function Security() {
  const [pin, setPin] = useState('');
  const [pw, setPw] = useState({ current: '', password: '' });
  return (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <div className="card">
        <h3 className="mb-2 font-medium">POS PIN</h3>
        <p className="mb-2 text-xs text-slate-500">4-digit PIN to unlock the POS counter (works offline; syncs to the server when online).</p>
        <input className="input mb-2" maxLength={4} inputMode="numeric" placeholder="New 4-digit PIN" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
        <button className="btn-primary" onClick={() => attempt(async () => { await changePin(pin); setPin(''); sessionStorage.removeItem('xpos_pos_unlocked'); }, 'PIN changed')}>Change PIN</button>
      </div>
      {!STANDALONE && <div className="card">
        <h3 className="mb-2 font-medium">Password</h3>
        <input className="input mb-2" type="password" placeholder="Current password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />
        <input className="input mb-2" type="password" placeholder="New password" value={pw.password} onChange={e => setPw({ ...pw, password: e.target.value })} />
        <button className="btn-primary" onClick={() => attempt(async () => { await api('auth/password', { method: 'POST', token: getSession().token, body: pw }); setPw({ current: '', password: '' }); }, 'Password changed (log in online once to refresh offline login)')}>Change password</button>
      </div>}
    </div>
  );
}

function Backup() {
  const [busy, setBusy] = useState(false);
  const exportAll = async () => {
    const data = { app: 'xpos', version: 1, exported_at: new Date().toISOString(), business_id: ctxStore.business_id, tables: {} };
    for (const e of ENTITIES) data.tables[e] = await db.table(e).toArray();
    downloadFile(`xpos-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data), 'application/json');
  };
  const importAll = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!confirm('Restore this backup? Records in the backup will be merged into this device and synced to the server (newer edits win).')) return;
    setBusy(true);
    await attempt(async () => {
      const data = JSON.parse(await file.text());
      if (data.app !== 'xpos') throw new Error('Not an XPOS backup file');
      if (data.business_id && data.business_id !== ctxStore.business_id && !confirm('This backup belongs to a different business. Import anyway into the current business?')) return;
      const bundle = {};
      for (const [k, rows] of Object.entries(data.tables || {})) if (ENTITIES.includes(k) && k !== 'users') bundle[k] = rows.map(r => (k === 'settings' ? { ...r, id: ctxStore.business_id } : r));
      await saveBundle(bundle, { action: 'backup.restore', detail: `Restored backup from ${data.exported_at}` });
    }, 'Backup restored');
    setBusy(false);
  };
  return (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <div className="card"><h3 className="mb-2 font-medium">Export backup</h3><p className="mb-3 text-sm text-slate-500">Download all data on this device as a JSON file.</p><button className="btn-primary" onClick={exportAll}>Download backup</button></div>
      <div className="card"><h3 className="mb-2 font-medium">Restore backup</h3><p className="mb-3 text-sm text-slate-500">Import a JSON backup. Restored records are queued for sync.</p><input type="file" accept="application/json,.json" disabled={busy} onChange={importAll} /></div>
      {!STANDALONE && <div className="card sm:col-span-2"><h3 className="mb-2 font-medium">Re-download from server</h3><p className="mb-3 text-sm text-slate-500">Resets the sync cursor and pulls every record again (pending local changes are kept).</p>
        <button className="btn-secondary" onClick={() => attempt(async () => { await resetCursor(); await syncNow(); }, 'Full re-sync complete')}>Full re-sync</button></div>}
    </div>
  );
}

function Audit() {
  const logs = useTable('audit_logs');
  const users = useTable('users');
  const umap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const rows = [...logs].sort((a, b) => b.at - a.at).slice(0, 500);
  return (
    <div className="card p-0">
      <Table rows={rows} empty="No activity yet" columns={[{ label: 'When', render: r => fmtDateTime(r.at) }, { label: 'User', render: r => r.user_name || umap[r.user_id]?.name || '' }, { label: 'Action', render: r => <Badge>{r.action}</Badge> }, { label: 'Detail', key: 'detail' }]} />
    </div>
  );
}
