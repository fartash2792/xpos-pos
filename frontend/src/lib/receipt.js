import { money, fmtDate, fmtDateTime, printHtml } from './format.js';
import { PAYMENT_METHODS } from '@shared/accounts.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const methodLabel = m => (PAYMENT_METHODS.find(x => x.key === m) || { label: m }).label;

export function printReceipt(sale, settings = {}, { customer, cashier, size } = {}) {
  const w = Number(size || settings.receipt_size || 80);
  if (w !== 58 && w !== 80) return printA4(sale, settings, { customer, title: 'INVOICE' });
  const no = sale.invoice_no || sale.local_no;
  const items = sale.items.map(i => `
    <tr><td colspan="3">${esc(i.name)}${i.variant_name ? ' (' + esc(i.variant_name) + ')' : ''}${i.serial ? '<br><small>IMEI/SN: ' + esc(i.serial) + '</small>' : ''}${i.batch_no ? '<br><small>Batch ' + esc(i.batch_no) + '</small>' : ''}</td></tr>
    <tr><td>${i.qty} x ${money(i.price, false)}</td><td class="r">${i.discount_amount ? '-' + money(i.discount_amount, false) : ''}</td><td class="r">${money(i.total, false)}</td></tr>`).join('');
  const html = `
    <div class="c">
      ${settings.logo ? `<img src="${settings.logo}" style="max-width:60%;max-height:60px"><br>` : ''}
      <div class="b" style="font-size:1.2em">${esc(settings.name)}</div>
      ${settings.address ? `<div>${esc(settings.address)}</div>` : ''}${settings.phone ? `<div>Ph: ${esc(settings.phone)}</div>` : ''}
      ${settings.ntn ? `<div>NTN: ${esc(settings.ntn)}</div>` : ''}
      ${settings.invoice_header ? `<div>${esc(settings.invoice_header)}</div>` : ''}
    </div><hr>
    <table><tr><td>Invoice: <b>${esc(no)}</b></td></tr><tr><td>${fmtDateTime(sale.at)}</td></tr>
    ${customer ? `<tr><td>Customer: ${esc(customer.name)}</td></tr>` : ''}${cashier ? `<tr><td>Cashier: ${esc(cashier)}</td></tr>` : ''}</table><hr>
    <table>${items}</table><hr>
    <table>
      <tr><td>Subtotal</td><td class="r">${money(sale.subtotal, false)}</td></tr>
      ${sale.discount ? `<tr><td>Discount</td><td class="r">-${money(sale.discount, false)}</td></tr>` : ''}
      ${sale.tax ? `<tr><td>Tax</td><td class="r">${money(sale.tax, false)}</td></tr>` : ''}
      ${sale.shipping ? `<tr><td>Shipping</td><td class="r">${money(sale.shipping, false)}</td></tr>` : ''}
      <tr class="b" style="font-size:1.15em"><td>TOTAL</td><td class="r">${money(sale.total)}</td></tr>
      ${sale.payments.map(p => `<tr><td>${methodLabel(p.method)}</td><td class="r">${money(p.amount, false)}</td></tr>`).join('')}
      ${sale.change ? `<tr><td>Change</td><td class="r">${money(sale.change, false)}</td></tr>` : ''}
      ${sale.due ? `<tr class="b"><td>Balance Due</td><td class="r">${money(sale.due, false)}</td></tr>` : ''}
      ${sale.points_earned ? `<tr><td>Points earned</td><td class="r">${sale.points_earned}</td></tr>` : ''}
    </table><hr>
    <div class="c">${esc(settings.invoice_footer || 'Thank you!')}</div>
    <div class="c muted" style="font-size:0.85em">Powered by XPOS</div>`;
  printHtml(html, { width: w });
}

export function printA4(doc, settings = {}, { customer, supplier, title = 'INVOICE' } = {}) {
  const no = doc.invoice_no || doc.quote_no || doc.local_no || doc.ref_no || '';
  const party = customer || supplier;
  const rows = (doc.items || []).map((i, idx) => `<tr><td>${idx + 1}</td><td>${esc(i.name)}${i.variant_name ? ' (' + esc(i.variant_name) + ')' : ''}${i.serial ? '<br><small>SN: ' + esc(i.serial) + '</small>' : ''}</td><td class="r">${i.qty}</td><td class="r">${money(i.price, false)}</td><td class="r">${money(i.discount_amount || 0, false)}</td><td class="r">${money(i.tax || 0, false)}</td><td class="r">${money(i.total, false)}</td></tr>`).join('');
  const html = `<div class="a4">
    <table><tr><td>${settings.logo ? `<img src="${settings.logo}" style="max-height:70px"><br>` : ''}<h2>${esc(settings.name)}</h2>${esc(settings.address)}<br>${esc(settings.phone)}${settings.ntn ? '<br>NTN: ' + esc(settings.ntn) : ''}</td>
    <td class="r" style="vertical-align:top"><h1>${title}</h1><b># ${esc(no)}</b><br>Date: ${fmtDate(doc.date)}${doc.valid_until ? '<br>Valid until: ' + fmtDate(doc.valid_until) : ''}</td></tr></table>
    ${party ? `<p><b>${supplier ? 'Supplier' : 'Bill To'}:</b> ${esc(party.name)}<br>${esc(party.phone || '')} ${esc(party.address || '')}</p>` : ''}
    <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Disc</th><th class="r">Tax</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <table style="width:45%;margin-left:55%;margin-top:10px">
      <tr><td>Subtotal</td><td class="r">${money(doc.subtotal)}</td></tr>
      ${doc.discount ? `<tr><td>Discount</td><td class="r">-${money(doc.discount)}</td></tr>` : ''}
      <tr><td>Tax</td><td class="r">${money(doc.tax || 0)}</td></tr>
      ${doc.shipping ? `<tr><td>Shipping</td><td class="r">${money(doc.shipping)}</td></tr>` : ''}
      <tr class="b"><td>Total</td><td class="r">${money(doc.total)}</td></tr>
      ${doc.paid != null ? `<tr><td>Paid</td><td class="r">${money(doc.paid)}</td></tr><tr class="b"><td>Due</td><td class="r">${money(doc.due || 0)}</td></tr>` : ''}
    </table>
    ${doc.note ? `<p><b>Note:</b> ${esc(doc.note)}</p>` : ''}
    <p class="c muted" style="margin-top:30px">${esc(settings.invoice_footer || '')}</p></div>`;
  printHtml(html);
}
