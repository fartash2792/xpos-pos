import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTable } from '../lib/db.js';
import { useStock, partyBalances, useAccounts, balancesWithAccounts } from '../lib/data.js';
import { money, monthStart, daysAgo, fmtDateTime } from '../lib/format.js';
import { today, r2 } from '@shared/posting.js';
import { Stat, BarChart, Table } from '../components/ui.jsx';

export default function Dashboard() {
  const sales = useTable('sales');
  const returns = useTable('sale_returns');
  const purchases = useTable('purchases', p => p.status === 'received');
  const expenses = useTable('expenses');
  const products = useTable('products');
  const customers = useTable('customers');
  const journal = useTable('journal_entries');
  const accounts = useAccounts();
  const stock = useStock();
  const t = today(), m = monthStart();
  const d = useMemo(() => {
    const sum = (arr, f, k) => r2(arr.filter(f).reduce((s, x) => s + (x[k] || 0), 0));
    const isT = x => x.date === t, isM = x => x.date >= m;
    const retT = sum(returns, isT, 'total'), retM = sum(returns, isM, 'total');
    const retProfitM = r2(returns.filter(isM).reduce((s, r) => s + (r.net - r.cost), 0));
    const retProfitT = r2(returns.filter(isT).reduce((s, r) => s + (r.net - r.cost), 0));
    const bal = partyBalances(journal);
    const custIds = new Set(customers.map(c => c.id));
    let receivable = 0, payable = 0;
    for (const [id, b] of Object.entries(bal)) { if (custIds.has(id)) receivable += b; else payable += b; }
    const chart = [];
    for (let i = 13; i >= 0; i--) { const day = daysAgo(i); chart.push({ label: day, short: day.slice(8), value: sum(sales, x => x.date === day, 'total') }); }
    const top = {};
    for (const s of sales.filter(isM)) for (const l of s.items) { top[l.product_id] = top[l.product_id] || { name: l.name, qty: 0, amount: 0 }; top[l.product_id].qty += l.qty; top[l.product_id].amount += l.total; }
    const cash = balancesWithAccounts(journal, accounts.filter(a => a.is_cash || a.is_bank)).reduce((s, a) => s + a.balance, 0);
    return {
      salesT: r2(sum(sales, isT, 'total') - retT), salesM: r2(sum(sales, isM, 'total') - retM), countT: sales.filter(isT).length,
      profitT: r2(sum(sales, isT, 'profit') - retProfitT), profitM: r2(sum(sales, isM, 'profit') - retProfitM),
      purchasesM: sum(purchases, isM, 'total'), expensesM: sum(expenses, isM, 'amount'), expensesT: sum(expenses, isT, 'amount'),
      receivable: r2(receivable), payable: r2(payable), chart, cash: r2(cash),
      top: Object.values(top).sort((a, b) => b.amount - a.amount).slice(0, 6)
    };
  }, [sales, returns, purchases, expenses, journal, customers, accounts, t, m]);
  const low = products.filter(p => (stock[p.id] || 0) <= (p.alert_qty || 0)).slice(0, 8);
  const recent = [...sales].sort((a, b) => b.at - a.at).slice(0, 6);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h1 className="h1">Dashboard</h1><Link to="/pos" className="btn-primary">🛒 Open POS counter</Link></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today's sales" value={money(d.salesT)} hint={`${d.countT} invoices`} />
        <Stat label="Today's profit" value={money(d.profitT - d.expensesT)} tone="green" hint={`Gross ${money(d.profitT)} − expenses ${money(d.expensesT)}`} />
        <Stat label="This month sales" value={money(d.salesM)} />
        <Stat label="This month net profit" value={money(d.profitM - d.expensesM)} tone={d.profitM - d.expensesM >= 0 ? 'green' : 'red'} hint={`Gross ${money(d.profitM)}`} />
        <Stat label="Purchases (month)" value={money(d.purchasesM)} tone="slate" />
        <Stat label="Expenses (month)" value={money(d.expensesM)} tone="amber" />
        <Stat label="Receivable (customers)" value={money(d.receivable)} tone="red" hint={`Payable to suppliers ${money(d.payable)}`} />
        <Stat label="Cash & bank" value={money(d.cash)} tone="slate" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2"><h3 className="mb-3 font-medium">Sales — last 14 days</h3><BarChart data={d.chart} format={v => money(v)} /></div>
        <div className="card"><h3 className="mb-2 font-medium">Top products (month)</h3>
          {d.top.length ? d.top.map(p => <div key={p.name} className="flex justify-between border-b border-slate-100 py-1.5 text-sm dark:border-slate-800"><span className="truncate">{p.name}</span><span className="text-slate-500">{p.qty} · {money(p.amount)}</span></div>) : <div className="text-sm text-slate-400">No sales yet this month</div>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-0"><h3 className="p-3 font-medium">Low stock alerts <Link to="/inventory" className="text-xs text-brand-600">reorder →</Link></h3>
          <Table rows={low} empty="All stock levels healthy" columns={[{ label: 'Product', key: 'name' }, { label: 'Stock', right: true, render: p => <span className="text-rose-600">{stock[p.id] || 0}</span> }, { label: 'Alert', key: 'alert_qty', right: true }]} /></div>
        <div className="card p-0"><h3 className="p-3 font-medium">Recent sales</h3>
          <Table rows={recent} empty="No sales yet" columns={[{ label: 'Invoice', render: s => s.invoice_no || s.local_no }, { label: 'Time', render: s => fmtDateTime(s.at) }, { label: 'Total', right: true, render: s => money(s.total) }]} /></div>
      </div>
    </div>
  );
}
