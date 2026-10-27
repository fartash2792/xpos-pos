import React, { useMemo, useState } from 'react';
import { db, useTable, saveBundle, save, remove, ctx } from '../lib/db.js';
import { useAccounts, paymentAccounts } from '../lib/data.js';
import { money, fmtDate, monthStart, toCSV, downloadFile } from '../lib/format.js';
import { buildExpense, journal as mkJournal, today } from '@shared/posting.js';
import { PAYMENT_METHODS } from '@shared/accounts.js';
import { PageHeader, Table, Modal, Field, Tabs, DateRange, attempt } from '../components/ui.jsx';

export default function Expenses() {
  const [tab, setTab] = useState('expense');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const expenses = useTable('expenses');
  const incomes = useTable('incomes');
  const cats = useTable('expense_categories');
  const accounts = useAccounts();
  const pays = paymentAccounts(accounts);
  const cmap = useMemo(() => Object.fromEntries(cats.map(c => [c.id, c])), [cats]);
  const [f, setF] = useState(null);
  const [catF, setCatF] = useState(null);
  const list = (tab === 'expense' ? expenses : incomes).filter(e => e.date >= range.from && e.date <= range.to).sort((a, b) => b.at - a.at);
  const total = list.reduce((s, e) => s + e.amount, 0);
  const byCat = {};
  if (tab === 'expense') for (const e of list) byCat[cmap[e.category_id]?.name || 'Uncategorised'] = (byCat[cmap[e.category_id]?.name || 'Uncategorised'] || 0) + e.amount;
  const submit = () => attempt(async () => {
    const cat = cmap[f.category_id];
    const b = buildExpense({ kind: tab, amount: f.amount, category_id: f.category_id, category_account: tab === 'expense' ? (cat?.account_code || '5100') : (f.income_account || '4100'), method: f.method, account_code: f.account_code, ctx: ctx(), note: f.note, date: f.date, title: f.title });
    await saveBundle(b, { action: `${tab}.create`, detail: `${tab} ${f.title}: ${money(f.amount)}` });
    setF(null);
  }, 'Saved');
  const del = async e => {
    if (!confirm('Delete and reverse this entry?')) return;
    const entries = await db.journal_entries.where('ref_id').equals(e.id).toArray();
    const reversal = entries.filter(x => !x.deleted).map(x => mkJournal(ctx(), { date: today(), ref_type: 'reversal', ref_id: e.id, memo: 'Reversal: ' + (x.memo || ''), lines: x.lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })) }));
    await saveBundle({ [tab === 'expense' ? 'expenses' : 'incomes']: [{ ...e, deleted: true }], journal_entries: reversal }, { action: `${tab}.delete`, detail: `Deleted ${tab} ${e.title} ${money(e.amount)}` });
  };
  return (
    <div>
      <PageHeader title="Expenses & Income" subtitle={`Total: ${money(total)}`}>
        <DateRange {...range} onChange={setRange} />
        <button className="btn-secondary" onClick={() => downloadFile(`${tab}s.csv`, toCSV(list, [{ label: 'Date', key: 'date' }, { label: 'Title', key: 'title' }, { label: 'Category', value: r => cmap[r.category_id]?.name || '' }, { label: 'Method', key: 'method' }, { label: 'Amount', key: 'amount' }, { label: 'Note', key: 'note' }]))}>Export CSV</button>
        {tab === 'expense' && <button className="btn-secondary" onClick={() => setCatF({ name: '', account_code: '5100' })}>+ Category</button>}
        <button className="btn-primary" onClick={() => setF({ title: '', amount: 0, category_id: cats[0]?.id || '', method: 'cash', account_code: '', date: today(), note: '' })}>+ Add {tab}</button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'expense', label: 'Expenses' }, { key: 'income', label: 'Other income' }]} />
      {tab === 'expense' && Object.keys(byCat).length > 0 && <div className="mb-3 flex flex-wrap gap-2">{Object.entries(byCat).map(([k, v]) => <span key={k} className="badge bg-white text-slate-700 shadow-sm dark:bg-slate-800 dark:text-slate-200">{k}: {money(v)}</span>)}</div>}
      <div className="card p-0">
        <Table rows={list} empty="Nothing recorded in this period" columns={[
          { label: 'Date', render: r => fmtDate(r.date) }, { label: 'Title', key: 'title' },
          ...(tab === 'expense' ? [{ label: 'Category', render: r => cmap[r.category_id]?.name || '—' }] : []),
          { label: 'Paid via', render: r => (PAYMENT_METHODS.find(m => m.key === r.method) || {}).label }, { label: 'Note', key: 'note' },
          { label: 'Amount', right: true, render: r => money(r.amount) }, { label: '', render: r => <button className="btn-secondary btn-sm" onClick={() => del(r)}>Delete</button> }
        ]} />
      </div>
      {f && <Modal open onClose={() => setF(null)} title={tab === 'expense' ? 'Add expense' : 'Add income'} footer={<button className="btn-primary" onClick={submit}>Save</button>}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Title" className="col-span-2"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} autoFocus /></Field>
          <Field label="Amount"><input className="input" type="number" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          {tab === 'expense' ? <Field label="Category"><select className="input" value={f.category_id} onChange={e => setF({ ...f, category_id: e.target.value })}><option value="">—</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            : <Field label="Income account"><select className="input" value={f.income_account || '4100'} onChange={e => setF({ ...f, income_account: e.target.value })}>{accounts.filter(a => a.type === 'income' && !a.contra).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>}
          <Field label={tab === 'expense' ? 'Paid from' : 'Received into'}><select className="input" value={f.account_code || ''} onChange={e => setF({ ...f, account_code: e.target.value, method: pays.find(a => a.code === e.target.value)?.is_cash ? 'cash' : 'bank' })}><option value="">Cash in Hand</option>{pays.filter(a => !a.is_cash).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
          <Field label="Note" className="col-span-2"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </Modal>}
      {catF && <Modal open onClose={() => setCatF(null)} title="Expense category" footer={<button className="btn-primary" onClick={() => attempt(async () => { if (!catF.name) throw new Error('Name required'); await save('expense_categories', catF); setCatF(null); }, 'Category added')}>Save</button>}>
        <Field label="Name"><input className="input" value={catF.name} onChange={e => setCatF({ ...catF, name: e.target.value })} autoFocus /></Field>
        <Field label="Post to expense account" className="mt-2"><select className="input" value={catF.account_code} onChange={e => setCatF({ ...catF, account_code: e.target.value })}>{accounts.filter(a => a.type === 'expense' && a.code !== '5000').map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></Field>
        <div className="mt-3 text-xs text-slate-500">Existing: {cats.map(c => <span key={c.id} className="mr-2">{c.name} <button className="text-rose-600" onClick={() => remove('expense_categories', c.id)}>×</button></span>)}</div>
      </Modal>}
    </div>
  );
}
