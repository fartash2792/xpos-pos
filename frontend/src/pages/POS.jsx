import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db, useTable, useRecord, useSettings, saveBundle, save, remove, ctx, nextLocalNo, ctxStore } from '../lib/db.js';
import { useStock, customerPoints, useAccounts, paymentAccounts } from '../lib/data.js';
import { verifyPin } from '../lib/session.js';
import { money } from '../lib/format.js';
import { printReceipt, printA4 } from '../lib/receipt.js';
import { buildSale, computeCart, computePayments, batchStock, stockKey, r2, today } from '@shared/posting.js';
import { PAYMENT_METHODS } from '@shared/accounts.js';
import { uuid } from '@shared/uuid.js';
import { Modal, toast, attempt, Badge } from '../components/ui.jsx';

export function PinGate({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const press = async d => {
    const p = (pin + d).slice(0, 4);
    setPin(p); setErr('');
    if (p.length === 4) {
      if (await verifyPin(p)) { sessionStorage.setItem('xpos_pos_unlocked', '1'); onUnlock(); }
      else { setErr('Wrong PIN'); setPin(''); }
    }
  };
  useEffect(() => {
    const h = e => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') setPin(p => p.slice(0, -1)); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  return (
    <div className="mx-auto mt-10 max-w-xs card text-center">
      <div className="text-3xl">🔒</div>
      <h2 className="mt-2 font-semibold">Enter PIN to open POS counter</h2>
      <p className="text-xs text-slate-500">Works offline. Default PIN is 1234 (change it in Settings → Security).</p>
      <div className="my-4 flex justify-center gap-3">{[0, 1, 2, 3].map(i => <div key={i} className={`h-4 w-4 rounded-full ${pin.length > i ? 'bg-brand-600' : 'bg-slate-200 dark:bg-slate-700'}`} />)}</div>
      {err && <div className="mb-2 text-sm text-rose-600">{err}</div>}
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map(k => (
          <button key={k} disabled={!k} className="btn-secondary h-12 text-lg" onClick={() => (k === '⌫' ? setPin(p => p.slice(0, -1)) : press(k))}>{k}</button>
        ))}
      </div>
    </div>
  );
}

const emptyInvoice = { customer_id: '', discount: 0, discount_type: 'amount', order_tax_rate: 0, shipping: 0, note: '' };

export default function POS() {
  const settings = useSettings();
  const [unlocked, setUnlocked] = useState(sessionStorage.getItem('xpos_pos_unlocked') === '1');
  if (settings.pin_required_for_pos !== false && !unlocked) return <PinGate onUnlock={() => setUnlocked(true)} />;
  return <Counter settings={settings} />;
}

function Counter({ settings }) {
  const products = useTable('products', p => p.active !== false);
  const categories = useTable('categories');
  const customers = useTable('customers');
  const serials = useTable('serials', s => s.status === 'in_stock');
  const held = useTable('held_sales');
  const sales = useTable('sales');
  const movements = useTable('stock_movements');
  const taxRates = useTable('tax_rates');
  const shifts = useTable('shifts', s => !s.closed_at && s.user_id === ctxStore.user_id);
  const stock = useStock();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState([]);
  const [inv, setInv] = useState(emptyInvoice);
  const [priceMode, setPriceMode] = useState('retail');
  const [picker, setPicker] = useState(null); // {product, kind: 'variant'|'serial'}
  const [payOpen, setPayOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [lastSaleId, setLastSaleId] = useState(null);
  const lastSale = useRecord('sales', lastSaleId);
  const [quotationId, setQuotationId] = useState(null);
  const searchRef = useRef();

  // load cart handed over from quotations / held list
  useEffect(() => {
    const raw = sessionStorage.getItem('xpos_pos_load');
    if (raw) {
      sessionStorage.removeItem('xpos_pos_load');
      const d = JSON.parse(raw);
      setCart(d.items.map(i => ({ ...i, uid: uuid() })));
      setInv({ ...emptyInvoice, ...(d.invoice || {}) });
      setQuotationId(d.quotation_id || null);
    }
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products.filter(p => (!cat || p.category_id === cat) && (!s || [p.name, p.sku, p.barcode, ...(p.variants || []).map(v => v.barcode + ' ' + v.sku)].join(' ').toLowerCase().includes(s))).slice(0, 120);
  }, [products, q, cat]);

  const totals = useMemo(() => computeCart(cart, inv), [cart, inv]);
  const allowNeg = !!settings.allow_negative_stock;

  function inCartQty(product_id, variant_id) {
    return cart.filter(l => l.product_id === product_id && (l.variant_id || null) === (variant_id || null)).reduce((s, l) => s + Number(l.qty), 0);
  }

  function addLine(product, { variant, serial } = {}) {
    if (product.variants && product.variants.length && !variant) return setPicker({ product, kind: 'variant' });
    if (product.track_serial && !serial) return setPicker({ product, kind: 'serial' });
    const vid = variant ? variant.id : null;
    const available = stock[stockKey(product.id, vid)] || 0;
    if (!allowNeg && inCartQty(product.id, vid) + 1 > available) return toast(`Out of stock: ${product.name}${variant ? ' ' + variant.name : ''} (available ${available})`, 'error');
    const price = variant && variant.price ? Number(variant.price) : priceMode === 'wholesale' && Number(product.wholesale_price) ? Number(product.wholesale_price) : Number(product.sale_price);
    let batch = {};
    if (product.track_batch) {
      const used = cart.filter(l => l.product_id === product.id).reduce((m, l) => ({ ...m, [l.batch_no]: (m[l.batch_no] || 0) + Number(l.qty) }), {});
      const b = batchStock(movements, product.id, ctx().warehouse_id).find(x => x.qty - (used[x.batch_no] || 0) > 0);
      if (b) batch = { batch_no: b.batch_no, expiry: b.expiry };
    }
    setCart(c => {
      if (!serial) {
        const idx = c.findIndex(l => l.product_id === product.id && (l.variant_id || null) === vid && !l.serial_id && (l.batch_no || null) === (batch.batch_no || null));
        if (idx >= 0) return c.map((l, i) => (i === idx ? { ...l, qty: Number(l.qty) + 1 } : l));
      }
      return [...c, {
        uid: uuid(), product_id: product.id, variant_id: vid, variant_name: variant ? variant.name : '', name: product.name, sku: variant ? variant.sku : product.sku,
        qty: 1, price, cost: Number(product.cost_price) || 0, discount: 0, discount_type: 'amount', tax_rate: Number(product.tax_rate) || 0,
        serial_id: serial ? serial.id : null, serial: serial ? serial.serial : null, ...batch
      }];
    });
  }

  function onScan(e) {
    if (e.key !== 'Enter') return;
    const code = q.trim();
    if (!code) return;
    const lc = code.toLowerCase();
    const ser = serials.find(s => s.serial === code);
    if (ser) { const p = products.find(x => x.id === ser.product_id); if (p) { addLine(p, { serial: ser, variant: (p.variants || []).find(v => v.id === ser.variant_id) }); setQ(''); return; } }
    for (const p of products) {
      const v = (p.variants || []).find(v => v.barcode === code || (v.sku || '').toLowerCase() === lc);
      if (v) { addLine(p, { variant: v }); setQ(''); return; }
    }
    const p = products.find(x => x.barcode === code || (x.sku || '').toLowerCase() === lc);
    if (p) { addLine(p); setQ(''); return; }
    if (filtered.length === 1) { addLine(filtered[0]); setQ(''); return; }
    toast('No product for code ' + code, 'error');
  }

  const upd = (uid, patch) => setCart(c => c.map(l => (l.uid === uid ? { ...l, ...patch } : l)));
  const del = uid => setCart(c => c.filter(l => l.uid !== uid));
  const clear = () => { setCart([]); setInv(emptyInvoice); setQuotationId(null); };

  async function hold() {
    if (!cart.length) return;
    const label = prompt('Label for this held sale (optional)', customers.find(c => c.id === inv.customer_id)?.name || '') ?? '';
    await save('held_sales', { items: cart, invoice: inv, label, at: Date.now(), total: totals.total, user_id: ctxStore.user_id });
    clear(); toast('Sale held');
  }
  async function resume(h) {
    setCart(h.items.map(i => ({ ...i, uid: uuid() }))); setInv({ ...emptyInvoice, ...h.invoice });
    await remove('held_sales', h.id, { action: 'held.resume', detail: 'Resumed held sale' }); setHeldOpen(false);
  }
  async function saveQuote() {
    if (!cart.length) return;
    const t = computeCart(cart, inv);
    await save('quotations', { date: today(), at: Date.now(), valid_until: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10), customer_id: inv.customer_id || null, items: t.lines, invoice: inv, subtotal: t.subtotal, discount: t.discount, tax: t.tax, shipping: t.shipping, total: t.total, status: 'open', local_no: 'Q-' + nextLocalNo(), user_id: ctxStore.user_id }, { action: 'quotation.create', detail: `Quotation ${money(t.total)}` });
    clear(); toast('Quotation saved');
  }

  async function complete(payments, print) {
    const c = ctx({ local_no: nextLocalNo() });
    const bundle = buildSale({ items: cart, invoice: { ...inv, quotation_id: quotationId }, payments, ctx: c, settings });
    if (quotationId) { const qt = await db.quotations.get(quotationId); if (qt) bundle.quotations = [{ ...qt, status: 'converted', sale_id: bundle.sales[0].id }]; }
    const saved = await saveBundle(bundle, { action: 'sale.create', detail: `Sale ${bundle.sales[0].local_no} ${money(bundle.sales[0].total)}` });
    const sale = saved.sales[0];
    setLastSaleId(sale.id); setPayOpen(false); clear();
    toast(`Sale ${sale.local_no} saved${sale.change ? ' — change ' + money(sale.change) : ''}`);
    if (print) printReceipt(sale, settings, { customer: customers.find(x => x.id === sale.customer_id), cashier: ctxStore.user_name });
    setTimeout(() => searchRef.current && searchRef.current.focus(), 100);
  }

  const customer = customers.find(c => c.id === inv.customer_id);
  const points = customer ? customerPoints(sales, customer.id) : 0;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_440px]">
      <div className="min-w-0 space-y-3">
        {!shifts.length && <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">No cash register shift open for you. <a className="underline" href="#/shifts">Open a shift</a> to track expected vs counted cash.</div>}
        <div className="card flex flex-wrap gap-2 p-3">
          <input ref={searchRef} autoFocus className="input min-w-[200px] flex-1" placeholder="🔍 Search or scan barcode / SKU / IMEI and press Enter" value={q} onChange={e => setQ(e.target.value)} onKeyDown={onScan} />
          <select className="input w-auto" value={priceMode} onChange={e => setPriceMode(e.target.value)}><option value="retail">Retail price</option><option value="wholesale">Wholesale price</option></select>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button className={`btn-sm btn ${!cat ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800'}`} onClick={() => setCat('')}>All</button>
          {categories.map(c => <button key={c.id} className={`btn-sm btn whitespace-nowrap ${cat === c.id ? 'bg-brand-600 text-white' : 'bg-white dark:bg-slate-800'}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map(p => {
            const st = stock[p.id] || 0;
            return (
              <button key={p.id} onClick={() => addLine(p)} className="card flex flex-col items-start p-3 text-left hover:border-brand-500">
                <div className="line-clamp-2 text-sm font-medium">{p.name}</div>
                <div className="mt-auto flex w-full items-end justify-between pt-2">
                  <span className="font-semibold text-brand-600">{money(priceMode === 'wholesale' && p.wholesale_price ? p.wholesale_price : p.sale_price)}</span>
                  <span className={`text-xs ${st <= (p.alert_qty || 0) ? 'text-rose-600' : 'text-slate-500'}`}>{st} {p.unit}</span>
                </div>
                <div className="mt-1 flex gap-1">{p.variants?.length > 0 && <Badge tone="brand">variants</Badge>}{p.track_serial && <Badge tone="amber">IMEI</Badge>}{p.track_batch && <Badge>batch</Badge>}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card flex h-fit flex-col gap-3 p-3 lg:sticky lg:top-16">
        <div className="flex gap-2">
          <select className="input flex-1" value={inv.customer_id} onChange={e => setInv({ ...inv, customer_id: e.target.value })}>
            <option value="">Walk-in customer</option>
            {customers.filter(c => !c.is_walkin).map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
          </select>
          <button className="btn-secondary" onClick={() => setCustOpen(true)} title="Quick add customer">＋</button>
        </div>
        {customer && settings.loyalty?.enabled && <div className="text-xs text-slate-500">Loyalty points: <b>{points}</b></div>}
        <div className="max-h-[45vh] space-y-2 overflow-y-auto">
          {!cart.length && <div className="py-8 text-center text-sm text-slate-400">Cart is empty. Tap a product or scan a barcode.</div>}
          {cart.map(l => (
            <div key={l.uid} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
              <div className="flex justify-between gap-2">
                <div className="min-w-0 text-sm font-medium">{l.name}{l.variant_name && <span className="text-slate-500"> · {l.variant_name}</span>}
                  {l.serial && <div className="text-xs text-amber-700">IMEI {l.serial}</div>}
                  {l.batch_no && <div className="text-xs text-slate-500">Batch {l.batch_no}{l.expiry ? ` · exp ${l.expiry}` : ''}</div>}
                </div>
                <div className="text-sm font-semibold">{money(computeCart([l]).total)}</div>
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1">
                <input className="input px-2 py-1" type="number" min="0" step="any" disabled={!!l.serial_id} value={l.qty} onChange={e => upd(l.uid, { qty: e.target.value })} title="Qty" />
                <input className="input px-2 py-1" type="number" step="any" value={l.price} onChange={e => upd(l.uid, { price: e.target.value })} title="Price" />
                <input className="input px-2 py-1" type="number" step="any" value={l.discount} onChange={e => upd(l.uid, { discount: e.target.value })} title="Discount amount" placeholder="Disc" />
                <select className="input px-1 py-1" value={l.tax_rate} onChange={e => upd(l.uid, { tax_rate: e.target.value })} title="Tax %">
                  {[...new Set([0, Number(l.tax_rate), ...taxRates.map(t => Number(t.rate))])].map(r => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>Qty · Price · Disc · Tax</span><button className="text-rose-600" onClick={() => del(l.uid)}>Remove</button></div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div><span className="label">Discount</span><div className="flex"><input className="input rounded-r-none px-2" type="number" value={inv.discount} onChange={e => setInv({ ...inv, discount: e.target.value })} />
            <select className="input w-14 rounded-l-none px-1" value={inv.discount_type} onChange={e => setInv({ ...inv, discount_type: e.target.value })}><option value="amount">Rs</option><option value="percent">%</option></select></div></div>
          <div><span className="label">Order tax %</span><input className="input px-2" type="number" value={inv.order_tax_rate} onChange={e => setInv({ ...inv, order_tax_rate: e.target.value })} /></div>
          <div><span className="label">Shipping</span><input className="input px-2" type="number" value={inv.shipping} onChange={e => setInv({ ...inv, shipping: e.target.value })} /></div>
        </div>
        <input className="input" placeholder="Note (optional)" value={inv.note} onChange={e => setInv({ ...inv, note: e.target.value })} />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
          <Row k="Subtotal" v={money(totals.subtotal)} />
          {totals.discount > 0 && <Row k="Discount" v={'-' + money(totals.discount)} />}
          {totals.tax > 0 && <Row k="Tax" v={money(totals.tax)} />}
          {totals.shipping > 0 && <Row k="Shipping" v={money(totals.shipping)} />}
          <div className="flex justify-between border-t border-slate-200 pt-1 text-lg font-bold dark:border-slate-700"><span>Total</span><span>{money(totals.total)}</span></div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <button className="btn-secondary" onClick={hold} disabled={!cart.length}>Hold</button>
          <button className="btn-secondary" onClick={() => setHeldOpen(true)}>Held ({held.length})</button>
          <button className="btn-secondary" onClick={saveQuote} disabled={!cart.length} title="Save as quotation">Quote</button>
          <button className="btn-secondary" onClick={clear} disabled={!cart.length}>Clear</button>
        </div>
        <button className="btn-success h-12 text-base" disabled={!cart.length} onClick={() => setPayOpen(true)}>Pay {money(totals.total)}</button>
        {lastSale && <div className="flex items-center justify-between rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">
          <span>Last: {lastSale.invoice_no || lastSale.local_no} · {money(lastSale.total)}</span>
          <span className="flex gap-1">
            <button className="btn-secondary btn-sm" onClick={() => printReceipt(lastSale, settings, { customer: customers.find(x => x.id === lastSale.customer_id), cashier: ctxStore.user_name })}>Receipt</button>
            <button className="btn-secondary btn-sm" onClick={() => printA4(lastSale, settings, { customer: customers.find(x => x.id === lastSale.customer_id) })}>A4</button>
          </span></div>}
      </div>

      <PayModal open={payOpen} onClose={() => setPayOpen(false)} total={totals.total} customer={customer} points={points} settings={settings} onComplete={(p, pr) => attempt(() => complete(p, pr))} />
      <PickerModal picker={picker} onClose={() => setPicker(null)} serials={serials} cart={cart} stock={stock} onPick={(opts) => { const p = picker.product; setPicker(null); addLine(p, opts); }} />
      <Modal open={heldOpen} onClose={() => setHeldOpen(false)} title="Held sales">
        {!held.length && <div className="text-sm text-slate-500">No held sales.</div>}
        {held.map(h => (
          <div key={h.id} className="flex items-center justify-between border-b py-2 text-sm dark:border-slate-800">
            <div><b>{h.label || 'Held sale'}</b> · {h.items.length} items · {money(h.total)}<div className="text-xs text-slate-500">{new Date(h.at).toLocaleString()}</div></div>
            <div className="flex gap-1"><button className="btn-primary btn-sm" onClick={() => resume(h)}>Resume</button><button className="btn-secondary btn-sm" onClick={() => remove('held_sales', h.id)}>Discard</button></div>
          </div>
        ))}
      </Modal>
      <QuickCustomer open={custOpen} onClose={() => setCustOpen(false)} onSaved={c => setInv(i => ({ ...i, customer_id: c.id }))} />
    </div>
  );
}

const Row = ({ k, v }) => <div className="flex justify-between"><span className="text-slate-500">{k}</span><span>{v}</span></div>;

function PickerModal({ picker, onClose, serials, cart, stock, onPick }) {
  if (!picker) return null;
  const p = picker.product;
  if (picker.kind === 'variant') {
    return (
      <Modal open onClose={onClose} title={`${p.name} — choose variant`}>
        <div className="grid grid-cols-2 gap-2">
          {p.variants.map(v => (
            <button key={v.id} className="btn-secondary flex-col items-start" onClick={() => onPick({ variant: v })}>
              <span className="font-medium">{v.name}</span><span className="text-xs text-slate-500">{money(v.price || p.sale_price)} · stock {stock[stockKey(p.id, v.id)] || 0}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }
  const used = new Set(cart.map(l => l.serial_id));
  const list = serials.filter(s => s.product_id === p.id && !used.has(s.id));
  return (
    <Modal open onClose={onClose} title={`${p.name} — select IMEI / serial`}>
      {!list.length && <div className="text-sm text-slate-500">No serials in stock. Add them through a purchase or Inventory → Serials.</div>}
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {list.map(s => <button key={s.id} className="btn-secondary w-full justify-start font-mono" onClick={() => onPick({ serial: s, variant: (p.variants || []).find(v => v.id === s.variant_id) })}>{s.serial}</button>)}
      </div>
    </Modal>
  );
}

function PayModal({ open, onClose, total, customer, points, settings, onComplete }) {
  const accounts = paymentAccounts(useAccounts());
  const [rows, setRows] = useState([]);
  const [print, setPrint] = useState(localStorage.getItem('xpos_autoprint') !== '0');
  useEffect(() => { if (open) setRows([{ method: 'cash', amount: total, account_code: '' }]); }, [open, total]);
  const p = computePayments(rows, total);
  const set = (i, patch) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const pointValue = Number(settings.loyalty?.point_value || 1);
  const methods = PAYMENT_METHODS.filter(m => m.key !== 'credit' && (m.key !== 'points' || (customer && settings.loyalty?.enabled && points > 0)));
  const pointsUsed = rows.filter(r => r.method === 'points').reduce((s, r) => s + Number(r.amount || 0), 0);
  const invalidPoints = pointsUsed > points * pointValue;
  const quick = [...new Set([total, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000, 5000])].filter(x => x >= total).slice(0, 4);
  return (
    <Modal open={open} onClose={onClose} title="Payment" footer={<>
      <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={print} onChange={e => { setPrint(e.target.checked); localStorage.setItem('xpos_autoprint', e.target.checked ? '1' : '0'); }} /> Print receipt</label>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className="btn-success" disabled={(p.due > 0 && !customer) || invalidPoints} onClick={() => onComplete(rows.map(r => r.method === 'points' ? { ...r, amount: r2(r.amount) } : r), print)}>Complete sale</button>
    </>}>
      <div className="mb-3 text-center"><div className="text-xs text-slate-500">Total payable</div><div className="text-3xl font-bold">{money(total)}</div></div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <select className="input w-40" value={r.method} onChange={e => set(i, { method: e.target.value, account_code: '' })}>{methods.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
            {r.method === 'bank' && <select className="input w-36" value={r.account_code} onChange={e => set(i, { account_code: e.target.value })}><option value="">Default bank</option>{accounts.filter(a => a.is_bank).map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</select>}
            <input className="input" type="number" step="any" value={r.amount} onChange={e => set(i, { amount: e.target.value })} />
            {rows.length > 1 && <button className="btn-secondary" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>}
          </div>
        ))}
        <button className="btn-secondary btn-sm" onClick={() => setRows([...rows, { method: 'card', amount: Math.max(0, r2(total - p.tendered)), account_code: '' }])}>+ Split payment</button>
        {rows.length === 1 && rows[0].method === 'cash' && <div className="flex flex-wrap gap-1">{quick.map(v => <button key={v} className="btn-secondary btn-sm" onClick={() => set(0, { amount: v })}>{money(v)}</button>)}<button className="btn-secondary btn-sm" onClick={() => set(0, { amount: 0 })}>Full credit</button></div>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800"><div className="text-xs text-slate-500">Paid</div><div className="font-semibold">{money(p.paid)}</div></div>
        <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-900/30"><div className="text-xs text-slate-500">Change</div><div className="font-semibold text-emerald-700">{money(p.change)}</div></div>
        <div className="rounded-lg bg-rose-50 p-2 dark:bg-rose-900/30"><div className="text-xs text-slate-500">Due (credit)</div><div className="font-semibold text-rose-700">{money(p.due)}</div></div>
      </div>
      {p.due > 0 && !customer && <div className="mt-2 text-sm text-rose-600">Select a customer to sell on credit.</div>}
      {p.due > 0 && customer && customer.credit_limit > 0 && <div className="mt-2 text-xs text-amber-700">Credit limit: {money(customer.credit_limit)}</div>}
      {invalidPoints && <div className="mt-2 text-sm text-rose-600">Only {points} points ({money(points * pointValue)}) available.</div>}
    </Modal>
  );
}

export function QuickCustomer({ open, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', phone: '', address: '' });
  useEffect(() => { if (open) setF({ name: '', phone: '', address: '' }); }, [open]);
  const submit = async () => {
    if (!f.name) return toast('Name is required', 'error');
    const c = await save('customers', { ...f, credit_limit: 0, opening_balance: 0 }, { action: 'customer.create', detail: 'Quick-added customer ' + f.name });
    onSaved && onSaved(c); onClose(); toast('Customer added');
  };
  return (
    <Modal open={open} onClose={onClose} title="Quick add customer" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit}>Save</button></>}>
      <div className="space-y-2">
        <input className="input" placeholder="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoFocus />
        <input className="input" placeholder="Phone" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} />
        <input className="input" placeholder="Address" value={f.address} onChange={e => setF({ ...f, address: e.target.value })} />
      </div>
    </Modal>
  );
}
