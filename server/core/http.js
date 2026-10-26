/* HTTP helpers: errors, responses, request bodies, route table. */
'use strict';

// ---------- helpers ----------
class HttpError extends Error { constructor(code, msg, extra) { super(msg); this.code = code; this.extra = extra; } }
const fail = (code, msg, extra) => { throw new HttpError(code, msg, extra); };
// all empty required fields at once, so the user sees everything still pending (the UI highlights them)
const failMissing = (fields, what) => fail(400, `${what}: ${fields.map(f => f.label.split(' (')[0]).join('; ')}.`, { missing: fields.map(f => f.k) });
function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', ...SEC_HEADERS, ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'"
};
function readBody(req, limit = 30 * 1024 * 1024, raw = false) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (raw) return resolve(Buffer.concat(chunks)); try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}

// ---------- API ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts });

module.exports = { HttpError, fail, failMissing, send, SEC_HEADERS, readBody, routes, route };
