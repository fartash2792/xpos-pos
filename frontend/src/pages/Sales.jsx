import React, { useMemo, useState } from 'react';
import { useTable, useSettings, saveBundle, ctx } from '../lib/db.js';
import { money, fmtDate, fmtDateTime, daysAgo, toCSV, downloadFile } from '../lib/format.js';
import { printReceipt, printA4 } from '../lib/receipt.js';
import { buildSaleReturn, today } from '@shared/posting.js';
import { PAYMENT_METHODS } from '@shared/accounts.js';
import { PageHeader, Table, Modal, Badge, DateRange, Tabs, attempt } from '../components/ui.jsx';

export default function Sales() {
  const settings = useSettings();
  const sales = useTable('sales');
  const returns = useTable('sale_returns');
  const customers = useTable('customers');
  const users = useTable('users');
  const [tab, setTab] = useState('sales');
  const [range, setRange] = useState({ from: daysAgo(30), to: today() });
  const [q, setQ] = useState('');
  const [view, setView] = useState(null);
  const [ret, setRet] = useState(null);
  const cmap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);
  const umap = useMemo(() => Object.fromEntries(users.map(c => [c.id, c])), [users]);
  const rows = sales.filter(s => s.date >= range.from && s.date <= range.to && (!q || [s.invoice_no, s.local_no, cmap[s.customer_id]?.name].join(' ').toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.at - a.at);
  const rrows = returns.filter(s => s.date >= range.from && s.date <= range.to).sort((a, b) => b.at - a.at);
  const tot = rows.reduce((s, r) => ({ total: s.total + r.total, due: s.due + r.due, profit: s.profit + (r.profit || 0) }), { total: 0, due: 0, profit: 0 });
  const exportCsv = () => downloadFile(`sales-${range.from}-${range.to}.csv`, toCSV(rows, [
    { label: 'Invoice', value: r => r.invoice_no || r.local_no }, { label: 'Date', key: 'date' }, { label: 'Customer', value: r => cmap[r.customer_id]?.name || 'Walk-in' },
    { label: 'Subtotal', key: 'subtotal' }, { label: 'Discount', key: 'discount' }, { label: 'Tax', key: 'tax' }, { label: 'Total', key: 'total' }, { label: 'Paid', key: 'paid' }, { label: 'Due', key: 'due' }, { label: 'Profit', key: 'profit' }]));
  return (
    <div>
      <PageHeader title="Sales & Returns" subtitle={`${rows.length} invoices · ${money(tot.total)} · due ${money(tot.due)}`}>
        <DateRange {...range} onChange={setRange} />
        <input className="input w-48" placeholder="Search invoice/customer" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
      </PageHeader>
      <Tabs tabs={[{ key: 'sales', label: 'Sales' }, { key: 'returns', label: `Returns (${rrows.length})` }]} value={tab} onChange={setTab} />
      <div className="card p-0">
        {tab === 'sales' ? (
          <Table rows={rows} onRowClick={setView} empty="No sales in this period" columns={[
            { label: 'Invoice', render: r => <span className="font-medium">{r.invoice_no || <span title="Awaiting server number">{r.local_no} <Badge tone="amber">offline #</Badge></span>}</span> },
            { label: 'Date', render: r => fmtDateTime(r.at) },
            { label: 'Customer', render: r => cmap[r.customer_id]?.name || 'Walk-in' },
            { label: 'Cashier', render: r => umap[r.user_id]?.name || '' },
            { label: 'Total', right: true, render: r => money(r.total) },
            { label: 'Due', right: true, render: r => (r.due ? <span className="text-rose-600">{money(r.due)}</span> : '—') },
            { label: 'Status', render: r => <>{r.returned_total > 0 && <Badge tone="amber">returned {money(r.returned_total)}</Badge>} <Badge tone={r.due > 0 ? 'red' : 'green'}>{r.status}</Badge></> }
          ]} />
        ) : (
          <Table rows={rrows} empty="No returns" columns={[
            { label: 'Date', render: r => fmtDateTime(r.at) }, { label: 'Invoice', key: 'sale_no' },
            { label: 'Customer', render: r => cmap[r.customer_id]?.name || 'Walk-in' },
            { label: 'Items', render: r => r.items.map(i => `${i.name} x${i.qty}`).join(', ') },
            { label: 'Refund', render: r => (PAYMENT_METHODS.find(m => m.key === r.refund_method) || {}).label || r.refund_method },
            { label: 'Total', right: true, render: r => money(r.total) }
          ]} />
        )}
      </div>
      <Modal open={!!view} onClose={() => setView(null)} wide title={`Invoice ${view?.invoice_no || view?.local_no || ''}`} footer={view && <>
        <button className="btn-secondary" onClick={() => printReceipt(view, settings, { customer: cmap[view.customer_id], cashier: umap[view.user_id]?.name, size: 58 })}>Receipt 58mm</button>
        <button className="btn-secondary" onClick={() => printReceipt(view, settings, { customer: cmap[view.customer_id], cashier: umap[view.user_id]?.name, size: 80 })}>Receipt 80mm</button>
        <button className="btn-secondary" onClick={() => printA4(view, settings, { customer: cmap[view.customer_id] })}>A4 Invoice</button>
        <button className="btn-danger" onClick={() => { setRet(view); setView(null); }}>Return items</button>
      </>}>
        {view && <SaleDetail sale={view} customer={cmap[view.customer_id]} />}
      </Modal>
      <ReturnModal sale={ret} onClose={() => setRet(null)} returns={returns} />
    </div>
  );
}

function SaleDetail({ sale, customer }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><span className="label">Date</span>{fmtDateTime(sale.at)}</div>
        <div><span className="label">Customer</span>{customer?.name || 'Walk-in'}</div>
        <div><span className="label">Local no.</span>{sale.local_no}</div>
        <div><span className="label">Profit</span>{money(sale.profit)}</div>
      </div>
      <Table rows={sale.items} columns={[
        { label: 'Item', render: i => <>{i.name}{i.variant_name && ` · ${i.variant_name}`}{i.serial && <div className="text-xs">IMEI {i.serial}</div>}{i.batch_no && <div className="text-xs">Batch {i.batch_no}</div>}</> },
        { label: 'Qty', key: 'qty', right: true }, { label: 'Price', right: true, render: i => money(i.price) },
        { label: 'Disc', right: true, render: i => money(i.discount_amount) }, { label: 'Tax', right: true, render: i => money(i.tax) }, { label: 'Total', right: true, render: i => money(i.total) }
      ]} />
      <div className="ml-auto max-w-xs space-y-1">
        {[['Subtotal', sale.subtotal], ['Discount', -sale.discount], ['Tax', sale.tax], ['Shipping', sale.shipping], ['Total', sale.total], ['Paid', sale.paid], ['Change', sale.change], ['Due', sale.due]].filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span>{money(v)}</span></div>)}
        <div className="text-xs text-slate-500">{sale.payments.map(p => `${p.method}: ${money(p.amount)}`).join(' · ')}</div>
      </div>
    </div>
  );
}

function ReturnModal({ sale, onClose, returns }) {
  const [qty, setQty] = useState({});
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  if (!sale) return null;
  const already = {};
  for (const r of returns.filter(r => r.sale_id === sale.id)) for (const i of r.items) already[i.line_index] = (already[i.line_index] || 0) + Number(i.qty);
  const submit = () => attempt(async () => {
    const items = Object.entries(qty).map(([line_index, q]) => ({ line_index: Number(line_index), qty: Number(q) })).filter(i => i.qty > 0);
    for (const i of items) if (i.qty > sale.items[i.line_index].qty - (already[i.line_index] || 0)) throw new Error('Return qty exceeds sold qty');
    const b = buildSaleReturn({ sale, items, refund_method: method, ctx: ctx(), note });
    await saveBundle(b, { action: 'sale.return', detail: `Return on ${sale.invoice_no || sale.local_no}: ${money(b.sale_returns[0].total)}` });
    setQty({}); onClose();
  }, 'Return saved, stock restored');
  return (
    <Modal open onClose={onClose} title={`Return items — ${sale.invoice_no || sale.local_no}`} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" onClick={submit}>Save return</button></>}>
      <div className="space-y-2">
        {sale.items.map((i, idx) => {
          const max = i.qty - (already[idx] || 0);
          return (
            <div key={idx} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">{i.name}{i.variant_name && ` · ${i.variant_name}`}{i.serial && ` · ${i.serial}`}<div className="text-xs text-slate-500">sold {i.qty} · returnable {max} · {money(i.total / i.qty)} each</div></div>
              <input className="input w-20" type="number" min="0" max={max} disabled={max <= 0} value={qty[idx] || ''} onChange={e => setQty({ ...qty, [idx]: e.target.value })} />
            </div>
          );
        })}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <div><span className="label">Refund via</span><select className="input" value={method} onChange={e => setMethod(e.target.value)}>
            {PAYMENT_METHODS.filter(m => m.key !== 'points').map(m => <option key={m.key} value={m.key} disabled={m.key === 'credit' && !sale.customer_id}>{m.key === 'credit' ? 'Adjust customer balance' : m.label}</option>)}</select></div>
          <div><span className="label">Note</span><input className="input" value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
      </div>
    </Modal>
  );
}
