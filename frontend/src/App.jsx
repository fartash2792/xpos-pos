import React, { useEffect, useState } from 'react';
import { SessionCtx, useSession } from './lib/sessionCtx.js';
import { HashRouter, Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { getSession, applySessionCtx, logout, ensureWarehouse } from './lib/session.js';
import { startSync, subscribe, syncNow } from './lib/sync.js';
import { useSettings, usePendingCount, useTable, activeWarehouse, setActiveWarehouse } from './lib/db.js';
import { setCurrency, fmtDateTime } from './lib/format.js';
import { STANDALONE } from './lib/api.js';
import { can } from '@shared/permissions.js';
import { Toaster } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import POS from './pages/POS.jsx';
import Sales from './pages/Sales.jsx';
import Quotations from './pages/Quotations.jsx';
import Products from './pages/Products.jsx';
import Inventory from './pages/Inventory.jsx';
import Purchases from './pages/Purchases.jsx';
import Parties from './pages/Parties.jsx';
import Accounts from './pages/Accounts.jsx';
import Shifts from './pages/Shifts.jsx';
import Expenses from './pages/Expenses.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';


const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', perm: 'dashboard' },
  { to: '/pos', label: 'POS Counter', icon: '🛒', perm: 'pos' },
  { to: '/sales', label: 'Sales & Returns', icon: '🧾', perm: 'sales' },
  { to: '/quotations', label: 'Quotations', icon: '📝', perm: 'quotations' },
  { to: '/products', label: 'Products', icon: '📦', perm: 'products' },
  { to: '/inventory', label: 'Inventory', icon: '🏬', perm: 'inventory' },
  { to: '/purchases', label: 'Purchases', icon: '🚚', perm: 'purchases' },
  { to: '/customers', label: 'Customers', icon: '👥', perm: 'parties' },
  { to: '/suppliers', label: 'Suppliers', icon: '🏭', perm: 'parties' },
  { to: '/accounts', label: 'Accounts', icon: '📒', perm: 'accounts' },
  { to: '/expenses', label: 'Expenses & Income', icon: '💸', perm: 'expenses' },
  { to: '/shifts', label: 'Cash Register', icon: '🗄️', perm: 'shifts' },
  { to: '/reports', label: 'Reports', icon: '📈', perm: 'reports' },
  { to: '/settings', label: 'Settings', icon: '⚙️', perm: 'settings' }
];

function SyncIndicator() {
  const [st, setSt] = useState({});
  const pending = usePendingCount();
  useEffect(() => subscribe(setSt), []);
  if (STANDALONE) return <span className="badge bg-amber-100 text-amber-800" title="Standalone demo: data stays in this browser">● Local-only mode</span>;
  const live = st.online && st.serverReachable;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`badge ${live ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>● {live ? 'Online' : 'Offline'}</span>
      <span className={`badge ${pending ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>{pending} pending</span>
      <span className="hidden text-slate-500 md:inline">{st.lastSynced ? `Synced ${fmtDateTime(st.lastSynced)}` : 'Never synced'}</span>
      <button className="btn-secondary btn-sm" disabled={st.syncing} onClick={() => syncNow()}>{st.syncing ? 'Syncing…' : '⟳ Sync now'}</button>
      {st.error && <span className="max-w-[220px] truncate text-rose-600" title={st.error}>{st.error}</span>}
    </div>
  );
}

function Layout({ children }) {
  const { session, setSession } = useSession();
  const settings = useSettings();
  const warehouses = useTable('warehouses');
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'));
  const [wh, setWh] = useState(activeWarehouse());
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => setCurrency(settings), [settings.currency, settings.currency_symbol]);
  useEffect(() => setOpen(false), [loc.pathname]);
  const role = session.user.role;
  const toggleDark = () => { const d = !dark; setDark(d); document.documentElement.classList.toggle('dark', d); localStorage.setItem('xpos_dark', d ? '1' : '0'); };
  return (
    <div className="flex min-h-screen">
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 transform border-r border-slate-200 bg-white transition dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">XP</div>
          <div className="min-w-0"><div className="truncate text-sm font-semibold">{settings.name || 'XPOS'}</div><div className="text-[11px] capitalize text-slate-500">{role}</div></div>
        </div>
        <nav className="h-[calc(100vh-3.5rem)] space-y-0.5 overflow-y-auto p-2">
          {NAV.filter(n => can(role, n.perm)).map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-100' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              <span>{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <button className="btn-secondary btn-sm lg:hidden" onClick={() => setOpen(true)}>☰</button>
          <SyncIndicator />
          <div className="ml-auto flex items-center gap-2">
            {warehouses.length > 1 && (
              <select className="input w-auto py-1 text-xs" value={wh || ''} onChange={e => { setActiveWarehouse(e.target.value); setWh(e.target.value); }} title="Active branch / warehouse">
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            )}
            <button className="btn-secondary btn-sm" onClick={toggleDark} title="Dark mode">{dark ? '☀️' : '🌙'}</button>
            <span className="hidden text-sm text-slate-600 dark:text-slate-300 sm:inline">{session.user.name}</span>
            <button className="btn-secondary btn-sm" onClick={() => { logout(); setSession(null); nav('/login'); }}>Logout</button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-3 sm:p-5">{children}</main>
      </div>
    </div>
  );
}

function Guard({ perm, children }) {
  const { session } = useSession();
  if (!can(session.user.role, perm)) return <div className="card text-sm text-slate-500">You don't have permission to open this page.</div>;
  return children;
}

export default function App() {
  const [session, setSessionState] = useState(() => { const s = getSession(); applySessionCtx(s); return s; });
  const setSession = s => { applySessionCtx(s); setSessionState(s); };
  useEffect(() => { if (session) { ensureWarehouse(); startSync(); } }, [session && session.user.id]);
  const home = session && !can(session.user.role, 'dashboard') ? '/pos' : '/';
  return (
    <SessionCtx.Provider value={{ session, setSession }}>
      <HashRouter>
        <Toaster />
        {!session ? (
          <Routes>
            <Route path="/signup" element={<Signup />} />
            <Route path="*" element={<Login />} />
          </Routes>
        ) : (
          <Layout>
            <Routes>
              <Route path="/" element={can(session.user.role, 'dashboard') ? <Dashboard /> : <Navigate to="/pos" />} />
              <Route path="/pos" element={<Guard perm="pos"><POS /></Guard>} />
              <Route path="/sales" element={<Guard perm="sales"><Sales /></Guard>} />
              <Route path="/quotations" element={<Guard perm="quotations"><Quotations /></Guard>} />
              <Route path="/products" element={<Guard perm="products"><Products /></Guard>} />
              <Route path="/inventory" element={<Guard perm="inventory"><Inventory /></Guard>} />
              <Route path="/purchases" element={<Guard perm="purchases"><Purchases /></Guard>} />
              <Route path="/customers" element={<Guard perm="parties"><Parties type="customer" /></Guard>} />
              <Route path="/suppliers" element={<Guard perm="parties"><Parties type="supplier" /></Guard>} />
              <Route path="/accounts" element={<Guard perm="accounts"><Accounts /></Guard>} />
              <Route path="/expenses" element={<Guard perm="expenses"><Expenses /></Guard>} />
              <Route path="/shifts" element={<Guard perm="shifts"><Shifts /></Guard>} />
              <Route path="/reports" element={<Guard perm="reports"><Reports /></Guard>} />
              <Route path="/settings" element={<Guard perm="settings"><Settings /></Guard>} />
              <Route path="*" element={<Navigate to={home} />} />
            </Routes>
          </Layout>
        )}
      </HashRouter>
    </SessionCtx.Provider>
  );
}
