// Generates the starter records for a new business (and optional demo data).
// Used by the server on signup/seed and by the standalone offline demo build.
import { uuid } from './uuid.js';
import { DEFAULT_ACCOUNTS } from './accounts.js';
import { buildOpening, buildOpeningStock, today } from './posting.js';

export const CATEGORIES = {
  retail: 'Retail / General Store', wholesale: 'Wholesale', pharmacy: 'Pharmacy', bakery: 'Bakery',
  clothing: 'Clothing / Boutique', mobile: 'Mobile Shop', restaurant: 'Restaurant / Cafe', other: 'Other'
};

function merge(out, part) {
  for (const [k, v] of Object.entries(part || {})) { out[k] = out[k] || []; out[k].push(...v); }
  return out;
}

export function createBusinessData({ business_id, user_id, profile = {}, demo = false }) {
  const now = Date.now();
  const rec = o => ({ id: uuid(), business_id, updated_at: now, deleted: false, ...o });
  const ctx = { business_id, user_id };
  const out = {};
  const wh = rec({ name: 'Main Branch', code: 'MAIN', address: profile.address || '', is_default: true });
  out.warehouses = [wh];
  out.settings = [{
    id: business_id, business_id, updated_at: now, deleted: false,
    name: profile.name || 'My Business', category: profile.category || 'retail', phone: profile.phone || '',
    address: profile.address || '', email: profile.email || '', ntn: '', logo: '',
    currency: profile.currency || 'PKR', currency_symbol: profile.currency_symbol || 'Rs',
    receipt_size: '80', invoice_footer: 'Thank you for shopping with us!', invoice_header: '',
    default_tax_rate: 0, prices_include_tax: false, low_stock_default: 5,
    loyalty: { enabled: true, earn_per: 100, point_value: 1 }, pin_required_for_pos: true,
    opening_balance: Number(profile.opening_balance) || 0, invoice_prefix: 'INV-'
  }];
  out.accounts = DEFAULT_ACCOUNTS.map(a => rec({ ...a }));
  out.units = ['pcs', 'kg', 'g', 'ltr', 'box', 'dozen', 'pack', 'strip', 'meter'].map(n => rec({ name: n }));
  out.tax_rates = [rec({ name: 'No Tax', rate: 0 }), rec({ name: 'GST 18%', rate: 18 }), rec({ name: 'GST 5%', rate: 5 })];
  out.expense_categories = ['Rent', 'Electricity', 'Salaries', 'Transport', 'Tea & Refreshments', 'Maintenance', 'Misc'].map(n => rec({ name: n, account_code: '5100' }));
  out.customers = [rec({ name: 'Walk-in Customer', phone: '', is_walkin: true, credit_limit: 0, opening_balance: 0 })];
  merge(out, buildOpening({ amount: profile.opening_balance, ctx }));

  if (demo) {
    const cats = ['Grocery', 'Beverages', 'Medicine', 'Bakery', 'Clothing', 'Mobiles'].map(n => rec({ name: n }));
    const brands = ['Nestle', 'Shan', 'GSK', 'Bake House', 'Khaadi', 'Samsung'].map(n => rec({ name: n }));
    out.categories = cats; out.brands = brands;
    const C = n => cats.find(c => c.name === n).id;
    const B = n => brands.find(b => b.name === n).id;
    const P = (o) => rec({ sku: '', barcode: '', unit: 'pcs', tax_rate: 0, wholesale_price: 0, alert_qty: 5, track_batch: false, track_serial: false, variants: [], description: '', active: true, ...o });
    const products = [
      P({ name: 'Nestle Milk Pack 1L', sku: 'NM-1L', barcode: '8901234500011', category_id: C('Beverages'), brand_id: B('Nestle'), cost_price: 260, sale_price: 290, wholesale_price: 275 }),
      P({ name: 'Shan Biryani Masala', sku: 'SH-BIR', barcode: '8901234500028', category_id: C('Grocery'), brand_id: B('Shan'), cost_price: 120, sale_price: 150, wholesale_price: 135 }),
      P({ name: 'Basmati Rice 5kg', sku: 'RICE-5', barcode: '8901234500035', category_id: C('Grocery'), cost_price: 1500, sale_price: 1750, wholesale_price: 1650, unit: 'pack' }),
      P({ name: 'Mineral Water 1.5L', sku: 'WAT-15', barcode: '8901234500042', category_id: C('Beverages'), brand_id: B('Nestle'), cost_price: 70, sale_price: 100, wholesale_price: 85 }),
      P({ name: 'Panadol 500mg (strip)', sku: 'PAN-500', barcode: '8901234500059', category_id: C('Medicine'), brand_id: B('GSK'), cost_price: 25, sale_price: 35, unit: 'strip', track_batch: true }),
      P({ name: 'Cake Rusk 200g', sku: 'RUSK-200', barcode: '8901234500066', category_id: C('Bakery'), brand_id: B('Bake House'), cost_price: 140, sale_price: 180, tax_rate: 0 }),
      P({ name: 'Lawn Shirt', sku: 'LAWN-SH', barcode: '8901234500073', category_id: C('Clothing'), brand_id: B('Khaadi'), cost_price: 1800, sale_price: 2900, tax_rate: 0 }),
      P({ name: 'Samsung Galaxy A15', sku: 'SAM-A15', barcode: '8901234500080', category_id: C('Mobiles'), brand_id: B('Samsung'), cost_price: 42000, sale_price: 47999, track_serial: true, alert_qty: 2, tax_rate: 0 }),
      P({ name: 'Cooking Oil 1L', sku: 'OIL-1L', barcode: '8901234500097', category_id: C('Grocery'), cost_price: 480, sale_price: 540, wholesale_price: 510, tax_rate: 18 })
    ];
    const shirt = products[6];
    shirt.variants = ['S', 'M', 'L'].map((s, i) => ({ id: uuid(), name: `${s} / Blue`, size: s, color: 'Blue', sku: `LAWN-SH-${s}`, barcode: `89012345001${i}0`, price: 2900 }));
    out.products = products;
    const opening = [[0, 40], [1, 60], [2, 15], [3, 100], [5, 25], [7, 3], [8, 20]];
    for (const [i, q] of opening) merge(out, buildOpeningStock({ product: products[i], qty: q, warehouse_id: wh.id, ctx }));
    merge(out, buildOpeningStock({ product: products[4], qty: 50, warehouse_id: wh.id, ctx, batch_no: 'PN2401', expiry: '2027-03-31' }));
    merge(out, buildOpeningStock({ product: products[4], qty: 30, warehouse_id: wh.id, ctx, batch_no: 'PN2312', expiry: '2026-12-15' }));
    for (const v of shirt.variants) merge(out, buildOpeningStock({ product: shirt, variant_id: v.id, qty: 8, warehouse_id: wh.id, ctx }));
    out.serials = ['356789100000011', '356789100000029', '356789100000037'].map(s => rec({ product_id: products[7].id, serial: s, status: 'in_stock', warehouse_id: wh.id, cost: 42000 }));
    const cust = [
      rec({ name: 'Ahmed Traders', phone: '03001234567', address: 'Hussain Agahi, Multan', credit_limit: 50000, opening_balance: 5000 }),
      rec({ name: 'Sara Khan', phone: '03111234567', address: 'Gulgasht, Multan', credit_limit: 10000, opening_balance: 0 })
    ];
    out.customers.push(...cust);
    merge(out, buildOpening({ amount: 5000, ctx, party: { party_id: cust[0].id, party_type: 'customer' } }));
    const sup = [
      rec({ name: 'Metro Distributors', phone: '0612345678', address: 'Multan', opening_balance: 0 }),
      rec({ name: 'Pharma Supply Co', phone: '0421234567', address: 'Lahore', opening_balance: 0 })
    ];
    out.suppliers = sup;
    out.settings[0].name = profile.name || 'XPOS Demo Store';
  }
  for (const k of Object.keys(out)) for (const r of out[k]) { r.business_id = business_id; if (!r.date && k === 'journal_entries') r.date = today(); }
  return out;
}
