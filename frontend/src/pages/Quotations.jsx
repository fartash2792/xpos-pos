import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTable, useSettings, remove } from '../lib/db.js';
import { money, fmtDate } from '../lib/format.js';
import { printA4 } from '../lib/receipt.js';
import { PageHeader, Table, Badge } from '../components/ui.jsx';

export default function Quotations() {
  const settings = useSettings();
  const quotes = useTable('quotations');
  const customers = useTable('customers');
  const nav = useNavigate();
  const cmap = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);
  const rows = [...quotes].sort((a, b) => b.at - a.at);
  const convert = q => {
    sessionStorage.setItem('xpos_pos_load', JSON.stringify({ items: q.items, invoice: { ...(q.invoice || {}), customer_id: q.customer_id || '' }, quotation_id: q.id }));
    nav('/pos');
  };
  return (
    <div>
      <PageHeader title="Quotations" subtitle="Create quotations from the POS counter (Quote button), then convert them to sales here." />
      <div className="card p-0">
        <Table rows={rows} empty="No quotations yet" columns={[
          { label: 'No.', render: r => r.quote_no || r.local_no }, { label: 'Date', render: r => fmtDate(r.date) },
          { label: 'Valid until', render: r => fmtDate(r.valid_until) }, { label: 'Customer', render: r => cmap[r.customer_id]?.name || 'Walk-in' },
          { label: 'Total', right: true, render: r => money(r.total) },
          { label: 'Status', render: r => <Badge tone={r.status === 'converted' ? 'green' : r.valid_until < new Date().toISOString().slice(0, 10) ? 'red' : 'brand'}>{r.status}</Badge> },
          { label: '', render: r => <div className="flex justify-end gap-1">
            <button className="btn-secondary btn-sm" onClick={() => printA4(r, settings, { customer: cmap[r.customer_id], title: 'QUOTATION' })}>Print</button>
            {r.status !== 'converted' && <button className="btn-primary btn-sm" onClick={() => convert(r)}>Convert to sale</button>}
            <button className="btn-secondary btn-sm" onClick={() => confirm('Delete quotation?') && remove('quotations', r.id)}>Delete</button>
          </div> }
        ]} />
      </div>
    </div>
  );
}
