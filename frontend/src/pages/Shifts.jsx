import React, { useMemo, useState } from 'react';
import { useTable, useSettings, save, saveBundle, ctx, ctxStore } from '../lib/db.js';
import { money, fmtDateTime, printHtml } from '../lib/format.js';
import { journal as mkJournal, r2 } from '@shared/posting.js';
import { PageHeader, Table, Modal, Field, Stat, Badge, attempt } from '../components/ui.jsx';

export function shiftFigures(shift, journal, sales) {
  const end = shift.closed_at || Date.now();
  let cashIn = 0, cashOut = 0;
  for (const e of journal) {
    if (e.user_id !== shift.user_id || e.at < shift.opened_at || e.at > end || e.ref_type === 'opening' || e.ref_type === 'shift_diff') continue;
    for (const l of e.lines) if (l.account === '1000') { cashIn += l.debit; cashOut += l.credit; }
  }
  const ss = sales.filter(s => s.user_id === shift.user_id && s.at >= shift.opened_at && s.at <= end);
  const byMethod = {};
  for (const s of ss) for (const p of s.payments) byMethod[p.method] = r2((byMethod[p.method] || 0) + p.amount - (p.method === 'cash' ? 0 : 0));
  if (byMethod.cash) byMethod.cash = r2(byMethod.cash - ss.reduce((x, s) => x + (s.change || 0), 0));
  return { cashIn: r2(cashIn), cashOut: r2(cashOut), expected: r2(Number(shift.opening_cash) + cashIn - cashOut), salesCount: ss.length, salesTotal: r2(ss.reduce((x, s) => x + s.total, 0)), byMethod };
}

export default function Shifts() {
  const settings = useSettings();
  const shifts = useTable('shifts');
  const journal = useTable('journal_entries');
  const sales = useTable('sales');
  const users = useTable('users');
  const umap = useMemo(() => Object.fromEntries(users.map(u => [u.id, u])), [users]);
  const mine = shifts.find(s => !s.closed_at && s.user_id === ctxStore.user_id);
  const [openF, setOpenF] = useState(null);
  const [closeF, setCloseF] = useState(null);
  const fig = mine ? shiftFigures(mine, journal, sales) : null;

  const openShift = () => attempt(async () => {
    await save('shifts', { user_id: ctxStore.user_id, user_name: ctxStore.user_name, warehouse_id: ctx().warehouse_id, opened_at: Date.now(), opening_cash: Number(openF.opening_cash) || 0, note: openF.note || '' }, { action: 'shift.open', detail: `Opened register with ${money(openF.opening_cash)}` });
    setOpenF(null);
  }, 'Register opened');
  const closeShift = () => attempt(async () => {
    const counted = Number(closeF.counted) || 0;
    const diff = r2(counted - fig.expected);
    const rec = { ...mine, closed_at: Date.now(), counted_cash: counted, expected_cash: fig.expected, difference: diff, close_note: closeF.note || '', sales_total: fig.salesTotal, sales_count: fig.salesCount };
    const bundle = { shifts: [rec] };
    if (diff && closeF.post) bundle.journal_entries = [mkJournal(ctx(), { ref_type: 'shift_diff', ref_id: mine.id, memo: diff > 0 ? 'Cash over (register)' : 'Cash short (register)', lines: diff > 0 ? [{ account: '1000', debit: diff, credit: 0 }, { account: '4100', debit: 0, credit: diff }] : [{ account: '5100', debit: -diff, credit: 0 }, { account: '1000', debit: 0, credit: -diff }] })];
    await saveBundle(bundle, { action: 'shift.close', detail: `Closed register. Expected ${money(fig.expected)}, counted ${money(counted)}` });
    printZ(rec, fig);
    setCloseF(null);
  }, 'Register closed');
  const printZ = (s, f) => printHtml(`<div class="c b">${settings.name}</div><div class="c">Z-REPORT / SHIFT CLOSE</div><hr>
    <table><tr><td>Cashier</td><td class="r">${s.user_name || ''}</td></tr><tr><td>Opened</td><td class="r">${fmtDateTime(s.opened_at)}</td></tr><tr><td>Closed</td><td class="r">${fmtDateTime(s.closed_at)}</td></tr></table><hr>
    <table><tr><td>Sales (${f.salesCount})</td><td class="r">${money(f.salesTotal, false)}</td></tr>${Object.entries(f.byMethod).map(([k, v]) => `<tr><td>&nbsp;${k}</td><td class="r">${money(v, false)}</td></tr>`).join('')}</table><hr>
    <table><tr><td>Opening cash</td><td class="r">${money(s.opening_cash, false)}</td></tr><tr><td>Cash in</td><td class="r">${money(f.cashIn, false)}</td></tr><tr><td>Cash out</td><td class="r">${money(f.cashOut, false)}</td></tr>
    <tr class="b"><td>Expected</td><td class="r">${money(s.expected_cash, false)}</td></tr><tr class="b"><td>Counted</td><td class="r">${money(s.counted_cash, false)}</td></tr><tr class="b"><td>Difference</td><td class="r">${money(s.difference, false)}</td></tr></table>`, { width: Number(settings.receipt_size) === 58 ? 58 : 80 });

  return (
    <div>
      <PageHeader title="Cash Register" subtitle="Open and close shifts; compares expected vs counted cash">
        {!mine && <button className="btn-primary" onClick={() => setOpenF({ opening_cash: 0, note: '' })}>Open register</button>}
        {mine && <button className="btn-danger" onClick={() => setCloseF({ counted: fig.expected, note: '', post: true })}>Close register</button>}
      </PageHeader>
      {mine ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Opened" value={fmtDateTime(mine.opened_at)} tone="slate" hint={`Opening cash ${money(mine.opening_cash)}`} />
          <Stat label="Sales this shift" value={money(fig.salesTotal)} hint={`${fig.salesCount} invoices`} />
          <Stat label="Cash in / out" value={`${money(fig.cashIn)} / ${money(fig.cashOut)}`} tone="slate" />
          <Stat label="Expected cash in drawer" value={money(fig.expected)} tone="green" />
        </div>
      ) : <div className="card mb-4 text-sm text-slate-500">No open register for you. Open one at the start of your shift.</div>}
      <div className="card p-0">
        <Table rows={[...shifts].sort((a, b) => b.opened_at - a.opened_at)} empty="No shifts yet" columns={[
          { label: 'Cashier', render: s => s.user_name || umap[s.user_id]?.name }, { label: 'Opened', render: s => fmtDateTime(s.opened_at) }, { label: 'Closed', render: s => (s.closed_at ? fmtDateTime(s.closed_at) : <Badge tone="green">open</Badge>) },
          { label: 'Opening', right: true, render: s => money(s.opening_cash) }, { label: 'Expected', right: true, render: s => (s.closed_at ? money(s.expected_cash) : '') },
          { label: 'Counted', right: true, render: s => (s.closed_at ? money(s.counted_cash) : '') },
          { label: 'Diff', right: true, render: s => (s.closed_at ? <span className={s.difference < 0 ? 'text-rose-600' : s.difference > 0 ? 'text-amber-600' : 'text-emerald-600'}>{money(s.difference)}</span> : '') },
          { label: '', render: s => (s.closed_at ? <button className="btn-secondary btn-sm" onClick={() => printZ(s, shiftFigures(s, journal, sales))}>Z-report</button> : null) }
        ]} />
      </div>
      {openF && <Modal open onClose={() => setOpenF(null)} title="Open cash register" footer={<button className="btn-primary" onClick={openShift}>Open</button>}>
        <Field label="Opening cash in drawer"><input className="input" type="number" value={openF.opening_cash} onChange={e => setOpenF({ ...openF, opening_cash: e.target.value })} autoFocus /></Field>
        <Field label="Note" className="mt-2"><input className="input" value={openF.note} onChange={e => setOpenF({ ...openF, note: e.target.value })} /></Field>
      </Modal>}
      {closeF && <Modal open onClose={() => setCloseF(null)} title="Close cash register" footer={<button className="btn-danger" onClick={closeShift}>Close & print Z-report</button>}>
        <div className="mb-2 text-sm">Expected cash: <b>{money(fig.expected)}</b></div>
        <Field label="Counted cash"><input className="input" type="number" value={closeF.counted} onChange={e => setCloseF({ ...closeF, counted: e.target.value })} autoFocus /></Field>
        <div className="mt-2 text-sm">Difference: <b className={Number(closeF.counted) - fig.expected < 0 ? 'text-rose-600' : ''}>{money(r2(Number(closeF.counted) - fig.expected))}</b></div>
        <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={closeF.post} onChange={e => setCloseF({ ...closeF, post: e.target.checked })} /> Post difference to books (cash over/short)</label>
        <Field label="Note" className="mt-2"><input className="input" value={closeF.note} onChange={e => setCloseF({ ...closeF, note: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}
