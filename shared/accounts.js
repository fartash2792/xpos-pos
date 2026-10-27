// Default chart of accounts. Journal lines reference accounts by `code`.
export const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'Cash in Hand', type: 'asset', is_cash: true, system: true },
  { code: '1010', name: 'Bank Account', type: 'asset', is_bank: true, system: true },
  { code: '1020', name: 'Mobile Wallet (JazzCash/Easypaisa)', type: 'asset', is_bank: true, system: true },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', system: true },
  { code: '1200', name: 'Inventory', type: 'asset', system: true },
  { code: '2000', name: 'Accounts Payable', type: 'liability', system: true },
  { code: '2100', name: 'Sales Tax Payable', type: 'liability', system: true },
  { code: '3000', name: "Owner's Capital", type: 'equity', system: true },
  { code: '3100', name: "Owner's Drawings", type: 'equity', system: true },
  { code: '4000', name: 'Sales Revenue', type: 'income', system: true },
  { code: '4100', name: 'Other Income', type: 'income', system: true },
  { code: '4200', name: 'Sales Returns', type: 'income', contra: true, system: true },
  { code: '5000', name: 'Cost of Goods Sold', type: 'expense', system: true },
  { code: '5100', name: 'General Expenses', type: 'expense', system: true },
  { code: '5300', name: 'Inventory Adjustments', type: 'expense', system: true },
  { code: '5400', name: 'Loyalty Rewards', type: 'expense', system: true }
];

export const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash', account: '1000' },
  { key: 'card', label: 'Card', account: '1010' },
  { key: 'bank', label: 'Bank Transfer', account: '1010' },
  { key: 'jazzcash', label: 'JazzCash', account: '1020' },
  { key: 'easypaisa', label: 'Easypaisa', account: '1020' },
  { key: 'credit', label: 'Credit / Due', account: null },
  { key: 'points', label: 'Loyalty Points', account: '5400' }
];

export function methodAccount(method, accountCode) {
  if (accountCode) return accountCode;
  const m = PAYMENT_METHODS.find(x => x.key === method);
  return m ? m.account : '1000';
}

// Normal balance side: assets & expenses are debit-normal (contra income too)
export function isDebitNormal(acc) {
  if (!acc) return true;
  if (acc.contra) return true;
  return acc.type === 'asset' || acc.type === 'expense';
}
