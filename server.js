/* QualiSuite eQMS server — Node.js >= 22.13, no npm dependencies.
 * Provides: authentication, role-based access, record workflows, e-signatures,
 * hash-chained audit trail, attachments with SHA-256, kit randomization,
 * label print logging, SharePoint (Microsoft Graph) publishing, static UI. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const net = require('node:net');
const tls = require('node:tls');
const { DatabaseSync } = require('node:sqlite');
// pdf-lib 1.17.1 (MIT, vendor/pdf-lib.LICENSE.md) – builds the merged PDF report; vendored so the app still installs no npm packages
const PDFLib = require('./vendor/pdf-lib.min.js');
const { MODULES, ROLES, DERIVED_ROLES, DEPTS, setDepartments, supRisk, trainingScore, PASS_MARK, TRAINER_PARAMS, TRAINER_PASS, RETENTION } = require('./public/modules.js');
// change control states from pre-approval onwards (the change may be implemented)
const CC_APPROVED = ['Optional Approvals', 'Implementation', 'QA Closure Review', 'Closed – EC Pending', 'Closed'];

// ---------- configuration ----------
loadEnv(path.join(__dirname, '.env'));
const CFG = {
  port: +process.env.PORT || 8080,
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  idleMinutes: +process.env.SESSION_IDLE_MINUTES || 60, // automatic lock after 1 hour without activity
  maxFailed: 5,
  orgName: process.env.ORG_NAME || 'Your Organisation',
  envLabel: process.env.APP_ENV_LABEL || '', // e.g. "TEST – not for GxP use", shown as a banner on every page
  demoPassword: process.env.DEMO_PASSWORD || 'Demo-Pass-2026',
  // WAL needs shared memory; network file shares (e.g. Azure App Service /home) need DELETE
  journal: ['WAL', 'DELETE', 'TRUNCATE'].includes(String(process.env.SQLITE_JOURNAL).toUpperCase()) ? String(process.env.SQLITE_JOURNAL).toUpperCase() : 'WAL',
  // outgoing e-mail for notifications and passwords (e.g. Microsoft 365: smtp.office365.com, port 587, STARTTLS)
  smtp: { host: process.env.SMTP_HOST || '', port: +process.env.SMTP_PORT || 587, secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.SMTP_FROM || process.env.SMTP_USER || '', fromName: process.env.SMTP_FROM_NAME || 'JRS eQMS' },
  appUrl: (process.env.APP_URL || '').replace(/\/$/, ''), // link in e-mails, e.g. http://192.168.1.100:8080
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
db.exec(`PRAGMA journal_mode = ${CFG.journal};`);
db.exec(`
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
CREATE TABLE IF NOT EXISTS links (a TEXT NOT NULL, b TEXT NOT NULL, created_by TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS versions (record_id TEXT NOT NULL, no INTEGER NOT NULL, ts TEXT NOT NULL, username TEXT, fullname TEXT,
  status TEXT NOT NULL, number TEXT, data TEXT NOT NULL, reason TEXT, PRIMARY KEY (record_id, no));
CREATE TRIGGER IF NOT EXISTS versions_no_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT, 'version history is read-only'); END;
CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT, 'version history is read-only'); END;
CREATE TABLE IF NOT EXISTS form_issues (no TEXT PRIMARY KEY, form_code TEXT NOT NULL, form_title TEXT, record_id TEXT, record_number TEXT, record_title TEXT,
  issued_to TEXT NOT NULL, issued_name TEXT, dept TEXT, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, record_id TEXT, record_number TEXT,
  subject TEXT NOT NULL, body TEXT NOT NULL, action TEXT, ts TEXT NOT NULL, read INTEGER DEFAULT 0, email TEXT);
CREATE TABLE IF NOT EXISTS departments (code TEXT PRIMARY KEY, name TEXT NOT NULL, parent TEXT, hod TEXT, active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL);
`);
// register of signatures (JRS/SOP/QAS/009) – columns added to existing databases
for (const col of ['designation', 'department', 'initials', 'inactive_date', 'reports_to', 'signature']) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`); } catch { /* already present */ } }
const REREGISTER_YEARS = 5;
try { db.exec('ALTER TABLE attachments ADD COLUMN stage TEXT'); } catch { /* already present */ } // workflow stage the file was added at
try { db.exec('ALTER TABLE attachments ADD COLUMN category TEXT'); } catch { /* already present */ } // document type, e.g. licence copy
try { db.exec('ALTER TABLE form_issues ADD COLUMN pdf BLOB'); } catch { /* already present or created below */ } // the issued file, returned again on every download

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
// ---------- departments and organogram ----------
// Departments are created by admin / management (System → Departments). Each department has a Head (HOD) and may sit under a
// parent department; users belong to a department and report to a manager. Approvals follow this hierarchy: when a department
// has no Head (or the Head is the person whose work is approved), the Head of the parent department approves.
if (!db.prepare('SELECT 1 FROM departments LIMIT 1').get()) {
  for (const [code, name] of [['OPS', 'Operation'], ['HRM', 'HR'], ['PKG', 'Packaging'], ['QAS', 'QA'], ['ITS', 'IT']])
    db.prepare('INSERT INTO departments (code,name,active,created_by,created_at) VALUES (?,?,1,?,?)').run(code, name, 'system', now());
  audit(null, 'Departments created', null, null, null, 'OPS Operation, HRM HR, PKG Packaging, QAS QA, ITS IT', 'Initial installation');
}
const deptRows = () => db.prepare('SELECT * FROM departments ORDER BY name').all();
const deptMap = () => Object.fromEntries(deptRows().map(d => [d.code, d]));
const loadDepartments = () => setDepartments(deptRows()); // the shared select options (modules.js) follow the department list
loadDepartments();
// the department and its parents, nearest first
function deptChain(code, map = deptMap()) { const out = []; let d = map[code]; while (d && !out.includes(d.code)) { out.push(d.code); d = map[d.parent]; } return out; }
const activeUser = (u) => !!u && !!db.prepare('SELECT 1 FROM users WHERE username=? AND active=1').get(u);
// Head of Department who approves work of a department: its own Head, otherwise up the hierarchy; never the person approved
// (then the parent department's Head, or the line manager from the organogram)
function hodFor(code, exclude) {
  const map = deptMap();
  for (const c of deptChain(code, map)) { const h = map[c].hod; if (h && h !== exclude && activeUser(h)) return h; }
  const mgr = exclude && (db.prepare('SELECT reports_to FROM users WHERE username=?').get(exclude) || {}).reports_to;
  return mgr && activeUser(mgr) ? mgr : '';
}
// departments a user heads directly, and every department below them in the hierarchy
function deptsHeaded(username) {
  const map = deptMap();
  return { direct: Object.values(map).filter(d => d.hod === username).map(d => d.code),
    under: Object.keys(map).filter(c => deptChain(c, map).some(x => map[x].hod === username)) };
}
const userDept = (u) => (db.prepare('SELECT department FROM users WHERE username=?').get(u || '') || {}).department || '';
if (process.env.SEED_DEMO === 'true') seedDemo();

function seedDemo() {
  const demo = [
    ['qa.lead', 'Priya Raman (QA Head / QP)', ['qa']], ['qa.reviewer', 'Tom Becker (QA Reviewer)', ['qa', 'auditor']],
    ['author1', 'Lena Ortiz (Document Author)', ['author', 'sme']], ['cs.manager', 'Sam Okafor (Clinical Supply)', ['cs', 'author']],
    ['stat1', 'Mei Chen (Unblinded Statistician)', ['unblinded']], ['rp1', 'Jonas Weber (Responsible Person)', ['rp']],
    ['trainer1', 'Ana Silva (Training Coordinator)', ['trainer']], ['operator1', 'Ravi Patel (Operator)', ['user']],
    ['hod.ops', 'Dana Fischer (Head of Operations)', ['user', 'sme']], ['pm1', 'Chris Novak (Project Manager)', ['pm']],
    ['director1', 'Alex Morgan (Director / Management Representative)', ['mgmt']], ['inspector1', 'Kim Yates (External Auditor – read-only)', ['extaud']],
    ['docctrl1', 'Sara Lind (QA Document Control)', ['qa']], ['packer1', 'Nina Kowalski (Packaging Operator)', ['user']]
  ].filter(([u]) => !db.prepare('SELECT 1 FROM users WHERE username=?').get(u));
  if (!demo.length) return seedOrganogram();
  for (const [u, n, r] of demo) db.prepare('INSERT INTO users (username,fullname,roles,pw_hash,must_change,created_at) VALUES (?,?,?,?,0,?)')
    .run(u, n, JSON.stringify(r), hashPw(CFG.demoPassword), now());
  audit(null, 'Demo users created', null, null, null, demo.map(d => d[0]).join(', '), 'SEED_DEMO=true');
  console.log('Demo users created with ' + (process.env.DEMO_PASSWORD ? 'the password from DEMO_PASSWORD' : 'password Demo-Pass-2026') + ' (disable SEED_DEMO in production).');
  seedOrganogram();
}
// demo organogram: departments, Heads and reporting lines (only fills what is still empty)
function seedOrganogram() {
    const people = { 'qa.lead': ['QAS', 'director1'], 'qa.reviewer': ['QAS', 'qa.lead'], docctrl1: ['QAS', 'qa.lead'], rp1: ['QAS', 'qa.lead'],
      'hod.ops': ['OPS', 'director1'], operator1: ['OPS', 'hod.ops'], pm1: ['OPS', 'hod.ops'], stat1: ['OPS', 'hod.ops'], author1: ['OPS', 'hod.ops'],
      'cs.manager': ['PKG', 'hod.ops'], packer1: ['PKG', 'cs.manager'], trainer1: ['HRM', 'director1'] };
    for (const [u, [dept, mgr]] of Object.entries(people)) {
      const row = db.prepare('SELECT department, reports_to FROM users WHERE username=?').get(u); if (!row) continue;
      if (!row.department || !deptMap()[row.department]) db.prepare('UPDATE users SET department=? WHERE username=?').run(dept, u);
      if (!row.reports_to) db.prepare('UPDATE users SET reports_to=? WHERE username=?').run(mgr, u);
    }
    for (const [code, hod, parent] of [['QAS', 'qa.lead'], ['OPS', 'hod.ops'], ['PKG', 'cs.manager', 'OPS'], ['HRM', 'trainer1']]) {
      const d = deptMap()[code]; if (!d) continue;
      if (!d.hod) db.prepare('UPDATE departments SET hod=? WHERE code=?').run(hod, code);
      if (parent && !d.parent) db.prepare('UPDATE departments SET parent=? WHERE code=?').run(parent, code);
    }
    // roles that are now derived from the organogram / QA are not stored on the user
    for (const u of db.prepare('SELECT username, roles FROM users').all()) {
      const r = JSON.parse(u.roles), keep = r.filter(x => !DERIVED_ROLES.includes(x));
      if (keep.length !== r.length) db.prepare('UPDATE users SET roles=? WHERE username=?').run(JSON.stringify(keep.length ? keep : [r.includes('numgen') ? 'qa' : 'user']), u.username);
    }
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
  withOrg(u); u.sid = m[1]; u.csrf = s.csrf;
  return u;
}
// Roles held through the organisation: 'hod' for Heads of Department (organogram); 'numgen' for QA, who assign all record numbers
function withOrg(u) {
  const stored = (Array.isArray(u.roles) ? u.roles : JSON.parse(u.roles)).filter(r => !DERIVED_ROLES.includes(r));
  const heads = deptsHeaded(u.username);
  u.hodOf = heads.direct; u.deptsUnder = heads.under; u.department = u.department || '';
  u.roles = [...stored, ...(heads.direct.length ? ['hod'] : []), ...(stored.includes('qa') ? ['numgen'] : [])];
  return u;
}
// admin and management have all access (except blinded randomization data, which stays with unblinded officers)
const allAccess = (u) => u.roles.includes('admin') || u.roles.includes('mgmt');
// organogram: management, the Head of QA and administrators
const canEditOrg = (u) => allAccess(u) || u.hodOf.includes('QAS');
const hasRole = (u, roles) => roles.includes('any') || u.roles.some(r => roles.includes(r)) || (allAccess(u) && !roles.every(r => ['unblinded', 'extaud'].includes(r)));
// JRS/SOP/QAS/009: signature registration is renewed every 5 years
const esigCurrent = (u) => !!u.esig_accepted && new Date(u.esig_accepted) > new Date(Date.now() - REREGISTER_YEARS * 365.25 * 864e5);
const pub = (u) => ({ username: u.username, fullname: u.fullname, email: u.email, roles: u.roles, mustChange: !!u.must_change, esigAccepted: esigCurrent(u), csrf: u.csrf,
  department: u.department || '', hodOf: u.hodOf || [], deptsUnder: u.deptsUnder || [], allAccess: allAccess(u), canEditOrg: canEditOrg(u) });

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
const contentHash = (rec) => { const { printLog, deptApprovals, stateEnteredAt, formIssues, ...d } = rec.data; return sha256(JSON.stringify({ id: rec.id, data: d })); };
// Record numbers: module-specific format from modules.js (e.g. JRS-DEVN-2026-001, CAPA/QAS/001/26), default PREFIX-YYYY-NNNN
function nextNumber(type, data, format) {
  const mod = MODULES[type], y = new Date().getFullYear(), fn = format || mod.numbering;
  const { pre, suf = '', pad = 4, fixed } = fn ? fn(data, y) : { pre: mod.prefix + '-' + y + '-' };
  if (fixed) { // one record per period, e.g. SIS-2026, QMR-2026-Q3
    if (db.prepare('SELECT 1 FROM records WHERE number=? AND deleted=0').get(fixed)) fail(409, `${fixed} already exists.`);
    return fixed;
  }
  let max = 0;
  for (const r of db.prepare('SELECT number FROM records WHERE number LIKE ?').all(pre + '%' + suf)) {
    const mid = r.number.slice(pre.length, r.number.length - suf.length);
    if (/^\d+$/.test(mid)) max = Math.max(max, +mid);
  }
  return pre + String(max + 1).padStart(pad, '0') + suf;
}
function applyComputed(mod, data) {
  const c = MODULES[mod].compute || {};
  for (const k of Object.keys(c)) data[k] = c[k](data);
}
function sanitize(mod, input) {
  const out = {};
  for (const f of MODULES[mod].fields) {
    if (!f.k || !(f.k in input) || f.type === 'computed' || f.type === 'readonly') continue;
    let v = input[f.k];
    if (f.type === 'number') v = v === '' || v == null ? '' : Number(v);
    else if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'multicheck') {
      v = Array.isArray(v) ? v.filter(x => f.options.includes(x)) : [];
      if (f.max && v.length > f.max) fail(400, `${f.label}: select at most ${f.max}.`);
    } else if (f.type === 'checklist') {
      const src = v && typeof v === 'object' ? v : {};
      v = Object.fromEntries(f.rows.map(row => { const x = src[row] || {}; return [row, { v: ['Yes', 'No'].includes(x.v) ? x.v : '', r: String(x.r ?? '').slice(0, 2000) }]; }));
    } else if (f.type === 'table') {
      const cols = f.cols.filter(c => !c.computed);
      v = (Array.isArray(v) ? v : []).slice(0, 100)
        .map(row => Object.fromEntries(cols.map(c => [c.k, String((row || {})[c.k] ?? '').trim().slice(0, 2000)])))
        .filter(row => Object.values(row).some(Boolean));
      for (const row of v) for (const c of cols) {
        const x = row[c.k]; if (!x) continue;
        if (c.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(x)) fail(400, `${f.label}: ${c.label} must be a date.`);
        if (c.type === 'score' && !/^[1-5]$/.test(x)) fail(400, `${f.label}: ${c.label} must be a whole number from 1 to 5.`);
        if (c.type === 'number' && !(Number(x) >= 0)) fail(400, `${f.label}: ${c.label} must be a number.`);
        if (c.options && !c.options.includes(x)) fail(400, `${f.label}: invalid ${c.label} "${x}".`);
        if (c.type === 'user' && !db.prepare('SELECT 1 FROM users WHERE username=?').get(x)) fail(400, `${f.label}: ${c.label} must be a user of the system.`);
        if (c.type === 'dept' && !DEPTS[x]) fail(400, `${f.label}: unknown department "${x}".`);
        if (c.ref) { row[c.k] = x.toUpperCase(); if (!byNumber(row[c.k], c.ref)) fail(400, `${f.label}: no ${c.ref.map(t => MODULES[t].name).join(' / ')} record with number ${row[c.k]}.`); }
      }
      if (f.rowCompute) v = v.map(row => ({ ...row, ...f.rowCompute(row) }));
    } else if (f.type === 'recordref') {
      v = v == null ? '' : String(v).trim().toUpperCase();
      if (v && !byNumber(v, f.refTypes)) fail(400, `${f.label}: no ${f.refTypes.map(t => MODULES[t].name.toLowerCase()).join(' / ')} record with number ${v}.`);
    } else v = v == null ? '' : String(v).slice(0, 20000);
    if (f.type === 'select' && v && !f.options.includes(v)) fail(400, `Invalid value for ${f.label}`);
    if (f.type === 'url' && v && !/^https?:\/\/[^\s]+$/i.test(v)) fail(400, `${f.label}: enter a web address starting with http:// or https://.`);
    out[f.k] = v;
  }
  return out;
}
const isEmpty = (f, v) => f && f.type === 'checklist' ? !v || f.rows.some(r => !(v[r] && v[r].v))
  : v === '' || v == null || v === false || (Array.isArray(v) && !v.length);
const fmt = (v) => v && typeof v === 'object' && !(Array.isArray(v) && v.every(x => typeof x !== 'object')) ? JSON.stringify(v)
  : Array.isArray(v) ? v.join('; ') : v === true ? 'Yes' : v === false ? 'No' : v;
const LOCKED = new Set(['Effective', 'Superseded', 'Obsolete', 'Completed', 'Closed', 'Cancelled', 'Approved', 'Released',
  'Rejected', 'QP Certified', 'Released to IRT', 'Withdrawn', 'Retired', 'Disqualified', 'Failed', 'Reconciled', 'Voided', 'Optional Approvals', 'Authorized']);
const EDITABLE_ALWAYS = new Set(['vendors', 'customers', 'risks']);
// Dates are ISO yyyy-mm-dd and calculated in UTC so results do not shift with the server time zone or daylight saving
const today = () => now().slice(0, 10);
const utc = (d) => new Date(String(d).slice(0, 10) + 'T00:00:00Z');
const addDays = (d, n) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const x = utc(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const addWorkingDays = (d, n) => { const x = utc(d); while (n > 0) { x.setUTCDate(x.getUTCDate() + 1); if (x.getUTCDay() % 6) n--; } return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);

function verifySignature(user, body) {
  if (!esigCurrent(user)) fail(403, user.esig_accepted ? `Signature registration is older than ${REREGISTER_YEARS} years. Accept the electronic signature statement again (JRS/SOP/QAS/009).` : 'Accept the electronic signature statement before signing.');
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
  snapshot(rec);
}
// ---------- version history: a read-only copy of the record each time its content, status or number changes ----------
let ACTOR = null; // signed-in user and reason of the request being handled (set by the HTTP handler)
function snapshot(rec, user = ACTOR && ACTOR.user) {
  const data = JSON.stringify(rec.data), last = db.prepare('SELECT no, status, number, data FROM versions WHERE record_id=? ORDER BY no DESC LIMIT 1').get(rec.id);
  if (last && last.status === rec.status && last.number === rec.number && last.data === data) return;
  db.prepare('INSERT INTO versions (record_id,no,ts,username,fullname,status,number,data,reason) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(rec.id, last ? last.no + 1 : 1, now(), user ? user.username : 'system', user ? user.fullname : 'System', rec.status, rec.number, data, (ACTOR && ACTOR.reason) || null);
}
function createdSummary(rec) {
  const parts = [`Status: ${rec.status}`];
  for (const f of MODULES[rec.type].fields) {
    const v = rec.data[f.k]; if (!f.k || f.type === 'computed' || v === '' || v == null || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${f.label.split(' (')[0]}: ${f.type === 'user' || f.fmt === 'user' ? userLabel(v) : f.type === 'table' ? v.length + ' row(s)' : f.type === 'checklist' ? 'completed' : fmt(v)}`);
  }
  return parts.join('; ');
}
function createRecord(user, type, data, ip, reasonText) {
  const mod = MODULES[type];
  for (const f of mod.fields) if (f.k && data[f.k] === undefined && f.def !== undefined) data[f.k] = f.def;
  // modules with a request stage get a temporary request number; the record number is assigned later (see AFTER)
  if (mod.fields.some(f => f.k === 'dateOpened') && !mod.tempNumbering) data.dateOpened = today();
  const rec = { id: uid(), type, number: data.__number || nextNumber(type, data, mod.tempNumbering), status: mod.states[0], data };
  delete data.__number;
  if (mod.tempNumbering) data.requestNo = rec.number;
  data.stateEnteredAt = now();
  if (DERIVE[type]) DERIVE[type](rec);
  applyComputed(type, data);
  db.prepare('INSERT INTO records (id,type,number,title,status,data,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(rec.id, type, rec.number, data.title || '', rec.status, JSON.stringify(data), user.username, now(), now());
  rec.created_by = user.username;
  snapshot(rec, user);
  // one entry with every value entered (instead of one "Field set" entry per field)
  audit(user, 'Record created', rec, null, null, createdSummary(rec), reasonText, ip);
  linkRefs(user, rec, ip);
  return rec;
}

// ---------- linked records (investigation ↔ CAPA ↔ change control ↔ extension …) ----------
function byNumber(number, types) {
  const r = rowToRecord(db.prepare('SELECT * FROM records WHERE number=? AND deleted=0 ORDER BY created_at DESC LIMIT 1').get(String(number || '').trim().toUpperCase()));
  return r && (!types || types.includes(r.type)) ? r : null;
}
function link(user, r1, r2, ip) {
  if (!r1 || !r2 || r1.id === r2.id) return;
  const [a, b] = [r1.id, r2.id].sort();
  if (db.prepare('SELECT 1 FROM links WHERE a=? AND b=?').get(a, b)) return;
  db.prepare('INSERT INTO links (a,b,created_by,ts) VALUES (?,?,?,?)').run(a, b, user.username, now());
  audit(user, 'Record linked', r1, 'link', null, r2.number, null, ip);
  audit(user, 'Record linked', r2, 'link', null, r1.number, null, ip);
}
function linked(id) {
  return db.prepare('SELECT r.* FROM links l JOIN records r ON r.id = CASE WHEN l.a=? THEN l.b ELSE l.a END WHERE (l.a=? OR l.b=?) AND r.deleted=0 ORDER BY r.created_at')
    .all(id, id, id).map(rowToRecord);
}
function linkRefs(user, rec, ip) {
  for (const f of MODULES[rec.type].fields) {
    if (f.type === 'recordref' && rec.data[f.k]) link(user, rec, byNumber(rec.data[f.k], f.refTypes), ip);
    if (f.type === 'table') for (const c of f.cols.filter(c => c.ref)) for (const row of rec.data[f.k] || []) if (row[c.k]) link(user, rec, byNumber(row[c.k], c.ref), ip);
  }
}
// Form sections: who may change a section's fields at which stage (section opts.edit in modules.js)
function sectionOf(mod, k) { let s = null; for (const f of mod.fields) { if (f.type === 'section') s = f; else if (f.k === k) return s; } return null; }
// pseudo-roles: initiator, responsible (person), respdept (member of the responsible department), depthead (Head approving the record)
const canEditSection = (s, rec, user) => !s || !s.edit || (s.edit[rec.status] || []).some(r =>
  r === 'initiator' ? rec.created_by === user.username : r === 'responsible' ? rec.data.respPerson === user.username
    : r === 'respdept' ? !!user.department && user.department === rec.data.respDept : r === 'depthead' ? rec.data.hodApprover === user.username
    : hasRole(user, [r])) || (allAccess(user) && (s.edit[rec.status] || []).length > 0);
// Confidential modules: hideFrom = invisible to users whose roles are all listed (e.g. external auditors);
// visibleTo = visible only to users holding one of the listed roles (e.g. audit trail reviews: QA and admin)
const hiddenFor = (user, type) => {
  const m = MODULES[type]; if (!m) return false;
  if (allAccess(user)) return false;
  if (m.visibleTo && !user.roles.some(r => m.visibleTo.includes(r))) return true;
  return !!m.hideFrom && user.roles.every(r => m.hideFrom.includes(r));
};
const HIDEABLE = Object.keys(MODULES).filter(k => MODULES[k].hideFrom || MODULES[k].visibleTo);
// The audit trail, record history and version history are visible to QA, administrators and management only
const canSeeAudit = (user) => user.roles.includes('qa') || allAccess(user);
const needAudit = (user) => { if (!canSeeAudit(user)) fail(403, 'The audit trail and version history are visible to QA, administrators and management only.'); };
// Department-scoped modules (modules.js "deptScoped"): only the initiator, the responsible person, members of the responsible
// department, the Heads above it and the approving Head see the record – plus QA, admin, management and read-only inspectors.
// Project managers see events that go to the customer.
function canSee(user, rec) {
  if (!MODULES[rec.type] || hiddenFor(user, rec.type)) return false;
  if (!MODULES[rec.type].deptScoped || allAccess(user) || user.roles.includes('qa') || user.roles.includes('extaud')) return true;
  const d = rec.data, me = user.username;
  if (rec.created_by === me || d.respPerson === me || d.hodApprover === me) return true;
  if (d.respDept && (user.department === d.respDept || (user.deptsUnder || []).includes(d.respDept))) return true;
  return user.roles.includes('pm') && (rec.status === 'Customer Approval' || (rec.status === 'Closed' && d.customerApproval && !String(d.customerApproval).startsWith('Not applicable')));
}
function visibleRecord(user, rec) { if (!canSee(user, rec)) fail(404, 'Record not found'); return rec; }

// ---------- SOP business rules ----------
// Derived values recalculated whenever a record is created, edited or moves state.
const DERIVE = {
  // JRS/SOP/QAS/022: investigation complete within 30 calendar days of opening; Critical events within 10 working days
  // suppliers: requalification date suggested from the effective date and the risk level frequency
  vendors: (r) => { const d = r.data; if (d.effectiveDate && !d.requalDate && supRisk(d).months) d.requalDate = addMonths(d.effectiveDate, supRisk(d).months); },
  changes: (r) => { r.data.respDept = r.data.respPerson ? userDept(r.data.respPerson) : ''; },
  investigations: (r) => { const d = r.data; d.respDept = d.respPerson ? userDept(d.respPerson) : ''; d.dueDate = !d.criticality ? '' : d.criticality === 'Critical' ? addWorkingDays(d.dateOpened, 10) : addDays(d.dateOpened, 30); },
  // JRS/SOP/QAS/021: titles in capitals, "[GLB]" when the document applies to more than one site
  documents: (r) => { const d = r.data, base = String(d.title || '').replace(/^\[GLB\]\s*/i, '').toUpperCase(); d.title = ((d.sites || []).length > 1 ? '[GLB] ' : '') + base; }
};
const need = (ok, msg) => { if (!ok) fail(400, msg); };
const blank = (v) => v === '' || v == null || (Array.isArray(v) && !v.length);
const ecMonths = (v) => parseInt(v, 10) || 0;
// Form JRS/FRM/QAS/045 – which due date an extension request moves
const ER_FIELDS = { 'Overall due date': ['dueDate', 'extendedDue'], 'Correction (CAPA)': ['corrDue', 'corrExt'], 'Corrective action (CAPA)': ['caDue', 'caExt'], 'Preventive action (CAPA)': ['paDue', 'paExt'] };
function erCheck(d, selfId) {
  const target = byNumber(d.documentId, ['investigations', 'capa', 'changes', 'selfinspections']);
  if (!target) fail(400, `No deviation, complaint, CAPA, change control or self-inspection with number ${d.documentId}.`);
  if (LOCKED.has(target.status) || target.status.startsWith('Closed')) fail(400, `${target.number} is ${target.status}. Extensions apply only to open records.`);
  const scope = d.scope || 'Overall due date';
  if (scope !== 'Overall due date' && target.type !== 'capa') fail(400, 'Action-level extensions apply to CAPA only.');
  const [dueK, extK] = ER_FIELDS[scope];
  const due = target.data[dueK];
  if (!due) fail(400, `${target.number} has no ${scope.toLowerCase()} to extend yet.`);
  if (target.data[extK]) fail(400, `${target.number} has already been extended once. Only one extension is allowed.`);
  const other = db.prepare("SELECT * FROM records WHERE type='extensions' AND deleted=0 AND status<>'Rejected' AND id<>?").all(selfId || '')
    .map(rowToRecord).find(x => x.data.documentId === target.number && (x.data.scope || 'Overall due date') === scope);
  if (other) fail(400, `Extension request ${other.number} already exists for ${target.number}. Only one extension is allowed.`);
  if (today() > due) fail(400, `The due date ${due} has passed. An extension must be requested and approved before the due date.`);
  if (!(d.requestedDate > due)) fail(400, `The requested extension date must be later than the current due date (${due}).`);
  return { target, extK, due };
}
// Named checks referenced by transitions in modules.js (opts.checks)
const CHECKS = {
  isInitiator: (r, u) => { if (r.created_by !== u.username && !allAccess(u)) fail(403, 'Only the initiator completes and submits this part.'); },
  // deviations and complaints: Part A by the initiator or the responsible department, Part C by the responsible person / department,
  // Part D by the Head of the responsible department (from the organogram)
  isPartAOwner: (r, u) => { if (![r.created_by, r.data.respPerson].includes(u.username) && !(u.department && u.department === r.data.respDept) && !allAccess(u)) fail(403, 'Only the initiator, the responsible person or the responsible department submits Part A.'); },
  isPartCOwner: (r, u) => { if (r.data.respPerson !== u.username && !(u.department && u.department === r.data.respDept) && !allAccess(u)) fail(403, 'Only the responsible person or the responsible department can do this step.'); },
  hodAvailable: (r) => need(hodFor(r.data.respDept, r.data.respPerson), `No Head of Department can approve for ${DEPTS[r.data.respDept] || 'the responsible department'}. Ask management or the Head of QA to set the Head in the organogram.`),
  // extension requests: the Head of the department responsible for the record being extended (organogram)
  erHod: (r, u) => {
    const t = byNumber(r.data.documentId), dept = t && (t.data.respDept || t.data.auditeeDept);
    if (dept && !allAccess(u) && !u.deptsUnder.includes(dept)) fail(403, `Only the Head of ${DEPTS[dept] || dept} (organogram) approves this extension.`);
  },
  isHodApprover: (r, u) => { if (r.data.hodApprover !== u.username && !allAccess(u)) fail(403, `Only the Head of Department named on the record (${userLabel(r.data.hodApprover)}) can approve or reject.`); },
  // audit trail review
  atrPeriod: (r) => need(r.data.periodFrom <= r.data.periodTo && r.data.periodTo <= today(), 'The review period must end today or earlier, and start before it ends.'),
  atrOutcome: (r) => { if (String(r.data.anomalies).startsWith('Anomalies')) need(r.data.investigationRef, 'Anomalies found: raise a deviation or CAPA and enter its number.'); },
  // JRS/SOP/QAS/021 – documents
  docRevisionCC: (r) => {
    if (!String(r.data.revisionType).startsWith('Revision')) return;
    const cc = byNumber(r.data.changeControl, ['changes']);
    need(cc && CC_APPROVED.includes(cc.status), 'A revision with technical or procedural changes needs an approved change control (JRS/SOP/QAS/007).');
  },
  isReviewer: (r, u) => { if (r.data.reviewer !== u.username) fail(403, 'Only the assigned reviewer can perform this step.'); },
  deptApprovalsDone: (r) => {
    const cfg = MODULES[r.type].deptApproval, done = (r.data.deptApprovals || []).map(a => a.dept), open = (r.data[cfg.field] || []).filter(x => !done.includes(x));
    need(!open.length, `${cfg.label} outstanding: ${open.join(', ')}.`);
  },
  docEffective8: (r) => need(r.data.effectiveDate >= addDays(today(), 8) || !blank(r.data.shortNotice), `The effective date must be at least 8 calendar days after approval (${addDays(today(), 8)} or later), or QA must justify the shorter period.`),
  docEffectiveToday: (r) => need(today() >= r.data.effectiveDate, `The document becomes effective on ${r.data.effectiveDate}.`),
  docTrainingDone: (r) => {
    const open = db.prepare("SELECT * FROM records WHERE type='training' AND deleted=0 AND status NOT IN ('Completed','Cancelled')").all().map(rowToRecord)
      .filter(t => t.data.docRef === r.number && t.data.docVersion === r.data.version);
    need(!open.length, `Training must be completed before the effective date: ${open.length} assignment(s) open (${open.map(t => userLabel(t.data.trainee)).join(', ')}).`);
  },
  docDiscontinueCC: (r) => need(linked(r.id).some(x => x.type === 'changes' && CC_APPROVED.includes(x.status)), 'Discontinuation needs a pre-approved change control linked to this document.'),
  // JRS/SOP/QAS/003 – training
  isTrainee: (r, u) => { if (r.data.trainee !== u.username) fail(403, 'Only the trainee can sign this step.'); },
  isTrainer: (r, u) => { if (r.data.trainer !== u.username) fail(403, 'Only the assigned trainer can sign this step.'); },
  certifiedTrainer: (r, u) => need(db.prepare("SELECT data FROM records WHERE type='trainers' AND status='Certified' AND deleted=0").all().some(x => JSON.parse(x.data).trainer === u.username), `${u.fullname} is not on the list of certified trainers (FRM/QAS/033).`),
  trSelfReading: (r) => need(String(r.data.trainingType).startsWith('Self-reading') && !r.data.assessment, 'Only self-reading (Manager and above) without assessment is signed by the trainee alone; other training is evaluated by a certified trainer.'),
  trNotSelfReading: (r) => need(!String(r.data.trainingType).startsWith('Self-reading'), 'Self-reading is signed as read and understood.'),
  trPass: (r) => {
    if (!r.data.assessment) return;
    const s = trainingScore(r.data);
    need(s != null, 'Record the assessment marks (FRM/QAS/034).');
    need(s >= PASS_MARK, `Score ${s}% is below the pass mark of ${PASS_MARK}%: record the unsatisfactory result and retrain.`);
    if (s < 100) need(!blank(r.data.gapTopic), `Score ${s}%: record the topic the trainee did not understand and that it was explained again.`);
  },
  trFail: (r) => { const s = trainingScore(r.data); need(r.data.assessment && s != null && s < PASS_MARK, 'Only an assessment score below 80% is recorded as unsatisfactory.'); },
  tniPlan: (r) => {
    const rows = r.data.plan || [];
    rows.forEach((x, i) => need(x.subject && x.type, `Training subject ${i + 1}: enter the subject and type.`));
    need(rows.some(x => /\/QAS\//.test(x.refDoc || '')), 'The TNI must include QA SOPs (JRS/SOP/QAS/…).');
  },
  tniDone: (r) => {
    const open = db.prepare("SELECT * FROM records WHERE type='training' AND deleted=0 AND status NOT IN ('Completed','Cancelled')").all().map(rowToRecord).filter(t => t.data.sourceRecord === r.number);
    need(!open.length, `${open.length} training assignment(s) from this TNI are not completed yet.`);
  },
  trainerScores: (r) => {
    let total = 0;
    for (const [k, label, max] of TRAINER_PARAMS) { const v = r.data[k]; need(v !== '' && v != null && +v >= 0 && +v <= max, `${label}: enter a score from 0 to ${max}.`); total += +v; }
    need(total >= TRAINER_PASS, `Total ${total} of 100 is below the acceptance criterion of ${TRAINER_PASS}.`);
  },
  // JRS/SOP/QAS/012 – record retention
  arLocation: (r) => {
    if (!String(r.data.location).startsWith('Off-site')) return;
    const v = byNumber(r.data.vendor, ['vendors']);
    need(v && v.status === 'Approved', 'Off-site storage needs a qualified, approved vendor (audit, qualification checklist, confidentiality and service agreement).');
  },
  arRetrievalOpen: (r) => { const x = (r.data.retrievals || []).slice(-1)[0]; need(x && x.date && x.by && x.purpose && !x.returned, 'Record the retrieval request (date, requested by, purpose) in the retrieval log.'); },
  arRetrievalClosed: (r) => { const x = (r.data.retrievals || []).slice(-1)[0]; need(x && x.returned && x.rearchived, 'Record the return date and re-archival date in the retrieval log.'); },
  arDestroy: (r) => {
    const d = r.data, y = RETENTION[d.recordType];
    need(y !== 'Permanent', `${d.recordType} are kept permanently.`);
    const from = MODULES.archives.compute.destroyFrom(d);
    need(today() >= from || (!blank(d.client) && !blank(d.clientRetention)), `The retention period ends on ${from}. Earlier destruction only on the client's documented instruction.`);
  },
  isResponsible: (r, u) => { if (![r.created_by, r.data.respPerson].includes(u.username) && !u.roles.includes('qa')) fail(403, 'Only the initiator, the responsible person or QA can submit this step.'); },
  capaDecision: (r) => need(r.data.capaRequired !== 'No' || !blank(r.data.capaJustification), 'Justify why no CAPA is required (JRS/SOP/QAS/022).'),
  capaLinked: (r) => need(r.data.capaRequired !== 'Yes' || linked(r.id).some(x => x.type === 'capa'), 'CAPA is marked as required: raise or link the CAPA before QA approval.'),
  customerInvolved: (r) => need(!String(r.data.customerApproval).startsWith('Not applicable'), 'Customer approval is "Not applicable": use "QA approve and close".'),
  customerNotInvolved: (r) => need(String(r.data.customerApproval).startsWith('Not applicable'), 'This event needs customer approval. Use "QA approve – send report to customer", or set customer approval to "Not applicable" if there is no customer impact.'),
  customerClosure: (r) => {
    const d = r.data;
    if (d.customerApproval === 'Approved by customer') return;
    need(String(d.customerApproval).startsWith('Deemed closed'), 'Record the customer approval, or deemed closure after 3 follow-ups within 45 days.');
    need(d.reportSent, 'Enter the date the QA-approved report was shared with the customer.');
    const f = [d.followUp1, d.followUp2, d.followUp3].filter(Boolean);
    need(f.length === 3 && f.every(x => x >= d.reportSent), 'Deemed closure needs 3 customer follow-ups after the report was shared.');
    need(daysBetween(d.reportSent, today()) >= 45, `Deemed closure is possible 45 days after the report was shared (from ${addDays(d.reportSent, 45)}).`);
  },
  capaPlan: (r) => {
    const d = r.data, acts = [['correction', 'corrDue', 'Correction'], ['corrective', 'caDue', 'Corrective action'], ['preventive', 'paDue', 'Preventive action']].filter(([k]) => !blank(d[k]));
    need(acts.length, 'Propose at least one correction, corrective action or preventive action.');
    for (const [, due, label] of acts) need(d[due], `${label}: enter the target due date.`);
  },
  capaImplemented: (r) => {
    const d = r.data;
    for (const [k, done, date, label] of [['correction', 'corrDone', 'corrDate', 'Correction'], ['corrective', 'caDone', 'caDate', 'Corrective action'], ['preventive', 'paDone', 'paDate', 'Preventive action']])
      if (!blank(d[k])) need(!blank(d[done]) && d[date], `${label}: record what was done and the implementation date (Part C).`);
  },
  ecDecision: (r) => {
    if (r.data.ecRequired === 'Not required') need(!blank(r.data.ecReason), 'Give the reason why no effectiveness check is required.');
    else need(ecMonths(r.data.ecDue), 'Select when the effectiveness check is due (3, 6, 9 or 12 months).');
  },
  ecIsRequired: (r) => need(r.data.ecRequired === 'Required', 'No effectiveness check is required: use "Close – CAPA completed".'),
  ecNotRequired: (r) => need(r.data.ecRequired === 'Not required', 'An effectiveness check is required: use "Close – effectiveness check pending".'),
  ccDue90: (r) => { const from = r.data.dateOpened || today(); if (r.data.nature === 'Permanent') need(r.data.dueDate <= addDays(from, 90), `A permanent change must be due within 90 days (by ${addDays(from, 90)}).`); },
  ccTemp: (r) => { if (r.data.nature === 'Temporary') need(r.data.tempStart && r.data.tempEnd && r.data.tempEnd >= r.data.tempStart, 'Temporary change: enter the start and end dates (end on or after start).'); },
  ccRiskClass: (r) => { if (['Major', 'Critical'].includes(r.data.classification)) need(r.data.riskRequired === 'Required', `${r.data.classification} changes require a risk assessment (JRS/SOP/QAS/020).`); },
  ccRiskRef: (r) => { if (r.data.riskRequired === 'Required') need(r.data.riskRef, 'Enter the risk assessment reference.'); },
  ccClientPm: (r) => { if (r.data.clientPre === 'Required' || r.data.clientPost === 'Required') need(r.data.pm, 'Name the person responsible for client communication.'); },
  ccOptional: (r) => {
    const done = (r.data.deptApprovals || []).map(a => a.dept), open = (r.data.optionalDepts || []).filter(x => !done.includes(x));
    need(!open.length, 'Optional approvals outstanding: ' + open.join(', ') + '.');
  },
  // change control: responsible person, Head of Department, department report, effectiveness check after its period
  // customers (JRS/FRM/QAS/010)
  custLicenceValid: (r) => need(r.data.licenceExpiry >= today(), `The licence expired on ${r.data.licenceExpiry}. Obtain the current licence before qualification.`),
  // suppliers (JRS/SOP/QAS/005): the evaluation required by the risk assessment is complete
  supEvaluationDone: (r) => {
    const d = r.data, a = supRisk(d).audit;
    need(a, 'Complete the risk assessment first.');
    // documents of this qualification cycle, by document type
    const has = (cat) => !!db.prepare('SELECT 1 FROM attachments WHERE record_id=? AND category=? AND ts>=? LIMIT 1').get(r.id, cat, d.cycleStartedAt || '');
    need(d.licenceExpiry > today(), `The licence expired on ${d.licenceExpiry}. Record the current licence no. and expiry date.`);
    need(d.requalDate > (d.effectiveDate || today()), 'The requalification date must be after the effective date.');
    if (/Certificate/.test(a)) { need(has('licence'), 'Certificate verification: attach the licence copy.'); need(d.licenceVerified === true, 'Certificate verification: tick "Licence verified" on the checklist.'); }
    if (/uestionnaire/.test(a)) need(has('questionnaire'), 'Supplier questionnaire: attach the filled questionnaire.');
    if (/ite audit/.test(a)) { need(d.auditDate && d.auditCertDate, 'Site audit: record the audit date and the audit certificate date.'); need(has('auditCert'), 'Site audit: attach the audit certificate.'); }
  },
  // the Head of the requesting department reviews the supplier risk assessment; never the QA person who prepared it
  supHodAvailable: (r, u) => need(hodFor(r.data.requesterDept, u.username), `No Head of Department in the organogram can review the risk assessment${r.data.requesterDept ? ' for ' + (DEPTS[r.data.requesterDept] || r.data.requesterDept) : ' (the request has no department)'}. Ask management or the Head of QA to set one.`),
  custReviewDate: (r) => need(r.data.reviewDate > today(), 'Set the next review date (after today).'),
  custDocuments: (r) => need(db.prepare('SELECT 1 FROM attachments WHERE record_id=? LIMIT 1').get(r.id), 'Attach the completed customer form and the licence copies before qualification.'),
  isRespPerson: (r, u) => { if (r.data.respPerson !== u.username && !allAccess(u)) fail(403, `Only the responsible person (${userLabel(r.data.respPerson)}) can review this step.`); },
  isCcDept: (r, u) => { if (![r.created_by, r.data.respPerson].includes(u.username) && !(u.department && u.department === r.data.respDept) && !allAccess(u)) fail(403, 'Only the initiator, the responsible person or the responsible department can do this step.'); },
  ccHasOptional: (r) => need((r.data.optionalDepts || []).length, 'No other departments are named: use "Approve – QA (pre-approval complete)".'),
  ccNoOptional: (r) => need(!(r.data.optionalDepts || []).length, 'Other departments are named for approval: use "Approve – QA (send to other departments)".'),
  ccNeedsEC: (r) => need(r.data.ecRequired === 'Required', 'No effectiveness check is required: use "Close – QA report".'),
  ccNoEC: (r) => need(r.data.ecRequired !== 'Required', 'An effectiveness check is required: use "Close – effectiveness check pending".'),
  ccEcDue: (r) => need(!r.data.ecDueDate || today() >= r.data.ecDueDate, `The effectiveness check is due on ${r.data.ecDueDate}, after the assigned period.`),
  ccPlanClosed: (r) => { const open = (r.data.plan || []).filter(p => !p.closed); need(!open.length, `${open.length} implementation activit${open.length === 1 ? 'y is' : 'ies are'} not closed yet.`); },
  ccClientComm: (r) => {
    if (r.data.clientPost === 'Required') need(r.data.clientCommunicated === 'Yes', 'Client post-communication is required: confirm the client was communicated.');
    else need(r.data.clientCommunicated, 'Record whether the client was communicated.');
  },
  ccRestored: (r) => { if (r.data.nature === 'Temporary') need(r.data.restored, 'Temporary change: record whether the original condition was restored.'); },
  erValid: (r) => { erCheck(r.data, r.id); },

  // JRS/SOP/QAS/004 – self-inspection
  siTeam: (r) => {
    const d = r.data;
    need(d.leadAuditor && d.coAuditor && d.leadAuditor !== d.coAuditor, 'At least two auditors are required: a lead auditor and a co-auditor.');
    const team = [d.leadAuditor, d.coAuditor].map(u => ({ u, a: qualifiedAuditor(u, 'Self-inspection') }));
    for (const x of team) need(x.a, `${userLabel(x.u)} is not on the list of qualified self-inspection auditors (FRM/QAS/039).`);
    for (const x of team) need(x.a.data.department !== d.auditeeDept, `${userLabel(x.u)} belongs to the audited department (${d.auditeeDept}) and cannot audit it.`);
    if (d.auditeeDept !== 'QAS') {
      need(team[0].a.data.department === 'QAS', 'The lead auditor must be a QA expert (qualified auditor from QAS).');
      need(team[1].a.data.department !== 'QAS', 'The co-auditor must be cross-functional (not from QAS).');
    }
    need(![d.leadAuditor, d.coAuditor].includes(d.auditee), 'The auditee cannot be on the audit team.');
  },
  siSchedule: (r) => {
    const d = r.data;
    if (!d.scheduleRef) return need(d.unscheduledTrigger, 'Link the annual schedule, or record the trigger for an unscheduled self-inspection.');
    const s = byNumber(d.scheduleRef, ['sischedule']);
    need(s && s.status === 'Approved', `Schedule ${d.scheduleRef} is not approved.`);
    const row = (s.data.plan || []).find(p => p.dept === d.auditeeDept);
    need(row, `${d.auditeeDept} is not on schedule ${s.number}. Record the self-inspection as unscheduled or revise the schedule.`);
    const p = utc(d.plannedDate), diff = p.getUTCMonth() + 12 * (p.getUTCFullYear() - +s.data.year) - MONTHS.indexOf(row.month);
    need(Math.abs(diff) <= 1, `${d.auditeeDept} is scheduled for ${row.month}: a self-inspection may be advanced or postponed by one month at most.`);
    if (diff) need(d.postponeReason, 'Record why the self-inspection was advanced or postponed.');
  },
  siNotice: (r) => need(addWorkingDays(r.data.notifiedOn, 3) <= r.data.plannedDate, 'The auditee must be notified at least 3 working days before the self-inspection.'),
  isAuditor: (r, u) => { if (![r.data.leadAuditor, r.data.coAuditor].includes(u.username)) fail(403, 'Only the assigned auditors can perform this step.'); },
  isLeadAuditor: (r, u) => { if (r.data.leadAuditor !== u.username) fail(403, 'Only the lead auditor can perform this step.'); },
  isAuditee: (r, u) => { if (r.data.auditee !== u.username) fail(403, 'Only the auditee (CAPA plan owner) can submit the response.'); },
  siReport: (r) => {
    const d = r.data;
    need(d.reportDate >= d.auditDate && daysBetween(d.auditDate, d.reportDate) <= 15, 'The report must be issued within 15 calendar days of the self-inspection.');
    (d.observations || []).forEach((o, i) => need(o.category && o.description, `Observation ${o.no || i + 1}: enter the category and description.`));
  },
  siResponse: (r) => (r.data.observations || []).forEach((o, i) => need(o.corrective && o.caDue && o.responsible, `Observation ${o.no || i + 1}: enter the corrective action, its due date and the responsible person.`)),
  siClosure: (r) => (r.data.observations || []).forEach((o, i) => {
    need(o.capa, `Observation ${o.no || i + 1}: every audit finding is answered through a CAPA (JRS/SOP/QAS/006) – enter the CAPA number.`);
    need(o.status === 'Complied', `Observation ${o.no || i + 1} is not yet complied with.`);
  }),
  sisMinimum: (r) => {
    const rows = (r.data.plan || []).filter(p => p.dept && p.month);
    need(rows.length >= 4, `At least four self-inspections a year are required (${rows.length} scheduled).`);
  },
  // JRS/SOP/QAS/002 – external audit
  eaFindings: (r) => (r.data.findings || []).forEach((f, i) => need(f.finding && f.category, `Finding ${f.no || i + 1}: enter the finding and its category.`)),
  eaResponse: (r) => (r.data.findings || []).forEach((f, i) => need(f.response && f.due, `Finding ${f.no || i + 1}: every finding needs a response with action items and a due date.`)),
  eaClosure: (r) => (r.data.findings || []).forEach((f, i) => {
    if (f.category !== 'Observation') need(f.capa, `Finding ${f.no || i + 1}: every audit finding is answered through a CAPA (JRS/SOP/QAS/006) – enter the CAPA number.`);
    need(f.status === 'Closed', `Finding ${f.no || i + 1} is still open.`);
  }),
  // JRS/SOP/QAS/020 – quality risk management
  raScores: (r) => {
    const rows = r.data.fmea || [];
    need(rows.length, 'Add at least one failure mode to the FMEA.');
    rows.forEach((x, i) => need(x.mode && x.s && x.o && x.d, `FMEA row ${x.id || i + 1}: enter the failure mode and scores for S, O and D.`));
  },
  raCriticalOpen: (r) => need((r.data.fmea || []).some(x => x.level === 'Critical' && blank(x.mitigation)), 'Senior leadership acceptance is only needed for a Critical risk without mitigation.'),
  raActions: (r) => {
    const accepted = db.prepare("SELECT content_hash FROM signatures WHERE record_id=? AND meaning LIKE 'Risk accepted%'").all(r.id).some(s => s.content_hash === contentHash(r));
    (r.data.fmea || []).forEach((x, i) => {
      const lab = `FMEA row ${x.id || i + 1}`, open = blank(x.mitigation);
      need(x.accept, `${lab}: record whether the risk is accepted.`);
      if (open && x.level === 'Major') need(x.comments, `${lab}: a Major risk without mitigation needs a justification.`);
      if (open && x.level === 'Critical') {
        need(x.comments, `${lab}: a Critical risk without mitigation needs a justification.`);
        need(accepted, `${lab}: a Critical risk without mitigation needs senior leadership acceptance.`);
      }
      if (x.accept === 'Yes' && (x.s === '5' || x.ps === '5')) need(x.comments, `${lab}: accepting a risk with severity 5 must be justified.`);
    });
  },
  raResidual: (r) => (r.data.fmea || []).forEach((x, i) => { if (!blank(x.mitigation)) need(x.ps && x.po && x.pd, `FMEA row ${x.id || i + 1}: score the residual risk (post-action S, O and D).`); }),
  // JRS/SOP/QAS/019 – management review
  qmrAttendance: (r) => {
    const rows = r.data.attendees || [];
    need(rows.length, 'Record the attendance.');
    for (const a of rows.filter(x => x.mandatory === 'Yes')) need(a.name && a.attendance === 'Present', `Mandatory attendee "${a.designation || a.name}" must be present.`);
  },
  qmrMinutes: (r) => {
    const d = r.data;
    need(d.metrics, 'Compile the QMR data first.');
    (d.prevActions || []).forEach((a, i) => need(a.update && a.status, `Previous action ${i + 1}: record the update and status.`));
    (d.actions || []).forEach((a, i) => need(a.recommendation && a.responsibility && a.target, `Action ${i + 1}: enter the recommendation, responsibility and target date.`));
  }
};
// Audit trail review (EU GMP Annex 11 §9, data integrity): what happened in the period, and the events a reviewer looks at first
function auditSummary(from, to, scope) {
  const types = scope.filter(s => s !== 'system'), system = !scope.length || scope.includes('system');
  const rows = db.prepare('SELECT a.*, r.type AS record_type FROM audit a LEFT JOIN records r ON r.id = a.record_id WHERE a.ts >= ? AND a.ts < ? ORDER BY a.id')
    .all(from, addDays(to, 1)).filter(a => !scope.length || (a.record_type ? types.includes(a.record_type) : system));
  const top = (key) => { const m = new Map(); for (const a of rows) m.set(a[key] || '—', (m.get(a[key] || '—') || 0) + 1); return [...m].sort((x, y) => y[1] - x[1]).slice(0, 20); };
  const flags = [
    ['Failed sign-ins', /^Login failed/], ['Accounts locked', /^Account locked/], ['Failed e-signatures', /^E-signature failed/],
    ['User accounts created or changed (roles, activation, password resets)', /^User (created|roles changed|activated|deactivated|unlocked)|^Password reset/],
    ['Field changes (each with a reason)', /^Field changed/], ['Records exported or printed', /^Record (exported|printed)/],
    ['Attachments downloaded', /^Attachment downloaded/], ['Unblinded randomization lists viewed', /^Unblinded list viewed/],
    ['Audit trail exported, printed or viewed per record', /^Audit trail (exported|report printed)|^Version history viewed/]
  ].map(([label, re]) => [label, rows.filter(a => re.test(a.action)).length]);
  const chain = verifyAudit();
  return { generatedAt: now(), period: { from, to }, scope: scope.length ? scope : ['All modules and system events'], total: rows.length,
    records: new Set(rows.map(a => a.record_id).filter(Boolean)).size, byUser: top('fullname'), byAction: top('action'), flags,
    chain: { ok: chain.ok, checked: chain.checked, brokenAt: chain.brokenAt || null } };
}
function assignNumber(u, r, ip) {
  if (!r.number.startsWith('REQ-')) return; // already numbered (e.g. returned to the initiator and re-submitted)
  const old = r.number;
  r.number = nextNumber(r.type, r.data); r.data.dateOpened = today();
  db.prepare('UPDATE records SET number=? WHERE id=?').run(r.number, r.id);
  audit(u, 'Record number assigned', r, 'number', old, r.number, null, ip);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const userLabel = (u) => (db.prepare('SELECT fullname FROM users WHERE username=?').get(u) || {}).fullname || u;
function qualifiedAuditor(username, scope) {
  return db.prepare("SELECT * FROM records WHERE type='auditors' AND status='Qualified' AND deleted=0").all().map(rowToRecord)
    .find(r => r.data.auditor === username && (r.data.scope || []).some(s => s.startsWith(scope)));
}
// the approving Head of Department comes from the organogram whenever a record reaches a Head of Department step
function assignHod(u, r, ip) {
  const old = r.data.hodApprover; r.data.hodApprover = hodFor(r.data.respDept, r.data.respPerson);
  if (old !== r.data.hodApprover) audit(u, 'Approver assigned from the organogram', r, 'hodApprover', old, r.data.hodApprover, null, ip);
}
// Side effects after a state change, keyed "module:new state"
const AFTER = {
  // the designated number generator assigns the record number once QA has approved the request
  'investigations:Initiation': (u, r, ip) => assignNumber(u, r, ip),
  // the approving Head of Department comes from the organogram when the investigation is submitted
  'investigations:HOD Approval': (u, r, ip) => assignHod(u, r, ip),
  // approved supplier list: approval date of this qualification cycle (effective and requalification dates are set by QA)
  'vendors:Approved': (u, r) => { r.data.approvedOn = today(); },
  'vendors:HOD Review': (u, r, ip) => { const old = r.data.hodApprover; r.data.hodApprover = hodFor(r.data.requesterDept, u.username); if (old !== r.data.hodApprover) audit(u, 'Approver assigned from the organogram', r, 'hodApprover', old, r.data.hodApprover, null, ip); },
  // requalification: the same process again – the finished cycle goes to the history, its review results are cleared
  'vendors:Risk Assessment': (u, r, ip) => {
    const d = r.data; if (!d.approvedOn) return; // returned from the quality review in the same cycle
    const cycle = (d.qualHistory || []).length + 1;
    (d.qualHistory ||= []).push({ cycle: String(cycle), riskLevel: `${d.riskLevel || ''} (${d.rpn || ''})`, auditType: d.auditType || '', effectiveDate: d.effectiveDate || '', requalDate: d.requalDate || '', outcome: 'Approved ' + d.approvedOn });
    for (const k of ['licenceVerified', 'auditCategory', 'auditMethod', 'auditDate', 'auditLocation', 'leadAuditor', 'auditTeam', 'auditeeRep', 'auditPurpose', 'agenda', 'effectiveDate', 'requalDate', 'auditCertDate', 'approvedOn', 'qaConclusion', 'hodApprover', 'hodComment']) delete d[k];
    d.cycleStartedAt = now();
    audit(u, 'Requalification started', r, 'qualHistory', null, `Cycle ${cycle} archived; new risk assessment and quality review`, null, ip);
  },
  'capa:HOD Pre-Approval': (u, r, ip) => assignHod(u, r, ip),
  'capa:HOD Verification': (u, r, ip) => assignHod(u, r, ip),
  'documents:Approved – Training': (u, r, ip) => { r.data.approvedOn = today(); assignDocTraining(u, r, ip); },
  'documents:Effective': (u, r, ip) => makeEffective(u, r, ip),
  'training:Assigned': (u, r) => { // retraining after an unsatisfactory assessment
    r.data.attempt = String((+r.data.attempt || 1) + 1);
    r.data.questions = (r.data.questions || []).map(q => ({ ...q, obtained: '' })); r.data.gapTopic = '';
  },
  'tni:Training In Progress': (u, r, ip) => {
    for (const row of r.data.plan || []) {
      const doc = row.refDoc ? byNumber(row.refDoc, ['documents']) : null;
      const t = createRecord(u, 'training', { trainee: r.data.employee, title: doc ? `${doc.number} v${doc.data.version} – ${doc.data.title}` : row.subject,
        docRef: doc ? doc.number : '', docVersion: doc ? doc.data.version : '', trainingType: row.type || 'Induction', dueDate: addDays(today(), 30), sourceRecord: r.number, attempt: '1' }, ip, `Assigned from ${r.number}`);
      link(u, r, t, ip);
    }
  },
  'tni:Certified': (u, r) => { r.data.certificateDate = today(); },
  'atreviews:Under Review': (u, r) => { r.data.summary = auditSummary(r.data.periodFrom, r.data.periodTo, r.data.scope || []); },
  'changes:RP Review': (u, r, ip) => assignNumber(u, r, ip),
  'changes:HOD Approval': (u, r, ip) => assignHod(u, r, ip),
  'capa:Effectiveness Check': (u, r) => { r.data.ecDueDate = addMonths(today(), ecMonths(r.data.ecDue)); },
  'capa:Closed': (u, r, ip) => {
    if (r.data.effective !== 'No') return;
    const d = r.data;
    const n = createRecord(u, 'capa', { title: 'Follow-up CAPA – ' + d.title, respDept: d.respDept, respPerson: d.respPerson, dueDate: addDays(today(), 30), source: 'CAPA not effective',
      nonconformance: `Effectiveness check of ${r.number} found the CAPA not effective. ${d.ecQaComment || ''}` }, ip, `Raised automatically: ${r.number} not effective`);
    link(u, r, n, ip);
  },
  'changes:Closed – EC Pending': (u, r) => { r.data.ecDueDate = addMonths(r.data.finalImplDate || today(), ecMonths(r.data.ecDue)); },
  'selfinspections:Report Issued': (u, r) => { r.data.dueDate = addDays(r.data.reportDate, 15); },
  'selfinspections:Response Submitted': (u, r) => { r.data.responseDate = today(); },
  'extensions:Approved': (u, r, ip) => {
    const { target, extK } = erCheck(r.data, r.id);
    const old = target.data[extK]; target.data[extK] = r.data.requestedDate; saveRecord(target);
    audit(u, 'Field changed', target, extK, old, r.data.requestedDate, `Extension request ${r.number} approved`, ip);
  }
};

// ---------- workflow side effects ----------
function onTransition(user, rec, to, ip) {
  if (AFTER[rec.type + ':' + to]) AFTER[rec.type + ':' + to](user, rec, ip);
  if (DERIVE[rec.type]) DERIVE[rec.type](rec);
  applyComputed(rec.type, rec.data);
}

// ---------- JRS/SOP/QAS/021 + 003: document approval assigns training, due before the effective date ----------
function assignDocTraining(user, rec, ip) {
  const d = rec.data;
  if (d.trainingImpact === 'None' || d.revisionType === 'Periodic review – no change' || !(d.trainingRoles || []).length) return 0;
  // the author, reviewer(s) and approver need no separate training
  const exempt = new Set([rec.created_by, d.reviewer, user.username, ...db.prepare('SELECT username FROM signatures WHERE record_id=?').all(rec.id).map(s => s.username)]);
  const users = db.prepare('SELECT username, roles FROM users WHERE active=1').all().filter(u => !exempt.has(u.username) && JSON.parse(u.roles).some(r => d.trainingRoles.includes(r)));
  for (const u of users) createRecord(user, 'training', {
    trainee: u.username, title: `${rec.number} v${d.version} – ${d.title}`, docRef: rec.number, docVersion: d.version,
    trainingType: d.trainingImpact === 'Read & Understand' ? 'SOP training – read & understand' : 'SOP training – instructor-led',
    assessment: d.trainingImpact === 'Assessment required', dueDate: d.effectiveDate, sourceRecord: rec.number, attempt: '1'
  }, ip, `Assigned on approval of ${rec.number} v${d.version}; training due before the effective date`);
  return users.length;
}
function makeEffective(user, rec, ip) {
  const d = rec.data;
  d.nextReview = addDays(d.effectiveDate, Math.round(3 * 365.25)); // periodic review within 3 years
  for (const old of db.prepare("SELECT * FROM records WHERE type='documents' AND number=? AND status='Effective' AND id<>? AND deleted=0").all(rec.number, rec.id).map(rowToRecord)) {
    old.status = 'Superseded'; old.data.supersededOn = today(); old.data.stateEnteredAt = now(); saveRecord(old);
    audit(user, 'Status changed', old, 'status', 'Effective', 'Superseded', `Superseded by version ${d.version} – master stamped SUPERSEDED and archived; issued copies to be retrieved`, ip);
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

route('GET', '/api/health', () => ({ ok: true, org: CFG.orgName, envLabel: CFG.envLabel, sharepoint: !!(CFG.sp.tenant && CFG.sp.clientId && CFG.sp.siteId) }), { public: true });

route('POST', '/api/login', async (ctx) => {
  const { username, password } = ctx.body;
  // sign in with the user ID or the email address
  const id = String(username || '').toLowerCase().trim();
  const u = db.prepare("SELECT * FROM users WHERE username=? OR (email<>'' AND lower(email)=?)").get(id, id);
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
  withOrg(u); u.csrf = csrf;
  return pub(u);
}, { public: true });

route('POST', '/api/logout', (ctx) => { sessions.delete(ctx.user.sid); audit(ctx.user, 'Logout', null, null, null, null, null, ctx.ip); ctx.setCookie = 'qms_sid=; Max-Age=0; Path=/'; return { ok: true }; });
route('GET', '/api/me', (ctx) => ({ ...pub(ctx.user), idleMinutes: CFG.idleMinutes }));
route('GET', '/api/config', () => ({ roles: ROLES, org: CFG.orgName, departments: deptRows(), mail: mailOn() }));

// Departments (System → Departments): everyone can read the list; admin and management create and change departments
route('GET', '/api/departments', () => deptRows());
const DEPT_CODE = /^[A-Z]{2,6}$/;
function checkParent(code, parent) {
  if (!parent) return null;
  const map = deptMap(); if (!map[parent]) fail(400, `Unknown parent department ${parent}.`);
  if (deptChain(parent, map).includes(code)) fail(400, 'A department cannot sit under itself or under one of its own sub-departments.');
  return parent;
}
route('POST', '/api/departments', (ctx) => {
  if (!allAccess(ctx.user)) fail(403, 'Only administrators and management can create departments.');
  const code = String(ctx.body.code || '').trim().toUpperCase(), name = String(ctx.body.name || '').trim().slice(0, 80);
  if (!DEPT_CODE.test(code)) fail(400, 'Department code: 2–6 capital letters (it is used in CAPA and document numbers).');
  if (!name) fail(400, 'Department name is required.');
  if (deptMap()[code]) fail(409, `Department ${code} already exists. Codes are never reused.`);
  const parent = checkParent(code, String(ctx.body.parent || '').toUpperCase());
  db.prepare('INSERT INTO departments (code,name,parent,active,created_by,created_at) VALUES (?,?,?,1,?,?)').run(code, name, parent, ctx.user.username, now());
  audit(ctx.user, 'Department created', null, 'department', null, `${code} – ${name}${parent ? ' (under ' + parent + ')' : ''}`, ctx.body.reason, ctx.ip);
  loadDepartments();
  return { ok: true };
});
route('PUT', '/api/departments/:code', (ctx) => {
  const d = deptMap()[ctx.params.code]; if (!d) fail(404, 'Department not found');
  const reason = String(ctx.body.reason || '').trim(); if (!reason) fail(400, 'Reason for change is required.');
  const { name, active, parent, hod } = ctx.body;
  // name and active status: admin / management; Head and parent (the organogram): also the Head of QA
  if ((name !== undefined || active !== undefined) && !allAccess(ctx.user)) fail(403, 'Only administrators and management can rename or deactivate departments.');
  if ((parent !== undefined || hod !== undefined) && !canEditOrg(ctx.user)) fail(403, 'Only management, the Head of QA and administrators can change the organogram.');
  const set = (k, v, label) => { if (String(v ?? '') === String(d[k] ?? '')) return; db.prepare(`UPDATE departments SET ${k}=? WHERE code=?`).run(v, d.code); audit(ctx.user, 'Department ' + label + ' changed', null, d.code, d[k], v, reason, ctx.ip); };
  if (name !== undefined) { const n = String(name).trim().slice(0, 80); if (!n) fail(400, 'Department name is required.'); set('name', n, 'name'); }
  if (active !== undefined) set('active', active ? 1 : 0, 'status');
  if (parent !== undefined) set('parent', checkParent(d.code, String(parent || '').toUpperCase()), 'parent');
  if (hod !== undefined) { const h = String(hod || ''); if (h && !activeUser(h)) fail(400, 'The Head of Department must be an active user.'); set('hod', h || null, 'Head'); }
  loadDepartments();
  return { ok: true };
});
// Organogram: departments with their Heads, parents and members, and each person's line manager
route('GET', '/api/organogram', (ctx) => {
  if (!canEditOrg(ctx.user)) fail(403, 'The organogram is available to management, the Head of QA and administrators.');
  const users = db.prepare('SELECT username, fullname, designation, department, reports_to, roles, active FROM users ORDER BY fullname').all().map(u => ({ ...u, roles: JSON.parse(u.roles) }));
  return { departments: deptRows(), users };
});
route('PUT', '/api/organogram/users/:u', (ctx) => {
  if (!canEditOrg(ctx.user)) fail(403, 'Only management, the Head of QA and administrators can change the organogram.');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(ctx.params.u); if (!u) fail(404, 'User not found');
  const reason = String(ctx.body.reason || '').trim(); if (!reason) fail(400, 'Reason for change is required.');
  setOrg(ctx, u, ctx.body, reason);
  return { ok: true };
});
// department and line manager of a user (organogram and user administration)
function setOrg(ctx, u, body, reason) {
  if (body.department !== undefined && String(body.department || '') !== String(u.department || '')) {
    const dep = String(body.department || '').toUpperCase(); if (dep && !deptMap()[dep]) fail(400, `Unknown department ${dep}.`);
    db.prepare('UPDATE users SET department=? WHERE username=?').run(dep, u.username);
    audit(ctx.user, 'User department changed', null, u.username, u.department, dep, reason, ctx.ip);
  }
  if (body.reportsTo !== undefined && String(body.reportsTo || '') !== String(u.reports_to || '')) {
    const m = String(body.reportsTo || '');
    if (m) {
      if (!activeUser(m)) fail(400, 'The line manager must be an active user.');
      for (let x = m, n = 0; x && n < 50; x = (db.prepare('SELECT reports_to FROM users WHERE username=?').get(x) || {}).reports_to, n++)
        if (x === u.username) fail(400, 'Reporting lines cannot form a loop.');
    }
    db.prepare('UPDATE users SET reports_to=? WHERE username=?').run(m || null, u.username);
    audit(ctx.user, 'User line manager changed', null, u.username, u.reports_to, m, reason, ctx.ip);
  }
}

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
// Signature register: only the signed-in employee registers their own signature (initials, specimen, password confirmation)
route('POST', '/api/signature/register', (ctx) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(ctx.user.username);
  if (!checkPw(String(ctx.body.password || ''), u.pw_hash)) fail(422, 'Password incorrect. Signature not registered.');
  const initials = String(ctx.body.initials || '').trim().toUpperCase().slice(0, 6);
  if (!/^[A-Z]{2,6}$/.test(initials)) fail(400, 'Enter your initials (2–6 letters).');
  const sig = String(ctx.body.signature || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 300000) fail(400, 'Draw your signature in the box.');
  if (!ctx.body.accept) fail(400, 'Accept the electronic signature statement.');
  db.prepare('UPDATE users SET initials=?, signature=?, esig_accepted=? WHERE username=?').run(initials, sig, now(), u.username);
  audit(ctx.user, 'Signature registered', null, u.username, u.initials || null, `Initials ${initials}; specimen signature SHA-256 ${sha256(sig).slice(0, 16)}…; e-signature statement accepted`, null, ctx.ip);
  return { ok: true };
});
route('GET', '/api/users/:u/signature', (ctx) => {
  const u = db.prepare('SELECT signature FROM users WHERE username=?').get(ctx.params.u);
  if (!u || !u.signature) fail(404, 'No signature registered');
  return { __raw: Buffer.from(u.signature.split(',')[1], 'base64'), headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } };
});
route('POST', '/api/esig-accept', (ctx) => {
  db.prepare('UPDATE users SET esig_accepted=? WHERE username=?').run(now(), ctx.user.username);
  audit(ctx.user, 'E-signature statement accepted', null, null, null, 'I agree that my electronic signature is the legally binding equivalent of my handwritten signature.', null, ctx.ip);
  return { ok: true };
});

route('GET', '/api/users', () => db.prepare("SELECT username,fullname,email,roles,active,locked,last_login,created_at,designation,department,reports_to,initials,inactive_date,esig_accepted,(signature IS NOT NULL AND signature<>'') AS hasSignature FROM users ORDER BY username").all()
  .map(u => ({ ...u, roles: withOrg({ username: u.username, roles: u.roles }).roles, esigCurrent: esigCurrent(u), reregisterBy: u.esig_accepted ? addDays(u.esig_accepted, Math.round(REREGISTER_YEARS * 365.25)) : '' })));
route('POST', '/api/users', (ctx) => {
  if (!allAccess(ctx.user)) fail(403, 'Administrator or management role required.');
  const { username, fullname, email, roles, password } = ctx.body;
  const un = String(username || '').toLowerCase().trim();
  if (!/^[a-z0-9._-]{3,40}$/.test(un)) fail(400, 'User ID: 3–40 characters, letters, numbers, dot, dash, underscore.');
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(un)) fail(409, 'User ID already exists. User IDs are never reused.');
  const p = pwPolicy(password); if (p) fail(400, p);
  const r = (roles || []).filter(x => ROLES[x] && !DERIVED_ROLES.includes(x)); if (!r.length) fail(400, 'Select at least one role.');
  const s = (v) => String(v || '').slice(0, 100);
  const dep = String(ctx.body.department || '').toUpperCase(); if (dep && !deptMap()[dep]) fail(400, `Unknown department ${dep}.`);
  const mgr = String(ctx.body.reportsTo || ''); if (mgr && !activeUser(mgr)) fail(400, 'The line manager must be an active user.');
  db.prepare('INSERT INTO users (username,fullname,email,roles,pw_hash,must_change,created_at,designation,department,initials,reports_to) VALUES (?,?,?,?,?,1,?,?,?,?,?)')
    .run(un, String(fullname || un), String(email || ''), JSON.stringify(r), hashPw(password), now(), s(ctx.body.designation), dep, s(ctx.body.initials).toUpperCase(), mgr || null);
  audit(ctx.user, 'User created', null, 'roles', null, `${un}: ${r.join(', ')}`, ctx.body.reason, ctx.ip);
  const emailed = mailPassword(un, password, false);
  if (emailed) audit(ctx.user, 'Temporary password e-mailed', null, un, null, String(email || ''), null, ctx.ip);
  return { ok: true, emailed, mailConfigured: mailOn() };
});
route('PUT', '/api/users/:u', (ctx) => {
  if (!allAccess(ctx.user)) fail(403, 'Administrator or management role required.');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(ctx.params.u); if (!u) fail(404, 'User not found');
  const { roles, active, unlock, password, reason } = ctx.body;
  if (!reason) fail(400, 'Reason for change is required.');
  const tag = { username: ctx.user.username, fullname: ctx.user.fullname };
  if (roles) { const r = roles.filter(x => ROLES[x] && !DERIVED_ROLES.includes(x)); db.prepare('UPDATE users SET roles=? WHERE username=?').run(JSON.stringify(r), u.username); audit(tag, 'User roles changed', null, u.username, JSON.parse(u.roles).join(', '), r.join(', '), reason, ctx.ip); }
  if (active !== undefined && !!active !== !!u.active) { // the register keeps the separation / inactive date (JRS/SOP/QAS/009)
    db.prepare('UPDATE users SET active=?, inactive_date=? WHERE username=?').run(active ? 1 : 0, active ? null : today(), u.username);
    audit(tag, active ? 'User activated' : 'User deactivated', null, u.username, null, active ? null : 'Inactive from ' + today(), reason, ctx.ip);
  }
  setOrg(ctx, u, ctx.body, reason);
  if (ctx.body.email !== undefined && String(ctx.body.email).trim().toLowerCase() !== String(u.email || '').toLowerCase()) {
    const em = String(ctx.body.email).trim().toLowerCase(); if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) fail(400, 'Enter a valid e-mail address.');
    db.prepare('UPDATE users SET email=? WHERE username=?').run(em, u.username); audit(tag, 'User email changed', null, u.username, u.email, em, reason, ctx.ip);
  }
  for (const k of ['designation']) if (ctx.body[k] !== undefined && String(ctx.body[k]) !== String(u[k] || '')) {
    const v = String(ctx.body[k]).slice(0, 100)[k === 'initials' ? 'toUpperCase' : 'trim']();
    db.prepare(`UPDATE users SET ${k}=? WHERE username=?`).run(v, u.username);
    audit(tag, 'User ' + k + ' changed', null, u.username, u[k], v, reason, ctx.ip);
  }
  if (unlock) { db.prepare('UPDATE users SET locked=0, failed=0 WHERE username=?').run(u.username); audit(tag, 'User unlocked', null, u.username, null, null, reason, ctx.ip); }
  if (password) { const p = pwPolicy(password); if (p) fail(400, p); db.prepare('UPDATE users SET pw_hash=?, must_change=1 WHERE username=?').run(hashPw(password), u.username); audit(tag, 'Password reset by administrator', null, u.username, null, null, reason, ctx.ip); }
  const emailed = password ? mailPassword(u.username, password, true) : false;
  if (emailed) audit(tag, 'Temporary password e-mailed', null, u.username, null, u.email, null, ctx.ip);
  return { ok: true, emailed, mailConfigured: mailOn() };
});

route('GET', '/api/records', (ctx) => {
  const type = ctx.query.get('type');
  const rows = type ? db.prepare('SELECT * FROM records WHERE type=? AND deleted=0 ORDER BY created_at DESC').all(type)
    : db.prepare('SELECT * FROM records WHERE deleted=0 ORDER BY updated_at DESC LIMIT 2000').all();
  return rows.map(rowToRecord).filter(r => MODULES[r.type] && canSee(ctx.user, r)); // records of retired modules stay in the database
});
route('GET', '/api/records/:id', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), h = contentHash(rec);
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=? ORDER BY id').all(rec.id).map(s => ({ ...s, current: s.content_hash === h }));
  const atts = db.prepare('SELECT id,name,mime,size,sha256,uploaded_by,ts,stage,category FROM attachments WHERE record_id=? ORDER BY ts').all(rec.id);
  const auditAccess = canSeeAudit(ctx.user);
  const trail = auditAccess ? db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id DESC').all(rec.id) : [];
  const rl = rec.type === 'randomization' ? db.prepare('SELECT generated_by, ts FROM rand_lists WHERE record_id=?').get(rec.id) : null;
  const mod = MODULES[rec.type];
  const editable = EDITABLE_ALWAYS.has(rec.type) || !LOCKED.has(rec.status);
  const transitions = mod.transitions.filter(t => t.from === rec.status).map(t => ({ ...t, allowed: hasRole(ctx.user, t.roles) }));
  const links = linked(rec.id).filter(r => canSee(ctx.user, r)).map(r => ({ id: r.id, number: r.number, type: r.type, title: r.data.title || '', status: r.status }));
  const versionCount = auditAccess ? db.prepare('SELECT COUNT(*) AS n FROM versions WHERE record_id=?').get(rec.id).n : 0;
  return { record: rec, signatures: sigs, attachments: atts, audit: trail, auditAccess, versionCount, transitions, editable, randList: rl, links };
});
// Version history of one record (QA and admin): every saved version, and one version's full content
route('GET', '/api/records/:id/versions', (ctx) => {
  needAudit(ctx.user);
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  const versions = db.prepare('SELECT no, ts, username, fullname, status, number, reason FROM versions WHERE record_id=? ORDER BY no DESC').all(rec.id);
  // controlled documents also have issued versions (1.0, 2.0 …) as separate records under the same number
  const docVersions = rec.type === 'documents' ? db.prepare("SELECT * FROM records WHERE type='documents' AND number=? AND deleted=0 ORDER BY created_at DESC").all(rec.number).map(rowToRecord)
    .map(r => ({ id: r.id, version: r.data.version, status: r.status, revisionType: r.data.revisionType, changeControl: r.data.changeControl, summary: r.data.revisionSummary,
      approvedOn: r.data.approvedOn, effectiveDate: r.data.effectiveDate, supersededOn: r.data.supersededOn, author: r.created_by })) : [];
  audit(ctx.user, 'Version history viewed', rec, null, null, null, null, ctx.ip);
  return { versions, docVersions };
});
route('GET', '/api/records/:id/versions/:no', (ctx) => {
  needAudit(ctx.user);
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  const v = db.prepare('SELECT * FROM versions WHERE record_id=? AND no=?').get(rec.id, +ctx.params.no); if (!v) fail(404, 'Version not found');
  return { ...v, data: JSON.parse(v.data) };
});
route('POST', '/api/records', (ctx) => {
  const { type, data, linkFrom } = ctx.body;
  const src = linkFrom ? getRecord(linkFrom) : null;
  if (!MODULES[type]) fail(400, 'Unknown module');
  if (hiddenFor(ctx.user, type)) fail(403, 'Your roles do not give access to this module.');
  if (type === 'randomization' && !hasRole(ctx.user, ['unblinded'])) fail(403, 'Only unblinded randomization officers can create randomization lists.');
  if (type === 'extensions' && !linkFrom) fail(400, 'Request an extension with the "Request extension" button beside the due date on the record.');
  const clean = sanitize(type, data || {});
  // modules with a request section: only its fields are entered (and required) when the record is created
  const mod = MODULES[type], hasCreate = mod.fields.some(f => f.type === 'section' && f.create);
  const onCreateForm = (k) => !hasCreate || !!(sectionOf(mod, k) || {}).create;
  for (const k of Object.keys(clean)) if (!onCreateForm(k)) delete clean[k];
  const missing = mod.fields.filter(f => f.req && onCreateForm(f.k) && (clean[f.k] === '' || clean[f.k] == null) && f.def === undefined);
  if (missing.length) failMissing(missing, 'Required fields are empty');
  if (type === 'investigations') clean.qaNotified = today();
  if (type === 'documents') { clean.version = '1.0'; clean.revisionType = 'New document'; }
  if (type === 'training') {
    clean.attempt = '1';
    const doc = clean.docRef ? byNumber(clean.docRef, ['documents']) : null;
    if (doc) clean.docVersion = doc.data.version;
  }
  if (type === 'issues') {
    const doc = effectiveDoc(clean.docNumber);
    clean.title = doc.data.title; clean.docVersion = doc.data.version;
    if (!(+clean.copies >= 1 && +clean.copies <= 100)) fail(400, 'Copies must be between 1 and 100.');
  }
  if (type === 'customers' || type === 'vendors') clean.requesterDept = ctx.user.department || '';
  if (type === 'vendors') clean.cycleStartedAt = now();
  if (type === 'extensions') {
    const { target, due } = erCheck(clean);
    if (src && src.id !== target.id) fail(400, 'The extension must be requested from the record it extends.');
    visibleRecord(ctx.user, target);
    clean.title = 'Extension of ' + target.number;
    clean.recordType = target.type === 'investigations' ? target.data.invType : target.type === 'selfinspections' ? 'Self-inspection response' : MODULES[target.type].name;
    clean.originalDue = due;
    // the Head of the department responsible for the record approves first (organogram); never the requester
    clean.requesterDept = ctx.user.department || '';
    const dept = target.data.respDept || target.data.auditeeDept;
    clean.hodApprover = dept ? hodFor(dept, ctx.user.username) : '';
    if (!clean.hodApprover) fail(400, `No Head of Department in the organogram can approve an extension for ${target.number}${dept ? ' (' + (DEPTS[dept] || dept) + ')' : ''}. Ask management or the Head of QA to set one.`);
  }
  if (type === 'auditors') {
    if (db.prepare("SELECT * FROM records WHERE type='auditors' AND status<>'Withdrawn' AND deleted=0").all().map(rowToRecord).some(r => r.data.auditor === clean.auditor))
      fail(409, `${userLabel(clean.auditor)} is already on the auditor list. Update the existing record instead.`);
    clean.title = userLabel(clean.auditor);
  }
  if (type === 'sischedule') {
    if (!(clean.year >= 2000 && clean.year <= 2100)) fail(400, 'Enter a valid year.');
    clean.title = 'Self-inspection schedule ' + clean.year;
  }
  if (type === 'mgmtreviews') {
    if (!(clean.year >= 2000 && clean.year <= 2100)) fail(400, 'Enter a valid year.');
    clean.title = `Quality management review ${clean.quarter}/${clean.year}`;
    // JRS/SOP/QAS/019: each review carries forward and updates the actions of the previous QMR
    const key = (d) => d.year * 10 + +String(d.quarter).slice(1);
    const prev = db.prepare("SELECT * FROM records WHERE type='mgmtreviews' AND status='Authorized' AND deleted=0").all().map(rowToRecord)
      .filter(r => key(r.data) < key(clean)).sort((a, b) => key(b.data) - key(a.data))[0];
    if (prev) clean.prevActions = [
      ...(prev.data.prevActions || []).filter(a => a.status !== 'Closed'),
      ...(prev.data.actions || []).map(a => ({ from: prev.number, recommendation: a.recommendation, responsibility: a.responsibility, target: a.target, update: '', status: 'Open' }))
    ].map(a => ({ ...a, update: '' }));
  }
  const rec = createRecord(ctx.user, type, clean, ctx.ip);
  notifyStatus(ctx.user, rec, '', rec.status);
  if (src) link(ctx.user, src, rec, ctx.ip);
  for (const a of (Array.isArray(ctx.body.attachments) ? ctx.body.attachments : []).slice(0, 20)) addAttachment(ctx, rec, a);
  return rec;
});
// The form sends every field. An empty value – '', null, [] (no boxes ticked), false (unticked), an empty table or an
// unanswered checklist – is the same as a field never filled in, so it is not a change (and needs no edit right)
const emptyValue = (v) => v == null || v === '' || v === false || (Array.isArray(v) ? v.every(emptyValue) : typeof v === 'object' && Object.values(v).every(emptyValue));
const sameValue = (a, b) => (emptyValue(a) && emptyValue(b)) || JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
route('PUT', '/api/records/:id', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), mod = MODULES[rec.type];
  if (!EDITABLE_ALWAYS.has(rec.type) && LOCKED.has(rec.status)) fail(409, `Record is ${rec.status} and cannot be edited. Raise a change or revision.`);
  if (rec.type === 'randomization' && !hasRole(ctx.user, ['unblinded'])) fail(403, 'Unblinded role required.');
  const reason = String(ctx.body.reason || '').trim(); if (!reason) fail(400, 'Reason for change is required.');
  const clean = sanitize(rec.type, ctx.body.data || {});
  if (rec.type === 'issues' && rec.status !== 'Requested') { delete clean.docNumber; delete clean.copies; delete clean.issuedTo; }
  for (const f of mod.fields) if (f.lock && f.k in clean && !sameValue(clean[f.k], rec.data[f.k])) fail(400, `${f.label} cannot be changed after the record is created.`);
  for (const [k, v] of Object.entries(clean)) {
    if (sameValue(rec.data[k], v)) continue;
    const s = sectionOf(mod, k);
    if (!canEditSection(s, rec, ctx.user)) fail(403, `"${s.label}" cannot be changed by you at stage "${rec.status}".`);
  }
  let changes = 0;
  for (const [k, v] of Object.entries(clean)) {
    const old = rec.data[k];
    if (!sameValue(old, v)) { rec.data[k] = v; audit(ctx.user, 'Field changed', rec, k, fmt(old), fmt(v), reason, ctx.ip); changes++; }
  }
  if (changes) {
    if (DERIVE[rec.type]) { const before = JSON.stringify(rec.data); DERIVE[rec.type](rec); if (JSON.stringify(rec.data) !== before) audit(ctx.user, 'Derived values recalculated', rec, null, null, rec.type === 'investigations' ? 'Due date ' + rec.data.dueDate : 'Title ' + rec.data.title, reason, ctx.ip); }
    applyComputed(rec.type, rec.data); saveRecord(rec); linkRefs(ctx.user, rec, ctx.ip);
  }
  return { changes };
});
route('POST', '/api/records/:id/links', (ctx) => {
  const rec = getRecord(ctx.params.id), other = byNumber(ctx.body.number);
  if (!other) fail(404, `No record with number ${ctx.body.number || ''}.`);
  if (other.id === rec.id) fail(400, 'A record cannot be linked to itself.');
  link(ctx.user, rec, other, ctx.ip);
  return { ok: true };
});
// Departmental approvals (modules.js "deptApproval"): change control optional approvals 1–4 (JRS/SOP/QAS/007 Part C),
// cross-functional review of documents (JRS/SOP/QAS/021)
route('POST', '/api/records/:id/dept-approve', (ctx) => {
  const rec = getRecord(ctx.params.id), cfg = MODULES[rec.type].deptApproval;
  if (!cfg || rec.status !== cfg.state) fail(409, cfg ? `${cfg.label} are recorded at stage "${cfg.state}".` : 'This record has no departmental approvals.');
  const dept = String(ctx.body.dept || ''), list = rec.data.deptApprovals || [];
  if (!allAccess(ctx.user) && !ctx.user.deptsUnder.includes(dept)) fail(403, `Only the Head of ${DEPTS[dept] || dept} (organogram) can give this approval.`);
  if (!(rec.data[cfg.field] || []).includes(dept)) fail(400, `${dept || 'This department'} is not named for ${cfg.label.toLowerCase()} on ${rec.number}.`);
  if (list.some(a => a.dept === dept)) fail(409, `${dept} has already approved ${rec.number}.`);
  verifySignature(ctx.user, ctx.body);
  const comment = String(ctx.body.comment || '').slice(0, 2000);
  list.push({ dept, by: ctx.user.username, name: ctx.user.fullname, ts: now(), comment });
  rec.data.deptApprovals = list; saveRecord(rec);
  const meaning = rec.type === 'changes' ? `Approved – optional approval (${dept})` : `Reviewed – cross-functional (${dept})`;
  audit(ctx.user, `${cfg.label} (e-signed: ${meaning})`, rec, 'deptApprovals', null, dept + (comment ? ': ' + comment : ''), null, ctx.ip);
  sign(ctx.user, rec, meaning, rec.status, rec.status);
  return { ok: true };
});
// JRS/SOP/QAS/019 §5 / FRM/QAS/035: compile the data for every agenda topic and the KPIs (§5.17) from the eQMS
function qmrMetrics(year, quarter) {
  const q = +String(quarter).slice(1), qs = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, qe = addDays(addMonths(qs, 3), -1);
  const ys = `${year}-01-01`, ps = addMonths(qs, -3), pe = addDays(qs, -1);
  const all = db.prepare('SELECT * FROM records WHERE deleted=0').all().map(rowToRecord);
  const opened = (r) => (r.data.dateOpened || r.created_at).slice(0, 10);
  const inQ = (r) => opened(r) >= qs && opened(r) <= qe, inY = (r) => opened(r) >= ys && opened(r) <= qe, inP = (r) => opened(r) >= ps && opened(r) <= pe;
  const isOpen = (r) => !LOCKED.has(r.status) && !r.status.startsWith('Closed');
  const due = (r) => r.status === 'Effectiveness Check' || r.status === 'Closed – EC Pending' ? r.data.ecDueDate : r.data.extendedDue || r.data.dueDate;
  const overdue = (r) => isOpen(r) && due(r) && due(r) < today();
  const of = (type, f = () => true) => all.filter(r => r.type === type && f(r));
  const row = (label, list, extra) => [label, list.filter(inQ).length, list.filter(inY).length, extra ?? ''];
  const trend = (list) => { const a = list.filter(inQ).length, b = list.filter(inP).length; return a > b ? `Up from ${b} last quarter` : a < b ? `Down from ${b} last quarter` : `Same as last quarter (${b})`; };
  const dev = of('investigations', r => r.data.invType === 'Deviation'), cmp = of('investigations', r => r.data.invType === 'Complaint');
  const eventRows = (list) => [row('Total', list, trend(list)), ...['Critical', 'Major', 'Minor'].map(c => row(c, list.filter(r => r.data.criticality === c))),
    row('Still open', list.filter(isOpen)), row('Overdue', list.filter(overdue)), row('With CAPA required', list.filter(r => r.data.capaRequired === 'Yes'))];
  const capa = of('capa'), cc = of('changes'), trn = of('training').filter(r => r.status !== 'Cancelled' && r.data.dueDate >= ys && r.data.dueDate <= qe);
  const trnQ = trn.filter(r => r.data.dueDate >= qs), pct = (l) => l.length ? Math.round(100 * l.filter(r => r.status === 'Completed').length / l.length) + '%' : 'n/a';
  const si = of('selfinspections'), ea = of('extaudits');
  const siDone = si.filter(r => ['Report Issued', 'Response Submitted', 'Auditor Review', 'Response Accepted', 'Closed'].includes(r.status));
  const findings = [...si.flatMap(r => (r.data.observations || []).map(o => ({ r, c: o.category, open: o.status !== 'Complied' }))), ...ea.flatMap(r => (r.data.findings || []).map(f => ({ r, c: f.category, open: f.status !== 'Closed' })))];
  const fRow = (c) => [c, findings.filter(f => f.c === c && inQ(f.r)).length, findings.filter(f => f.c === c && inY(f.r)).length, ''];
  const temp = dev.filter(r => r.data.tempRange && r.data.tempRange !== 'Not applicable');
  const vendors = of('vendors'), byStatus = (l) => Object.entries(l.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + 1 }), {}));
  const months = (q - 1) * 3 + 3, chain = verifyAudit();
  const prevQmr = of('mgmtreviews', r => r.status === 'Authorized').sort((a, b) => (b.data.year * 10 + +b.data.quarter.slice(1)) - (a.data.year * 10 + +a.data.quarter.slice(1)))[0];
  return {
    generatedAt: now(), period: { quarter: `${quarter}/${year}`, from: qs, to: qe, ytdFrom: ys },
    columns: ['Item', `This quarter (${qs} – ${qe})`, `Year to date (from ${ys})`, 'Notes'],
    sections: [
      { title: '1. Status of actions from the previous QMR', rows: prevQmr ? [['Actions raised at ' + prevQmr.number, (prevQmr.data.actions || []).length, '', 'Updates are recorded in "Status of actions from the previous QMR"']] : [['No previous authorized QMR', '', '', '']] },
      { title: '2. Complaints', rows: eventRows(cmp) },
      { title: '3. Deviations', rows: [...eventRows(dev), row('Temperature-related', temp)] },
      { title: '4. Change control', rows: [row('Raised', cc), ...['Critical', 'Major', 'Minor'].map(c => row(c, cc.filter(r => r.data.classification === c))), row('Temporary changes', cc.filter(r => r.data.nature === 'Temporary')), row('Still open', cc.filter(isOpen)), row('Overdue', cc.filter(overdue))] },
      { title: '5. CAPA and CAPA effectiveness', rows: [row('Raised', capa), row('Closed', capa.filter(r => r.status === 'Closed')), row('Overdue', capa.filter(overdue)), row('Effectiveness check: effective', capa.filter(r => r.data.effective === 'Yes')), row('Effectiveness check: not effective', capa.filter(r => r.data.effective === 'No'))] },
      { title: '6. Training and effectiveness', rows: [['Assignments due', trnQ.length, trn.length, ''], ['Completed', trnQ.filter(r => r.status === 'Completed').length, trn.filter(r => r.status === 'Completed').length, ''], ['Compliance', pct(trnQ), pct(trn), ''], ['Triggered by CAPA / deviation / complaint', trnQ.filter(r => /^(CAPA|JRS-)/.test(r.data.sourceRecord || '')).length, trn.filter(r => /^(CAPA|JRS-)/.test(r.data.sourceRecord || '')).length, '']] },
      { title: '7. Audits (self-inspection, customer, regulatory)', rows: [['Self-inspections performed', siDone.filter(inQ).length, siDone.filter(inY).length, 'At least 4 per year (JRS/SOP/QAS/004)'], ...['Customer / client audit', 'Regulatory inspection', 'Third-party audit'].map(t => row(t, ea.filter(r => r.data.auditType === t))), ...['Critical', 'Major', 'Minor', 'Observation'].map(fRow), ['Open findings', findings.filter(f => f.open && inQ(f.r)).length, findings.filter(f => f.open && inY(f.r)).length, '']] },
      { title: '8. Area, equipment and system qualification', rows: [['Not yet recorded in the eQMS', '', '', 'Validation module (JRS/SOP/QAS/018) planned']] },
      { title: '9. Environmental monitoring (temperature / humidity excursions)', rows: [row('Temperature-related deviations', temp)] },
      { title: '10. Vendor qualification', rows: byStatus(vendors).map(([s, n]) => [s, n, n, 'Current status']).concat(vendors.length ? [] : [['No vendors recorded', '', '', '']]) },
      { title: '11. Recall and mock recall', rows: [row('Events with product recall', of('investigations', r => String(r.data.recall).startsWith('Yes')))] },
      { title: '12. Self-inspection, regulatory and customer audits with open CAPA', rows: [['Audits not yet closed', [...si, ...ea].filter(r => isOpen(r) && inQ(r)).length, [...si, ...ea].filter(r => isOpen(r) && inY(r)).length, '']] },
      { title: '13. Overall QMS status', rows: [['Open CAPA / overdue', capa.filter(isOpen).length, capa.filter(overdue).length, 'Open / overdue now'], ['Open deviations / overdue', dev.filter(isOpen).length, dev.filter(overdue).length, 'Open / overdue now'], ['Open change controls / overdue', cc.filter(isOpen).length, cc.filter(overdue).length, 'Open / overdue now'], ['Open complaints / overdue', cmp.filter(isOpen).length, cmp.filter(overdue).length, 'Open / overdue now'], ['Extension requests', of('extensions').filter(inQ).length, of('extensions').filter(inY).length, ''], ['Audit trail integrity', chain.ok ? 'Intact' : 'BROKEN', '', `${chain.checked} entries verified`]] }
    ],
    kpis: [
      ['Right first time (RFT)', 'n/a', 'Needs order / shipment data – not yet in the eQMS'],
      ['Deviation rate (per month, year to date)', (dev.filter(inY).length / months).toFixed(1), `Deviations: ${dev.filter(inY).length} in ${months} months`],
      ['Complaint rate (per month, year to date)', (cmp.filter(inY).length / months).toFixed(1), `Complaints: ${cmp.filter(inY).length} in ${months} months`],
      ['Training compliance (year to date)', pct(trn), `${trn.filter(r => r.status === 'Completed').length} of ${trn.length} assignments completed`],
      ['Critical audit findings (year to date)', findings.filter(f => f.c === 'Critical' && inY(f.r)).length, 'Patient- or product-impacting'],
      ['Overdue CAPA / deviations / complaints / change controls', [capa, dev, cmp, cc].map(l => l.filter(overdue).length).join(' / '), 'Now'],
      ['Data integrity compliance', chain.ok ? 'Audit trail intact' : 'Audit trail BROKEN', `${chain.checked} entries verified`],
      ['Supplier performance', 'n/a', 'Supplier qualification module not yet aligned to JRS/SOP/QAS/005']
    ]
  };
}
route('POST', '/api/records/:id/compile', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'mgmtreviews') fail(400, 'Only management reviews compile data.');
  if (!hasRole(ctx.user, ['qa'])) fail(403, 'QA role required.');
  if (!['Planned', 'Data Compiled', 'Meeting Held'].includes(rec.status)) fail(409, 'Data can be compiled only before the minutes are compiled.');
  const from = rec.status;
  rec.data.metrics = qmrMetrics(rec.data.year, rec.data.quarter);
  if (from === 'Planned') rec.status = 'Data Compiled';
  saveRecord(rec);
  audit(ctx.user, 'QMR data compiled', rec, 'metrics', null, `${rec.data.metrics.period.from} – ${rec.data.metrics.period.to}`, null, ctx.ip);
  if (from !== rec.status) audit(ctx.user, 'Status changed', rec, 'status', from, rec.status, null, ctx.ip);
  return { ok: true, status: rec.status };
});
// Co-signed step (modules.js "cosign"): each sign-off is recorded; once every required sign-off has been given
// in the current stage, by different people, the record moves to the next stage.
function coSign(ctx, rec, mod, t) {
  const group = mod.cosign[rec.status], from = rec.status;
  const given = () => db.prepare('SELECT username, meaning FROM signatures WHERE record_id=? AND ts>=?').all(rec.id, rec.data.stateEnteredAt || '').filter(s => group.meanings.includes(s.meaning));
  const before = given();
  if (before.some(s => s.meaning === t.sign)) fail(409, `"${t.sign}" has already been given at this stage.`);
  if (before.some(s => s.username === ctx.user.username)) fail(403, 'Segregation of duties: the sign-offs at this stage must be given by different people.');
  verifySignature(ctx.user, ctx.body);
  sign(ctx.user, rec, t.sign, from, from);
  audit(ctx.user, 'Signed (e-signed: ' + t.sign + ')', rec, 'status', from, from, ctx.body.reason, ctx.ip);
  const done = group.meanings.every(m => given().some(s => s.meaning === m));
  if (done) {
    const next = group.next(rec);
    rec.status = next; rec.data.stateEnteredAt = now();
    onTransition(ctx.user, rec, next, ctx.ip);
    audit(ctx.user, 'Status changed (all sign-offs given)', rec, 'status', from, next, null, ctx.ip);
  }
  saveRecord(rec);
  if (done) notifyStatus(ctx.user, rec, from, rec.status);
  return { ok: true, status: rec.status, pending: group.meanings.filter(m => !given().some(s => s.meaning === m)) };
}
route('POST', '/api/records/:id/transition', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), mod = MODULES[rec.type];
  // several sign-offs can share a from/to pair (co-signatures); the label picks the one meant
  const cands = mod.transitions.filter(x => x.from === rec.status && x.to === ctx.body.to);
  const t = cands.length > 1 ? cands.find(x => x.label === ctx.body.label) : cands[0];
  if (!t) fail(409, cands.length ? 'Choose which sign-off to give.' : `Cannot move from ${rec.status} to ${ctx.body.to}.`);
  if (!hasRole(ctx.user, t.roles)) fail(403, `Your roles do not allow "${t.label}".`);
  if (t.reason && !String(ctx.body.reason || '').trim()) fail(400, 'A reason is required for this step.');
  const missing = (t.needs || []).map(k => mod.fields.find(x => x.k === k)).filter(f => isEmpty(f, rec.data[f.k]));
  if (missing.length) failMissing(missing, `Complete these fields before "${t.label}"`);
  for (const c of t.checks || []) CHECKS[c](rec, ctx.user);
  if (t.sod && rec.created_by === ctx.user.username) fail(403, 'Segregation of duties: the record initiator cannot approve it.');
  if (t.sodWith && db.prepare('SELECT 1 FROM signatures WHERE record_id=? AND username=? AND meaning LIKE ?').get(rec.id, ctx.user.username, t.sodWith + '%'))
    fail(403, `Segregation of duties: you signed "${t.sodWith}" on this record and cannot also sign this step.`);
  if (t.needsList) {
    const rl = db.prepare('SELECT generated_by FROM rand_lists WHERE record_id=?').get(rec.id);
    if (!rl) fail(400, 'Generate the list first.');
    if (rl.generated_by === ctx.user.username) fail(403, 'Segregation of duties: the list generator cannot approve it.');
  }
  if (t.traineeOnly && rec.data.trainee !== ctx.user.username) fail(403, 'Only the trainee can sign their own training record.');
  if (t.checkScore && rec.data.passMark !== '' && rec.data.passMark != null && !(+rec.data.score >= +rec.data.passMark)) fail(400, `Score ${rec.data.score || 0}% is below the pass mark ${rec.data.passMark}%.`);
  if (t.checkSanctions && rec.data.sanctions !== 'Clear') fail(400, 'Sanctions screening must be "Clear" before qualification.');
  if (t.checkRecon && !String(rec.data.reconciliation).startsWith('Balanced')) fail(400, 'Label reconciliation is not balanced. Raise a deviation before completing.');
  if (t.cosign) return coSign(ctx, rec, mod, t);
  if (t.sign) verifySignature(ctx.user, ctx.body);
  const from = rec.status; rec.status = t.to;
  if (from !== t.to) rec.data.stateEnteredAt = now();
  onTransition(ctx.user, rec, t.to, ctx.ip);
  saveRecord(rec);
  audit(ctx.user, t.sign ? 'Status changed (e-signed: ' + t.sign + ')' : 'Status changed', rec, 'status', from, t.to, ctx.body.reason, ctx.ip);
  if (t.sign) sign(ctx.user, rec, t.sign, from, t.to);
  if (from !== rec.status) notifyStatus(ctx.user, rec, from, rec.status);
  return { ok: true, status: rec.status };
});
route('POST', '/api/records/:id/revise', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'documents' || rec.status !== 'Effective') fail(409, 'Only effective documents can be revised.');
  if (!hasRole(ctx.user, ['author', 'qa'])) fail(403, 'Author or QA role required.');
  if (db.prepare("SELECT 1 FROM records WHERE type='documents' AND number=? AND status IN ('Draft','In Review','QA Review','Approval','Approved – Training') AND deleted=0").get(rec.number)) fail(409, 'A revision of this document is already in progress.');
  // JRS/SOP/QAS/021 §5.9: a revision with changes needs an approved change control; a periodic review without change still issues a new version but needs no training
  const revisionType = ctx.body.revisionType === 'Periodic review – no change' ? 'Periodic review – no change' : 'Revision – technical / procedural change';
  const reason = String(ctx.body.reason || '').trim(); if (!reason) fail(400, 'A reason for the revision is required.');
  if (revisionType.startsWith('Revision')) {
    const cc = byNumber(ctx.body.changeControl, ['changes']);
    if (!cc || !CC_APPROVED.includes(cc.status)) fail(400, 'A revision with technical or procedural changes needs an approved change control (JRS/SOP/QAS/007).');
  }
  const [maj] = String(rec.data.version || '1.0').split('.');
  const { approvedOn, deptApprovals, stateEnteredAt, supersededOn, ...keep } = rec.data;
  const data = { ...keep, version: (parseInt(maj, 10) + 1) + '.0', revisionType, changeControl: revisionType.startsWith('Revision') ? String(ctx.body.changeControl).toUpperCase() : '',
    revisionSummary: reason, effectiveDate: '', shortNotice: '', nextReview: '', sharepointUrl: '', supersedes: rec.id, __number: rec.number };
  const rev = createRecord(ctx.user, 'documents', data, ctx.ip, `${revisionType} of ${rec.number} v${rec.data.version}: ${reason}`);
  link(ctx.user, rec, rev, ctx.ip);
  return rev;
});
// Attachments can be added at every stage; each file keeps the stage it was added at. Closed records take files from QA only.
function addAttachment(ctx, rec, file) {
  const buf = Buffer.from(String(file.base64 || ''), 'base64'); if (!buf.length) fail(400, 'Empty file');
  if (buf.length > 25 * 1024 * 1024) fail(413, 'Maximum file size is 25 MB.');
  const id = uid(), h = crypto.createHash('sha256').update(buf).digest('hex');
  const cat = String(file.category || '').replace(/[^\w-]/g, '').slice(0, 30) || null;
  db.prepare('INSERT INTO attachments (id,record_id,name,mime,size,sha256,blob,uploaded_by,ts,stage,category) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, rec.id, String(file.name || 'file').slice(0, 200), String(file.mime || ''), buf.length, h, buf, ctx.user.username, now(), rec.status, cat);
  audit(ctx.user, 'Attachment added', rec, 'attachment', null, `${file.name} (stage ${rec.status}${cat ? '; ' + cat : ''}; SHA-256 ${h.slice(0, 16)}…)`, file.reason || ctx.body.reason, ctx.ip);
  return { id, sha256: h };
}
route('POST', '/api/records/:id/attachments', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  if (LOCKED.has(rec.status) && !EDITABLE_ALWAYS.has(rec.type) && !hasRole(ctx.user, ['qa'])) fail(409, `Record is ${rec.status}. Only QA can add attachments now.`);
  if (MODULES[rec.type].attachOnRequestOnly && !hasRole(ctx.user, ['qa'])) fail(403, 'Documents are attached with the request. After that only QA can add documents.');
  return addAttachment(ctx, rec, ctx.body);
});
route('GET', '/api/attachments/:id', (ctx) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id=?').get(ctx.params.id); if (!a) fail(404, 'Not found');
  visibleRecord(ctx.user, getRecord(a.record_id));
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
// Audit trail (QA and admin). Filters: from / to (dates), user, type (module), record (number), action, q (any text), limit.
function auditQuery(user, f) {
  const where = [], args = [];
  const hidden = HIDEABLE.filter(t => hiddenFor(user, t));
  if (hidden.length) { where.push(`(r.type IS NULL OR r.type NOT IN (${hidden.map(() => '?').join(',')}))`); args.push(...hidden); }
  if (f.from) { where.push('a.ts >= ?'); args.push(String(f.from).slice(0, 10)); }
  if (f.to) { where.push('a.ts < ?'); args.push(addDays(String(f.to).slice(0, 10), 1)); }
  if (f.user) { where.push('a.username = ?'); args.push(f.user); }
  if (f.type === 'system') where.push('a.record_id IS NULL');
  else if (f.type) { where.push('r.type = ?'); args.push(f.type); }
  if (f.record) { where.push('(a.record_number LIKE ? OR r.number LIKE ?)'); args.push(`%${f.record}%`, `%${f.record}%`); }
  if (f.action) { where.push('a.action LIKE ?'); args.push(`%${f.action}%`); }
  if (f.q) { where.push('(a.username LIKE ? OR a.fullname LIKE ? OR a.action LIKE ? OR a.record_number LIKE ? OR a.field LIKE ? OR a.new_value LIKE ? OR a.reason LIKE ?)'); args.push(...Array(7).fill(`%${f.q}%`)); }
  const lim = Math.min(+f.limit || 1000, 10000);
  return db.prepare(`SELECT a.*, r.type AS record_type FROM audit a LEFT JOIN records r ON r.id = a.record_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`).all(...args, lim);
}
route('GET', '/api/audit', (ctx) => {
  needAudit(ctx.user);
  return auditQuery(ctx.user, Object.fromEntries(['from', 'to', 'user', 'type', 'record', 'action', 'q', 'limit'].map(k => [k, ctx.query.get(k) || ''])));
});
route('GET', '/api/audit/verify', (ctx) => { needAudit(ctx.user); const r = verifyAudit(); audit(ctx.user, 'Audit trail integrity verified', null, null, null, r.ok ? 'Intact' : 'BROKEN at ' + r.brokenAt, null, ctx.ip); return r; });
route('POST', '/api/audit/report', (ctx) => { // logs that a filtered audit trail was exported or printed
  needAudit(ctx.user);
  audit(ctx.user, 'Audit trail ' + (ctx.body.kind === 'print' ? 'report printed' : 'exported'), null, 'filters', null, String(ctx.body.filters || 'none').slice(0, 500), null, ctx.ip);
  return { ok: true };
});
// ---------- e-mail (SMTP, no dependencies) and notifications ----------
const mailOn = () => !!(CFG.smtp.host && CFG.smtp.from);
async function smtpSend(to, subject, text) {
  const c = CFG.smtp; let sock = c.secure ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect({ host: c.host, port: c.port });
  let buf = ''; const waiting = [];
  const flush = () => { while (waiting.length) { const m = buf.match(/^((?:\d{3}-[^\r\n]*\r?\n)*)(\d{3})(?: [^\r\n]*)?\r?\n/); if (!m) return; buf = buf.slice(m[0].length); waiting.shift().ok({ code: +m[2], text: m[0] }); } };
  const attach = (s) => { s.setTimeout(30000); s.on('data', d => { buf += d.toString('utf8'); flush(); }); s.on('timeout', () => s.destroy(new Error('SMTP timeout'))); s.on('error', e => waiting.splice(0).forEach(w => w.fail(e))); };
  const read = () => new Promise((ok, f) => { waiting.push({ ok, fail: f }); flush(); });
  const cmd = async (line, codes) => { if (line != null) sock.write(line + '\r\n'); const r = await read(); if (!codes.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.trim().slice(0, 200)}`); return r; };
  attach(sock);
  try {
    await cmd(null, [220]);
    let r = await cmd('EHLO jrs-eqms', [250]);
    if (!c.secure && /STARTTLS/i.test(r.text)) {
      await cmd('STARTTLS', [220]); sock.removeAllListeners('data'); sock.removeAllListeners('timeout');
      sock = tls.connect({ socket: sock, servername: c.host }); attach(sock);
      await new Promise((ok, f) => { sock.once('secureConnect', ok); sock.once('error', f); });
      r = await cmd('EHLO jrs-eqms', [250]);
    }
    if (c.user) { await cmd('AUTH LOGIN', [334]); await cmd(Buffer.from(c.user).toString('base64'), [334]); await cmd(Buffer.from(c.pass).toString('base64'), [235]); }
    await cmd(`MAIL FROM:<${c.from}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const b64 = (v) => '=?UTF-8?B?' + Buffer.from(v).toString('base64') + '?=';
    await cmd([`From: ${b64(c.fromName)} <${c.from}>`, `To: <${to}>`, `Subject: ${b64(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${uid()}@jrs-eqms>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n'), '.'].join('\r\n'), [250]);
    await cmd('QUIT', [221]).catch(() => {});
  } finally { sock.end(); }
}
// e-mails go out one at a time in the background; the result is kept on the notification (or logged for password e-mails)
const mailQueue = []; let mailBusy = false;
function queueMail(to, subject, text, noteId) {
  if (!mailOn() || !to) { if (noteId) db.prepare('UPDATE notifications SET email=? WHERE id=?').run(mailOn() ? 'No e-mail address' : 'E-mail not configured', noteId); return false; }
  mailQueue.push({ to, subject, text, noteId }); if (!mailBusy) setImmediate(drainMail); return true;
}
async function drainMail() {
  mailBusy = true;
  while (mailQueue.length) {
    const m = mailQueue.shift(); let result = 'Sent ' + now();
    try { await smtpSend(m.to, m.subject, m.text); } catch (e) { result = 'Failed: ' + e.message; console.error('E-mail to', m.to, 'failed:', e.message); }
    if (m.noteId) db.prepare('UPDATE notifications SET email=? WHERE id=?').run(result, m.noteId);
  }
  mailBusy = false;
}
const userRow = (u) => u ? db.prepare('SELECT username, fullname, email, roles, active FROM users WHERE username=?').get(u) : null;
const usersWithRole = (r) => db.prepare('SELECT username, roles FROM users WHERE active=1').all().filter(u => JSON.parse(u.roles).includes(r)).map(u => u.username);
// who has to act next on a record (and the step they can take)
function nextActors(rec) {
  const mod = MODULES[rec.type], d = rec.data, out = new Map(), add = (u, label) => { if (u && !out.has(u)) out.set(u, label); };
  for (const t of mod.transitions.filter(x => x.from === rec.status && !x.reason && !['Cancelled', 'Rejected'].includes(x.to))) {
    const c = t.checks || [];
    if (c.includes('isHodApprover')) add(d.hodApprover, t.label);
    else if (c.includes('isRespPerson') || c.includes('isPartCOwner')) add(d.respPerson, t.label);
    else if (c.includes('isPartAOwner') || c.includes('isCcDept') || c.includes('isResponsible')) { add(rec.created_by, t.label); add(d.respPerson, t.label); }
    else if (c.includes('isInitiator')) add(rec.created_by, t.label);
    else if (c.includes('isReviewer')) add(d.reviewer, t.label);
    else if (c.includes('isTrainee') || t.traineeOnly) add(d.trainee, t.label);
    else if (c.includes('isTrainer')) add(d.trainer, t.label);
    else for (const r of t.roles) {
      if (r === 'hod') add(d.respDept ? hodFor(d.respDept) : '', t.label);
      else if (r === 'pm' && d.pm) add(d.pm, t.label);
      else if (r !== 'any') usersWithRole(r).forEach(u => add(u, t.label));
    }
  }
  const da = mod.deptApproval;
  if (da && rec.status === da.state) for (const code of d[da.field] || []) if (!(d.deptApprovals || []).some(a => a.dept === code)) add(hodFor(code), `${da.label} (${code})`);
  return out;
}
// every status change: the people who act next, plus the initiator, responsible person and approving Head, in the app and by e-mail
function notifyStatus(actor, rec, from, to) {
  const d = rec.data, mod = MODULES[rec.type], act = nextActors(rec), people = new Set([...act.keys(), rec.created_by, d.respPerson, d.hodApprover].filter(Boolean));
  const link = CFG.appUrl ? `${CFG.appUrl}/#/r/${rec.id}` : '';
  for (const u of people) {
    if (u === actor.username) continue;
    const p = userRow(u); if (!p || !p.active) continue;
    const action = act.get(u) || '';
    const subject = `${rec.number} – ${action ? 'action needed: ' + action : to}`;
    const body = [`${mod.name}: ${rec.number} – ${d.title || ''}`, from ? `Status: ${from} → ${to} (by ${actor.fullname})` : `New record, status ${to} (by ${actor.fullname})`,
      action ? `Your action: ${action}` : 'For your information – no action needed from you now.', link ? `Open: ${link}` : '', '', 'JRS eQMS – automatic notification. Do not reply.'].filter(x => x !== '').join('\n');
    const id = db.prepare('INSERT INTO notifications (username,record_id,record_number,subject,body,action,ts) VALUES (?,?,?,?,?,?,?)').run(u, rec.id, rec.number, subject, body, action, now()).lastInsertRowid;
    queueMail(p.email, subject, body, id);
  }
}
function mailPassword(u, password, reset) {
  const p = userRow(u); if (!p || !p.email || !mailOn()) return false;
  return queueMail(p.email, reset ? 'JRS eQMS – your password was reset' : 'JRS eQMS – your account',
    [`Hello ${p.fullname},`, '', reset ? 'An administrator has reset your password for the JRS eQMS.' : 'An account has been created for you in the JRS eQMS.',
      `User ID: ${p.username} (or sign in with this e-mail address)`, `Temporary password: ${password}`, CFG.appUrl ? `Sign in: ${CFG.appUrl}` : '', '',
      'You must choose a new password when you sign in. Do not share your password.'].filter(x => x !== '').join('\n'));
}
route('GET', '/api/notifications', (ctx) => {
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE username=? AND read=0').get(ctx.user.username).n;
  if (ctx.query.get('count')) return { unread };
  return { unread, items: db.prepare('SELECT id, record_id, record_number, subject, body, action, ts, read, email FROM notifications WHERE username=? ORDER BY id DESC LIMIT 200').all(ctx.user.username) };
});
route('POST', '/api/notifications/read', (ctx) => { db.prepare('UPDATE notifications SET read=1 WHERE username=? AND read=0').run(ctx.user.username); return { ok: true }; });

// ---------- full record report (any stage): report.html, every attachment and the audit trail, in one ZIP ----------
function zipFiles(files) { // stored with deflate, UTF-8 names; no dependencies
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'), body = zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(h, name, body); central.push(c, name); offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const csvCell = (v) => /[",\n\r]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');
const safeName = (n) => String(n).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
function reportValue(f, v) {
  if (v === '' || v == null || (Array.isArray(v) && !v.length)) return '<span class="empty">—</span>';
  if (f.type === 'table') return `<table><tr>${f.cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr>${v.map(row => `<tr>${f.cols.map(c => `<td>${esc(row[c.k])}</td>`).join('')}</tr>`).join('')}</table>`;
  if (f.type === 'checklist') return `<table>${f.rows.map(r => `<tr><td>${esc(r)}</td><td>${esc((v[r] || {}).v)}</td><td>${esc((v[r] || {}).r)}</td></tr>`).join('')}</table>`;
  if (f.type === 'user' || f.fmt === 'user') return esc(userLabel(v));
  if (f.optionLabels && f.optionLabels[v]) return esc(f.optionLabels[v]);
  return esc(fmt(v)).replace(/\n/g, '<br>');
}
function reportZip(user, rec) {
  const mod = MODULES[rec.type], h = contentHash(rec), withAudit = canSeeAudit(user);
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=? ORDER BY id').all(rec.id);
  const atts = db.prepare('SELECT * FROM attachments WHERE record_id=? ORDER BY ts').all(rec.id);
  const trail = withAudit ? db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id').all(rec.id) : [];
  const links = linked(rec.id).filter(r => canSee(user, r));
  const files = [], attRows = atts.map((a, i) => {
    const p = `attachments/Attachment ${String(i + 1).padStart(2, '0')} - ${safeName(a.name)}`;
    files.push({ name: p, data: Buffer.from(a.blob) });
    return `<tr><td>${i + 1}</td><td>${esc(a.stage || '')}</td><td>${esc(a.name)}<br><small>${esc(p)}</small></td><td>${a.size}</td><td>${esc(userLabel(a.uploaded_by))}</td><td>${esc(a.ts.slice(0, 16).replace('T', ' '))}</td><td><small>${esc(a.sha256)}</small></td></tr>`;
  });
  let body = '', open = false;
  for (const f of mod.fields) {
    if (f.type === 'section') { body += (open ? '</table>' : '') + `<h2>${esc(f.label)}</h2><table class="kv">`; open = true; continue; }
    if (!open) { body += '<table class="kv">'; open = true; }
    body += `<tr><th>${esc(f.label)}</th><td>${reportValue(f, rec.data[f.k])}</td></tr>`;
  }
  if (open) body += '</table>';
  const final = LOCKED.has(rec.status) || rec.status.startsWith('Closed');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rec.number)} report</title><style>
body{font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#1b1f24;margin:24px;max-width:1000px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #1f4e79;color:#1f4e79}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border:1px solid #c9d1d9;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f3f6f9}.kv th{width:34%;font-weight:600}
.meta{color:#555;margin-bottom:12px}.banner{padding:8px 10px;margin:10px 0;border:1px solid #d29922;background:#fff8e5}.empty{color:#999}small{color:#666;word-break:break-all}
@media print{body{margin:0}h2{break-after:avoid}}</style></head><body>
<h1>${esc(mod.name)} – ${esc(rec.number)}</h1>
<div class="meta">${esc(rec.data.title || '')}<br>Status: <b>${esc(rec.status)}</b> · Created by ${esc(userLabel(rec.created_by))} on ${esc(rec.created_at.slice(0, 10))} · Report generated by ${esc(user.fullname)} on ${esc(now().slice(0, 16).replace('T', ' '))} UTC</div>
${final ? '' : '<div class="banner">Interim report – the record is still in progress (stage "' + esc(rec.status) + '").</div>'}
${body}
<h2>Electronic signatures</h2>${sigs.length ? `<table><tr><th>Meaning</th><th>Name</th><th>User ID</th><th>Date / time (UTC)</th><th>Stage</th><th>Valid for current content</th></tr>${sigs.map(x => `<tr><td>${esc(x.meaning)}</td><td>${esc(x.fullname)}</td><td>${esc(x.username)}</td><td>${esc(x.ts.slice(0, 19).replace('T', ' '))}</td><td>${esc(x.from_state)} → ${esc(x.to_state)}</td><td>${x.content_hash === h ? 'Yes' : 'Signed an earlier version'}</td></tr>`).join('')}</table>` : '<p class="empty">No signatures yet.</p>'}
<h2>Attachments (${atts.length})</h2>${atts.length ? `<table><tr><th>#</th><th>Stage</th><th>File (path in this ZIP)</th><th>Bytes</th><th>Added by</th><th>Added (UTC)</th><th>SHA-256</th></tr>${attRows.join('')}</table>` : '<p class="empty">No attachments.</p>'}
<h2>Linked records</h2>${links.length ? `<table><tr><th>Number</th><th>Module</th><th>Title</th><th>Status</th></tr>${links.map(l => `<tr><td>${esc(l.number)}</td><td>${esc(MODULES[l.type].name)}</td><td>${esc(l.data.title || '')}</td><td>${esc(l.status)}</td></tr>`).join('')}</table>` : '<p class="empty">None.</p>'}
<h2>Audit trail</h2>${withAudit ? `<table><tr><th>Date / time (UTC)</th><th>User</th><th>Action</th><th>Field</th><th>Old value</th><th>New value</th><th>Reason</th></tr>${trail.map(a => `<tr><td>${esc(a.ts.slice(0, 19).replace('T', ' '))}</td><td>${esc(a.fullname)}</td><td>${esc(a.action)}</td><td>${esc(a.field || '')}</td><td>${esc(a.old_value || '')}</td><td>${esc(a.new_value || '')}</td><td>${esc(a.reason || '')}</td></tr>`).join('')}</table>` : '<p class="empty">The audit trail is included in reports downloaded by QA, administrators and management.</p>'}
</body></html>`;
  files.unshift({ name: `${safeName(rec.number)} report.html`, data: html });
  if (withAudit) files.push({ name: 'audit-trail.csv', data: '\ufeff' + [['ID', 'Date / time (UTC)', 'User ID', 'Name', 'Action', 'Field', 'Old value', 'New value', 'Reason', 'Hash'],
    ...trail.map(a => [a.id, a.ts, a.username, a.fullname, a.action, a.field, a.old_value, a.new_value, a.reason, a.hash])].map(r => r.map(csvCell).join(',')).join('\r\n') });
  return zipFiles(files);
}
// ---------- issued copies of controlled forms (stamp on every page, fields stay fillable) ----------
// Register of issued controlled forms (QA, administrators, management)
route('GET', '/api/form-issues', (ctx) => { needAudit(ctx.user); return db.prepare('SELECT no,form_code,form_title,record_id,record_number,record_title,issued_to,issued_name,dept,ts FROM form_issues ORDER BY ts DESC').all(); });
// Audit agenda JRS/FRM/QAS/021 from the supplier record (shared with the supplier before the audit)
route('GET', '/api/records/:id/agenda.pdf', async (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), d = rec.data;
  if (rec.type !== 'vendors') fail(400, 'Audit agendas are prepared for supplier site audits.');
  if (!d.auditDate || !(d.agenda || []).length) fail(400, 'Enter the audit date and the audit schedule first.');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create(), F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { logo = await doc.embedPng(fs.readFileSync(path.join(PUBLIC, 'logo.png'))); } catch { /* no logo */ }
  const W = 595.28, H = 841.89, M = 50, page = doc.addPage([W, H]); let y = H - M;
  if (logo) page.drawImage(logo, { x: M, y: y - 30, width: logo.width * 30 / logo.height, height: 30 });
  [['FORM NUMBER', 'JRS/FRM/QAS/021'], ['FORM VERSION', '1.0'], ['FORM TITLE', 'AUDIT AGENDA'], ['RELATED SOP', 'JRS/SOP/QAS/005']].forEach(([k, v], i) => { page.drawText(k, { x: 320, y: y - 6 - i * 12, size: 7.5, font: FB }); page.drawText(v, { x: 410, y: y - 6 - i * 12, size: 7.5, font: F }); });
  y -= 70;
  const line = (s, o = {}) => { page.drawText(pdfText(s).slice(0, 110), { x: o.x || M, y, size: o.size || 9.5, font: o.font || F }); y -= o.gap || 15; };
  line(`Date: ${dmyText(today())}`); line('Dear Team,'); line(`This is the audit agenda for the ${(d.auditCategory || 'supplier audit').toLowerCase()} on ${dmyText(d.auditDate)}.`, { gap: 22 });
  for (const [k, v] of [['Auditee company', rec.data.title], ['Auditee representative', d.auditeeRep], ['Purpose', d.auditPurpose], ['Audit method / location', [d.auditMethod, d.auditLocation].filter(Boolean).join(' – ')], ['Date of audit', dmyText(d.auditDate)], ['Auditors', [userLabel(d.leadAuditor) + ' (lead auditor)', d.auditTeam].filter(Boolean).join(', ')]]) {
    page.drawText(k + ':', { x: M, y, size: 9.5, font: FB }); page.drawText(pdfText(v || '–').slice(0, 85), { x: M + 140, y, size: 9.5, font: F }); y -= 16;
  }
  y -= 8; line('Audit schedule:', { font: FB });
  const cols = [['Date', 70], ['Time', 70], ['Activity / area', 230], ['Participants', 125]];
  let x = M; cols.forEach(([c, w]) => { page.drawRectangle({ x, y: y - 14, width: w, height: 16, color: rgb(0.93, 0.95, 0.98), borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 }); page.drawText(c, { x: x + 3, y: y - 9, size: 8, font: FB }); x += w; }); y -= 16;
  for (const r of d.agenda || []) { x = M; [r.date ? dmyText(r.date) : '', r.time, r.activity, r.participants].forEach((v, i) => { page.drawRectangle({ x, y: y - 14, width: cols[i][1], height: 16, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 }); page.drawText(pdfText(v || '').slice(0, i === 2 ? 50 : 26), { x: x + 3, y: y - 9, size: 8, font: F }); x += cols[i][1]; }); y -= 16; if (y < 120) break; }
  y -= 12; line('*This audit agenda can be updated as per the requirement.', { size: 8 });
  page.drawText(`${rec.number} · prepared by ${ctx.user.fullname} on ${tsText(now())}`, { x: M, y: 30, size: 7, font: F, color: rgb(0.35, 0.35, 0.35) });
  audit(ctx.user, 'Audit agenda downloaded', rec, null, null, `JRS/FRM/QAS/021 for ${dmyText(d.auditDate)}`, null, ctx.ip);
  return { __raw: Buffer.from(await doc.save()), headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safeName(rec.number)} audit agenda.pdf"` } };
});
const FORMS_DIR = path.join(__dirname, 'forms');
function nextIssueNo() {
  const y = new Date().getFullYear(), key = 'formIssue:' + y, cur = +((db.prepare('SELECT value FROM settings WHERE key=?').get(key) || {}).value || 0) + 1;
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(cur));
  return `FI-${y}-${String(cur).padStart(3, '0')}`;
}
route('GET', '/api/forms/:type', async (ctx) => {
  const mod = MODULES[ctx.params.type], cfg = mod && mod.issueForm; if (!cfg) fail(404, 'No controlled form for this module.');
  if (hiddenFor(ctx.user, ctx.params.type)) fail(404, 'Not found');
  const rec = ctx.query.get('record') ? visibleRecord(ctx.user, getRecord(ctx.query.get('record'))) : null;
  if (rec && rec.type !== ctx.params.type) fail(400, 'The record does not belong to this module.');
  if (cfg.roles && !hasRole(ctx.user, cfg.roles)) fail(403, `Only ${cfg.roles.map(r => ROLES[r].split(' (')[0]).join(' / ')} can issue ${cfg.code}.`);
  if (cfg.fromRecordOnly && !rec) fail(400, `${cfg.code} is issued from the record it is for.`);
  const issued = rec && cfg.oncePerCycle ? db.prepare('SELECT * FROM form_issues WHERE record_id=? AND form_code=? AND ts>=? AND pdf IS NOT NULL ORDER BY ts DESC LIMIT 1').get(rec.id, cfg.code, rec.data.cycleStartedAt || '') : null;
  if (issued) { // one issue per supplier and qualification cycle: the same file every time
    audit(ctx.user, `Controlled form downloaded again (${issued.no})`, rec, null, null, `${cfg.code} issued ${issued.ts.slice(0, 10)} to ${issued.issued_name}`, null, ctx.ip);
    return { __raw: Buffer.from(issued.pdf), headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${cfg.code.replace(/\//g, '-')} ${issued.no}.pdf"` } };
  }
  if (rec && cfg.when && !cfg.when(rec.data, rec.status)) fail(409, `${cfg.code} is not needed for ${rec.number} at stage "${rec.status}".`);
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.load(fs.readFileSync(path.join(FORMS_DIR, cfg.file)));
  const F = await doc.embedFont(StandardFonts.HelveticaBold), F2 = await doc.embedFont(StandardFonts.Helvetica);
  if (rec) { const form = doc.getForm(); for (const [field, k] of Object.entries(cfg.prefill || {})) { try { form.getTextField(field).setText(pdfText(k === '#number' ? rec.number : rec.data[k] || '')); } catch { /* field not in this form version */ } } }
  const no = nextIssueNo(), who = `${ctx.user.fullname}${ctx.user.department ? ' (' + ctx.user.department + ')' : ''}`;
  const lines = [`ISSUED COPY – ${no}`, `Issued to ${who} on ${tsText(now())}`, rec ? `For ${rec.number} – ${rec.data.title || ''}` : 'Blank form – not valid without the issue number'];
  const red = rgb(0.75, 0.1, 0.1);
  for (const p of doc.getPages()) {
    // top margin, above the form header: clear of the form, the form number and the page number in the footer
    const { width, height } = p.getSize(), w = 250, h = 27, x = width - w - 18, y = height - h - 4;
    p.drawRectangle({ x, y, width: w, height: h, borderColor: red, borderWidth: 1.1, color: rgb(1, 1, 1), opacity: 0.92, borderOpacity: 1 });
    lines.forEach((l, i) => p.drawText(pdfText(l).slice(0, 64), { x: x + 6, y: y + h - 9.5 - i * 7.6, size: i ? 6 : 7.5, font: i ? F2 : F, color: red }));
  }
  doc.setTitle(`${cfg.code} – issued copy ${no}`);
  const buf = Buffer.from(await doc.save());
  if (rec) { (rec.data.formIssues ||= []).push({ no, by: ctx.user.username, ts: now() }); saveRecord(rec); }
  db.prepare('INSERT INTO form_issues (no,form_code,form_title,record_id,record_number,record_title,issued_to,issued_name,dept,ts,pdf) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(no, cfg.code, cfg.label, rec ? rec.id : null, rec ? rec.number : null, rec ? rec.data.title || '' : null, ctx.user.username, ctx.user.fullname, ctx.user.department || '', now(), cfg.oncePerCycle ? buf : null);
  audit(ctx.user, `Controlled form issued (${no})`, rec, null, null, `${cfg.code} issued to ${who}`, null, ctx.ip);
  const name = `${cfg.code.replace(/\//g, '-')} ${no}.pdf`;
  return { __raw: buf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"` } };
});

// ---------- merged PDF report ----------
// Standard PDF fonts use the Windows-1252 character set: map the few other characters used in the forms
const WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfText = (v) => String(v ?? '').replace(/\r/g, '').replace(/\t/g, '  ').replace(/[→⇒]/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[−‐‑]/g, '-')
  .replace(/[^\n\x20-\x7e\xa0-\xff]/g, c => WINANSI.includes(c) ? c : '?');
const kindOf = (buf) => buf.slice(0, 4).toString('latin1') === '%PDF' ? 'pdf' : buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : '';
function plainValue(f, v) {
  if (v === '' || v == null || (Array.isArray(v) && !v.length)) return '—';
  if (f.type === 'table') return v.map((row, i) => `${i + 1}. ` + f.cols.map(c => `${c.label}: ${c.type === 'user' ? userLabel(row[c.k]) : row[c.k] || '–'}`).join('; ')).join('\n');
  if (f.type === 'checklist') return f.rows.map(r => `${r}: ${(v[r] || {}).v || '–'}${(v[r] || {}).r ? ' (' + v[r].r + ')' : ''}`).join('\n');
  if (f.type === 'user' || f.fmt === 'user') return userLabel(v);
  if (f.optionLabels && f.optionLabels[v]) return f.optionLabels[v];
  if ((f.type === 'date' || f.fmt === 'date') && /^\d{4}-\d{2}-\d{2}/.test(v)) return dmyText(v);
  return String(fmt(v));
}
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmyText = (v) => { const [y, m, d] = String(v).slice(0, 10).split('-'); return `${d}-${MON3[+m - 1]}-${y}`; };
const tsText = (v) => `${dmyText(v)} ${String(v).slice(11, 19)} UTC`;
async function reportPdf(user, rec) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const mod = MODULES[rec.type], withAudit = canSeeAudit(user), h = contentHash(rec), d = rec.data;
  const doc = await PDFDocument.create();
  doc.setTitle(`${rec.number} – ${pdfText(d.title || mod.name)}`); doc.setAuthor(CFG.orgName); doc.setCreator('JRS eQMS'); doc.setProducer('JRS eQMS (pdf-lib)');
  const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { logo = await doc.embedPng(fs.readFileSync(path.join(PUBLIC, 'logo.png'))); } catch { /* no logo */ }
  const W = 595.28, H = 841.89, M = 40, blue = rgb(0.10, 0.40, 0.69), grey = rgb(0.38, 0.40, 0.43), lineC = rgb(0.80, 0.83, 0.86), black = rgb(0, 0, 0);
  let page, y;
  const head = (p, label) => {
    if (logo) { const hh = 26; p.drawImage(logo, { x: M, y: H - M - hh + 10, width: logo.width * hh / logo.height, height: hh }); }
    const t = pdfText(label); p.drawText(t, { x: W - M - FB.widthOfTextAtSize(t, 9.5), y: H - M - 2, size: 9.5, font: FB, color: blue });
    p.drawLine({ start: { x: M, y: H - M - 22 }, end: { x: W - M, y: H - M - 22 }, thickness: 0.8, color: blue });
  };
  const own = new Set(), attPages = new Map(); // report pages carry the header; merged attachment pages get a numbered strip
  const newPage = (label = `${mod.name} – ${rec.number}`) => { page = doc.addPage([W, H]); own.add(page); head(page, label); y = H - M - 34; };
  const ensure = (need) => { if (y - need < M + 16) newPage(); };
  const wrap = (s, font, size, width) => {
    const out = [];
    for (const para of pdfText(s).split('\n')) {
      let cur = '';
      for (let w of para.split(/ +/)) {
        while (font.widthOfTextAtSize(w, size) > width) { let i = w.length; while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--; if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, i)); w = w.slice(i); }
        const t = cur ? cur + ' ' + w : w;
        if (cur && font.widthOfTextAtSize(t, size) > width) { out.push(cur); cur = w; } else cur = t;
      }
      out.push(cur);
    }
    return out;
  };
  const text = (s, o = {}) => { const { font = F, size = 9, color = black, x = M, width = W - 2 * M } = o; for (const l of wrap(s, font, size, width)) { ensure(size + 3); page.drawText(l, { x, y: y - size, size, font, color }); y -= size + 3; } };
  const heading = (s) => { ensure(44); y -= 8; page.drawRectangle({ x: M, y: y - 17, width: W - 2 * M, height: 19, color: rgb(0.92, 0.95, 0.99) }); page.drawText(pdfText(s).slice(0, 105), { x: M + 6, y: y - 12.5, size: 10, font: FB, color: blue }); y -= 26; };
  const table = (cols, rows, size = 7.8) => {
    const tw = cols.reduce((a, c) => a + c.w, 0);
    const row = (cells, font, bg) => {
      const lines = cells.map((c, i) => wrap(c, font, size, cols[i].w - 6).slice(0, 60));
      const hgt = Math.max(1, ...lines.map(l => l.length)) * (size + 2) + 5;
      if (y - hgt < M + 16) { newPage(); if (font !== FB) row(cols.map(c => c.label), FB, rgb(0.95, 0.96, 0.97)); }
      if (bg) page.drawRectangle({ x: M, y: y - hgt, width: tw, height: hgt, color: bg });
      let x = M;
      cells.forEach((c, i) => { lines[i].forEach((l, j) => page.drawText(l, { x: x + 3, y: y - 3 - size - j * (size + 2), size, font })); page.drawRectangle({ x, y: y - hgt, width: cols[i].w, height: hgt, borderColor: lineC, borderWidth: 0.5 }); x += cols[i].w; });
      y -= hgt;
    };
    row(cols.map(c => c.label), FB, rgb(0.95, 0.96, 0.97));
    for (const r of rows) row(r.map(v => String(v ?? '')), F);
    y -= 6;
  };
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=? ORDER BY id').all(rec.id);
  const atts = db.prepare('SELECT * FROM attachments WHERE record_id=? ORDER BY ts').all(rec.id);
  const links = linked(rec.id).filter(r => canSee(user, r));
  const final = LOCKED.has(rec.status) || rec.status.startsWith('Closed');

  // ----- report -----
  newPage();
  text(`${mod.name}`, { font: F, size: 10, color: grey });
  text(rec.number, { font: FB, size: 17, color: blue });
  text(d.title || '', { font: FB, size: 11 });
  y -= 2;
  text(`Status: ${rec.status}   ·   Created by ${userLabel(rec.created_by)} on ${tsText(rec.created_at)}   ·   Report by ${user.fullname} on ${tsText(now())}`, { size: 8.5, color: grey });
  if (!final) { ensure(22); y -= 4; page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 18, color: rgb(1, 0.97, 0.88), borderColor: rgb(0.82, 0.6, 0.13), borderWidth: 0.6 }); page.drawText(pdfText(`Interim report – the record is still in progress (stage "${rec.status}").`), { x: M + 6, y: y - 12, size: 8.5, font: FB, color: rgb(0.5, 0.35, 0) }); y -= 24; }
  const LW = 170; let skip = false;
  for (const f of mod.fields) {
    if (f.type === 'section') { skip = !!(f.showIf && !f.showIf(d, rec.status)); if (!skip) heading(f.label); continue; }
    if (!f.k || skip) continue; // sections that do not apply (e.g. evaluations the risk assessment does not require)
    const lab = wrap(f.label, F, 8, LW - 8), val = wrap(plainValue(f, d[f.k]), F, 8.8, W - 2 * M - LW).slice(0, 200);
    const hgt = Math.max(lab.length * 10, val.length * 11.2) + 4;
    if (hgt < 700) ensure(hgt);
    lab.forEach((l, i) => { if (y - 8 - i * 10 > M + 16) page.drawText(l, { x: M, y: y - 8 - i * 10, size: 8, font: F, color: grey }); });
    let yy = y;
    for (const l of val) { if (yy - 11 < M + 16) { newPage(); yy = y; } page.drawText(l, { x: M + LW, y: yy - 8.8, size: 8.8, font: F }); yy -= 11.2; }
    y = Math.min(yy, y - lab.length * 10) - 4;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.3, color: lineC });
  }
  // ----- signatures, with the signer's registered signature specimen -----
  heading('Electronic signatures');
  if (!sigs.length) text('No signatures yet.', { color: grey });
  const sigImg = {};
  for (const s of sigs) {
    ensure(44);
    if (!(s.username in sigImg)) { const u = db.prepare('SELECT signature FROM users WHERE username=?').get(s.username); try { sigImg[s.username] = u && u.signature ? await doc.embedPng(Buffer.from(u.signature.split(',')[1], 'base64')) : null; } catch { sigImg[s.username] = null; } }
    const im = sigImg[s.username];
    page.drawText(pdfText(s.meaning).slice(0, 95), { x: M, y: y - 10, size: 9, font: FB });
    page.drawText(pdfText(`${s.fullname} (${s.username}) · ${tsText(s.ts)} · ${s.from_state || ''} -> ${s.to_state || ''}${s.content_hash === h ? '' : ' · signed an earlier version'}`).slice(0, 120), { x: M, y: y - 22, size: 7.8, font: F, color: grey });
    if (im) { const ih = 30, iw = Math.min(120, im.width * ih / im.height); page.drawImage(im, { x: W - M - iw, y: y - 34, width: iw, height: ih }); }
    page.drawLine({ start: { x: M, y: y - 38 }, end: { x: W - M, y: y - 38 }, thickness: 0.3, color: lineC });
    y -= 42;
  }
  // ----- attachments list and linked records -----
  heading(`Attachments (${atts.length})`);
  const merged = atts.map(a => ['pdf', 'png', 'jpg'].includes(kindOf(Buffer.from(a.blob))));
  if (atts.length) table([{ label: 'No.', w: 62 }, { label: 'Stage', w: 70 }, { label: 'File', w: 140 }, { label: 'Added by', w: 100 }, { label: 'Added', w: 85 }, { label: 'In this PDF', w: 58 }],
    atts.map((a, i) => [`Attachment ${i + 1}`, a.stage || '', a.name, userLabel(a.uploaded_by), tsText(a.ts), merged[i] ? 'Yes' : 'No – open in eQMS']));
  else text('No attachments.', { color: grey });
  heading('Linked records');
  if (links.length) table([{ label: 'Number', w: 120 }, { label: 'Module', w: 110 }, { label: 'Title', w: 200 }, { label: 'Status', w: 85 }], links.map(l => [l.number, MODULES[l.type].name, l.data.title || '', l.status]));
  else text('None.', { color: grey });

  // ----- attachments: PDF pages and images merged in -----
  for (const [i, a] of atts.entries()) {
    const buf = Buffer.from(a.blob), kind = kindOf(buf), label = `Attachment ${i + 1} – ${a.name} (stage ${a.stage || '–'})`;
    try {
      if (kind === 'pdf') {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        if (src.isEncrypted) throw new Error('protected PDF');
        const pages = await doc.copyPages(src, src.getPageIndices());
        for (const p of pages) { doc.addPage(p); attPages.set(p, label); }
      } else if (kind === 'png' || kind === 'jpg') {
        const im = kind === 'png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
        newPage(label);
        const maxW = W - 2 * M, maxH = H - 2 * M - 50, sc = Math.min(maxW / im.width, maxH / im.height, 1);
        page.drawImage(im, { x: M + (maxW - im.width * sc) / 2, y: H - M - 40 - im.height * sc, width: im.width * sc, height: im.height * sc });
      }
    } catch (e) {
      newPage(label); text(label, { font: FB, size: 10 });
      text(`This file could not be added to the PDF (${e.message === 'protected PDF' ? 'it is a protected / encrypted PDF' : 'unreadable file'}). Open it from the record in the eQMS.`, { color: grey });
    }
  }
  // ----- audit trail (QA, administrators, management) -----
  newPage();
  heading('Audit trail');
  if (withAudit) {
    const trail = db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id').all(rec.id);
    const lbl = (k) => { const f = mod.fields.find(x => x.k === k); return f ? f.label.split(' (')[0] : k || ''; };
    table([{ label: 'Date / time', w: 72 }, { label: 'User', w: 78 }, { label: 'Action', w: 105 }, { label: 'Field', w: 70 }, { label: 'Change', w: 125 }, { label: 'Reason', w: 65.28 }],
      trail.map(a => [tsText(a.ts), a.fullname, a.action, lbl(a.field), a.old_value != null ? `${a.old_value} -> ${a.new_value ?? ''}` : a.new_value || '', a.reason || '']), 7);
  } else text('The audit trail is included in reports produced by QA, administrators and management.', { color: grey });
  // footer on every page
  const pages = doc.getPages(), stamp = `${rec.number} · ${CFG.orgName} · ${final ? 'Final report' : 'Interim report'} · ${tsText(now())}`;
  pages.forEach((p, i) => {
    const { width, height } = p.getSize(), pn = `Page ${i + 1} of ${pages.length}`;
    if (own.has(p)) p.drawText(pn, { x: width - M - F.widthOfTextAtSize(pn, 8), y: H - M - 16, size: 8, font: F, color: grey }); // header: logo, record, page number
    else { // merged attachment page: strip with the attachment number, logo and page number
      p.drawRectangle({ x: 0, y: height - 18, width, height: 18, color: rgb(1, 1, 1), opacity: 0.9 });
      let x = 6; if (logo) { const lw = logo.width * 12 / logo.height; p.drawImage(logo, { x, y: height - 15, width: lw, height: 12 }); x += lw + 8; }
      p.drawText(pdfText(`${rec.number} · ${attPages.get(p) || ''}`).slice(0, 110), { x, y: height - 12, size: 7, font: FB, color: blue });
      p.drawText(pn, { x: width - 6 - F.widthOfTextAtSize(pn, 7), y: height - 12, size: 7, font: F, color: grey });
    }
    p.drawText(pdfText(stamp), { x: 18, y: 10, size: 6.5, font: F, color: grey });
  });
  return Buffer.from(await doc.save());
}
route('GET', '/api/records/:id/report.pdf', async (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), inline = ctx.query.get('inline') === '1';
  const buf = await reportPdf(ctx.user, rec);
  audit(ctx.user, inline ? 'Report printed (PDF)' : 'Report downloaded (PDF)', rec, null, null, `Stage ${rec.status}`, null, ctx.ip);
  const name = safeName(rec.number) + ' report.pdf';
  return { __raw: buf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^ -~]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` } };
});
route('GET', '/api/records/:id/report', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  const buf = reportZip(ctx.user, rec);
  audit(ctx.user, 'Report downloaded', rec, null, null, `ZIP at stage ${rec.status}`, null, ctx.ip);
  return { __raw: buf, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${safeName(rec.number).replace(/[^ -~]/g, '_')} report.zip"; filename*=UTF-8''${encodeURIComponent(safeName(rec.number) + ' report.zip')}` } };
});
route('GET', '/api/export/:id', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  audit(ctx.user, 'Record exported', rec, null, null, 'JSON', null, ctx.ip);
  const out = { record: rec, signatures: db.prepare('SELECT * FROM signatures WHERE record_id=?').all(rec.id), exportedBy: ctx.user.username, exportedAt: now() };
  if (canSeeAudit(ctx.user)) out.audit = db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id').all(rec.id);
  return out;
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
      if (req.method !== 'GET' && ctx.user.roles.every(r => r === 'extaud') && !['/api/logout', '/api/password', '/api/esig-accept'].includes(url.pathname))
        fail(403, 'Read-only access: external auditors and inspectors cannot change records.');
    }
    if (req.method === 'POST' || req.method === 'PUT') ctx.body = await readBody(req);
    ACTOR = { user: ctx.user || null, reason: String(ctx.body.reason || '').slice(0, 500) };
    const out = await r.handler(ctx);
    const headers = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
    if (out && out.__raw) return send(res, 200, out.__raw, { ...out.headers, ...headers });
    send(res, 200, out ?? { ok: true }, headers);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e.code || 500, { error: e instanceof HttpError ? e.message : 'Unexpected server error', ...(e instanceof HttpError && e.extra ? e.extra : {}) });
  }
});
const STATE_MAP = { vendors: { Prospective: 'Risk Assessment', 'Under Qualification': 'Under Quality Review', 'Conditionally Approved': 'Approved', 'Under QA Review': 'Risk Assessment', Evaluation: 'Under Quality Review', Suspended: 'On Hold', Disqualified: 'Rejected' }, customers: { Pending: 'Under QA Review', Requested: 'Under QA Review', Blocked: 'On Hold' }, investigations: { Initiated: 'Initiation', 'Number Assignment': 'Requested', 'QA Assessment': 'QA Review', 'Pre-Approval': 'QA Review', Evaluation: 'QA Evaluation' }, changes: { 'Number Assignment': 'Draft', Requested: 'Draft', Initiation: 'Draft', 'QA Assessment': 'QA Review', 'Pre-Approval': 'RP Review', 'Pending Closure': 'QA Closure Review' } };
for (const [type, map] of Object.entries(STATE_MAP)) for (const r of db.prepare(`SELECT * FROM records WHERE type=? AND status IN (${Object.keys(map).map(() => '?').join(',')})`).all(type, ...Object.keys(map)).map(rowToRecord)) {
  const from = r.status; r.status = map[from]; r.data.stateEnteredAt = now();
  ACTOR = { user: null, reason: 'Workflow updated' }; if (DERIVE[type]) DERIVE[type](r); saveRecord(r);
  audit(null, 'Status changed (workflow updated)', r, 'status', from, r.status, 'Workflow updated: departments and organogram');
}
// records that existed before version history was introduced get a baseline version 1 (once)
for (const r of db.prepare('SELECT * FROM records WHERE id NOT IN (SELECT DISTINCT record_id FROM versions)').all().map(rowToRecord)) {
  ACTOR = { user: null, reason: 'Baseline – version history started for an existing record' }; snapshot(r);
}
ACTOR = null;
if (require.main === module) server.listen(CFG.port, CFG.host, () => console.log(`eQMS listening on http://${CFG.host}:${CFG.port}`));
module.exports = { server, generateList, db, audit, hashPw, now, loadDepartments }; // internals for maintenance scripts (scripts/)
