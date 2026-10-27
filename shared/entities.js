// Every synced entity. Each becomes a server table and an IndexedDB store.
// Common fields on every record: id (uuid), business_id, updated_at (ms), deleted (bool)
export const ENTITIES = [
  'settings', 'warehouses', 'categories', 'brands', 'units', 'tax_rates',
  'products', 'serials', 'customers', 'suppliers', 'accounts',
  'sales', 'sale_returns', 'purchases', 'purchase_returns', 'quotations', 'held_sales',
  'payments', 'expenses', 'incomes', 'expense_categories', 'transfers',
  'stock_movements', 'stock_transfers', 'stock_adjustments',
  'journal_entries', 'shifts', 'audit_logs', 'users'
];

// Entities only the server writes (clients pull them read-only)
export const SERVER_ONLY = ['users'];

// Extra Dexie indexes per entity (besides id, updated_at, deleted)
export const INDEXES = {
  stock_movements: 'product_id, warehouse_id, ref_id, date',
  journal_entries: 'date, ref_id',
  sales: 'date, customer_id, invoice_no',
  purchases: 'date, supplier_id',
  serials: 'product_id, serial',
  payments: 'party_id, date',
  audit_logs: 'at',
  products: 'barcode, sku'
};
