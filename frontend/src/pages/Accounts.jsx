import React, { useMemo, useState } from 'react';
import { useTable, useSettings, save, saveBundle, ctx } from '../lib/db.js';
import { useAccounts, paymentAccounts, balancesWithAccounts } from '../lib/data.js';
import { money, fmtDate, monthStart, printHtml, toCSV, downloadFile } from '../lib/format.js';
import { buildTransfer, journal as mkJournal, r2, today } from '@shared/posting.js';
import { PageHeader, Table, Modal, Field, Tabs, Badge, DateRange, Stat, attempt } from '../components/ui.jsx';

export default function Accounts() {
  const [tab, setTab] = useState('coa');
  const accounts = useAccounts();
  const journal = useTable('journal_entries');
  const settings = useSettings();
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const amap = useMemo(() => Object.fromEntries(accounts.map(a => [a.code, a])), [accounts]);
  return (
    <div>
      <PageHeader title="Accounts" subtitle="Double-entry books, auto-posted from every sale, purchase, expense and payment">
        {['daybook', 'tb', 'pl'].includes(tab) && <DateRange {...range} onChange={setRange} />}
        {tab === 'bs' && <span className="text-sm text-slate-500">As of <input type="date" className="input inline w-auto" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></span>}
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'coa', label: 'Chart of accounts' }, { key: 'cash', label: 'Cash & bank' }, { key: 'daybook', label: 'Day book / Journal' }, { key: 'tb', label: 'Trial balance' }, { key: 'pl', label: 'Profit & loss' }, { key: 'bs', label: 'Balance sheet' }]} />
      {tab === 'coa' && <ChartOfAccounts accounts={accounts} journal={journal} />}
      {tab === 'cash' && <CashBank accounts={accounts} journal={journal} amap={amap} />}
      {tab === 'daybook' && <DayBook journal={journal} amap={amap} range={range} accounts={accounts} />}
      {tab === 'tb' && <TrialBalance journal={journal} accounts={accounts} range={range} settings={settings} />}
      {tab === 'pl' && <ProfitLoss journal={journal} accounts={accounts} range={range} settings={settings} />}
      {tab === 'bs' && <BalanceSheet journal={journal} accounts={accounts} to={range.to} settings={settings} />}
    </div>
  );
}

function ChartOfAccounts({ accounts, journal }) {
  const [f, setF] = useState(null);
  const bals = balancesWithAccounts(journal, accounts, undefined, true);
  const submit = () => attempt(async () => {
    if (!f.name) throw new Error('Name required');
    let code = f.code;
    if (!code) {
      const base = { asset: 1000, liability: 2000, equity: 3000, income: 4000, expense: 5000 }[f.type];
      const used = new Set(accounts.map(a => Number(a.code)));
      let c = base + (f.is_bank ? 11 : 500); while (used.has(c)) c++;
      code = String(c);
    }
    if (!f.id && accounts.find(a => a.code === code)) throw new Error('Code already exists');
    await save('accounts', { ...f, code }, { action: 'account.save', detail: `Account ${code} ${f.name}` });
    setF(null);
  }, 'Account saved');
  return (
    <div className="card p-0">
      <div className="flex justify-end p-3"><button className="btn-primary" onClick={() => setF({ name: '', type: 'asset', is_bank: false, is_cash: false, code: '' })}>+ Add account</button></div>
      <Table rows={bals} columns={[
        { label: 'Code', key: 'code' }, { label: 'Account', render: a => <>{a.name} {a.is_cash && <Badge tone="green">cash</Badge>} {a.is_bank && <Badge tone="brand">bank/wallet</Badge>} {a.system && <Badge>system</Badge>}</> },
        { label: 'Type', render: a => <span className="capitalize">{a.type}</span> }, { label: 'Balance', right: true, render: a => money(a.balance) },
        { label: '', render: a => (!a.system && a.id ? <button className="btn-secondary btn-sm" onClick={() => setF({ ...a })}>Edit</button> : null) }
      ]} />
      {f && <Modal open onClose={() => setF(null)} title="Account" footer={<button className="btn-primary" onClick={submit}>Save</button>}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Type"><select className="input" value={f.type} disabled={!!f.id} onChange={e => setF({ ...f, type: e.target.value })}>{['asset', 'liability', 'equity', 'income', 'expense'].map(t => <option key={t}>{t}</option>)}</select></Field>
          <Field label="Code (auto if empty)"><input className="input" value={f.code} disabled={!!f.id} onChange={e => setF({ ...f, code: e.target.value })} /></Field>
          {f.type === 'asset' && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.is_bank} onChange={e => setF({ ...f, is_bank: e.target.checked })} /> This is a bank / wallet account (usable for payments)</label>}
        </div>
      </Modal>}
    </div>
  );
}

function CashBank({ accounts, journal, amap }) {
  const transfers = useTable('transfers');
  const pays = paymentAccounts(accounts);
  const bals = balancesWithAccounts(journal, pays);
  const [f, setF] = useState(null);
  const submit = () => attempt(async () => {
    await saveBundle(buildTransfer({ from_account: f.from, to_account: f.to, amount: f.amount, ctx: ctx(), note: f.note, date: f.date }), { action: 'transfer', detail: `Transfer ${money(f.amount)} ${amap[f.from]?.name} → ${amap[f.to]?.name}` });
    setF(null);
  }, 'Transfer saved');
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">{bals.map(a => <Stat key={a.code} label={a.name} value={money(a.balance)} tone={a.balance < 0 ? 'red' : 'slate'} />)}</div>
      <div className="card p-0">
        <div className="flex items-center justify-between p-3"><h3 className="font-medium">Transfers</h3><button className="btn-primary" onClick={() => setF({ from: '1000', to: '1010', amount: 0, note: 'Cash deposited to bank', date: today() })}>+ Transfer</button></div>
        <Table rows={[...transfers].sort((a, b) => b.at - a.at)} empty="No transfers" columns={[
          { label: 'Date', render: r => fmtDate(r.date) }, { label: 'From', render: r => amap[r.from_account]?.name }, { label: 'To', render: r => amap[r.to_account]?.name },
          { label: 'Note', key: 'note' }, { label: 'Amount', right: true, render: r => money(r.amount) }]} />
      </div>
      {f && <Modal open onClose={() => setF(null)} title="Transfer between accounts" footer={<button className="btn-primary" onClick={submit}>Save</button>}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From"><select className="input" value={f.from} onChange={e => setF({ ...f, from: e.target.value })}>{pays.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
          <Field label="To"><select className="input" value={f.to} onChange={e => setF({ ...f, to: e.target.value })}>{pays.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>
          <Field label="Amount"><input className="input" type="number" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Note" className="col-span-2"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}

function DayBook({ journal, amap, range, accounts }) {
  const [manual, setManual] = useState(null);
  const rows = journal.filter(e => e.date >= range.from && e.date <= range.to).sort((a, b) => (b.date + b.at).localeCompare(a.date + a.at));
  const dr = r2(rows.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0));
  const cr = r2(rows.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit, 0), 0));
  const submit = () => attempt(async () => {
    const lines = manual.lines.filter(l => l.account && (Number(l.debit) || Number(l.credit))).map(l => ({ account: l.account, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
    const d = r2(lines.reduce((s, l) => s + l.debit, 0)); const c = r2(lines.reduce((s, l) => s + l.credit, 0));
    if (!lines.length || d !== c) throw new Error(`Debits (${d}) must equal credits (${c})`);
    await save('journal_entries', mkJournal(ctx(), { date: manual.date, ref_type: 'manual', ref_id: null, memo: manual.memo || 'Manual journal', lines }), { action: 'journal.manual', detail: manual.memo });
    setManual(null);
  }, 'Journal posted');
  return (
    <div className="card p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span>{rows.length} entries · Debits {money(dr)} · Credits {money(cr)} {dr === cr ? <Badge tone="green">balanced</Badge> : <Badge tone="red">unbalanced</Badge>}</span>
        <button className="btn-secondary" onClick={() => setManual({ date: today(), memo: '', lines: [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }] })}>+ Manual journal</button>
      </div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
          <tbody>{rows.slice(0, 400).map(e => e.lines.map((l, i) => (
            <tr key={e.id + i} className={i === 0 ? 'border-t-2 border-slate-200 dark:border-slate-700' : ''}>
              <td>{i === 0 ? fmtDate(e.date) : ''}</td><td>{i === 0 ? <>{e.memo} <span className="text-xs text-slate-400">{e.ref_no}</span></> : ''}</td>
              <td className={l.credit ? 'pl-8' : ''}>{l.account} · {amap[l.account]?.name || ''}</td>
              <td className="text-right">{l.debit ? money(l.debit, false) : ''}</td><td className="text-right">{l.credit ? money(l.credit, false) : ''}</td>
            </tr>)))}</tbody>
        </table>
      </div>
      {manual && <Modal open wide onClose={() => setManual(null)} title="Manual journal entry" footer={<button className="btn-primary" onClick={submit}>Post</button>}>
        <div className="mb-2 grid grid-cols-2 gap-2"><Field label="Date"><input className="input" type="date" value={manual.date} onChange={e => setManual({ ...manual, date: e.target.value })} /></Field><Field label="Memo"><input className="input" value={manual.memo} onChange={e => setManual({ ...manual, memo: e.target.value })} /></Field></div>
        {manual.lines.map((l, i) => (
          <div key={i} className="mb-1 grid grid-cols-[1fr_120px_120px] gap-1">
            <select className="input" value={l.account} onChange={e => setManual({ ...manual, lines: manual.lines.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)) })}><option value="">Account…</option>{accounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
            <input className="input" type="number" placeholder="Debit" value={l.debit} onChange={e => setManual({ ...manual, lines: manual.lines.map((x, j) => (j === i ? { ...x, debit: e.target.value } : x)) })} />
            <input className="input" type="number" placeholder="Credit" value={l.credit} onChange={e => setManual({ ...manual, lines: manual.lines.map((x, j) => (j === i ? { ...x, credit: e.target.value } : x)) })} />
          </div>
        ))}
        <button className="btn-secondary btn-sm" onClick={() => setManual({ ...manual, lines: [...manual.lines, { account: '', debit: 0, credit: 0 }] })}>+ Line</button>
      </Modal>}
    </div>
  );
}

function reportPrint(settings, title, sub, rows) {
  printHtml(`<div class="a4"><h2>${settings.name || ''}</h2><h3>${title}</h3><p class="muted">${sub}</p><table>${rows.map(r => `<tr class="${r.b ? 'b' : ''}"><td>${r.k}</td><td class="r">${r.v ?? ''}</td>${r.v2 !== undefined ? `<td class="r">${r.v2}</td>` : ''}</tr>`).join('')}</table></div>`);
}

function TrialBalance({ journal, accounts, range, settings }) {
  const rows = balancesWithAccounts(journal, accounts, range, true).filter(a => a.debit || a.credit).map(a => { const n = r2(a.debit - a.credit); return { ...a, dr: n > 0 ? n : 0, cr: n < 0 ? -n : 0 }; });
  const td = r2(rows.reduce((s, r) => s + r.dr, 0)); const tc = r2(rows.reduce((s, r) => s + r.cr, 0));
  return (
    <div className="card p-0">
      <div className="flex justify-between p-3 text-sm"><span>{td === tc ? <Badge tone="green">Balanced ✓</Badge> : <Badge tone="red">Out of balance by {money(td - tc)}</Badge>}</span>
        <span className="flex gap-2"><button className="btn-secondary btn-sm" onClick={() => downloadFile('trial-balance.csv', toCSV(rows, [{ label: 'Code', key: 'code' }, { label: 'Account', key: 'name' }, { label: 'Debit', key: 'dr' }, { label: 'Credit', key: 'cr' }]))}>CSV</button>
          <button className="btn-secondary btn-sm" onClick={() => reportPrint(settings, 'Trial Balance', `${range.from} to ${range.to}`, [{ k: 'Account', v: 'Debit', v2: 'Credit', b: 1 }, ...rows.map(r => ({ k: `${r.code} ${r.name}`, v: money(r.dr, false), v2: money(r.cr, false) })), { k: 'Total', v: money(td, false), v2: money(tc, false), b: 1 }])}>Print</button></span></div>
      <Table rows={rows} footer={{ name: 'Total', dr: money(td), cr: money(tc) }} columns={[{ label: 'Code', key: 'code' }, { label: 'Account', key: 'name' }, { label: 'Debit', key: 'dr', right: true, render: r => (r.dr ? money(r.dr) : '') }, { label: 'Credit', key: 'cr', right: true, render: r => (r.cr ? money(r.cr) : '') }]} />
    </div>
  );
}

export function plFigures(journal, accounts, range) {
  const b = balancesWithAccounts(journal, accounts, range);
  const income = b.filter(a => a.type === 'income' && !a.contra && a.balance);
  const contra = b.filter(a => a.type === 'income' && a.contra && a.balance);
  const cogs = b.find(a => a.code === '5000')?.balance || 0;
  const expenses = b.filter(a => a.type === 'expense' && a.code !== '5000' && a.balance);
  const revenue = r2(income.reduce((s, a) => s + a.balance, 0) - contra.reduce((s, a) => s + a.balance, 0));
  const gross = r2(revenue - cogs);
  const exp = r2(expenses.reduce((s, a) => s + a.balance, 0));
  return { income, contra, cogs, expenses, revenue, gross, exp, net: r2(gross - exp) };
}

function ProfitLoss({ journal, accounts, range, settings }) {
  const p = plFigures(journal, accounts, range);
  const lines = [
    { k: 'Revenue', b: 1 }, ...p.income.map(a => ({ k: '  ' + a.name, v: money(a.balance) })), ...p.contra.map(a => ({ k: '  Less: ' + a.name, v: '-' + money(a.balance) })),
    { k: 'Net revenue', v: money(p.revenue), b: 1 }, { k: 'Cost of goods sold', v: '-' + money(p.cogs) }, { k: 'Gross profit', v: money(p.gross), b: 1 },
    { k: 'Expenses', b: 1 }, ...p.expenses.map(a => ({ k: '  ' + a.name, v: money(a.balance) })), { k: 'Total expenses', v: money(p.exp), b: 1 },
    { k: p.net >= 0 ? 'NET PROFIT' : 'NET LOSS', v: money(p.net), b: 1 }
  ];
  return <Statement lines={lines} onPrint={() => reportPrint(settings, 'Profit & Loss', `${range.from} to ${range.to}`, lines)} />;
}

function BalanceSheet({ journal, accounts, to, settings }) {
  const b = balancesWithAccounts(journal, accounts, { to }, true);
  const p = plFigures(journal, accounts, { to });
  const assets = b.filter(a => a.type === 'asset' && a.balance);
  const liab = b.filter(a => a.type === 'liability' && a.balance);
  const eq = b.filter(a => a.type === 'equity' && a.balance);
  const ta = r2(assets.reduce((s, a) => s + a.balance, 0));
  const tl = r2(liab.reduce((s, a) => s + a.balance, 0));
  const te = r2(eq.reduce((s, a) => s + a.balance, 0) + p.net);
  const lines = [
    { k: 'ASSETS', b: 1 }, ...assets.map(a => ({ k: '  ' + a.name, v: money(a.balance) })), { k: 'Total assets', v: money(ta), b: 1 },
    { k: 'LIABILITIES', b: 1 }, ...liab.map(a => ({ k: '  ' + a.name, v: money(a.balance) })), { k: 'Total liabilities', v: money(tl), b: 1 },
    { k: 'EQUITY', b: 1 }, ...eq.map(a => ({ k: '  ' + a.name, v: money(a.balance) })), { k: '  Retained earnings (net profit)', v: money(p.net) }, { k: 'Total equity', v: money(te), b: 1 },
    { k: 'Liabilities + Equity', v: money(r2(tl + te)), b: 1 }
  ];
  return <><div className="mb-2">{Math.abs(ta - tl - te) < 0.01 ? <Badge tone="green">Balanced ✓</Badge> : <Badge tone="red">Difference {money(ta - tl - te)}</Badge>}</div>
    <Statement lines={lines} onPrint={() => reportPrint(settings, 'Balance Sheet', `As of ${to}`, lines)} /></>;
}

function Statement({ lines, onPrint }) {
  return (
    <div className="card max-w-2xl">
      <div className="mb-2 flex justify-end"><button className="btn-secondary btn-sm" onClick={onPrint}>Print</button></div>
      {lines.map((l, i) => <div key={i} className={`flex justify-between border-b border-slate-100 py-1.5 text-sm dark:border-slate-800 ${l.b ? 'font-semibold' : 'text-slate-600 dark:text-slate-300'}`}><span className="whitespace-pre">{l.k}</span><span>{l.v}</span></div>)}
    </div>
  );
}
