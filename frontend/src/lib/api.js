// Relative "api/" so the app also works when deployed under a sub-path (cPanel).
export const STANDALONE = typeof __STANDALONE__ !== 'undefined' && __STANDALONE__;

export class NetworkError extends Error {}

export async function api(path, { method = 'GET', body, token, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch('api/' + path.replace(/^\/?(api\/)?/, ''), {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new NetworkError('Server unreachable');
  } finally { clearTimeout(t); }
  let data = null;
  try { data = await res.json(); } catch (e) { /* non json */ }
  if (!res.ok) {
    if (res.status >= 502 && res.status <= 504) throw new NetworkError('Server unreachable');
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}
