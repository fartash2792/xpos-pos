import React, { useMemo, useState } from 'react';
import { useTable, saveBundle, save, ctx, activeWarehouse } from '../lib/db.js';
import { money, fmtDate, fmtDateTime, toCSV, downloadFile } from '../lib/format.js';
import { buildStockAdjustment, buildStockTransfer, stockMap, stockKey, batchStock, r2, today } from '@shared/posting.js';
import { PageHeader, Table, Modal, Field, Tabs, Badge, attempt } from '../components/ui.jsx';

export function ProductPicker({ products, value, onChange, variant, onVariant }) {
  const p = products.find(x => x.id === value);
  return (
    <div className="flex gap-1">
      <select className="input" value={value || ''} onChange={e => { onChange(e.target.value); onVariant && onVariant(''); }}>
        <option value="">Select product…</option>{products.map(x => <option key={x.id} value={x.id}>{x.name}{x.sku ? ` (${x.sku})` : ''}</option>)}
      </select>
      {p && p.variants?.length > 0 && onVariant && <select className="input w-36" value={variant || ''} onChange={e => onVariant(e.target.value)}><option value="">Variant…</option>{p.variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}
    </div>
  );
}

export default function Inventory() {
  const [tab, setTab] = useState('stock');
  const products = useTable('products');
  const warehouses = useTable('warehouses');
  const movements = useTable('stock_movements');
  const pmap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const wmap = useMemo(() => Object.fromEntries(warehouses.map(p => [p.id, p])), [warehouses]);
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock is calculated from stock movements, so sales on several offline devices never overwrite each other." />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'stock', label: 'Stock by branch' }, { key: 'low', label: 'Low stock & reorder' }, { key: 'expiry', label: 'Batches & expiry' }, { key: 'adjust', label: 'Adjustments' }, { key: 'transfer', label: 'Branch transfers' }, { key: 'serials', label: 'IMEI / Serials' }, { key: 'moves', label: 'Movement history' }]} />
      {tab === 'stock' && <StockByBranch {...{ products, warehouses, movements }} />}
      {tab === 'low' && <LowStock {...{ products, movements }} />}
      {tab === 'expiry' && <Expiry {...{ products, movements, wmap }} />}
      {tab === 'adjust' && <Adjustments {...{ products, pmap }} />}
      {tab === 'transfer' && <Transfers {...{ products, warehouses, pmap, wmap, movements }} />}
      {tab === 'serials' && <Serials {...{ products, pmap }} />}
      {tab === 'moves' && <Moves {...{ movements, pmap, wmap }} />}
    </div>
  );
}

function StockByBranch({ products, warehouses, movements }) {
  const maps = useMemo(() => Object.fromEntries(warehouses.map(w => [w.id, stockMap(movements, w.id)])), [warehouses, movements]);
  const total = useMemo(() => stockMap(movements), [movements]);
  const rows = [];
  for (const p of products) {
    rows.push({ id: p.id, name: p.name, unit: p.unit, cost: p.cost_price, key: p.id });
    for (const v of p.variants || []) rows.push({ id: p.id + v.id, name: `   ↳ ${v.name}`, unit: p.unit, cost: p.cost_price, key: stockKey(p.id, v.id), sub: true });
  }
  const value = products.reduce((s, p) => s + (total[p.id] || 0) * (p.cost_price || 0), 0);
  return (
    <div className="card p-0">
      <div className="p-3 text-sm text-slate-500">Total stock value at cost: <b className="text-slate-800 dark:text-slate-100">{money(value)}</b></div>
      <Table rows={rows} columns={[
        { label: 'Product', render: r => <span className={r.sub ? 'pl-4 text-slate-500' : 'font-medium'}>{r.name}</span> },
        ...warehouses.map(w => ({ label: w.name, right: true, render: r => r2(maps[w.id][r.key] || 0) })),
        { label: 'Total', right: true, render: r => <b>{r2(total[r.key] || 0)} {r.unit}</b> },
        { label: 'Value', right: true, render: r => (r.sub ? '' : money((total[r.key] || 0) * (r.cost || 0))) }
      ]} />
    </div>
  );
}

function LowStock({ products, movements }) {
  const stock = useMemo(() => stockMap(movements, activeWarehouse()), [movements]);
  // reorder suggestion: cover 30 days of average daily sales (last 30 days), min up to alert*2
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const sold = {};
  for (const m of movements) if (m.type === 'sale' && m.date >= since) sold[m.product_id] = (sold[m.product_id] || 0) - m.qty;
  const rows = products.filter(p => (stock[p.id] || 0) <= (p.alert_qty || 0)).map(p => {
    const daily = (sold[p.id] || 0) / 30;
    const suggest = Math.max(Math.ceil(daily * 30 - (stock[p.id] || 0)), (p.alert_qty || 0) * 2 - (stock[p.id] || 0), 1);
    return { ...p, stock: stock[p.id] || 0, sold30: sold[p.id] || 0, suggest, cost: suggest * (p.cost_price || 0) };
  });
  const exportCsv = () => downloadFile('reorder-list.csv', toCSV(rows, [{ label: 'Product', key: 'name' }, { label: 'SKU', key: 'sku' }, { label: 'Stock', key: 'stock' }, { label: 'Alert', key: 'alert_qty' }, { label: 'Sold 30d', key: 'sold30' }, { label: 'Suggested order', key: 'suggest' }, { label: 'Est. cost', key: 'cost' }]));
  return (
    <div className="card p-0">
      <div className="flex items-center justify-between p-3 text-sm text-slate-500"><span>{rows.length} products at or below alert level. Suggested quantities cover 30 days of sales.</span><button className="btn-secondary btn-sm" onClick={exportCsv}>Export reorder list</button></div>
      <Table rows={rows} empty="All stock levels are healthy 🎉" columns={[
        { label: 'Product', key: 'name' }, { label: 'Stock', right: true, render: r => <span className="text-rose-600">{r.stock}</span> }, { label: 'Alert at', key: 'alert_qty', right: true },
        { label: 'Sold (30d)', key: 'sold30', right: true }, { label: 'Suggested order', right: true, render: r => <b>{r.suggest}</b> }, { label: 'Est. cost', right: true, render: r => money(r.cost) }
      ]} />
    </div>
  );
}

function Expiry({ products, movements }) {
  const t = today();
  const soon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  const rows = [];
  for (const p of products.filter(p => p.track_batch)) for (const b of batchStock(movements, p.id)) rows.push({ id: p.id + b.batch_no, name: p.name, ...b, value: b.qty * (p.cost_price || 0) });
  rows.sort((a, b) => String(a.expiry || '9999').localeCompare(String(b.expiry || '9999')));
  return (
    <div className="card p-0">
      <Table rows={rows} empty="No batch-tracked stock" columns={[
        { label: 'Product', key: 'name' }, { label: 'Batch', key: 'batch_no' }, { label: 'Expiry', render: r => fmtDate(r.expiry) },
        { label: 'Qty', key: 'qty', right: true }, { label: 'Value', right: true, render: r => money(r.value) },
        { label: 'Status', render: r => (!r.expiry ? '—' : r.expiry < t ? <Badge tone="red">Expired</Badge> : r.expiry <= soon ? <Badge tone="amber">Expiring ≤90d</Badge> : <Badge tone="green">OK</Badge>) }
      ]} />
    </div>
  );
}

function Adjustments({ products, pmap }) {
  const adj = useTable('stock_adjustments');
  const [f, setF] = useState(null);
  const submit = () => attempt(async () => {
    const p = pmap[f.product_id]; if (!p) throw new Error('Select a product');
    if (p.variants?.length && !f.variant_id) throw new Error('Select a variant');
    const qty = (f.dir === 'out' ? -1 : 1) * Math.abs(Number(f.qty));
    await saveBundle(buildStockAdjustment({ product: p, variant_id: f.variant_id, qty, reason: f.reason, ctx: ctx(), batch_no: f.batch_no, expiry: f.expiry }), { action: 'stock.adjust', detail: `${p.name}: ${qty} (${f.reason})` });
    setF(null);
  }, 'Stock adjusted');
  return (
    <div className="card p-0">
      <div className="flex justify-end p-3"><button className="btn-primary" onClick={() => setF({ product_id: '', variant_id: '', qty: 1, dir: 'in', reason: 'Stock count correction' })}>+ New adjustment</button></div>
      <Table rows={[...adj].sort((a, b) => b.at - a.at)} empty="No adjustments" columns={[
        { label: 'Date', render: r => fmtDateTime(r.at) }, { label: 'Product', render: r => pmap[r.product_id]?.name },
        { label: 'Qty', right: true, render: r => <span className={r.qty < 0 ? 'text-rose-600' : 'text-emerald-600'}>{r.qty > 0 ? '+' : ''}{r.qty}</span> }, { label: 'Reason', key: 'reason' }
      ]} />
      {f && <Modal open onClose={() => setF(null)} title="Stock adjustment" footer={<button className="btn-primary" onClick={submit}>Save</button>}>
        <div className="space-y-2">
          <Field label="Product"><ProductPicker products={products} value={f.product_id} onChange={v => setF({ ...f, product_id: v })} variant={f.variant_id} onVariant={v => setF(x => ({ ...x, variant_id: v }))} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type"><select className="input" value={f.dir} onChange={e => setF({ ...f, dir: e.target.value })}><option value="in">Add stock (+)</option><option value="out">Remove stock (−) damage/loss</option></select></Field>
            <Field label="Quantity"><input className="input" type="number" value={f.qty} onChange={e => setF({ ...f, qty: e.target.value })} /></Field>
          </div>
          {pmap[f.product_id]?.track_batch && <div className="grid grid-cols-2 gap-2"><Field label="Batch no."><input className="input" value={f.batch_no || ''} onChange={e => setF({ ...f, batch_no: e.target.value })} /></Field><Field label="Expiry"><input className="input" type="date" value={f.expiry || ''} onChange={e => setF({ ...f, expiry: e.target.value })} /></Field></div>}
          <Field label="Reason"><input className="input" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
      </Modal>}
    </div>
  );
}

function Transfers({ products, warehouses, pmap, wmap, movements }) {
  const transfers = useTable('stock_transfers');
  const [f, setF] = useState(null);
  const submit = () => attempt(async () => {
    const items = f.items.filter(i => i.product_id && Number(i.qty) > 0).map(i => ({ ...i, cost: pmap[i.product_id]?.cost_price || 0, name: pmap[i.product_id]?.name }));
    if (!items.length) throw new Error('Add items');
    const st = stockMap(movements, f.from);
    for (const i of items) if ((st[stockKey(i.product_id, i.variant_id)] || 0) < Number(i.qty)) throw new Error(`Not enough ${i.name} in source branch`);
    await saveBundle(buildStockTransfer({ items, from_warehouse: f.from, to_warehouse: f.to, ctx: ctx(), note: f.note }), { action: 'stock.transfer', detail: `Transfer ${wmap[f.from]?.name} → ${wmap[f.to]?.name}` });
    setF(null);
  }, 'Transfer saved');
  if (warehouses.length < 2) return <div className="card text-sm text-slate-500">Add a second branch/warehouse in Settings → Branches to transfer stock.</div>;
  return (
    <div className="card p-0">
      <div className="flex justify-end p-3"><button className="btn-primary" onClick={() => setF({ from: activeWarehouse(), to: warehouses.find(w => w.id !== activeWarehouse())?.id, items: [{ product_id: '', variant_id: '', qty: 1 }], note: '' })}>+ New transfer</button></div>
      <Table rows={[...transfers].sort((a, b) => b.at - a.at)} empty="No transfers" columns={[
        { label: 'Date', render: r => fmtDate(r.date) }, { label: 'From', render: r => wmap[r.from_warehouse]?.name }, { label: 'To', render: r => wmap[r.to_warehouse]?.name },
        { label: 'Items', render: r => r.items.map(i => `${i.name || pmap[i.product_id]?.name} x${i.qty}`).join(', ') }, { label: 'Note', key: 'note' }
      ]} />
      {f && <Modal open wide onClose={() => setF(null)} title="Stock transfer" footer={<button className="btn-primary" onClick={submit}>Transfer</button>}>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <Field label="From"><select className="input" value={f.from} onChange={e => setF({ ...f, from: e.target.value })}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
          <Field label="To"><select className="input" value={f.to} onChange={e => setF({ ...f, to: e.target.value })}>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        </div>
        {f.items.map((it, i) => (
          <div key={i} className="mb-1 flex gap-1">
            <div className="flex-1"><ProductPicker products={products} value={it.product_id} onChange={v => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, product_id: v } : x)) })} variant={it.variant_id} onVariant={v => setF(s => ({ ...s, items: s.items.map((x, j) => (j === i ? { ...x, variant_id: v } : x)) }))} /></div>
            <input className="input w-24" type="number" value={it.qty} onChange={e => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} />
          </div>
        ))}
        <button className="btn-secondary btn-sm" onClick={() => setF({ ...f, items: [...f.items, { product_id: '', variant_id: '', qty: 1 }] })}>+ Item</button>
        <Field label="Note" className="mt-2"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}

function Serials({ products, pmap }) {
  const serials = useTable('serials');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState(null);
  const rows = serials.filter(s => !q || s.serial.includes(q) || (pmap[s.product_id]?.name || '').toLowerCase().includes(q.toLowerCase()));
  const submit = () => attempt(async () => {
    const list = add.text.split(/[\s,]+/).filter(Boolean);
    if (!add.product_id || !list.length) throw new Error('Choose product and enter serials');
    const existing = new Set(serials.map(s => s.serial));
    const dup = list.find(s => existing.has(s)); if (dup) throw new Error('Serial already exists: ' + dup);
    await saveBundle({ serials: list.map(s => ({ product_id: add.product_id, serial: s, status: 'in_stock', warehouse_id: activeWarehouse(), cost: pmap[add.product_id]?.cost_price || 0 })) }, { action: 'serial.add', detail: `Added ${list.length} serials` });
    setAdd(null);
  }, 'Serials added (record stock via purchase or adjustment)');
  return (
    <div className="card p-0">
      <div className="flex justify-between gap-2 p-3"><input className="input w-64" placeholder="Search IMEI / serial" value={q} onChange={e => setQ(e.target.value)} /><button className="btn-primary" onClick={() => setAdd({ product_id: '', text: '' })}>+ Register serials</button></div>
      <Table rows={rows} empty="No serials. They are added automatically from purchases of IMEI-tracked products." columns={[
        { label: 'IMEI / Serial', render: r => <span className="font-mono">{r.serial}</span> }, { label: 'Product', render: r => pmap[r.product_id]?.name },
        { label: 'Status', render: r => <Badge tone={r.status === 'sold' ? 'slate' : 'green'}>{r.status}</Badge> }
      ]} />
      {add && <Modal open onClose={() => setAdd(null)} title="Register IMEI / serial numbers" footer={<button className="btn-primary" onClick={submit}>Save</button>}>
        <Field label="Product"><select className="input" value={add.product_id} onChange={e => setAdd({ ...add, product_id: e.target.value })}><option value="">Select…</option>{products.filter(p => p.track_serial).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Serials (one per line)" className="mt-2"><textarea className="input h-32 font-mono" value={add.text} onChange={e => setAdd({ ...add, text: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}

function Moves({ movements, pmap, wmap }) {
  const [pid, setPid] = useState('');
  const rows = movements.filter(m => !pid || m.product_id === pid).sort((a, b) => b.updated_at - a.updated_at).slice(0, 500);
  return (
    <div className="card p-0">
      <div className="p-3"><select className="input w-72" value={pid} onChange={e => setPid(e.target.value)}><option value="">All products</option>{Object.values(pmap).filter(p => !p.deleted).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <Table rows={rows} empty="No movements" columns={[
        { label: 'Date', render: r => fmtDate(r.date) }, { label: 'Product', render: r => pmap[r.product_id]?.name },
        { label: 'Branch', render: r => wmap[r.warehouse_id]?.name }, { label: 'Type', render: r => <Badge>{r.type}</Badge> },
        { label: 'Batch', render: r => r.batch_no || '' }, { label: 'Qty', right: true, render: r => <span className={r.qty < 0 ? 'text-rose-600' : 'text-emerald-600'}>{r.qty > 0 ? '+' : ''}{r.qty}</span> }
      ]} />
    </div>
  );
}
