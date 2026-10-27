import React, { useMemo, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { db, useTable, useSettings, save, saveBundle, remove, ctx, activeWarehouse } from '../lib/db.js';
import { useStock } from '../lib/data.js';
import { money, toCSV, parseCSV, downloadFile, printHtml } from '../lib/format.js';
import { buildOpeningStock, stockKey } from '@shared/posting.js';
import { uuid } from '@shared/uuid.js';
import { PageHeader, Table, Modal, Field, Badge, toast, attempt } from '../components/ui.jsx';

const blank = { name: '', sku: '', barcode: '', category_id: '', brand_id: '', unit: 'pcs', cost_price: 0, sale_price: 0, wholesale_price: 0, tax_rate: 0, alert_qty: 5, track_batch: false, track_serial: false, variants: [], description: '', active: true };

export function barcodeSvg(code, opts = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try { JsBarcode(svg, String(code), { format: 'CODE128', height: 40, width: 1.4, fontSize: 11, margin: 2, ...opts }); } catch (e) { return `<div>${code}</div>`; }
  return svg.outerHTML;
}

export default function Products() {
  const settings = useSettings();
  const products = useTable('products');
  const categories = useTable('categories');
  const brands = useTable('brands');
  const units = useTable('units');
  const taxRates = useTable('tax_rates');
  const stock = useStock();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [edit, setEdit] = useState(null);
  const [labels, setLabels] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const cmap = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c.name])), [categories]);
  const bmap = useMemo(() => Object.fromEntries(brands.map(c => [c.id, c.name])), [brands]);
  const rows = products.filter(p => (!cat || p.category_id === cat) && (!q || [p.name, p.sku, p.barcode].join(' ').toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name));

  const exportCsv = () => downloadFile('products.csv', toCSV(products, [
    { label: 'name', key: 'name' }, { label: 'sku', key: 'sku' }, { label: 'barcode', key: 'barcode' }, { label: 'category', value: p => cmap[p.category_id] || '' },
    { label: 'brand', value: p => bmap[p.brand_id] || '' }, { label: 'unit', key: 'unit' }, { label: 'cost_price', key: 'cost_price' }, { label: 'sale_price', key: 'sale_price' },
    { label: 'wholesale_price', key: 'wholesale_price' }, { label: 'tax_rate', key: 'tax_rate' }, { label: 'alert_qty', key: 'alert_qty' }, { label: 'stock', value: p => stock[p.id] || 0 }]));

  return (
    <div>
      <PageHeader title="Products" subtitle={`${products.length} products`}>
        <input className="input w-48" placeholder="Search name / SKU / barcode" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input w-auto" value={cat} onChange={e => setCat(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="btn-secondary" onClick={() => setImportOpen(true)}>Import CSV</button>
        <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
        <button className="btn-secondary" onClick={() => setLabels(rows.map(p => ({ p, qty: 1, on: false })))}>Print labels</button>
        <button className="btn-primary" onClick={() => setEdit({ ...blank, tax_rate: settings.default_tax_rate || 0, alert_qty: settings.low_stock_default ?? 5, opening_qty: 0 })}>+ Add product</button>
      </PageHeader>
      <div className="card p-0">
        <Table rows={rows} onRowClick={p => setEdit({ ...p })} empty="No products. Add your first product." columns={[
          { label: 'Product', render: p => <div><div className="font-medium">{p.name}</div><div className="text-xs text-slate-500">{p.sku} {p.barcode && `· ${p.barcode}`}</div></div> },
          { label: 'Category', render: p => cmap[p.category_id] || '—' },
          { label: 'Cost', right: true, render: p => money(p.cost_price) },
          { label: 'Price', right: true, render: p => money(p.sale_price) },
          { label: 'Wholesale', right: true, render: p => (p.wholesale_price ? money(p.wholesale_price) : '—') },
          { label: 'Stock', right: true, render: p => <span className={(stock[p.id] || 0) <= (p.alert_qty || 0) ? 'font-semibold text-rose-600' : ''}>{stock[p.id] || 0} {p.unit}</span> },
          { label: 'Flags', render: p => <div className="flex gap-1">{p.variants?.length > 0 && <Badge tone="brand">{p.variants.length} variants</Badge>}{p.track_batch && <Badge>batch/expiry</Badge>}{p.track_serial && <Badge tone="amber">IMEI</Badge>}{p.active === false && <Badge tone="red">inactive</Badge>}</div> }
        ]} />
      </div>
      {edit && <ProductForm product={edit} onClose={() => setEdit(null)} {...{ categories, brands, units, taxRates, stock }} />}
      {labels && <LabelModal list={labels} setList={setLabels} settings={settings} />}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} categories={categories} brands={brands} />
    </div>
  );
}

function ProductForm({ product, onClose, categories, brands, units, taxRates, stock }) {
  const [f, setF] = useState(product);
  const isNew = !product.id;
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const setVar = (i, patch) => up('variants', f.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const submit = () => attempt(async () => {
    if (!f.name) throw new Error('Product name is required');
    const all = await db.products.toArray();
    if (f.barcode && all.find(p => p.barcode === f.barcode && p.id !== f.id && !p.deleted)) throw new Error('Barcode already used by another product');
    const rec = { ...f, id: f.id || uuid(), cost_price: Number(f.cost_price) || 0, sale_price: Number(f.sale_price) || 0, wholesale_price: Number(f.wholesale_price) || 0, tax_rate: Number(f.tax_rate) || 0, alert_qty: Number(f.alert_qty) || 0,
      variants: (f.variants || []).filter(v => v.name).map(v => ({ ...v, id: v.id || uuid(), price: Number(v.price) || 0 })) };
    const openingQty = Number(f.opening_qty) || 0;
    delete rec.opening_qty; delete rec.opening_batch; delete rec.opening_expiry;
    const bundle = { products: [rec] };
    if (isNew && openingQty && !rec.variants.length) {
      const o = buildOpeningStock({ product: rec, qty: openingQty, warehouse_id: activeWarehouse(), ctx: ctx(), batch_no: f.opening_batch, expiry: f.opening_expiry });
      Object.assign(bundle, o);
    }
    await saveBundle(bundle, { action: isNew ? 'product.create' : 'product.update', detail: `${isNew ? 'Created' : 'Updated'} product ${rec.name}` });
    onClose();
  }, 'Product saved');
  const genBarcode = () => up('barcode', '2' + String(Date.now()).slice(-11));
  return (
    <Modal open wide onClose={onClose} title={isNew ? 'Add product' : `Edit ${product.name}`} footer={<>
      {!isNew && <button className="btn-danger mr-auto" onClick={() => confirm('Delete this product?') && remove('products', f.id).then(onClose)}>Delete</button>}
      <button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit}>Save</button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name *" className="sm:col-span-2"><input className="input" value={f.name} onChange={e => up('name', e.target.value)} autoFocus /></Field>
        <Field label="SKU"><input className="input" value={f.sku} onChange={e => up('sku', e.target.value)} /></Field>
        <Field label="Barcode"><div className="flex gap-1"><input className="input" value={f.barcode} onChange={e => up('barcode', e.target.value)} /><button type="button" className="btn-secondary" onClick={genBarcode} title="Generate">⚙</button></div></Field>
        <Field label="Category"><select className="input" value={f.category_id || ''} onChange={e => up('category_id', e.target.value)}><option value="">—</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Brand"><select className="input" value={f.brand_id || ''} onChange={e => up('brand_id', e.target.value)}><option value="">—</option>{brands.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Unit"><select className="input" value={f.unit} onChange={e => up('unit', e.target.value)}>{[...new Set([f.unit, ...units.map(u => u.name)])].map(u => <option key={u}>{u}</option>)}</select></Field>
        <Field label="Cost price"><input className="input" type="number" step="any" value={f.cost_price} onChange={e => up('cost_price', e.target.value)} /></Field>
        <Field label="Sale (retail) price"><input className="input" type="number" step="any" value={f.sale_price} onChange={e => up('sale_price', e.target.value)} /></Field>
        <Field label="Wholesale price"><input className="input" type="number" step="any" value={f.wholesale_price} onChange={e => up('wholesale_price', e.target.value)} /></Field>
        <Field label="Tax rate %"><select className="input" value={f.tax_rate} onChange={e => up('tax_rate', e.target.value)}>{[...new Set([Number(f.tax_rate) || 0, ...taxRates.map(t => Number(t.rate))])].map(r => <option key={r} value={r}>{r}%</option>)}</select></Field>
        <Field label="Low-stock alert qty"><input className="input" type="number" value={f.alert_qty} onChange={e => up('alert_qty', e.target.value)} /></Field>
        <div className="flex flex-col justify-end gap-1 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.track_batch} onChange={e => up('track_batch', e.target.checked)} /> Batch & expiry (pharmacy)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.track_serial} onChange={e => up('track_serial', e.target.checked)} /> IMEI / serial (mobile)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.active !== false} onChange={e => up('active', e.target.checked)} /> Active</label>
        </div>
        {isNew && !(f.variants || []).length && <>
          <Field label="Opening stock qty"><input className="input" type="number" value={f.opening_qty || 0} onChange={e => up('opening_qty', e.target.value)} /></Field>
          {f.track_batch && <><Field label="Opening batch no."><input className="input" value={f.opening_batch || ''} onChange={e => up('opening_batch', e.target.value)} /></Field>
            <Field label="Expiry"><input className="input" type="date" value={f.opening_expiry || ''} onChange={e => up('opening_expiry', e.target.value)} /></Field></>}
        </>}
        <Field label="Description" className="sm:col-span-3"><input className="input" value={f.description || ''} onChange={e => up('description', e.target.value)} /></Field>
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between"><h4 className="font-medium">Variants (size / colour)</h4>
          <button className="btn-secondary btn-sm" onClick={() => up('variants', [...(f.variants || []), { id: uuid(), name: '', size: '', color: '', sku: '', barcode: '', price: f.sale_price }])}>+ Add variant</button></div>
        {(f.variants || []).map((v, i) => (
          <div key={v.id} className="mb-1 grid grid-cols-7 gap-1">
            <input className="input" placeholder="Size" value={v.size} onChange={e => setVar(i, { size: e.target.value, name: [e.target.value, v.color].filter(Boolean).join(' / ') })} />
            <input className="input" placeholder="Colour" value={v.color} onChange={e => setVar(i, { color: e.target.value, name: [v.size, e.target.value].filter(Boolean).join(' / ') })} />
            <input className="input" placeholder="SKU" value={v.sku} onChange={e => setVar(i, { sku: e.target.value })} />
            <input className="input" placeholder="Barcode" value={v.barcode} onChange={e => setVar(i, { barcode: e.target.value })} />
            <input className="input" type="number" placeholder="Price" value={v.price} onChange={e => setVar(i, { price: e.target.value })} />
            <div className="self-center text-xs text-slate-500">stock {stock[stockKey(f.id, v.id)] || 0}</div>
            <button className="btn-secondary" onClick={() => up('variants', f.variants.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {(f.variants || []).length > 0 && <p className="text-xs text-slate-500">Add variant stock with a purchase or Inventory → Adjustments.</p>}
      </div>
    </Modal>
  );
}

function LabelModal({ list, setList, settings }) {
  const print = () => {
    const items = list.filter(x => x.on && x.qty > 0);
    if (!items.length) return toast('Select products', 'error');
    let html = '<div style="display:flex;flex-wrap:wrap;gap:4mm">';
    for (const { p, qty } of items) {
      const codes = p.variants?.length ? p.variants.map(v => ({ code: v.barcode || v.sku || p.barcode, name: `${p.name} ${v.name}`, price: v.price || p.sale_price })) : [{ code: p.barcode || p.sku || p.id.slice(0, 12), name: p.name, price: p.sale_price }];
      for (const c of codes) for (let i = 0; i < qty; i++) {
        html += `<div style="width:48mm;border:1px dashed #999;padding:2mm;text-align:center;font-size:10px"><div style="font-weight:bold">${settings.name || ''}</div><div>${c.name}</div>${barcodeSvg(c.code)}<div style="font-weight:bold">${money(c.price)}</div></div>`;
      }
    }
    printHtml(html + '</div>');
  };
  return (
    <Modal open wide onClose={() => setList(null)} title="Print barcode labels" footer={<><button className="btn-secondary" onClick={() => setList(null)}>Close</button><button className="btn-primary" onClick={print}>Print</button></>}>
      <div className="mb-2 flex gap-2"><button className="btn-secondary btn-sm" onClick={() => setList(list.map(x => ({ ...x, on: true })))}>Select all</button></div>
      <div className="max-h-[60vh] space-y-1 overflow-y-auto">
        {list.map((x, i) => (
          <div key={x.p.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={x.on} onChange={e => setList(list.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
            <span className="flex-1">{x.p.name} <span className="text-xs text-slate-500">{x.p.barcode}</span></span>
            <input className="input w-20" type="number" min="1" value={x.qty} onChange={e => setList(list.map((y, j) => (j === i ? { ...y, qty: Number(e.target.value) } : y)))} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ImportModal({ open, onClose, categories, brands }) {
  const [rows, setRows] = useState([]);
  const onFile = async e => { const f = e.target.files[0]; if (!f) return; setRows(parseCSV(await f.text())); };
  const template = () => downloadFile('products-template.csv', 'name,sku,barcode,category,brand,unit,cost_price,sale_price,wholesale_price,tax_rate,alert_qty,stock\nSample Item,SMP-1,1234567890123,Grocery,,pcs,100,130,120,0,5,10\n');
  const run = () => attempt(async () => {
    const bundle = { products: [], categories: [], brands: [] };
    const catBy = Object.fromEntries(categories.map(c => [c.name.toLowerCase(), c.id]));
    const brBy = Object.fromEntries(brands.map(c => [c.name.toLowerCase(), c.id]));
    const existing = await db.products.toArray();
    const getId = (map, list, name) => { if (!name) return ''; const k = name.toLowerCase(); if (!map[k]) { map[k] = uuid(); list.push({ id: map[k], name }); } return map[k]; };
    let opening = {};
    for (const r of rows) {
      if (!r.name) continue;
      const ex = existing.find(p => !p.deleted && ((r.sku && p.sku === r.sku) || (r.barcode && p.barcode === r.barcode)));
      const p = { ...blank, ...(ex || {}), id: ex ? ex.id : uuid(), name: r.name, sku: r.sku || '', barcode: r.barcode || '', unit: r.unit || 'pcs',
        category_id: getId(catBy, bundle.categories, r.category), brand_id: getId(brBy, bundle.brands, r.brand),
        cost_price: Number(r.cost_price) || 0, sale_price: Number(r.sale_price) || 0, wholesale_price: Number(r.wholesale_price) || 0, tax_rate: Number(r.tax_rate) || 0, alert_qty: Number(r.alert_qty) || 0 };
      bundle.products.push(p);
      if (!ex && Number(r.stock)) {
        const o = buildOpeningStock({ product: p, qty: Number(r.stock), warehouse_id: activeWarehouse(), ctx: ctx() });
        for (const [k, v] of Object.entries(o)) opening[k] = [...(opening[k] || []), ...v];
      }
    }
    for (const [k, v] of Object.entries(opening)) bundle[k] = v;
    await saveBundle(bundle, { action: 'product.import', detail: `Imported ${bundle.products.length} products` });
    setRows([]); onClose();
  }, 'Products imported');
  return (
    <Modal open={open} onClose={onClose} title="Import products from CSV" footer={<><button className="btn-secondary" onClick={template}>Download template</button><button className="btn-primary" disabled={!rows.length} onClick={run}>Import {rows.length} rows</button></>}>
      <p className="mb-2 text-sm text-slate-500">Columns: name, sku, barcode, category, brand, unit, cost_price, sale_price, wholesale_price, tax_rate, alert_qty, stock. Existing products are matched by SKU or barcode and updated.</p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      {rows.length > 0 && <div className="mt-2 max-h-40 overflow-y-auto text-xs">{rows.slice(0, 10).map((r, i) => <div key={i}>{r.name} · {r.sku} · {r.sale_price}</div>)}{rows.length > 10 && '…'}</div>}
    </Modal>
  );
}
