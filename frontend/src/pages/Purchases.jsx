import React, { useMemo, useState } from 'react';
import { db, useTable, useSettings, saveBundle, save, ctx } from '../lib/db.js';
import { useAccounts, paymentAccounts } from '../lib/data.js';
import { money, fmtDate, daysAgo, toCSV, downloadFile } from '../lib/format.js';
import { printA4 } from '../lib/receipt.js';
import { buildPurchase, buildPurchaseReturn, computeCart, today, r2 } from '@shared/posting.js';
import { PAYMENT_METHODS } from '@shared/accounts.js';
import { PageHeader, Table, Modal, Field, Tabs, Badge, DateRange, attempt } from '../components/ui.jsx';
import { ProductPicker } from './Inventory.jsx';

export default function Purchases() {
  const settings = useSettings();
  const purchases = useTable('purchases');
  const returns = useTable('purchase_returns');
  const suppliers = useTable('suppliers');
  const products = useTable('products');
  const [tab, setTab] = useState('purchases');
  const [range, setRange] = useState({ from: daysAgo(90), to: today() });
  const [form, setForm] = useState(null);
  const [ret, setRet] = useState(null);
  const smap = useMemo(() => Object.fromEntries(suppliers.map(s => [s.id, s])), [suppliers]);
  const rows = purchases.filter(p => p.date >= range.from && p.date <= range.to).sort((a, b) => b.at - a.at);
  const rrows = returns.filter(p => p.date >= range.from && p.date <= range.to).sort((a, b) => b.at - a.at);
  const newForm = (po) => setForm(po ? { ...po, po_id: po.id, items: po.items.map(i => ({ ...i })), payments: [{ method: 'cash', amount: 0 }], status: 'received' }
    : { supplier_id: '', ref_no: '', date: today(), items: [{ product_id: '', variant_id: '', qty: 1, cost: 0, discount: 0, tax_rate: 0 }], discount: 0, shipping: 0, payments: [{ method: 'cash', amount: 0 }], note: '', status: 'received', update_cost: true });
  return (
    <div>
      <PageHeader title="Purchases" subtitle="Purchase orders, purchase invoices and returns">
        <DateRange {...range} onChange={setRange} />
        <button className="btn-secondary" onClick={() => downloadFile('purchases.csv', toCSV(rows, [{ label: 'Date', key: 'date' }, { label: 'Ref', key: 'ref_no' }, { label: 'Supplier', value: r => smap[r.supplier_id]?.name }, { label: 'Status', key: 'status' }, { label: 'Total', key: 'total' }, { label: 'Paid', key: 'paid' }, { label: 'Due', key: 'due' }]))}>Export CSV</button>
        <button className="btn-primary" onClick={() => newForm()}>+ New purchase</button>
      </PageHeader>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'purchases', label: 'Purchases & POs' }, { key: 'returns', label: `Returns (${rrows.length})` }]} />
      <div className="card p-0">
        {tab === 'purchases' ? <Table rows={rows} empty="No purchases" columns={[
          { label: 'Date', render: r => fmtDate(r.date) }, { label: 'Ref #', key: 'ref_no' }, { label: 'Supplier', render: r => smap[r.supplier_id]?.name },
          { label: 'Items', render: r => r.items.length }, { label: 'Total', right: true, render: r => money(r.total) },
          { label: 'Due', right: true, render: r => (r.due ? <span className="text-rose-600">{money(r.due)}</span> : '—') },
          { label: 'Status', render: r => <Badge tone={r.status === 'ordered' ? 'amber' : r.status === 'converted' ? 'slate' : 'green'}>{r.status === 'ordered' ? 'PO (ordered)' : r.status}</Badge> },
          { label: '', render: r => <div className="flex justify-end gap-1">
            <button className="btn-secondary btn-sm" onClick={() => printA4(r, settings, { supplier: smap[r.supplier_id], title: r.status === 'ordered' ? 'PURCHASE ORDER' : 'PURCHASE' })}>Print</button>
            {r.status === 'ordered' && <button className="btn-primary btn-sm" onClick={() => newForm(r)}>Receive</button>}
            {r.status === 'received' && <button className="btn-secondary btn-sm" onClick={() => setRet(r)}>Return</button>}
          </div> }
        ]} /> : <Table rows={rrows} empty="No purchase returns" columns={[
          { label: 'Date', render: r => fmtDate(r.date) }, { label: 'Supplier', render: r => smap[r.supplier_id]?.name },
          { label: 'Items', render: r => r.items.map(i => `${i.name} x${i.qty}`).join(', ') }, { label: 'Total', right: true, render: r => money(r.total) }
        ]} />}
      </div>
      {form && <PurchaseForm form={form} setForm={setForm} suppliers={suppliers} products={products} />}
      {ret && <PurchaseReturn purchase={ret} onClose={() => setRet(null)} returns={returns} />}
    </div>
  );
}

function PurchaseForm({ form: f, setForm: setF, suppliers, products }) {
  const accounts = paymentAccounts(useAccounts());
  const pmap = Object.fromEntries(products.map(p => [p.id, p]));
  const setItem = (i, patch) => setF(x => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const lines = f.items.filter(i => i.product_id).map(i => ({ ...i, name: pmap[i.product_id]?.name, variant_name: pmap[i.product_id]?.variants?.find(v => v.id === i.variant_id)?.name || '', price: i.cost }));
  const t = computeCart(lines, { discount: f.discount, shipping: f.shipping });
  const submit = asPO => attempt(async () => {
    if (!f.supplier_id) throw new Error('Select a supplier');
    if (!lines.length) throw new Error('Add at least one item');
    for (const l of lines) {
      const p = pmap[l.product_id];
      if (p.variants?.length && !l.variant_id) throw new Error(`Choose a variant for ${p.name}`);
      if (!asPO && p.track_serial) { const s = String(l.serials_text || '').split(/[\s,]+/).filter(Boolean); if (s.length !== Number(l.qty)) throw new Error(`${p.name}: enter ${l.qty} IMEI/serial numbers`); }
      if (!asPO && p.track_batch && !l.batch_no) throw new Error(`${p.name}: batch number required`);
    }
    const items = lines.map(l => ({ ...l, serials: String(l.serials_text || '').split(/[\s,]+/).filter(Boolean) }));
    if (asPO) {
      await save('purchases', { date: f.date, at: Date.now(), ref_no: f.ref_no, supplier_id: f.supplier_id, warehouse_id: ctx().warehouse_id, items: t.lines, subtotal: t.subtotal, discount: t.discount, tax: t.tax, shipping: t.shipping, total: t.total, paid: 0, due: 0, status: 'ordered', note: f.note }, { action: 'po.create', detail: `PO ${f.ref_no} ${money(t.total)}` });
    } else {
      const b = buildPurchase({ items, purchase: { supplier_id: f.supplier_id, ref_no: f.ref_no, date: f.date, discount: f.discount, shipping: f.shipping, note: f.note }, payments: f.payments, ctx: ctx() });
      if (f.update_cost) b.products = [...new Map(lines.map(l => [l.product_id, { ...pmap[l.product_id], cost_price: Number(l.cost) }])).values()];
      if (f.po_id) { const po = await db.purchases.get(f.po_id); b.purchases.push({ ...po, status: 'converted', converted_to: b.purchases[0].id }); }
      await saveBundle(b, { action: 'purchase.create', detail: `Purchase ${f.ref_no} ${money(b.purchases[0].total)}` });
    }
    setF(null);
  }, asPO ? 'Purchase order saved' : 'Purchase saved, stock updated');
  return (
    <Modal open wide onClose={() => setF(null)} title={f.po_id ? 'Receive purchase order' : 'New purchase'} footer={<>
      {!f.po_id && <button className="btn-secondary mr-auto" onClick={() => submit(true)}>Save as Purchase Order</button>}
      <button className="btn-secondary" onClick={() => setF(null)}>Cancel</button><button className="btn-primary" onClick={() => submit(false)}>Save & receive stock</button></>}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Supplier *"><select className="input" value={f.supplier_id} onChange={e => setF({ ...f, supplier_id: e.target.value })}><option value="">Select…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Supplier invoice / ref #"><input className="input" value={f.ref_no} onChange={e => setF({ ...f, ref_no: e.target.value })} /></Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <div className="mt-3 space-y-2">
        {f.items.map((it, i) => {
          const p = pmap[it.product_id];
          return (
            <div key={i} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <div className="grid gap-1 sm:grid-cols-[1fr_80px_100px_90px_80px_30px]">
                <ProductPicker products={products} value={it.product_id} onChange={v => setItem(i, { product_id: v, cost: pmap[v]?.cost_price || 0, tax_rate: pmap[v]?.tax_rate || 0 })} variant={it.variant_id} onVariant={v => setItem(i, { variant_id: v })} />
                <input className="input" type="number" title="Qty" placeholder="Qty" value={it.qty} onChange={e => setItem(i, { qty: e.target.value })} />
                <input className="input" type="number" title="Unit cost" placeholder="Cost" value={it.cost} onChange={e => setItem(i, { cost: e.target.value })} />
                <input className="input" type="number" title="Discount" placeholder="Disc" value={it.discount} onChange={e => setItem(i, { discount: e.target.value })} />
                <input className="input" type="number" title="Tax %" placeholder="Tax%" value={it.tax_rate} onChange={e => setItem(i, { tax_rate: e.target.value })} />
                <button className="btn-secondary" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}>×</button>
              </div>
              {p?.track_batch && <div className="mt-1 grid grid-cols-2 gap-1"><input className="input" placeholder="Batch no." value={it.batch_no || ''} onChange={e => setItem(i, { batch_no: e.target.value })} /><input className="input" type="date" title="Expiry" value={it.expiry || ''} onChange={e => setItem(i, { expiry: e.target.value })} /></div>}
              {p?.track_serial && <textarea className="input mt-1 h-16 font-mono" placeholder={`Enter ${it.qty} IMEI / serial numbers (one per line)`} value={it.serials_text || ''} onChange={e => setItem(i, { serials_text: e.target.value })} />}
            </div>
          );
        })}
        <button className="btn-secondary btn-sm" onClick={() => setF({ ...f, items: [...f.items, { product_id: '', variant_id: '', qty: 1, cost: 0, discount: 0, tax_rate: 0 }] })}>+ Add item</button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <Field label="Invoice discount"><input className="input" type="number" value={f.discount} onChange={e => setF({ ...f, discount: e.target.value })} /></Field>
        <Field label="Shipping / freight"><input className="input" type="number" value={f.shipping} onChange={e => setF({ ...f, shipping: e.target.value })} /></Field>
        <Field label="Paid via"><select className="input" value={f.payments[0].method} onChange={e => setF({ ...f, payments: [{ ...f.payments[0], method: e.target.value, account_code: '' }] })}>{PAYMENT_METHODS.filter(m => !['credit', 'points'].includes(m.key)).map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Field>
        <Field label="Amount paid now"><div className="flex gap-1"><input className="input" type="number" value={f.payments[0].amount} onChange={e => setF({ ...f, payments: [{ ...f.payments[0], amount: e.target.value }] })} /><button className="btn-secondary btn-sm" onClick={() => setF({ ...f, payments: [{ ...f.payments[0], amount: t.total }] })}>Full</button></div></Field>
      </div>
      {f.payments[0].method === 'bank' && <Field label="Bank account" className="mt-2"><select className="input" value={f.payments[0].account_code || ''} onChange={e => setF({ ...f, payments: [{ ...f.payments[0], account_code: e.target.value }] })}><option value="">Default bank</option>{accounts.filter(a => a.is_bank).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select></Field>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.update_cost} onChange={e => setF({ ...f, update_cost: e.target.checked })} /> Update product cost prices</label>
        <span>Subtotal {money(t.subtotal)} · Tax {money(t.tax)} · <b>Total {money(t.total)}</b> · Due {money(Math.max(0, r2(t.total - Number(f.payments[0].amount || 0))))}</span>
      </div>
      <Field label="Note" className="mt-2"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
    </Modal>
  );
}

function PurchaseReturn({ purchase, onClose, returns }) {
  const [qty, setQty] = useState({});
  const [method, setMethod] = useState('credit');
  const already = {};
  for (const r of returns.filter(r => r.purchase_id === purchase.id)) for (const i of r.items) already[i.line_index] = (already[i.line_index] || 0) + Number(i.qty);
  const submit = () => attempt(async () => {
    const items = Object.entries(qty).map(([k, v]) => ({ line_index: Number(k), qty: Number(v) })).filter(i => i.qty > 0);
    for (const i of items) if (i.qty > purchase.items[i.line_index].qty - (already[i.line_index] || 0)) throw new Error('Qty exceeds purchased qty');
    await saveBundle(buildPurchaseReturn({ purchase, items, refund_method: method, ctx: ctx() }), { action: 'purchase.return', detail: `Return to supplier on ${purchase.ref_no}` });
    onClose();
  }, 'Purchase return saved');
  return (
    <Modal open onClose={onClose} title="Return to supplier" footer={<button className="btn-danger" onClick={submit}>Save return</button>}>
      {purchase.items.map((i, idx) => (
        <div key={idx} className="mb-2 flex items-center justify-between text-sm"><span>{i.name}{i.variant_name && ` · ${i.variant_name}`} <span className="text-xs text-slate-500">(bought {i.qty}, returnable {i.qty - (already[idx] || 0)})</span></span>
          <input className="input w-20" type="number" value={qty[idx] || ''} onChange={e => setQty({ ...qty, [idx]: e.target.value })} /></div>
      ))}
      <Field label="Settlement"><select className="input" value={method} onChange={e => setMethod(e.target.value)}><option value="credit">Reduce amount payable to supplier</option><option value="cash">Cash refund</option><option value="bank">Bank refund</option></select></Field>
    </Modal>
  );
}
