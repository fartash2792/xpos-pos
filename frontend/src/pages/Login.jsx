import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { login } from '../lib/session.js';
import { useSession } from '../lib/sessionCtx.js';
import { STANDALONE } from '../lib/api.js';

export function AuthShell({ children, title, subtitle }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-600 to-indigo-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 font-bold text-white">XP</div>
          <div><h1 className="text-lg font-bold">{title}</h1><p className="text-sm text-slate-500">{subtitle}</p></div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Login() {
  const { setSession } = useSession();
  const [email, setEmail] = useState(STANDALONE ? 'admin@xpos.local' : '');
  const [password, setPassword] = useState(STANDALONE ? 'admin123' : '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { setSession(await login(email, password)); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell title="XPOS – Smart Multi-Business POS" subtitle={STANDALONE ? 'Standalone offline demo' : 'Sign in to your business'}>
      <form onSubmit={submit} className="space-y-3">
        <div><span className="label">Email</span><input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoFocus /></div>
        <div><span className="label">Password</span><input className="input" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
        {err && <div className="rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{err}</div>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      {!STANDALONE && <p className="mt-4 text-center text-sm text-slate-500">New business? <Link className="font-medium text-brand-600" to="/signup">Create an account</Link></p>}
      <p className="mt-3 text-center text-xs text-slate-400">Works offline after your first sign-in on this device. Demo: admin@xpos.local / admin123</p>
    </AuthShell>
  );
}
