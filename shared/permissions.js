export const ROLES = ['owner', 'manager', 'cashier'];

// Permission keys used by UI nav + server write checks
export const PERMISSIONS = {
  owner: ['*'],
  manager: ['dashboard', 'pos', 'sales', 'quotations', 'products', 'inventory', 'purchases', 'parties',
    'accounts', 'expenses', 'reports', 'shifts', 'audit'],
  cashier: ['pos', 'sales', 'quotations', 'parties', 'shifts']
};

export function can(role, perm) {
  const p = PERMISSIONS[role] || [];
  return p.includes('*') || p.includes(perm);
}

// Which entities each role may write through sync
const CASHIER_WRITES = ['sales', 'sale_returns', 'quotations', 'held_sales', 'customers', 'payments',
  'stock_movements', 'journal_entries', 'shifts', 'audit_logs', 'serials'];
export function canWriteEntity(role, entity) {
  if (role === 'owner') return true;
  if (role === 'manager') return !['settings', 'users'].includes(entity);
  return CASHIER_WRITES.includes(entity);
}
