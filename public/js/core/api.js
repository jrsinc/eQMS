/* Calls to the server API. */
'use strict';
// ---------- API ----------
async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(ME ? { 'X-CSRF-Token': ME.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  resetIdle();
  if (r.status === 401 && url !== '/api/login') { ME = null; renderLogin('Your session ended. Sign in again.'); throw new Error('Session expired'); }
  const ct = r.headers.get('content-type') || '';
  const out = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) { const e = new Error(out.error || 'Request failed (' + r.status + ')'); e.missing = out.missing || []; throw e; }
  return out;
}

