import { useMemo } from 'react';
import { useTable, activeWarehouse } from './db.js';
import { stockMap, accountBalances, r2 } from '@shared/posting.js';
import { DEFAULT_ACCOUNTS, isDebitNormal } from '@shared/accounts.js';

export function useStock(allWarehouses = false) {
  const mv = useTable('stock_movements');
  const wh = allWarehouses ? null : activeWarehouse();
  return useMemo(() => stockMap(mv, wh), [mv, wh]);
}

export function useAccounts() {
  const accs = useTable('accounts');
  return useMemo(() => {
    const list = accs.length ? accs : DEFAULT_ACCOUNTS;
    return [...list].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [accs]);
}

export function paymentAccounts(accounts) {
  return accounts.filter(a => a.is_cash || a.is_bank);
}

export function balancesWithAccounts(entries, accounts, range, includeUnknown = false) {
  const bal = accountBalances(entries, range);
  return accounts.map(a => {
    const b = bal[a.code] || { debit: 0, credit: 0 };
    const net = isDebitNormal(a) ? r2(b.debit - b.credit) : r2(b.credit - b.debit);
    return { ...a, debit: b.debit, credit: b.credit, balance: net };
  }).concat(!includeUnknown ? [] : Object.keys(bal).filter(code => !accounts.find(a => a.code === code)).map(code => ({ code, name: `Account ${code}`, type: 'asset', debit: bal[code].debit, credit: bal[code].credit, balance: r2(bal[code].debit - bal[code].credit) })));
}

export function partyBalances(entries) {
  const b = {};
  for (const e of entries) {
    if (e.deleted) continue;
    for (const l of e.lines || []) {
      if (!l.party_id) continue;
      if (l.account === '1100') b[l.party_id] = r2((b[l.party_id] || 0) + l.debit - l.credit);
      if (l.account === '2000') b[l.party_id] = r2((b[l.party_id] || 0) + l.credit - l.debit);
    }
  }
  return b;
}

export function customerPoints(sales, customerId) {
  let p = 0;
  for (const s of sales) if (!s.deleted && s.customer_id === customerId) p += (s.points_earned || 0) - (s.points_redeemed || 0);
  return Math.max(0, Math.floor(p));
}

export function inRange(date, from, to) { return (!from || date >= from) && (!to || date <= to); }
