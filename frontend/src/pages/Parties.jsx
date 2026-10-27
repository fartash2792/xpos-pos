import React, { useMemo, useState } from 'react';
import { useTable, useSettings, saveBundle, remove, ctx } from '../lib/db.js';
import { partyBalances, customerPoints, useAccounts, paymentAccounts } from '../lib/data.js';
import { money, fmtDate, toCSV, downloadFile, printHtml } from '../lib/format.js';
import { buildOpening, buildPayment, r2, today } from '@shared/posting.js';
import { PAYMENT_METHODS } from '@shared/accounts.js';
import { uuid } from '@shared/uuid.js';
import { PageHeader, Table, Modal, Field, Badge, attempt } from '../components/ui.jsx';

export default function Parties({ type }) {
  const entity = type === 'customer' ? 'customers' : 'suppliers';
  const label = type === 'customer' ? 'Customers' : 'Suppliers';
  const settings = useSettings();
  const parties = useTable(entity, p => !p.is_walkin);
  const journal = useTable('journal_entries');
  const sales = useTable('sales');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [ledger, setLedger] = useState(null);
  const [pay, setPay] = useState(null);
  const bal = useMemo(() => partyBalances(journal), [journal]);
  const rows = parties.filter(p => !q || [p.name, p.phone].join(' ').toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const totalDue = rows.reduce((s, p) => s + Math.max(0, bal[p.id] || 0), 0);
  return (
    <div>
      <PageHeader title={label} subtitle={`${type === 'customer' ? 'Total receivable' : 'Total payable'}: ${money(totalDue)}`}>
        <input className="input w-48" placeholder="Search name / phone" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-secondary" onClick={() => downloadFile(`${entity}.csv`, toCSV(rows, [{ label: 'Name', key: 'name' }, { label: 'Phone', key: 'phone' }, { label: 'Address', key: 'address' }, { label: 'Balance', value: r => bal[r.id] || 0 }, { label: 'Credit limit', key: 'credit_limit' }]))}>Export CSV</button>
        <button className="btn-primary" onClick={() => setEdit({ name: '', phone: '', email: '', address: '', credit_limit: 0, opening_balance: 0 })}>+ Add {type}</button>
      </PageHeader>
      <div className="card p-0">
        <Table rows={rows} empty={`No ${entity} yet`} columns={[
          { label: 'Name', render: p => <div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.address}</div></div> },
          { label: 'Phone', key: 'phone' },
          ...(type === 'customer' ? [{ label: 'Credit limit', right: true, render: p => (p.credit_limit ? money(p.credit_limit) : '—') }, ...(settings.loyalty?.enabled ? [{ label: 'Points', right: true, render: p => customerPoints(sales, p.id) }] : [])] : []),
          { label: type === 'customer' ? 'Receivable' : 'Payable', right: true, render: p => { const b = bal[p.id] || 0; return <span className={b > 0 ? 'font-semibold text-rose-600' : b < 0 ? 'text-emerald-600' : ''}>{money(b)}{type === 'customer' && p.credit_limit > 0 && b > p.credit_limit && <Badge tone="red">over limit</Badge>}</span>; } },
          { label: '', render: p => <div className="flex justify-end gap-1">
            <button className="btn-secondary btn-sm" onClick={() => setLedger(p)}>Ledger</button>
            <button className="btn-success btn-sm" onClick={() => setPay({ party: p, amount: Math.max(0, bal[p.id] || 0), method: 'cash', note: '', date: today() })}>{type === 'customer' ? 'Receive' : 'Pay'}</button>
            <button className="btn-secondary btn-sm" onClick={() => setEdit({ ...p })}>Edit</button>
          </div> }
        ]} />
      </div>
      {edit && <PartyForm type={type} entity={entity} party={edit} onClose={() => setEdit(null)} />}
      {ledger && <Ledger party={ledger} type={type} journal={journal} settings={settings} onClose={() => setLedger(null)} />}
      {pay && <PaymentModal type={type} pay={pay} setPay={setPay} />}
    </div>
  );
}

function PartyForm({ type, entity, party, onClose }) {
  const [f, setF] = useState(party);
  const isNew = !party.id;
  const submit = () => attempt(async () => {
    if (!f.name) throw new Error('Name required');
    const rec = { ...f, id: f.id || uuid(), credit_limit: Number(f.credit_limit) || 0, opening_balance: Number(f.opening_balance) || 0 };
    const bundle = { [entity]: [rec] };
    if (isNew && rec.opening_balance) Object.assign(bundle, buildOpening({ amount: rec.opening_balance, ctx: ctx(), party: { party_id: rec.id, party_type: type } }));
    await saveBundle(bundle, { action: `${type}.${isNew ? 'create' : 'update'}`, detail: `${isNew ? 'Created' : 'Updated'} ${type} ${rec.name}` });
    onClose();
  }, 'Saved');
  return (
    <Modal open onClose={onClose} title={isNew ? `Add ${type}` : `Edit ${party.name}`} footer={<>
      {!isNew && <button className="btn-danger mr-auto" onClick={() => confirm('Delete?') && remove(entity, f.id).then(onClose)}>Delete</button>}
      <button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit}>Save</button></>}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name *" className="col-span-2"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="Phone"><input className="input" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" value={f.email || ''} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Address" className="col-span-2"><input className="input" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} /></Field>
        {type === 'customer' && <Field label="Credit limit"><input className="input" type="number" value={f.credit_limit} onChange={e => setF({ ...f, credit_limit: e.target.value })} /></Field>}
        <Field label={`Opening balance (${type === 'customer' ? 'they owe you' : 'you owe them'})`}><input className="input" type="number" disabled={!isNew} value={f.opening_balance} onChange={e => setF({ ...f, opening_balance: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Ledger({ party, type, journal, settings, onClose }) {
  const acc = type === 'customer' ? '1100' : '2000';
  const rows = [];
  for (const e of [...journal].sort((a, b) => (a.date + a.at).localeCompare(b.date + b.at))) {
    for (const l of e.lines) if (l.party_id === party.id && l.account === acc) rows.push({ id: e.id + rows.length, date: e.date, memo: e.memo, ref: e.ref_no, debit: l.debit, credit: l.credit });
  }
  let run = 0;
  for (const r of rows) { run = r2(run + (type === 'customer' ? r.debit - r.credit : r.credit - r.debit)); r.balance = run; }
  const print = () => printHtml(`<div class="a4"><h2>${settings.name}</h2><h3>${type === 'customer' ? 'Customer' : 'Supplier'} Ledger: ${party.name}</h3><p>${party.phone || ''}</p>
    <table><thead><tr><th>Date</th><th>Description</th><th>Ref</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.date}</td><td>${r.memo}</td><td>${r.ref || ''}</td><td class="r">${money(r.debit, false)}</td><td class="r">${money(r.credit, false)}</td><td class="r">${money(r.balance, false)}</td></tr>`).join('')}
    </tbody></table><h3 class="r">Closing balance: ${money(run)}</h3></div>`);
  return (
    <Modal open wide onClose={onClose} title={`Ledger — ${party.name}`} footer={<button className="btn-secondary" onClick={print}>Print statement</button>}>
      <Table rows={rows} empty="No transactions" columns={[
        { label: 'Date', render: r => fmtDate(r.date) }, { label: 'Description', key: 'memo' }, { label: 'Ref', key: 'ref' },
        { label: 'Debit', right: true, render: r => (r.debit ? money(r.debit) : '') }, { label: 'Credit', right: true, render: r => (r.credit ? money(r.credit) : '') },
        { label: 'Balance', right: true, render: r => <b>{money(r.balance)}</b> }
      ]} />
    </Modal>
  );
}

export function PaymentModal({ type, pay, setPay }) {
  const accounts = paymentAccounts(useAccounts());
  const submit = () => attempt(async () => {
    await saveBundle(buildPayment({ party_type: type, party_id: pay.party.id, amount: pay.amount, method: pay.method, account_code: pay.account_code, ctx: ctx(), note: pay.note, date: pay.date }),
      { action: `payment.${type === 'customer' ? 'in' : 'out'}`, detail: `${type === 'customer' ? 'Received from' : 'Paid to'} ${pay.party.name}: ${money(pay.amount)}` });
    setPay(null);
  }, 'Payment recorded');
  return (
    <Modal open onClose={() => setPay(null)} title={`${type === 'customer' ? 'Receive payment from' : 'Pay'} ${pay.party.name}`} footer={<button className="btn-success" onClick={submit}>Save payment</button>}>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount"><input className="input" type="number" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} autoFocus /></Field>
        <Field label="Date"><input className="input" type="date" value={pay.date} onChange={e => setPay({ ...pay, date: e.target.value })} /></Field>
        <Field label="Method"><select className="input" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value, account_code: '' })}>{PAYMENT_METHODS.filter(m => !['credit', 'points'].includes(m.key)).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Field>
        <Field label="Account"><select className="input" value={pay.account_code || ''} onChange={e => setPay({ ...pay, account_code: e.target.value })}><option value="">Default for method</option>{accounts.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
        <Field label="Note" className="col-span-2"><input className="input" value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
