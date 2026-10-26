/* Sessions, roles, users and electronic signatures. */
'use strict';
const { DERIVED_ROLES, GROUPS_OFF, MODULES } = require('../../public/modules.js');
const { CFG } = require('./config.js');
const { db, now } = require('./db.js');
const { checkPw, hashPw } = require('./passwords.js');
const { audit } = require('./audit.js');
const { fail } = require('./http.js');
// defined in modules loaded later: resolved when called
const deptsHeaded = (...a) => require('../org/departments.js').deptsHeaded(...a);

const REREGISTER_YEARS = 5;

// ---------- seed admin ----------
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const pw = process.env.ADMIN_INITIAL_PASSWORD || 'ChangeMe-2026!';
  db.prepare('INSERT INTO users (username,fullname,email,roles,pw_hash,must_change,created_at) VALUES (?,?,?,?,?,1,?)')
    .run('admin', 'System Administrator', '', JSON.stringify(['admin']), hashPw(pw), now());
  audit(null, 'User created', null, 'username', null, 'admin', 'Initial installation');
  console.log('Created initial user "admin". Initial password: ' + (process.env.ADMIN_INITIAL_PASSWORD ? '(from ADMIN_INITIAL_PASSWORD)' : pw));
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
  const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(s.username);
  if (!u || (u.locked && !neverLocked(u))) return null;
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
  department: u.department || '', hodOf: u.hodOf || [], deptsUnder: u.deptsUnder || [], allAccess: allAccess(u), canEditOrg: canEditOrg(u), modulesOff: [...OFF_TYPES] });

// System administrators are never locked out (failed attempts are still recorded and slowed down), so the system always has
// someone who can unlock and reset the other accounts
const neverLocked = (u) => { try { return (Array.isArray(u.roles) ? u.roles : JSON.parse(u.roles || '[]')).includes('admin'); } catch { return false; } };
function verifySignature(user, body) {
  if (!esigCurrent(user)) fail(403, user.esig_accepted ? `Signature registration is older than ${REREGISTER_YEARS} years. Accept the electronic signature statement again (JRS/SOP/QAS/009).` : 'Accept the electronic signature statement before signing.');
  if (body.sigUsername !== user.username) fail(403, 'Signature user ID must match the logged-in user.');
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(user.username);
  if (!checkPw(String(body.password || ''), u.pw_hash)) {
    const failed = u.failed + 1;
    const lock = failed >= CFG.maxFailed && !neverLocked(u);
    db.prepare('UPDATE users SET failed=?, locked=? WHERE username=?').run(failed, lock ? 1 : 0, u.username);
    audit(user, 'E-signature failed', null, null, null, null, 'Wrong password');
    fail(422, lock ? 'Account locked after repeated failures. Contact your administrator.' : 'Password incorrect. Signature not applied.');
  }
  db.prepare('UPDATE users SET failed=0 WHERE username=?').run(u.username);
}
// Confidential modules: hideFrom = invisible to users whose roles are all listed (e.g. external auditors);
// visibleTo = visible only to users holding one of the listed roles (e.g. audit trail reviews: QA and admin)
// switched-off module groups (modules.js GROUPS_OFF, or MODULE_GROUPS_OFF="Group A,Group B" in .env; empty = none): hidden from everyone
const OFF_GROUPS = process.env.MODULE_GROUPS_OFF !== undefined ? process.env.MODULE_GROUPS_OFF.split(',').map(s => s.trim()).filter(Boolean) : GROUPS_OFF;
const OFF_TYPES = new Set(Object.keys(MODULES).filter(k => OFF_GROUPS.includes(MODULES[k].group)));
const userLabel = (u) => (db.prepare('SELECT fullname FROM users WHERE username=?').get(u) || {}).fullname || u;
const userRow = (u) => u ? db.prepare('SELECT username, fullname, email, roles, active FROM users WHERE username=?').get(u) : null;
const usersWithRole = (r) => db.prepare('SELECT username, roles FROM users WHERE active=1').all().filter(u => JSON.parse(u.roles).includes(r)).map(u => u.username);

module.exports = { neverLocked, REREGISTER_YEARS, sessions, getUser, withOrg, allAccess, canEditOrg, hasRole, esigCurrent, pub, verifySignature, OFF_GROUPS, OFF_TYPES, userLabel, userRow, usersWithRole };
