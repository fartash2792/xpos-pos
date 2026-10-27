// Pure business logic shared by the browser (offline) and the server.
// Each build* function returns { <entity>: [records] } ready to be saved.
import { uuid } from './uuid.js';
import { methodAccount } from './accounts.js';

export const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
export const today = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

function base(ctx) {
  return { id: uuid(), business_id: ctx.business_id, updated_at: Date.now(), deleted: false, user_id: ctx.user_id || null };
}

export function journal(ctx, { date, ref_type, ref_id, ref_no, memo, lines }) {
  const clean = lines.filter(l => r2(l.debit) !== 0 || r2(l.credit) !== 0).map(l => ({
    account: l.account, debit: r2(l.debit), credit: r2(l.credit),
    party_id: l.party_id || null, party_type: l.party_type || null
  }));
  // Turn negative amounts to the other side
  for (const l of clean) {
    if (l.debit < 0) { l.credit = r2(l.credit - l.debit); l.debit = 0; }
    if (l.credit < 0) { l.debit = r2(l.debit - l.credit); l.credit = 0; }
  }
  const d = r2(clean.reduce((s, l) => s + l.debit, 0));
  const c = r2(clean.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(d - c) > 0.009) {
    // absorb rounding pennies into the first credit/debit line so entries always balance
    const diff = r2(d - c);
    if (Math.abs(diff) <= 0.05 && clean.length) {
      const target = clean.find(l => (diff > 0 ? l.credit > 0 : l.debit > 0));
      if (target) { if (diff > 0) target.credit = r2(target.credit + diff); else target.debit = r2(target.debit - diff); }
    } else {
      throw new Error(`Unbalanced journal for ${ref_type}: Dr ${d} / Cr ${c}`);
    }
  }
  return { ...base(ctx), date: date || today(), at: Date.now(), ref_type, ref_id, ref_no: ref_no || '', memo: memo || '', lines: clean };
}

// ---------- cart math ----------
export function computeLine(l) {
  const qty = Number(l.qty) || 0;
  const price = Number(l.price) || 0;
  const gross = r2(qty * price);
  const discount = r2(l.discount_type === 'percent' ? gross * (Number(l.discount) || 0) / 100 : (Number(l.discount) || 0));
  const net = r2(gross - discount);
  const tax = r2(net * (Number(l.tax_rate) || 0) / 100);
  return { ...l, qty, price, gross, discount_amount: discount, net, tax, total: r2(net + tax) };
}

export function computeCart(items, inv = {}) {
  const lines = items.map(computeLine);
  const subtotal = r2(lines.reduce((s, l) => s + l.net, 0));
  const lineTax = r2(lines.reduce((s, l) => s + l.tax, 0));
  const discount = r2(inv.discount_type === 'percent' ? subtotal * (Number(inv.discount) || 0) / 100 : (Number(inv.discount) || 0));
  const taxable = r2(subtotal - discount);
  const orderTax = r2(taxable * (Number(inv.order_tax_rate) || 0) / 100);
  const shipping = r2(inv.shipping || 0);
  const tax = r2(lineTax + orderTax);
  const total = r2(taxable + tax + shipping);
  const cost = r2(lines.reduce((s, l) => s + (Number(l.cost) || 0) * l.qty, 0));
  return { lines, subtotal, discount, taxable, tax, shipping, total, cost };
}

export function computePayments(payments, total) {
  const pays = (payments || []).filter(p => r2(p.amount) > 0 && p.method !== 'credit');
  const tendered = r2(pays.reduce((s, p) => s + r2(p.amount), 0));
  const cashTendered = r2(pays.filter(p => p.method === 'cash').reduce((s, p) => s + r2(p.amount), 0));
  const change = r2(Math.min(Math.max(0, tendered - total), cashTendered));
  const paid = r2(tendered - change);
  const due = r2(Math.max(0, total - paid));
  return { pays, tendered, change, paid, due };
}

function paymentDebits(pays, change, party) {
  // cash change is given back out of cash
  const lines = [];
  let changeLeft = change;
  for (const p of pays) {
    let amt = r2(p.amount);
    if (p.method === 'cash' && changeLeft > 0) { const c = Math.min(changeLeft, amt); amt = r2(amt - c); changeLeft = r2(changeLeft - c); }
    if (amt > 0) lines.push({ account: methodAccount(p.method, p.account_code), debit: amt, credit: 0, ...party });
  }
  return lines;
}

// ---------- sales ----------
export function buildSale({ items, invoice = {}, payments = [], ctx, settings = {} }) {
  if (!items || !items.length) throw new Error('Cart is empty');
  const c = computeCart(items, invoice);
  const p = computePayments(payments, c.total);
  if (p.due > 0 && !invoice.customer_id) throw new Error('Select a customer for credit/due sales');
  const sale = {
    ...base(ctx), date: ctx.date || today(), at: Date.now(),
    local_no: ctx.local_no, invoice_no: ctx.invoice_no || null,
    customer_id: invoice.customer_id || null, warehouse_id: ctx.warehouse_id,
    items: c.lines, subtotal: c.subtotal, discount: c.discount, discount_type: invoice.discount_type || 'amount',
    discount_value: Number(invoice.discount) || 0, order_tax_rate: Number(invoice.order_tax_rate) || 0,
    tax: c.tax, shipping: c.shipping, total: c.total, cost: c.cost, profit: r2(c.taxable - c.cost),
    payments: p.pays.map(x => ({ method: x.method, amount: r2(x.amount), account_code: x.account_code || null, ref: x.ref || '' })),
    tendered: p.tendered, change: p.change, paid: p.paid, due: p.due,
    note: invoice.note || '', quotation_id: invoice.quotation_id || null,
    points_earned: 0, points_redeemed: r2(p.pays.filter(x => x.method === 'points').reduce((s, x) => s + r2(x.amount), 0) / (Number((settings.loyalty || {}).point_value) || 1)),
    returned_total: 0, status: p.due > 0 ? (p.paid > 0 ? 'partial' : 'unpaid') : 'paid'
  };
  const loyalty = settings.loyalty || {};
  if (loyalty.enabled && sale.customer_id && Number(loyalty.earn_per) > 0) {
    sale.points_earned = Math.floor(sale.total / Number(loyalty.earn_per));
  }
  const movements = c.lines.map(l => ({
    ...base(ctx), product_id: l.product_id, variant_id: l.variant_id || null, warehouse_id: ctx.warehouse_id,
    qty: -l.qty, type: 'sale', ref_type: 'sale', ref_id: sale.id, batch_no: l.batch_no || null, expiry: l.expiry || null,
    cost: Number(l.cost) || 0, date: sale.date
  }));
  const party = sale.customer_id ? { party_id: sale.customer_id, party_type: 'customer' } : {};
  const lines = [
    ...paymentDebits(p.pays, p.change, {}),
    { account: '1100', debit: p.due, credit: 0, ...party },
    { account: '4000', debit: 0, credit: r2(c.taxable + c.shipping) },
    { account: '2100', debit: 0, credit: c.tax },
    { account: '5000', debit: c.cost, credit: 0 },
    { account: '1200', debit: 0, credit: c.cost }
  ];
  const j = journal(ctx, { date: sale.date, ref_type: 'sale', ref_id: sale.id, ref_no: sale.local_no, memo: 'Sale', lines });
  const serials = c.lines.filter(l => l.serial_id).map(l => ({ id: l.serial_id, status: 'sold', sale_id: sale.id }));
  return { sales: [sale], stock_movements: movements, journal_entries: [j], serials_patch: serials };
}

export function buildSaleReturn({ sale, items, refund_method = 'cash', account_code, ctx, note }) {
  const lines = [];
  for (const it of items) {
    const src = sale.items[it.line_index];
    const qty = Number(it.qty) || 0;
    if (!src || qty <= 0) continue;
    const ratio = qty / src.qty;
    lines.push({ ...src, line_index: it.line_index, qty, net: r2(src.net * ratio), tax: r2(src.tax * ratio), total: r2(src.total * ratio) });
  }
  if (!lines.length) throw new Error('Nothing to return');
  // pro-rate invoice-level discount and order tax
  const factor = sale.subtotal ? (sale.subtotal - sale.discount) / sale.subtotal : 1;
  const lineNet = lines.reduce((s, l) => s + l.net, 0);
  const net = r2(lineNet * factor);
  const lineTax = lines.reduce((s, l) => s + l.tax, 0);
  const tax = r2(lineTax + net * (sale.order_tax_rate || 0) / 100);
  const total = r2(net + tax);
  const cost = r2(lines.reduce((s, l) => s + (Number(l.cost) || 0) * l.qty, 0));
  const ret = {
    ...base(ctx), date: ctx.date || today(), at: Date.now(), sale_id: sale.id, sale_no: sale.invoice_no || sale.local_no,
    customer_id: sale.customer_id, warehouse_id: sale.warehouse_id, items: lines, net, tax, total, cost,
    refund_method, account_code: account_code || null, note: note || ''
  };
  const movements = lines.map(l => ({
    ...base(ctx), product_id: l.product_id, variant_id: l.variant_id || null, warehouse_id: sale.warehouse_id,
    qty: l.qty, type: 'sale_return', ref_type: 'sale_return', ref_id: ret.id, batch_no: l.batch_no || null,
    expiry: l.expiry || null, cost: Number(l.cost) || 0, date: ret.date
  }));
  const party = sale.customer_id ? { party_id: sale.customer_id, party_type: 'customer' } : {};
  const credit = refund_method === 'credit'
    ? { account: '1100', debit: 0, credit: total, ...party }
    : { account: methodAccount(refund_method, account_code), debit: 0, credit: total };
  const j = journal(ctx, {
    date: ret.date, ref_type: 'sale_return', ref_id: ret.id, ref_no: ret.sale_no, memo: 'Sale return',
    lines: [
      { account: '4200', debit: net, credit: 0 }, { account: '2100', debit: tax, credit: 0 }, credit,
      { account: '1200', debit: cost, credit: 0 }, { account: '5000', debit: 0, credit: cost }
    ]
  });
  const salePatch = { ...sale, returned_total: r2((sale.returned_total || 0) + total), updated_at: Date.now() };
  const serials = lines.filter(l => l.serial_id).map(l => ({ id: l.serial_id, status: 'in_stock', sale_id: null }));
  return { sale_returns: [ret], stock_movements: movements, journal_entries: [j], sales: [salePatch], serials_patch: serials };
}

// ---------- purchases ----------
export function buildPurchase({ items, purchase = {}, payments = [], ctx }) {
  if (!items || !items.length) throw new Error('No items');
  if (!purchase.supplier_id) throw new Error('Select a supplier');
  const c = computeCart(items.map(i => ({ ...i, price: i.cost, cost: i.cost })), purchase);
  const p = computePayments(payments, c.total);
  if (p.tendered > c.total + 0.009) throw new Error('Paid amount exceeds purchase total');
  const pur = {
    ...base(ctx), date: purchase.date || today(), at: Date.now(), ref_no: purchase.ref_no || '',
    supplier_id: purchase.supplier_id, warehouse_id: ctx.warehouse_id, items: c.lines,
    subtotal: c.subtotal, discount: c.discount, tax: c.tax, shipping: c.shipping, total: c.total,
    payments: p.pays.map(x => ({ method: x.method, amount: r2(x.amount), account_code: x.account_code || null })),
    paid: r2(Math.min(p.tendered, c.total)), due: r2(Math.max(0, c.total - p.tendered)), returned_total: 0,
    note: purchase.note || '', status: purchase.status || 'received'
  };
  // Landed unit cost includes invoice discount/shipping spread by value
  const factor = c.subtotal ? (c.taxable + c.shipping) / c.subtotal : 1;
  const movements = c.lines.map(l => ({
    ...base(ctx), product_id: l.product_id, variant_id: l.variant_id || null, warehouse_id: ctx.warehouse_id,
    qty: l.qty, type: 'purchase', ref_type: 'purchase', ref_id: pur.id, batch_no: l.batch_no || null,
    expiry: l.expiry || null, cost: r2((l.net / (l.qty || 1)) * factor), date: pur.date
  }));
  const serials = [];
  for (const l of c.lines) for (const s of (l.serials || [])) {
    if (!s) continue;
    serials.push({ ...base(ctx), product_id: l.product_id, variant_id: l.variant_id || null, serial: String(s).trim(), status: 'in_stock', purchase_id: pur.id, warehouse_id: ctx.warehouse_id, cost: l.cost });
  }
  const party = { party_id: pur.supplier_id, party_type: 'supplier' };
  const paidLines = p.pays.map(x => ({ account: methodAccount(x.method, x.account_code), debit: 0, credit: r2(x.amount) }));
  const j = journal(ctx, {
    date: pur.date, ref_type: 'purchase', ref_id: pur.id, ref_no: pur.ref_no, memo: 'Purchase',
    lines: [
      { account: '1200', debit: r2(c.taxable + c.shipping), credit: 0 },
      { account: '2100', debit: c.tax, credit: 0 },
      ...paidLines,
      { account: '2000', debit: 0, credit: pur.due, ...party }
    ]
  });
  return { purchases: [pur], stock_movements: movements, journal_entries: [j], serials };
}

export function buildPurchaseReturn({ purchase, items, refund_method = 'credit', account_code, ctx, note }) {
  const lines = [];
  for (const it of items) {
    const src = purchase.items[it.line_index];
    const qty = Number(it.qty) || 0;
    if (!src || qty <= 0) continue;
    const ratio = qty / src.qty;
    lines.push({ ...src, line_index: it.line_index, qty, net: r2(src.net * ratio), tax: r2(src.tax * ratio) });
  }
  if (!lines.length) throw new Error('Nothing to return');
  const factor = purchase.subtotal ? (purchase.subtotal - purchase.discount) / purchase.subtotal : 1;
  const net = r2(lines.reduce((s, l) => s + l.net, 0) * factor);
  const tax = r2(lines.reduce((s, l) => s + l.tax, 0));
  const total = r2(net + tax);
  const ret = {
    ...base(ctx), date: ctx.date || today(), at: Date.now(), purchase_id: purchase.id, supplier_id: purchase.supplier_id,
    warehouse_id: purchase.warehouse_id, items: lines, net, tax, total, refund_method, note: note || ''
  };
  const movements = lines.map(l => ({
    ...base(ctx), product_id: l.product_id, variant_id: l.variant_id || null, warehouse_id: purchase.warehouse_id,
    qty: -l.qty, type: 'purchase_return', ref_type: 'purchase_return', ref_id: ret.id, batch_no: l.batch_no || null,
    expiry: l.expiry || null, cost: r2(l.net / l.qty * factor), date: ret.date
  }));
  const party = { party_id: purchase.supplier_id, party_type: 'supplier' };
  const debit = refund_method === 'credit'
    ? { account: '2000', debit: total, credit: 0, ...party }
    : { account: methodAccount(refund_method, account_code), debit: total, credit: 0 };
  const j = journal(ctx, {
    date: ret.date, ref_type: 'purchase_return', ref_id: ret.id, ref_no: purchase.ref_no, memo: 'Purchase return',
    lines: [debit, { account: '1200', debit: 0, credit: net }, { account: '2100', debit: 0, credit: tax }]
  });
  const patch = { ...purchase, returned_total: r2((purchase.returned_total || 0) + total), updated_at: Date.now() };
  return { purchase_returns: [ret], stock_movements: movements, journal_entries: [j], purchases: [patch] };
}

// ---------- money ----------
export function buildPayment({ party_type, party_id, amount, method = 'cash', account_code, ctx, note, date, discount = 0 }) {
  amount = r2(amount);
  if (amount <= 0) throw new Error('Amount must be positive');
  const pay = { ...base(ctx), date: date || today(), at: Date.now(), party_type, party_id, amount, method, account_code: account_code || null, note: note || '', direction: party_type === 'customer' ? 'in' : 'out' };
  const acc = methodAccount(method, account_code);
  const party = { party_id, party_type };
  const lines = party_type === 'customer'
    ? [{ account: acc, debit: amount, credit: 0 }, { account: '1100', debit: 0, credit: amount, ...party }]
    : [{ account: '2000', debit: amount, credit: 0, ...party }, { account: acc, debit: 0, credit: amount }];
  const j = journal(ctx, { date: pay.date, ref_type: 'payment', ref_id: pay.id, memo: party_type === 'customer' ? 'Payment received' : 'Payment made', lines });
  return { payments: [pay], journal_entries: [j] };
}

export function buildExpense({ amount, category_id, category_account = '5100', method = 'cash', account_code, ctx, note, date, kind = 'expense', title }) {
  amount = r2(amount);
  if (amount <= 0) throw new Error('Amount must be positive');
  const rec = { ...base(ctx), date: date || today(), at: Date.now(), amount, category_id: category_id || null, method, account_code: account_code || null, note: note || '', title: title || '' };
  const acc = methodAccount(method, account_code);
  const lines = kind === 'expense'
    ? [{ account: category_account || '5100', debit: amount, credit: 0 }, { account: acc, debit: 0, credit: amount }]
    : [{ account: acc, debit: amount, credit: 0 }, { account: category_account || '4100', debit: 0, credit: amount }];
  const j = journal(ctx, { date: rec.date, ref_type: kind, ref_id: rec.id, memo: title || kind, lines });
  return kind === 'expense' ? { expenses: [rec], journal_entries: [j] } : { incomes: [rec], journal_entries: [j] };
}

export function buildTransfer({ from_account, to_account, amount, ctx, note, date }) {
  amount = r2(amount);
  if (amount <= 0 || from_account === to_account) throw new Error('Invalid transfer');
  const t = { ...base(ctx), date: date || today(), at: Date.now(), from_account, to_account, amount, note: note || '' };
  const j = journal(ctx, { date: t.date, ref_type: 'transfer', ref_id: t.id, memo: note || 'Transfer', lines: [
    { account: to_account, debit: amount, credit: 0 }, { account: from_account, debit: 0, credit: amount }] });
  return { transfers: [t], journal_entries: [j] };
}

export function buildOpening({ account = '1000', amount, ctx, party, date }) {
  amount = r2(amount);
  if (!amount) return {};
  let lines;
  if (party && party.party_type === 'customer') lines = [{ account: '1100', debit: amount, credit: 0, ...party }, { account: '3000', debit: 0, credit: amount }];
  else if (party && party.party_type === 'supplier') lines = [{ account: '3000', debit: amount, credit: 0 }, { account: '2000', debit: 0, credit: amount, ...party }];
  else lines = [{ account, debit: amount, credit: 0 }, { account: '3000', debit: 0, credit: amount }];
  return { journal_entries: [journal(ctx, { date, ref_type: 'opening', ref_id: party ? party.party_id : null, memo: 'Opening balance', lines })] };
}

export function buildStockAdjustment({ product, variant_id, qty, reason, ctx, batch_no, expiry, date }) {
  qty = Number(qty);
  if (!qty) throw new Error('Quantity required');
  const adj = { ...base(ctx), date: date || today(), at: Date.now(), product_id: product.id, variant_id: variant_id || null, warehouse_id: ctx.warehouse_id, qty, reason: reason || '', cost: Number(product.cost_price) || 0 };
  const mv = { ...base(ctx), product_id: product.id, variant_id: variant_id || null, warehouse_id: ctx.warehouse_id, qty, type: 'adjustment', ref_type: 'adjustment', ref_id: adj.id, batch_no: batch_no || null, expiry: expiry || null, cost: adj.cost, date: adj.date };
  const value = r2(Math.abs(qty) * adj.cost);
  const lines = qty > 0
    ? [{ account: '1200', debit: value, credit: 0 }, { account: '5300', debit: 0, credit: value }]
    : [{ account: '5300', debit: value, credit: 0 }, { account: '1200', debit: 0, credit: value }];
  const out = { stock_adjustments: [adj], stock_movements: [mv] };
  if (value) out.journal_entries = [journal(ctx, { date: adj.date, ref_type: 'adjustment', ref_id: adj.id, memo: 'Stock adjustment: ' + (reason || ''), lines })];
  return out;
}

export function buildOpeningStock({ product, variant_id, qty, warehouse_id, ctx, batch_no, expiry }) {
  qty = Number(qty);
  if (!qty) return {};
  const mv = { ...base(ctx), product_id: product.id, variant_id: variant_id || null, warehouse_id, qty, type: 'opening', ref_type: 'opening', ref_id: product.id, batch_no: batch_no || null, expiry: expiry || null, cost: Number(product.cost_price) || 0, date: today() };
  const value = r2(qty * mv.cost);
  const out = { stock_movements: [mv] };
  if (value) out.journal_entries = [journal(ctx, { ref_type: 'opening_stock', ref_id: product.id, memo: 'Opening stock: ' + product.name, lines: [{ account: '1200', debit: value, credit: 0 }, { account: '3000', debit: 0, credit: value }] })];
  return out;
}

export function buildStockTransfer({ items, from_warehouse, to_warehouse, ctx, note, date }) {
  if (from_warehouse === to_warehouse) throw new Error('Choose different warehouses');
  const t = { ...base(ctx), date: date || today(), at: Date.now(), from_warehouse, to_warehouse, items, note: note || '' };
  const mv = [];
  for (const i of items) {
    const q = Number(i.qty) || 0; if (!q) continue;
    const common = { product_id: i.product_id, variant_id: i.variant_id || null, ref_type: 'stock_transfer', ref_id: t.id, batch_no: i.batch_no || null, expiry: i.expiry || null, cost: Number(i.cost) || 0, date: t.date };
    mv.push({ ...base(ctx), ...common, warehouse_id: from_warehouse, qty: -q, type: 'transfer_out' });
    mv.push({ ...base(ctx), ...common, warehouse_id: to_warehouse, qty: q, type: 'transfer_in' });
  }
  return { stock_transfers: [t], stock_movements: mv };
}

// ---------- read helpers (work on arrays from either DB) ----------
export function stockKey(product_id, variant_id) { return variant_id ? `${product_id}::${variant_id}` : product_id; }

export function stockMap(movements, warehouse_id) {
  const m = {};
  for (const mv of movements) {
    if (mv.deleted) continue;
    if (warehouse_id && mv.warehouse_id !== warehouse_id) continue;
    const q = Number(mv.qty) || 0;
    m[mv.product_id] = (m[mv.product_id] || 0) + q;
    if (mv.variant_id) { const k = stockKey(mv.product_id, mv.variant_id); m[k] = (m[k] || 0) + q; }
  }
  return m;
}

export function batchStock(movements, product_id, warehouse_id) {
  const b = {};
  for (const mv of movements) {
    if (mv.deleted || mv.product_id !== product_id || !mv.batch_no) continue;
    if (warehouse_id && mv.warehouse_id !== warehouse_id) continue;
    const k = mv.batch_no;
    b[k] = b[k] || { batch_no: k, expiry: mv.expiry, qty: 0 };
    b[k].qty += Number(mv.qty) || 0;
    if (mv.expiry) b[k].expiry = mv.expiry;
  }
  return Object.values(b).filter(x => x.qty > 0).sort((a, z) => String(a.expiry || '9999').localeCompare(String(z.expiry || '9999')));
}

export function accountBalances(entries, { from, to } = {}) {
  const bal = {};
  for (const e of entries) {
    if (e.deleted) continue;
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    for (const l of e.lines || []) {
      bal[l.account] = bal[l.account] || { debit: 0, credit: 0 };
      bal[l.account].debit = r2(bal[l.account].debit + l.debit);
      bal[l.account].credit = r2(bal[l.account].credit + l.credit);
    }
  }
  return bal;
}

export function partyBalance(entries, party_id) {
  let b = 0;
  for (const e of entries) {
    if (e.deleted) continue;
    for (const l of e.lines || []) if (l.party_id === party_id) {
      if (l.account === '1100') b += l.debit - l.credit;     // customer owes us (+)
      if (l.account === '2000') b += l.credit - l.debit;     // we owe supplier (+)
    }
  }
  return r2(b);
}
