/* QualiSuite eQMS server — Node.js >= 22.13, no npm dependencies.
 * Provides: authentication, role-based access, record workflows, e-signatures,
 * hash-chained audit trail, attachments with SHA-256, kit randomization,
 * label print logging, SharePoint (Microsoft Graph) publishing, static UI. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { MODULES, ROLES } = require('./public/modules.js');

// ---------- configuration ----------
loadEnv(path.join(__dirname, '.env'));
const CFG = {
  port: +process.env.PORT || 8080,
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  idleMinutes: +process.env.SESSION_IDLE_MINUTES || 15,
  maxFailed: 5,
  orgName: process.env.ORG_NAME || 'Your Organisation',
  sp: {
    tenant: process.env.SP_TENANT_ID, clientId: process.env.SP_CLIENT_ID,
    secret: process.env.SP_CLIENT_SECRET, siteId: process.env.SP_SITE_ID,
    folder: process.env.SP_FOLDER || 'Effective Documents'
  }
};
fs.mkdirSync(CFG.dataDir, { recursive: true });
const PUBLIC = path.join(__dirname, 'public');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ---------- database ----------
const db = new DatabaseSync(path.join(CFG.dataDir, 'qms.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY, fullname TEXT NOT NULL, email TEXT, roles TEXT NOT NULL,
  pw_hash TEXT NOT NULL, failed INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  must_change INTEGER DEFAULT 1, esig_accepted TEXT, last_login TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, number TEXT NOT NULL, title TEXT, status TEXT NOT NULL,
  data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_rec_type ON records(type);
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, username TEXT NOT NULL, fullname TEXT NOT NULL,
  meaning TEXT NOT NULL, from_state TEXT, to_state TEXT, ts TEXT NOT NULL, content_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, record_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER,
  sha256 TEXT NOT NULL, blob BLOB NOT NULL, uploaded_by TEXT NOT NULL, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rand_lists (
  record_id TEXT PRIMARY KEY, list TEXT NOT NULL, seed TEXT NOT NULL, generated_by TEXT NOT NULL, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, username TEXT, fullname TEXT, action TEXT NOT NULL,
  record_id TEXT, record_number TEXT, field TEXT, old_value TEXT, new_value TEXT, reason TEXT,
  ip TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit trail is read-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit trail is read-only'); END;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const uid = () => crypto.randomUUID();

// ---------- passwords ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [, salt, h] = String(stored).split('$');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function pwPolicy(pw) {
  if (!pw || pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password needs upper case, lower case and a number.';
  return null;
}

// ---------- audit trail (hash-chained, append-only) ----------
function audit(user, action, rec, field, oldV, newV, reason, ip) {
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get();
  const prev = last ? last.hash : 'GENESIS';
  const e = {
    ts: now(), username: user ? user.username : 'system', fullname: user ? user.fullname : 'System', action,
    record_id: rec ? rec.id : null, record_number: rec ? rec.number : null, field: field || null,
    old_value: oldV == null ? null : String(oldV), new_value: newV == null ? null : String(newV),
    reason: reason || null, ip: ip || null
  };
  const hash = sha256(prev + JSON.stringify(e));
  db.prepare(`INSERT INTO audit (ts,username,fullname,action,record_id,record_number,field,old_value,new_value,reason,ip,prev_hash,hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.ts, e.username, e.fullname, e.action, e.record_id, e.record_number,
    e.field, e.old_value, e.new_value, e.reason, e.ip, prev, hash);
}
function verifyAudit() {
  let prev = 'GENESIS', n = 0;
  for (const r of db.prepare('SELECT * FROM audit ORDER BY id').iterate()) {
    const e = { ts: r.ts, username: r.username, fullname: r.fullname, action: r.action, record_id: r.record_id,
      record_number: r.record_number, field: r.field, old_value: r.old_value, new_value: r.new_value, reason: r.reason, ip: r.ip };
    if (r.prev_hash !== prev || sha256(prev + JSON.stringify(e)) !== r.hash) return { ok: false, brokenAt: r.id, checked: n };
    prev = r.hash; n++;
  }
  return { ok: true, checked: n };
}

// ---------- seed admin ----------
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const pw = process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMe-2026!';
  db.prepare('INSERT INTO users (username,fullname,email,roles,pw_hash,must_change,created_at) VALUES (?,?,?,?,?,1,?)')
    .run('admin', 'System Administrator', '', JSON.stringify(['admin']), hashPw(pw), now());
  audit(null, 'User created', null, 'username', null, 'admin', 'Initial installation');
  console.log('Created initial user "admin". Initial password: ' + (process.env.ADMIN_INITIAL_PASSWORD ? '(from ADMIN_INITIAL_PASSWORD)' : pw));
}
if (process.env.SEED_DEMO === 'true' && !db.prepare("SELECT 1 FROM users WHERE username='qa.lead'").get()) seedDemo();

function seedDemo() {
  const demo = [
    ['qa.lead', 'Priya Raman (QA Head / QP)', ['qa']], ['qa.reviewer', 'Tom Becker (QA Reviewer)', ['qa', 'auditor']],
    ['author1', 'Lena Ortiz (Document Author)', ['author', 'sme']], ['cs.manager', 'Sam Okafor (Clinical Supply)', ['cs', 'author']],
    ['stat1', 'Mei Chen (Unblinded Statistician)', ['unblinded']], ['rp1', 'Jonas Weber (Responsible Person)', ['rp']],
    ['trainer1', 'Ana Silva (Training Coordinator)', ['trainer']], ['operator1', 'Ravi Patel (Operator)', ['user']]
  ];
  for (const [u, n, r] of demo) db.prepare('INSERT INTO users (username,fullname,roles,pw_hash,must_change,created_at) VALUES (?,?,?,?,0,?)')
    .run(u, n, JSON.stringify(r), hashPw('Demo-Pass-2026'), now());
  audit(null, 'Demo users created', null, null, null, demo.map(d => d[0]).join(', '), 'SEED_DEMO=true');
  console.log('Demo users created with password Demo-Pass-2026 (disable SEED_DEMO in production).');
}

// ---------- sessions ----------
const sessions = new Map();
function getUser(req) {
  const m = /(?:^|;\s*)qms_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s) return null;
  if (Date.now() - s.last > CFG.idleMinutes * 60000) { sessions.delete(m[1]); return null; }
  s.last = Date.now();
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1 AND locked=0').get(s.username);
  if (!u) return null;
  u.roles = JSON.parse(u.roles); u.sid = m[1]; u.csrf = s.csrf;
  return u;
}
const hasRole = (u, roles) => roles.includes('any') || u.roles.some(r => roles.includes(r)) || (u.roles.includes('qa') && roles.includes('qa'));
const pub = (u) => ({ username: u.username, fullname: u.fullname, email: u.email, roles: u.roles, mustChange: !!u.must_change, esigAccepted: !!u.esig_accepted, csrf: u.csrf });

// ---------- helpers ----------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (code, msg) => { throw new HttpError(code, msg); };
function send(res, code, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8', ...SEC_HEADERS, ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'"
};
function readBody(req, limit = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}
function rowToRecord(r) { return r && { ...r, data: JSON.parse(r.data) }; }
function getRecord(id) { const r = rowToRecord(db.prepare('SELECT * FROM records WHERE id=? AND deleted=0').get(id)); if (!r) fail(404, 'Record not found'); return r; }
const contentHash = (rec) => { const { printLog, ...d } = rec.data; return sha256(JSON.stringify({ id: rec.id, data: d })); };
function nextNumber(mod) {
  const y = new Date().getFullYear(), pre = MODULES[mod].prefix + '-' + y + '-';
  const r = db.prepare("SELECT number FROM records WHERE number LIKE ? ORDER BY number DESC LIMIT 1").get(pre + '%');
  const n = r ? parseInt(r.number.slice(pre.length), 10) + 1 : 1;
  return pre + String(n).padStart(4, '0');
}
function applyComputed(mod, data) {
  const c = MODULES[mod].compute || {};
  for (const k of Object.keys(c)) data[k] = c[k](data);
}
function sanitize(mod, input) {
  const out = {};
  for (const f of MODULES[mod].fields) {
    if (!(f.k in input) || f.type === 'computed' || f.type === 'readonly') continue;
    let v = input[f.k];
    if (f.type === 'number') v = v === '' || v == null ? '' : Number(v);
    else if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'multicheck') v = Array.isArray(v) ? v.filter(x => f.options.includes(x)) : [];
    else v = v == null ? '' : String(v).slice(0, 20000);
    if (f.type === 'select' && v && !f.options.includes(v)) fail(400, `Invalid value for ${f.label}`);
    out[f.k] = v;
  }
  return out;
}
const fmt = (v) => Array.isArray(v) ? v.join('; ') : v === true ? 'Yes' : v === false ? 'No' : v;
const LOCKED = new Set(['Effective', 'Superseded', 'Obsolete', 'Completed', 'Closed', 'Cancelled', 'Approved', 'Released',
  'Rejected', 'QP Certified', 'Released to IRT', 'Withdrawn', 'Retired', 'Disqualified', 'Failed', 'Reconciled', 'Voided']);
const EDITABLE_ALWAYS = new Set(['vendors', 'customers', 'risks']);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

function verifySignature(user, body) {
  if (!user.esig_accepted) fail(403, 'Accept the electronic signature statement before signing.');
  if (body.sigUsername !== user.username) fail(403, 'Signature user ID must match the logged-in user.');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(user.username);
  if (!checkPw(String(body.password || ''), u.pw_hash)) {
    const failed = u.failed + 1;
    db.prepare('UPDATE users SET failed=?, locked=? WHERE username=?').run(failed, failed >= CFG.maxFailed ? 1 : 0, u.username);
    audit(user, 'E-signature failed', null, null, null, null, 'Wrong password');
    fail(422, failed >= CFG.maxFailed ? 'Account locked after repeated failures. Contact your administrator.' : 'Password incorrect. Signature not applied.');
  }
  db.prepare('UPDATE users SET failed=0 WHERE username=?').run(u.username);
}
function sign(user, rec, meaning, from, to) {
  db.prepare('INSERT INTO signatures (record_id,username,fullname,meaning,from_state,to_state,ts,content_hash) VALUES (?,?,?,?,?,?,?,?)')
    .run(rec.id, user.username, user.fullname, meaning, from, to, now(), contentHash(rec));
}
function saveRecord(rec) {
  db.prepare('UPDATE records SET title=?, status=?, data=?, updated_at=? WHERE id=?').run(rec.data.title || '', rec.status, JSON.stringify(rec.data), now(), rec.id);
}
function createRecord(user, type, data, ip, reasonText) {
  const mod = MODULES[type];
  for (const f of mod.fields) if (data[f.k] === undefined && f.def !== undefined) data[f.k] = f.def;
  applyComputed(type, data);
  const rec = { id: uid(), type, number: data.__number || nextNumber(type), status: mod.states[0], data };
  delete data.__number;
  db.prepare('INSERT INTO records (id,type,number,title,status,data,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(rec.id, type, rec.number, data.title || '', rec.status, JSON.stringify(data), user.username, now(), now());
  audit(user, 'Record created', rec, 'status', null, rec.status, reasonText, ip);
  for (const [k, v] of Object.entries(data)) if (v !== '' && v != null && !(Array.isArray(v) && !v.length)) audit(user, 'Field set', rec, k, null, fmt(v), null, ip);
  return rec;
}

// ---------- workflow side effects ----------
function onTransition(user, rec, to, ip) {
  const d = rec.data, today = now().slice(0, 10);
  if (rec.type === 'documents' && to === 'Effective') {
    if (!d.effectiveDate) d.effectiveDate = today;
    d.nextReview = addDays(d.effectiveDate, 365 * (+d.reviewYears || 2));
    // supersede previous effective version of the same document number
    for (const old of db.prepare("SELECT * FROM records WHERE type='documents' AND number=? AND status='Effective' AND id<>? AND deleted=0").all(rec.number, rec.id).map(rowToRecord)) {
      old.status = 'Superseded'; saveRecord(old);
      audit(user, 'Status changed', old, 'status', 'Effective', 'Superseded', 'Superseded by version ' + d.version, ip);
    }
    // auto-assign training
    if (d.trainingImpact && d.trainingImpact !== 'None' && (d.trainingRoles || []).length) {
      const users = db.prepare('SELECT username, roles FROM users WHERE active=1').all().filter(u => JSON.parse(u.roles).some(r => d.trainingRoles.includes(r)));
      for (const u of users) createRecord(user, 'training', {
        trainee: u.username, title: `${rec.number} v${d.version} – ${d.title}`, docRef: rec.number,
        trainingType: d.trainingImpact === 'Assessment required' ? 'e-Learning' : d.trainingImpact === 'Instructor-led' ? 'Instructor-led' : 'Read & Understand',
        dueDate: addDays(today, 14), sourceRecord: rec.number, notes: ''
      }, ip, 'Auto-assigned on document effectivity');
    }
  }
}

// ---------- randomization ----------
function prng(seedStr) { // sha256-seeded xorshift128+
  const h = crypto.createHash('sha256').update(seedStr).digest();
  let s0 = h.readBigUInt64LE(0), s1 = h.readBigUInt64LE(8); const M = (1n << 64n) - 1n;
  return () => { let x = s0; const y = s1; s0 = y; x ^= (x << 23n) & M; s1 = x ^ y ^ (x >> 17n) ^ (y >> 26n); return Number(((s1 + y) & M) >> 11n) / 2 ** 53; };
}
function generateList(d) {
  const arms = String(d.arms).split(',').map(s => s.trim()).filter(Boolean);
  const ratio = String(d.ratio).split(':').map(n => parseInt(n, 10));
  if (arms.length < 2 || ratio.length !== arms.length || ratio.some(n => !(n > 0))) fail(400, 'Treatment codes and ratio must match, e.g. A,B with 1:1.');
  const unit = ratio.reduce((a, b) => a + b, 0), bs = +d.blockSize, n = +d.kits, start = +d.startKit || 1;
  if (!(bs > 0) || bs % unit) fail(400, `Block size must be a multiple of ${unit} for ratio ${d.ratio}.`);
  if (!(n > 0) || n > 100000) fail(400, 'Number of kits must be between 1 and 100,000.');
  const seed = d.seed && String(d.seed).trim() ? String(d.seed).trim() : crypto.randomBytes(16).toString('hex');
  const rnd = prng(seed), template = [];
  for (let k = 0; k < bs / unit; k++) arms.forEach((a, i) => { for (let j = 0; j < ratio[i]; j++) template.push(a); });
  const list = []; let block = 0;
  while (list.length < n) {
    block++; const b = template.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    for (const a of b) { if (list.length >= n) break; list.push({ kit: start + list.length, block, arm: a }); }
  }
  return { list, seed };
}
const listCsv = (list) => 'kit,block,treatment\n' + list.map(r => `${r.kit},${r.block},${r.arm}`).join('\n');

// ---------- SharePoint (Microsoft Graph) ----------
async function spToken() {
  const { tenant, clientId, secret } = CFG.sp;
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  const j = await r.json(); if (!r.ok) fail(502, 'SharePoint authentication failed: ' + (j.error_description || r.status));
  return j.access_token;
}
function renderDocHtml(rec, sigs) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const d = rec.data;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rec.number)} ${esc(d.title)}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:800px;margin:2rem auto;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 8px;text-align:left}pre{white-space:pre-wrap;font-family:inherit}</style></head><body>
<table><tr><th>Document no.</th><td>${esc(rec.number)}</td><th>Version</th><td>${esc(d.version)}</td></tr>
<tr><th>Title</th><td colspan="3">${esc(d.title)}</td></tr><tr><th>Effective date</th><td>${esc(d.effectiveDate)}</td><th>Next review</th><td>${esc(d.nextReview)}</td></tr></table>
<pre>${esc(d.content)}</pre><h3>Electronic signatures</h3><table><tr><th>Name</th><th>Meaning</th><th>Date/time (UTC)</th></tr>
${sigs.map(s => `<tr><td>${esc(s.fullname)}</td><td>${esc(s.meaning)}</td><td>${esc(s.ts)}</td></tr>`).join('')}</table>
<p><em>Published from ${esc(CFG.orgName)} eQMS. Controlled copy is the eQMS record; printed copies are uncontrolled.</em></p></body></html>`;
}

// ---------- API ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts });

route('GET', '/api/health', () => ({ ok: true, org: CFG.orgName, sharepoint: !!(CFG.sp.tenant && CFG.sp.clientId && CFG.sp.siteId) }), { public: true });

route('POST', '/api/login', async (ctx) => {
  const { username, password } = ctx.body;
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').toLowerCase());
  if (!u || !u.active) { audit(null, 'Login failed', null, 'username', null, username, 'Unknown or inactive user', ctx.ip); fail(401, 'User ID or password incorrect.'); }
  if (u.locked) fail(423, 'Account locked. Contact your administrator.');
  if (!checkPw(String(password || ''), u.pw_hash)) {
    const failed = u.failed + 1, locked = failed >= CFG.maxFailed ? 1 : 0;
    db.prepare('UPDATE users SET failed=?, locked=? WHERE username=?').run(failed, locked, u.username);
    audit({ username: u.username, fullname: u.fullname }, locked ? 'Account locked' : 'Login failed', null, null, null, null, `Failed attempt ${failed}`, ctx.ip);
    fail(401, locked ? 'Account locked after 5 failed attempts.' : 'User ID or password incorrect.');
  }
  const sid = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(16).toString('hex');
  sessions.set(sid, { username: u.username, last: Date.now(), csrf });
  db.prepare('UPDATE users SET failed=0, last_login=? WHERE username=?').run(now(), u.username);
  audit(u, 'Login', null, null, null, null, null, ctx.ip);
  ctx.setCookie = `qms_sid=${sid}; HttpOnly; SameSite=Strict; Path=/${CFG.cookieSecure ? '; Secure' : ''}`;
  u.roles = JSON.parse(u.roles); u.csrf = csrf;
  return pub(u);
}, { public: true });

route('POST', '/api/logout', (ctx) => { sessions.delete(ctx.user.sid); audit(ctx.user, 'Logout', null, null, null, null, null, ctx.ip); ctx.setCookie = 'qms_sid=; Max-Age=0; Path=/'; return { ok: true }; });
route('GET', '/api/me', (ctx) => ({ ...pub(ctx.user), idleMinutes: CFG.idleMinutes }));
route('GET', '/api/config', () => ({ roles: ROLES, org: CFG.orgName }));

route('POST', '/api/password', (ctx) => {
  const { current, next } = ctx.body;
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(ctx.user.username);
  if (!checkPw(String(current || ''), u.pw_hash)) fail(401, 'Current password incorrect.');
  const p = pwPolicy(next); if (p) fail(400, p);
  if (checkPw(next, u.pw_hash)) fail(400, 'New password must differ from the current one.');
  db.prepare('UPDATE users SET pw_hash=?, must_change=0 WHERE username=?').run(hashPw(next), u.username);
  audit(ctx.user, 'Password changed', null, null, null, null, null, ctx.ip);
  return { ok: true };
});
route('POST', '/api/esig-accept', (ctx) => {
  db.prepare('UPDATE users SET esig_accepted=? WHERE username=?').run(now(), ctx.user.username);
  audit(ctx.user, 'E-signature statement accepted', null, null, null, 'I agree that my electronic signature is the legally binding equivalent of my handwritten signature.', null, ctx.ip);
  return { ok: true };
});

route('GET', '/api/users', () => db.prepare('SELECT username,fullname,email,roles,active,locked,last_login,created_at FROM users ORDER BY username').all().map(u => ({ ...u, roles: JSON.parse(u.roles) })));
route('POST', '/api/users', (ctx) => {
  if (!ctx.user.roles.includes('admin')) fail(403, 'Administrator role required.');
  const { username, fullname, email, roles, password } = ctx.body;
  const un = String(username || '').toLowerCase().trim();
  if (!/^[a-z0-9._-]{3,40}$/.test(un)) fail(400, 'User ID: 3–40 characters, letters, numbers, dot, dash, underscore.');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(un)) fail(409, 'User ID already exists. User IDs are never reused.');
  const p = pwPolicy(password); if (p) fail(400, p);
  const r = (roles || []).filter(x => ROLES[x]); if (!r.length) fail(400, 'Select at least one role.');
  db.prepare('INSERT INTO users (username,fullname,email,roles,pw_hash,must_change,created_at) VALUES (?,?,?,?,?,1,?)').run(un, String(fullname || un), String(email || ''), JSON.stringify(r), hashPw(password), now());
  audit(ctx.user, 'User created', null, 'roles', null, `${un}: ${r.join(', ')}`, ctx.body.reason, ctx.ip);
  return { ok: true };
});
route('PUT', '/api/users/:u', (ctx) => {
  if (!ctx.user.roles.includes('admin')) fail(403, 'Administrator role required.');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(ctx.params.u); if (!u) fail(404, 'User not found');
  const { roles, active, unlock, password, reason } = ctx.body;
  if (!reason) fail(400, 'Reason for change is required.');
  const tag = { username: ctx.user.username, fullname: ctx.user.fullname };
  if (roles) { const r = roles.filter(x => ROLES[x]); db.prepare('UPDATE users SET roles=? WHERE username=?').run(JSON.stringify(r), u.username); audit(tag, 'User roles changed', null, u.username, JSON.parse(u.roles).join(', '), r.join(', '), reason, ctx.ip); }
  if (active !== undefined) { db.prepare('UPDATE users SET active=? WHERE username=?').run(active ? 1 : 0, u.username); audit(tag, active ? 'User activated' : 'User deactivated', null, u.username, null, null, reason, ctx.ip); }
  if (unlock) { db.prepare('UPDATE users SET locked=0, failed=0 WHERE username=?').run(u.username); audit(tag, 'User unlocked', null, u.username, null, null, reason, ctx.ip); }
  if (password) { const p = pwPolicy(password); if (p) fail(400, p); db.prepare('UPDATE users SET pw_hash=?, must_change=1 WHERE username=?').run(hashPw(password), u.username); audit(tag, 'Password reset by administrator', null, u.username, null, null, reason, ctx.ip); }
  return { ok: true };
});

route('GET', '/api/records', (ctx) => {
  const type = ctx.query.get('type');
  const rows = type ? db.prepare('SELECT * FROM records WHERE type=? AND deleted=0 ORDER BY created_at DESC').all(type)
    : db.prepare('SELECT * FROM records WHERE deleted=0 ORDER BY updated_at DESC LIMIT 2000').all();
  return rows.map(rowToRecord);
});
route('GET', '/api/records/:id', (ctx) => {
  const rec = getRecord(ctx.params.id), h = contentHash(rec);
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=? ORDER BY id').all(rec.id).map(s => ({ ...s, current: s.content_hash === h }));
  const atts = db.prepare('SELECT id,name,mime,size,sha256,uploaded_by,ts FROM attachments WHERE record_id=? ORDER BY ts').all(rec.id);
  const trail = db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id DESC').all(rec.id);
  const rl = rec.type === 'randomization' ? db.prepare('SELECT generated_by, ts FROM rand_lists WHERE record_id=?').get(rec.id) : null;
  const mod = MODULES[rec.type];
  const editable = EDITABLE_ALWAYS.has(rec.type) || !LOCKED.has(rec.status);
  const transitions = mod.transitions.filter(t => t.from === rec.status).map(t => ({ ...t, allowed: hasRole(ctx.user, t.roles) }));
  return { record: rec, signatures: sigs, attachments: atts, audit: trail, transitions, editable, randList: rl };
});
route('POST', '/api/records', (ctx) => {
  const { type, data } = ctx.body;
  if (!MODULES[type]) fail(400, 'Unknown module');
  if (type === 'randomization' && !hasRole(ctx.user, ['unblinded'])) fail(403, 'Only unblinded randomization officers can create randomization lists.');
  const clean = sanitize(type, data || {});
  for (const f of MODULES[type].fields) if (f.req && (clean[f.k] === '' || clean[f.k] == null) && f.def === undefined) fail(400, `${f.label} is required.`);
  if (type === 'deviations' && !clean.dueDate && clean.occurred) clean.dueDate = addDays(clean.occurred, 30);
  if (type === 'issues') {
    const doc = effectiveDoc(clean.docNumber);
    clean.title = doc.data.title; clean.docVersion = doc.data.version;
    if (!(+clean.copies >= 1 && +clean.copies <= 100)) fail(400, 'Copies must be between 1 and 100.');
  }
  return createRecord(ctx.user, type, clean, ctx.ip);
});
route('PUT', '/api/records/:id', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (!EDITABLE_ALWAYS.has(rec.type) && LOCKED.has(rec.status)) fail(409, `Record is ${rec.status} and cannot be edited. Raise a change or revision.`);
  if (rec.type === 'randomization' && !hasRole(ctx.user, ['unblinded'])) fail(403, 'Unblinded role required.');
  const reason = String(ctx.body.reason || '').trim(); if (!reason) fail(400, 'Reason for change is required.');
  const clean = sanitize(rec.type, ctx.body.data || {});
  if (rec.type === 'issues' && rec.status !== 'Requested') { delete clean.docNumber; delete clean.copies; delete clean.issuedTo; }
  let changes = 0;
  for (const [k, v] of Object.entries(clean)) {
    const old = rec.data[k];
    if (JSON.stringify(old ?? '') !== JSON.stringify(v ?? '')) { rec.data[k] = v; audit(ctx.user, 'Field changed', rec, k, fmt(old), fmt(v), reason, ctx.ip); changes++; }
  }
  if (changes) { applyComputed(rec.type, rec.data); saveRecord(rec); }
  return { changes };
});
route('POST', '/api/records/:id/transition', (ctx) => {
  const rec = getRecord(ctx.params.id), mod = MODULES[rec.type];
  const t = mod.transitions.find(x => x.from === rec.status && x.to === ctx.body.to);
  if (!t) fail(409, `Cannot move from ${rec.status} to ${ctx.body.to}.`);
  if (!hasRole(ctx.user, t.roles)) fail(403, `Your roles do not allow "${t.label}".`);
  if (t.reason && !String(ctx.body.reason || '').trim()) fail(400, 'A reason is required for this step.');
  for (const k of t.needs || []) { const v = rec.data[k]; if (v === '' || v == null || v === false || (Array.isArray(v) && !v.length)) fail(400, `Complete "${mod.fields.find(f => f.k === k).label}" first.`); }
  if (t.sod && rec.created_by === ctx.user.username) fail(403, 'Segregation of duties: the record initiator cannot approve it.');
  if (t.needsList) {
    const rl = db.prepare('SELECT generated_by FROM rand_lists WHERE record_id=?').get(rec.id);
    if (!rl) fail(400, 'Generate the list first.');
    if (rl.generated_by === ctx.user.username) fail(403, 'Segregation of duties: the list generator cannot approve it.');
  }
  if (t.traineeOnly && rec.data.trainee !== ctx.user.username) fail(403, 'Only the trainee can sign their own training record.');
  if (t.checkScore && rec.data.passMark !== '' && rec.data.passMark != null && !(+rec.data.score >= +rec.data.passMark)) fail(400, `Score ${rec.data.score || 0}% is below the pass mark ${rec.data.passMark}%.`);
  if (t.checkSanctions && rec.data.sanctions !== 'Clear') fail(400, 'Sanctions screening must be "Clear" before qualification.');
  if (t.checkRecon && !String(rec.data.reconciliation).startsWith('Balanced')) fail(400, 'Label reconciliation is not balanced. Raise a deviation before completing.');
  if (t.sign) verifySignature(ctx.user, ctx.body);
  const from = rec.status; rec.status = t.to;
  onTransition(ctx.user, rec, t.to, ctx.ip);
  saveRecord(rec);
  audit(ctx.user, t.sign ? 'Status changed (e-signed: ' + t.sign + ')' : 'Status changed', rec, 'status', from, t.to, ctx.body.reason, ctx.ip);
  if (t.sign) sign(ctx.user, rec, t.sign, from, t.to);
  return { ok: true, status: rec.status };
});
route('POST', '/api/records/:id/revise', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'documents' || rec.status !== 'Effective') fail(409, 'Only effective documents can be revised.');
  if (!hasRole(ctx.user, ['author', 'qa'])) fail(403, 'Author or QA role required.');
  if (db.prepare("SELECT 1 FROM records WHERE type='documents' AND number=? AND status IN ('Draft','In Review','In Approval') AND deleted=0").get(rec.number)) fail(409, 'A revision of this document is already in progress.');
  const [maj] = String(rec.data.version || '1.0').split('.');
  const data = { ...rec.data, version: (parseInt(maj, 10) + 1) + '.0', effectiveDate: '', nextReview: '', supersedes: rec.id, __number: rec.number };
  return createRecord(ctx.user, 'documents', data, ctx.ip, 'Revision of ' + rec.number + ' v' + rec.data.version + ': ' + (ctx.body.reason || ''));
});
route('POST', '/api/records/:id/attachments', (ctx) => {
  const rec = getRecord(ctx.params.id);
  const buf = Buffer.from(String(ctx.body.base64 || ''), 'base64'); if (!buf.length) fail(400, 'Empty file');
  const id = uid(), h = crypto.createHash('sha256').update(buf).digest('hex');
  db.prepare('INSERT INTO attachments (id,record_id,name,mime,size,sha256,blob,uploaded_by,ts) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, rec.id, String(ctx.body.name).slice(0, 200), String(ctx.body.mime || ''), buf.length, h, buf, ctx.user.username, now());
  audit(ctx.user, 'Attachment added', rec, 'attachment', null, `${ctx.body.name} (SHA-256 ${h.slice(0, 16)}…)`, ctx.body.reason, ctx.ip);
  return { id, sha256: h };
});
route('GET', '/api/attachments/:id', (ctx) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id=?').get(ctx.params.id); if (!a) fail(404, 'Not found');
  const buf = Buffer.from(a.blob);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== a.sha256) fail(500, 'Integrity check failed: file checksum does not match.');
  audit(ctx.user, 'Attachment downloaded', getRecord(a.record_id), 'attachment', null, a.name, null, ctx.ip);
  return { __raw: buf, headers: { 'Content-Type': a.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"` } };
});

route('POST', '/api/records/:id/printed', (ctx) => {
  const rec = getRecord(ctx.params.id);
  audit(ctx.user, 'Record printed (uncontrolled copy)', rec, null, null, null, ctx.body.reason, ctx.ip);
  return { ok: true };
});

// ---------- controlled document issuance ----------
function effectiveDoc(number) {
  const r = rowToRecord(db.prepare("SELECT * FROM records WHERE type='documents' AND number=? AND status='Effective' AND deleted=0").get(String(number || '').trim().toUpperCase()));
  if (!r) fail(400, `No Effective version of document "${number}". Only the current Effective version can be issued.`);
  return r;
}
function paginate(text, perPage = 38, width = 95) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let l = raw; if (!l) { lines.push(''); continue; }
    while (l.length > width) { let cut = l.lastIndexOf(' ', width); if (cut < 20) cut = width; lines.push(l.slice(0, cut)); l = l.slice(cut).trimStart(); }
    lines.push(l);
  }
  const pages = []; for (let i = 0; i < Math.max(lines.length, 1); i += perPage) pages.push(lines.slice(i, i + perPage).join('\n'));
  return pages;
}
route('POST', '/api/records/:id/issue-print', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'issues') fail(400, 'Not an issue record.');
  if (!hasRole(ctx.user, ['qa'])) fail(403, 'Only QA Document Control can print issued copies.');
  const reprint = !!ctx.body.reprint;
  if (!reprint && rec.status !== 'Approved') fail(409, 'The issue must be Approved before copies are printed.');
  if (reprint && rec.status !== 'Issued') fail(409, 'Replacement copies can be printed only while the issue is Issued.');
  if (reprint && !String(ctx.body.reason || '').trim()) fail(400, 'A reason is required for a replacement copy.');
  const doc = effectiveDoc(rec.data.docNumber);
  if (doc.data.version !== rec.data.docVersion) fail(409, `Document is now at version ${doc.data.version}; this issue was approved for ${rec.data.docVersion}. Raise a new issue request.`);
  verifySignature(ctx.user, ctx.body);
  const pages = paginate(doc.data.content);
  const log = rec.data.printLog || [];
  let copies;
  if (reprint) {
    const replaces = +ctx.body.copyNo;
    const total = +rec.data.copies + log.filter(j => j.replacement).length;
    if (!(replaces >= 1 && replaces <= total) || log.some(j => j.voided === replaces)) fail(400, 'Enter a valid copy number that has not already been voided.');
    copies = [{ copyNo: total + 1, replacement: true, replaces }];
    log.push({ ts: now(), by: ctx.user.username, copyNo: total + 1, replacement: true, voided: replaces, reason: ctx.body.reason, pages: pages.length });
    audit(ctx.user, 'Replacement copy issued (e-signed: Replacement issued)', rec, 'copy', `Copy ${replaces} voided`, `Copy ${total + 1}`, ctx.body.reason, ctx.ip);
    sign(ctx.user, rec, 'Replacement issued', rec.status, rec.status);
  } else {
    copies = Array.from({ length: +rec.data.copies }, (_, i) => ({ copyNo: i + 1 }));
    for (const c of copies) log.push({ ts: now(), by: ctx.user.username, copyNo: c.copyNo, pages: pages.length });
    rec.status = 'Issued';
    audit(ctx.user, 'Controlled copies issued (e-signed: Issued)', rec, 'status', 'Approved', 'Issued', `${copies.length} copies of ${doc.number} v${doc.data.version}, ${pages.length} pages each`, ctx.ip);
  }
  rec.data.printLog = log; rec.data.pages = pages.length; saveRecord(rec);
  if (!reprint) sign(ctx.user, rec, 'Issued', 'Approved', 'Issued');
  return {
    issueNo: rec.number, totalCopies: +rec.data.copies, copies, pages,
    doc: { number: doc.number, version: doc.data.version, title: doc.data.title, effectiveDate: doc.data.effectiveDate },
    issuedTo: rec.data.issuedTo, issuedToName: (db.prepare('SELECT fullname FROM users WHERE username=?').get(rec.data.issuedTo) || {}).fullname || rec.data.issuedTo,
    issuedBy: ctx.user.fullname, issuedAt: now(), returnBy: rec.data.returnBy, purpose: rec.data.purpose, copyType: rec.data.copyType, org: CFG.orgName
  };
});

// randomization
route('POST', '/api/records/:id/randomize', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'randomization' || rec.status !== 'Draft') fail(409, 'Lists can be generated only for Draft randomization records.');
  if (!hasRole(ctx.user, ['unblinded'])) fail(403, 'Unblinded role required.');
  verifySignature(ctx.user, ctx.body);
  const { list, seed } = generateList(rec.data);
  const csv = listCsv(list);
  db.prepare('INSERT OR REPLACE INTO rand_lists (record_id,list,seed,generated_by,ts) VALUES (?,?,?,?,?)').run(rec.id, JSON.stringify(list), seed, ctx.user.username, now());
  rec.data.checksum = sha256(csv); rec.data.seed = seed; rec.status = 'Generated'; saveRecord(rec);
  audit(ctx.user, 'Randomization list generated (e-signed: Generated)', rec, 'checksum', null, rec.data.checksum, `${list.length} kits; seed recorded`, ctx.ip);
  sign(ctx.user, rec, 'Generated', 'Draft', 'Generated');
  return { ok: true, kits: list.length };
});
route('GET', '/api/records/:id/kits', (ctx) => {
  const rec = getRecord(ctx.params.id);
  const rl = db.prepare('SELECT * FROM rand_lists WHERE record_id=?').get(rec.id); if (!rl) fail(404, 'No list generated');
  const list = JSON.parse(rl.list), unblinded = ctx.query.get('view') === 'unblinded';
  if (unblinded) {
    if (!hasRole(ctx.user, ['unblinded'])) fail(403, 'Unblinded role required.');
    audit(ctx.user, 'Unblinded list viewed', rec, null, null, null, null, ctx.ip);
    const arms = {}, blocks = {};
    for (const r of list) { arms[r.arm] = (arms[r.arm] || 0) + 1; (blocks[r.block] ||= {})[r.arm] = (blocks[r.block][r.arm] || 0) + 1; }
    return { unblinded: true, seed: rl.seed, list, balance: arms, blocks, checksumValid: sha256(listCsv(list)) === rec.data.checksum };
  }
  return { unblinded: false, list: list.map(r => ({ kit: r.kit })) };
});

// label printing
route('POST', '/api/records/:id/print', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'labels' || rec.status !== 'Approved') fail(409, 'Only Approved labels can be printed.');
  if (!hasRole(ctx.user, ['cs', 'qa'])) fail(403, 'Clinical supply or QA role required.');
  const { firstKit, qty, batch, expiry, printer } = ctx.body;
  if (!(+qty > 0 && +qty <= 5000)) fail(400, 'Quantity must be 1–5000.');
  if (!batch || !expiry) fail(400, 'Batch and expiry are required.');
  verifySignature(ctx.user, ctx.body);
  const job = { id: uid().slice(0, 8), ts: now(), by: ctx.user.username, firstKit: +firstKit, qty: +qty, batch, expiry, printer: printer || 'Browser / PDF', version: rec.data.version };
  rec.data.printLog = [...(rec.data.printLog || []), job]; saveRecord(rec);
  audit(ctx.user, 'Label print job (e-signed: Printed)', rec, 'print', null, `${qty} labels, kits ${firstKit}–${+firstKit + +qty - 1}, batch ${batch}, exp ${expiry}`, null, ctx.ip);
  sign(ctx.user, rec, 'Printed', rec.status, rec.status);
  return job;
});

// audit trail
route('GET', '/api/audit', (ctx) => {
  const lim = Math.min(+ctx.query.get('limit') || 500, 5000), q = ctx.query.get('q');
  return q ? db.prepare("SELECT * FROM audit WHERE username LIKE ? OR action LIKE ? OR record_number LIKE ? OR field LIKE ? ORDER BY id DESC LIMIT ?").all(...Array(4).fill('%' + q + '%'), lim)
    : db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(lim);
});
route('GET', '/api/audit/verify', (ctx) => { const r = verifyAudit(); audit(ctx.user, 'Audit trail integrity verified', null, null, null, r.ok ? 'Intact' : 'BROKEN at ' + r.brokenAt, null, ctx.ip); return r; });
route('GET', '/api/export/:id', (ctx) => {
  const rec = getRecord(ctx.params.id);
  audit(ctx.user, 'Record exported', rec, null, null, 'JSON', null, ctx.ip);
  return { record: rec, signatures: db.prepare('SELECT * FROM signatures WHERE record_id=?').all(rec.id), audit: db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id').all(rec.id), exportedBy: ctx.user.username, exportedAt: now() };
});

// SharePoint
route('POST', '/api/sharepoint/publish/:id', async (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'documents' || rec.status !== 'Effective') fail(409, 'Only effective documents can be published.');
  if (!hasRole(ctx.user, ['qa', 'admin'])) fail(403, 'QA or administrator role required.');
  if (!(CFG.sp.tenant && CFG.sp.clientId && CFG.sp.secret && CFG.sp.siteId)) fail(501, 'SharePoint is not configured. Set SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET and SP_SITE_ID in .env.');
  const token = await spToken();
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=?').all(rec.id);
  const file = `${rec.number}_v${rec.data.version}.html`.replace(/[^\w.-]/g, '_');
  const url = `https://graph.microsoft.com/v1.0/sites/${CFG.sp.siteId}/drive/root:/${encodeURIComponent(CFG.sp.folder)}/${file}:/content`;
  const r = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/html' }, body: renderDocHtml(rec, sigs) });
  const j = await r.json(); if (!r.ok) fail(502, 'SharePoint upload failed: ' + (j.error && j.error.message || r.status));
  const old = rec.data.sharepointUrl; rec.data.sharepointUrl = j.webUrl; saveRecord(rec);
  audit(ctx.user, 'Published to SharePoint', rec, 'sharepointUrl', old, j.webUrl, null, ctx.ip);
  return { webUrl: j.webUrl };
});

// ---------- HTTP server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!url.pathname.startsWith('/api/')) {
    let p = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
    return fs.createReadStream(p).pipe(res);
  }
  try {
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) fail(404, 'Not found');
    const ctx = { params: url.pathname.match(r.re).groups || {}, query: url.searchParams, ip, body: {} };
    if (!r.opts.public) {
      ctx.user = getUser(req); if (!ctx.user) fail(401, 'Session expired. Sign in again.');
      if (req.method !== 'GET' && req.headers['x-csrf-token'] !== ctx.user.csrf) fail(403, 'Security token missing. Reload the page.');
    }
    if (req.method === 'POST' || req.method === 'PUT') ctx.body = await readBody(req);
    const out = await r.handler(ctx);
    const headers = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
    if (out && out.__raw) return send(res, 200, out.__raw, { ...out.headers, ...headers });
    send(res, 200, out ?? { ok: true }, headers);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.code || 500, { error: e instanceof HttpError ? e.message : 'Unexpected server error' });
  }
});
if (require.main === module) server.listen(CFG.port, CFG.host, () => console.log(`eQMS listening on http://${CFG.host}:${CFG.port}`));
module.exports = { server, generateList };
