import React, { useEffect, useState } from 'react';

export function Modal({ open, onClose, title, children, wide, footer }) {
  useEffect(() => {
    if (!open) return;
    const h = e => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 sm:p-6" onMouseDown={e => e.target === e.currentTarget && onClose && onClose()}>
      <div className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl dark:bg-slate-900`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h3 className="font-semibold">{title}</h3>
          <button className="text-slate-400 hover:text-slate-700 text-xl leading-none" onClick={onClose}>×</button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}</label>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><h1 className="h1">{title}</h1>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'brand' }) {
  const tones = { brand: 'text-brand-600', green: 'text-emerald-600', red: 'text-rose-600', amber: 'text-amber-600', slate: 'text-slate-700 dark:text-slate-200' };
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Empty({ children = 'Nothing here yet.' }) {
  return <div className="py-10 text-center text-sm text-slate-400">{children}</div>;
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${value === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{t.label}</button>
      ))}
    </div>
  );
}

export function DateRange({ from, to, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <input type="date" className="input w-auto" value={from} onChange={e => onChange({ from: e.target.value, to })} />
      <span className="text-slate-400">–</span>
      <input type="date" className="input w-auto" value={to} onChange={e => onChange({ from, to: e.target.value })} />
    </div>
  );
}

// --- toasts ---
let pushToast = () => {};
export function toast(msg, type = 'success') { pushToast({ id: Math.random(), msg, type }); }
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushToast = t => { setItems(x => [...x, t]); setTimeout(() => setItems(x => x.filter(i => i.id !== t.id)), 3500); };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2">
      {items.map(t => (
        <div key={t.id} className={`rounded-lg px-4 py-2 text-sm text-white shadow-lg ${t.type === 'error' ? 'bg-rose-600' : t.type === 'info' ? 'bg-slate-700' : 'bg-emerald-600'}`}>{t.msg}</div>
      ))}
    </div>
  );
}

export async function attempt(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { console.error(e); toast(e.message || 'Something went wrong', 'error'); return undefined; }
}

export function Badge({ children, tone = 'slate' }) {
  const t = { slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', green: 'bg-emerald-100 text-emerald-700', red: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700', brand: 'bg-brand-100 text-brand-700' };
  return <span className={`badge ${t[tone]}`}>{children}</span>;
}

export function Table({ columns, rows, empty, onRowClick, footer }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr>{columns.map(c => <th key={c.key || c.label} className={c.right ? 'text-right' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i} className={onRowClick ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : ''} onClick={() => onRowClick && onRowClick(r)}>
              {columns.map(c => <td key={c.key || c.label} className={c.right ? 'text-right' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot><tr className="font-semibold">{columns.map((c, i) => <td key={i} className={`px-3 py-2 ${c.right ? 'text-right' : ''}`}>{footer[c.key] ?? ''}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

export function BarChart({ data, height = 180, format = v => v }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map(d => (
        <div key={d.label} className="group flex flex-1 flex-col items-center justify-end" title={`${d.label}: ${format(d.value)}`}>
          <div className="mb-1 hidden text-[10px] text-slate-500 group-hover:block">{format(d.value)}</div>
          <div className="w-full rounded-t bg-brand-500/80 hover:bg-brand-600" style={{ height: `${(d.value / max) * (height - 30)}px`, minHeight: d.value ? 2 : 0 }} />
          <div className="mt-1 truncate text-[10px] text-slate-500">{d.short || d.label}</div>
        </div>
      ))}
    </div>
  );
}
