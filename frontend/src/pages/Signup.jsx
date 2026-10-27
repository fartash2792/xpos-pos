import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { signup } from '../lib/session.js';
import { useSession } from '../lib/sessionCtx.js';
import { AuthShell } from './Login.jsx';
import { CATEGORIES } from '@shared/seed.js';

export default function Signup() {
  const { setSession } = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [f, setF] = useState({ name: '', email: '', password: '', bname: '', category: 'retail', phone: '', address: '', opening_balance: 0, currency: 'PKR', currency_symbol: 'Rs', demo: false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const submit = async e => {
    e.preventDefault(); setErr('');
    if (step === 1) { if (f.password.length < 6) return setErr('Password must be at least 6 characters'); return setStep(2); }
    setBusy(true);
    try {
      const s = await signup({ name: f.name, email: f.email, password: f.password, demo: f.demo, business: { name: f.bname, category: f.category, phone: f.phone, address: f.address, opening_balance: Number(f.opening_balance) || 0, currency: f.currency, currency_symbol: f.currency_symbol } });
      setSession(s); nav('/');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="Create your XPOS account" subtitle={step === 1 ? 'Step 1 of 2 — your login' : 'Step 2 of 2 — business profile'}>
      <form onSubmit={submit} className="space-y-3">
        {step === 1 ? (
          <>
            <div><span className="label">Your name</span><input className="input" required value={f.name} onChange={e => up('name', e.target.value)} /></div>
            <div><span className="label">Email</span><input className="input" type="email" required value={f.email} onChange={e => up('email', e.target.value)} /></div>
            <div><span className="label">Password</span><input className="input" type="password" required value={f.password} onChange={e => up('password', e.target.value)} /></div>
          </>
        ) : (
          <>
            <div><span className="label">Business name</span><input className="input" required value={f.bname} onChange={e => up('bname', e.target.value)} /></div>
            <div><span className="label">Business type</span>
              <select className="input" value={f.category} onChange={e => up('category', e.target.value)}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="label">Phone</span><input className="input" value={f.phone} onChange={e => up('phone', e.target.value)} /></div>
              <div><span className="label">Opening cash balance</span><input className="input" type="number" value={f.opening_balance} onChange={e => up('opening_balance', e.target.value)} /></div>
            </div>
            <div><span className="label">Address</span><input className="input" value={f.address} onChange={e => up('address', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="label">Currency code</span><input className="input" value={f.currency} onChange={e => up('currency', e.target.value)} /></div>
              <div><span className="label">Symbol</span><input className="input" value={f.currency_symbol} onChange={e => up('currency_symbol', e.target.value)} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.demo} onChange={e => up('demo', e.target.checked)} /> Load sample products & customers</label>
          </>
        )}
        {err && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{err}</div>}
        <div className="flex gap-2">
          {step === 2 && <button type="button" className="btn-secondary" onClick={() => setStep(1)}>Back</button>}
          <button className="btn-primary flex-1" disabled={busy}>{step === 1 ? 'Continue' : busy ? 'Creating…' : 'Create business'}</button>
        </div>
      </form>
      <p className="mt-4 text-center text-sm text-slate-500">Have an account? <Link className="font-medium text-brand-600" to="/login">Sign in</Link></p>
    </AuthShell>
  );
}
