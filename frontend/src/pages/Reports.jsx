import React, { useMemo, useState } from 'react';
import { useTable, useSettings } from '../lib/db.js';
import { partyBalances, useAccounts } from '../lib/data.js';
import { money, num, monthStart, toCSV, downloadFile, printHtml } from '../lib/format.js';
import { stockMap, batchStock, r2, today } from '@shared/posting.js';
import { PAYMENT_METHODS } from '@shared/accounts.js';
import { PageHeader, Table, DateRange } from '../components/ui.jsx';
import { plFigures } from './Accounts.jsx';

const REPORTS = [
  ['sales_day', 'Sales by day'], ['sales_product', 'Sales by product'], ['sales_category', 'Sales by category'], ['sales_user', 'Sales by cashier'],
  ['sales_customer', 'Sales by customer'], ['payments', 'Sales by payment method'], ['purchases', 'Purchases by supplier'], ['stock', 'Stock & valuation'],
  ['expiry', 'Expiry report'], ['profit', 'Profit report'], ['tax', 'Tax report'], ['receivable', 'Customer dues (receivable)'], ['payable', 'Supplier dues (payable)']
];
const NO_DATE = ['stock', 'expiry', 'receivable', 'payable'];

export default function Reports() {
  const [rep, setRep] = useState('sales_day');
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const settings = useSettings();
  const d = {
    sales: useTable('sales'), returns: useTable('sale_returns'), purchases: useTable('purchases', p => p.status === 'received'), products: useTable('products'),
    categories: useTable('categories'), users: useTable('users'), customers: useTable('customers'), suppliers: useTable('suppliers'),
    movements: useTable('stock_movements'), journal: useTable('journal_entries'), expenses: useTable('expenses'), accounts: useAccounts()
  };
  const report = useMemo(() => build(rep, d, range), [rep, range, ...Object.values(d)]);
  const title = REPORTS.find(r => r[0] === rep)[1];
  const fmt = (c, r) => (c.render ? c.render(r) : c.money ? money(r[c.key]) : r[c.key]);
  const plain = (c, r) => (c.money ? money(r[c.key], false) : typeof r[c.key] === 'number' ? num(r[c.key]) : r[c.key] ?? '');
  const print = () => printHtml(`<div class="a4"><h2>${settings.name || ''}</h2><h3>${title}</h3><p class="muted">${NO_DATE.includes(rep) ? 'As of ' + today() : range.from + ' to ' + range.to}</p>
    <table><thead><tr>${report.columns.map(c => `<th class="${c.right || c.money ? 'r' : ''}">${c.label}</th>`).join('')}</tr></thead><tbody>
    ${report.rows.map(r => `<tr>${report.columns.map(c => `<td class="${c.right || c.money ? 'r' : ''}">${plain(c, r)}</td>`).join('')}</tr>`).join('')}
    ${report.total ? `<tr class="b">${report.columns.map(c => `<td class="${c.right || c.money ? 'r' : ''}">${report.total[c.key] !== undefined ? (c.money ? money(report.total[c.key], false) : report.total[c.key]) : ''}</td>`).join('')}</tr>` : ''}</tbody></table></div>`);
  const csv = () => downloadFile(`${rep}-${range.from}-${range.to}.csv`, toCSV(report.rows, report.columns.map(c => ({ label: c.label, value: r => r[c.key] }))));
  return (
    <div>
      <PageHeader title="Reports" subtitle={title}>
        <select className="input w-auto" value={rep} onChange={e => setRep(e.target.value)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {!NO_DATE.includes(rep) && <DateRange {...range} onChange={setRange} />}
        <button className="btn-secondary" onClick={print}>Print</button><button className="btn-secondary" onClick={csv}>CSV</button>
      </PageHeader>
      {report.summary && <div className="mb-3 grid gap-3 sm:grid-cols-4">{report.summary.map(([k, v]) => <div key={k} className="card"><div className="text-xs uppercase text-slate-500">{k}</div><div className="text-lg font-bold">{v}</div></div>)}</div>}
      <div className="card p-0">
        <Table rows={report.rows} empty="No data for this period" columns={report.columns.map(c => ({ ...c, right: c.right || c.money, render: r => fmt(c, r) }))}
          footer={report.total ? Object.fromEntries(report.columns.map(c => [c.key, report.total[c.key] !== undefined ? (c.money ? money(report.total[c.key]) : report.total[c.key]) : ''])) : null} />
      </div>
    </div>
  );
}

function group(rows, keyFn, init, add) {
  const m = {};
  for (const r of rows) { const k = keyFn(r); m[k] = m[k] || init(k, r); add(m[k], r); }
  return Object.values(m);
}
const totals = (rows, keys) => Object.fromEntries(keys.map(k => [k, r2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0))]));

function build(rep, d, { from, to }) {
  const inR = x => x.date >= from && x.date <= to;
  const sales = d.sales.filter(inR);
  const map = (arr) => Object.fromEntries(arr.map(x => [x.id, x]));
  const P = map(d.products), C = map(d.categories), U = map(d.users), CU = map(d.customers), S = map(d.suppliers);
  const lines = sales.flatMap(s => s.items.map(l => ({ ...l, sale: s, profit: r2(l.net - (l.cost || 0) * l.qty) })));
  const withTotal = (cols, rows, keys) => ({ columns: cols, rows, total: { ...totals(rows, keys), [cols[0].key]: 'Total' } });
  switch (rep) {
    case 'sales_day': {
      const rows = group(sales, s => s.date, k => ({ id: k, date: k, invoices: 0, subtotal: 0, discount: 0, tax: 0, total: 0, profit: 0, due: 0 }), (g, s) => { g.invoices++; g.subtotal += s.subtotal; g.discount += s.discount; g.tax += s.tax; g.total += s.total; g.profit += s.profit || 0; g.due += s.due; }).sort((a, b) => a.date.localeCompare(b.date));
      return withTotal([{ key: 'date', label: 'Date' }, { key: 'invoices', label: 'Invoices', right: true }, { key: 'subtotal', label: 'Subtotal', money: 1 }, { key: 'discount', label: 'Discount', money: 1 }, { key: 'tax', label: 'Tax', money: 1 }, { key: 'total', label: 'Total', money: 1 }, { key: 'profit', label: 'Gross profit', money: 1 }, { key: 'due', label: 'Credit', money: 1 }], rows, ['invoices', 'subtotal', 'discount', 'tax', 'total', 'profit', 'due']);
    }
    case 'sales_product': {
      const rows = group(lines, l => l.product_id + (l.variant_id || ''), (k, l) => ({ id: k, name: l.name + (l.variant_name ? ' · ' + l.variant_name : ''), qty: 0, amount: 0, profit: 0 }), (g, l) => { g.qty += l.qty; g.amount += l.total; g.profit += l.profit; }).sort((a, b) => b.amount - a.amount);
      return withTotal([{ key: 'name', label: 'Product' }, { key: 'qty', label: 'Qty sold', right: true }, { key: 'amount', label: 'Sales', money: 1 }, { key: 'profit', label: 'Profit', money: 1 }], rows, ['qty', 'amount', 'profit']);
    }
    case 'sales_category': {
      const rows = group(lines, l => P[l.product_id]?.category_id || '-', k => ({ id: k, name: C[k]?.name || 'Uncategorised', qty: 0, amount: 0, profit: 0 }), (g, l) => { g.qty += l.qty; g.amount += l.total; g.profit += l.profit; }).sort((a, b) => b.amount - a.amount);
      return withTotal([{ key: 'name', label: 'Category' }, { key: 'qty', label: 'Qty', right: true }, { key: 'amount', label: 'Sales', money: 1 }, { key: 'profit', label: 'Profit', money: 1 }], rows, ['qty', 'amount', 'profit']);
    }
    case 'sales_user': {
      const rows = group(sales, s => s.user_id || '-', k => ({ id: k, name: U[k]?.name || 'Unknown', invoices: 0, total: 0, profit: 0 }), (g, s) => { g.invoices++; g.total += s.total; g.profit += s.profit || 0; });
      return withTotal([{ key: 'name', label: 'Cashier' }, { key: 'invoices', label: 'Invoices', right: true }, { key: 'total', label: 'Sales', money: 1 }, { key: 'profit', label: 'Profit', money: 1 }], rows, ['invoices', 'total', 'profit']);
    }
    case 'sales_customer': {
      const rows = group(sales, s => s.customer_id || '-', k => ({ id: k, name: CU[k]?.name || 'Walk-in', invoices: 0, total: 0, paid: 0, due: 0 }), (g, s) => { g.invoices++; g.total += s.total; g.paid += s.paid; g.due += s.due; }).sort((a, b) => b.total - a.total);
      return withTotal([{ key: 'name', label: 'Customer' }, { key: 'invoices', label: 'Invoices', right: true }, { key: 'total', label: 'Sales', money: 1 }, { key: 'paid', label: 'Paid', money: 1 }, { key: 'due', label: 'Credit', money: 1 }], rows, ['invoices', 'total', 'paid', 'due']);
    }
    case 'payments': {
      const pays = sales.flatMap(s => s.payments.map(p => ({ ...p, amount: p.method === 'cash' ? p.amount - (s.change || 0) : p.amount })));
      const rows = group(pays, p => p.method, k => ({ id: k, name: (PAYMENT_METHODS.find(m => m.key === k) || { label: k }).label, count: 0, amount: 0 }), (g, p) => { g.count++; g.amount += p.amount; });
      rows.push({ id: 'credit', name: 'Credit / Due', count: sales.filter(s => s.due > 0).length, amount: r2(sales.reduce((s, x) => s + x.due, 0)) });
      return withTotal([{ key: 'name', label: 'Method' }, { key: 'count', label: 'Transactions', right: true }, { key: 'amount', label: 'Amount', money: 1 }], rows, ['count', 'amount']);
    }
    case 'purchases': {
      const rows = group(d.purchases.filter(inR), p => p.supplier_id, k => ({ id: k, name: S[k]?.name || '-', count: 0, total: 0, paid: 0, due: 0 }), (g, p) => { g.count++; g.total += p.total; g.paid += p.paid; g.due += p.due; });
      return withTotal([{ key: 'name', label: 'Supplier' }, { key: 'count', label: 'Invoices', right: true }, { key: 'total', label: 'Total', money: 1 }, { key: 'paid', label: 'Paid', money: 1 }, { key: 'due', label: 'Due', money: 1 }], rows, ['count', 'total', 'paid', 'due']);
    }
    case 'stock': {
      const st = stockMap(d.movements);
      const rows = d.products.map(p => ({ id: p.id, name: p.name, sku: p.sku, category: C[p.category_id]?.name || '', stock: r2(st[p.id] || 0), cost: p.cost_price, value: r2((st[p.id] || 0) * (p.cost_price || 0)), retail: r2((st[p.id] || 0) * (p.sale_price || 0)) })).sort((a, b) => b.value - a.value);
      const r = withTotal([{ key: 'name', label: 'Product' }, { key: 'sku', label: 'SKU' }, { key: 'category', label: 'Category' }, { key: 'stock', label: 'Stock', right: true }, { key: 'cost', label: 'Unit cost', money: 1 }, { key: 'value', label: 'Value at cost', money: 1 }, { key: 'retail', label: 'Value at retail', money: 1 }], rows, ['stock', 'value', 'retail']);
      delete r.total.cost; return r;
    }
    case 'expiry': {
      const rows = [];
      for (const p of d.products.filter(p => p.track_batch)) for (const b of batchStock(d.movements, p.id)) rows.push({ id: p.id + b.batch_no, name: p.name, batch: b.batch_no, expiry: b.expiry || '', qty: b.qty, days: b.expiry ? Math.round((new Date(b.expiry) - new Date(today())) / 86400000) : '' });
      rows.sort((a, b) => String(a.expiry || '9999').localeCompare(String(b.expiry || '9999')));
      return { columns: [{ key: 'name', label: 'Product' }, { key: 'batch', label: 'Batch' }, { key: 'expiry', label: 'Expiry' }, { key: 'days', label: 'Days left', right: true }, { key: 'qty', label: 'Qty', right: true }], rows };
    }
    case 'profit': {
      const rets = d.returns.filter(inR);
      const rows = group([...sales.map(s => ({ ...s, k: 's' })), ...rets.map(r => ({ ...r, k: 'r' })), ...d.expenses.filter(inR).map(e => ({ ...e, k: 'e' }))], x => x.date,
        k => ({ id: k, date: k, revenue: 0, cogs: 0, gross: 0, expenses: 0, net: 0 }),
        (g, x) => { if (x.k === 's') { g.revenue += x.total - x.tax; g.cogs += x.cost; } else if (x.k === 'r') { g.revenue -= x.net; g.cogs -= x.cost; } else g.expenses += x.amount; g.gross = r2(g.revenue - g.cogs); g.net = r2(g.gross - g.expenses); }).sort((a, b) => a.date.localeCompare(b.date));
      const pl = plFigures(d.journal, d.accounts, { from, to });
      const r = withTotal([{ key: 'date', label: 'Date' }, { key: 'revenue', label: 'Revenue (ex-tax)', money: 1 }, { key: 'cogs', label: 'COGS', money: 1 }, { key: 'gross', label: 'Gross profit', money: 1 }, { key: 'expenses', label: 'Expenses', money: 1 }, { key: 'net', label: 'Net profit', money: 1 }], rows, ['revenue', 'cogs', 'gross', 'expenses', 'net']);
      r.summary = [['Net revenue (books)', money(pl.revenue)], ['Gross profit', money(pl.gross)], ['Expenses', money(pl.exp)], ['Net profit (books)', money(pl.net)]];
      return r;
    }
    case 'tax': {
      const outT = r2(sales.reduce((s, x) => s + x.tax, 0)) - r2(d.returns.filter(inR).reduce((s, x) => s + x.tax, 0));
      const inT = r2(d.purchases.filter(inR).reduce((s, x) => s + x.tax, 0));
      const rows = group(lines, l => String(l.tax_rate || 0), k => ({ id: k, rate: k + '%', taxable: 0, tax: 0 }), (g, l) => { g.taxable += l.net; g.tax += l.tax; });
      const r = withTotal([{ key: 'rate', label: 'Tax rate' }, { key: 'taxable', label: 'Taxable sales', money: 1 }, { key: 'tax', label: 'Output tax', money: 1 }], rows, ['taxable', 'tax']);
      r.summary = [['Output tax (sales, net of returns)', money(outT)], ['Input tax (purchases)', money(inT)], ['Net tax payable', money(r2(outT - inT))]];
      return r;
    }
    case 'receivable':
    case 'payable': {
      const bal = partyBalances(d.journal);
      const list = rep === 'receivable' ? d.customers : d.suppliers;
      const rows = list.map(p => ({ id: p.id, name: p.name, phone: p.phone, limit: p.credit_limit || 0, balance: bal[p.id] || 0 })).filter(r => r.balance).sort((a, b) => b.balance - a.balance);
      return withTotal([{ key: 'name', label: rep === 'receivable' ? 'Customer' : 'Supplier' }, { key: 'phone', label: 'Phone' }, ...(rep === 'receivable' ? [{ key: 'limit', label: 'Credit limit', money: 1 }] : []), { key: 'balance', label: 'Balance', money: 1 }], rows, ['balance']);
    }
    default: return { columns: [], rows: [] };
  }
}
