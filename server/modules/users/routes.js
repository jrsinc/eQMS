/* Users, passwords and signature register API. */
'use strict';
const crypto = require('node:crypto');
const { DERIVED_ROLES, EMAIL_RE, ROLES } = require('../../../public/modules.js');
const { db, now, sha256 } = require('../../core/db.js');
const { addDays, today, tsText } = require('../../core/util.js');
const { checkPw, hashPw, pwPolicy } = require('../../core/passwords.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { REREGISTER_YEARS, allAccess, esigCurrent, withOrg } = require('../../core/auth.js');
const { activeUser, deptMap } = require('../../org/departments.js');
const { mailOn, mailPassword, queueMail } = require('../../core/mail.js');
const { setOrg } = require('../org/routes.js');

// Password change confirmed by e-mail: the first call checks the passwords and e-mails a 6-digit code (valid 10 minutes, 5 tries);
// the second call with the code changes the password. Without e-mail on the server the change is made directly (and logged so).
const pwPending = new Map();
 // username -> { codeHash, pwHash, exp, tries }
const maskMail = (e) => String(e).replace(/^(.{1,2})[^@]*(@.*)$/, (m, a, b) => a + '•••' + b);
route('POST', '/api/password', (ctx) => {
  const { current, next } = ctx.body, code = String(ctx.body.code || '').trim();
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(ctx.user.username);
  if (!checkPw(String(current || ''), u.pw_hash)) fail(401, 'Current password incorrect.');
  const p = pwPolicy(next); if (p) fail(400, p);
  if (checkPw(next, u.pw_hash)) fail(400, 'New password must differ from the current one.');
  const byMail = mailOn();
  if (byMail && !u.email) fail(400, 'Your account has no e-mail address for the confirmation code. Ask an administrator to add it.');
  if (byMail && !code) {
    const c = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    pwPending.set(u.username, { codeHash: sha256(u.username + ':' + c), pwHash: hashPw(next), exp: Date.now() + 10 * 60000, tries: 0 });
    queueMail(u.email, 'JRS eQMS – confirm your password change', `Hello ${u.fullname},

Your confirmation code for changing your eQMS password is: ${c}

It is valid for 10 minutes. If you did not ask to change your password, do not use the code and tell your administrator.

JRS eQMS – automatic message. Do not reply.`);
    audit(ctx.user, 'Password change requested', null, null, null, `Confirmation code e-mailed to ${maskMail(u.email)}`, null, ctx.ip);
    return { codeSent: true, to: maskMail(u.email) };
  }
  if (byMail) {
    const pend = pwPending.get(u.username);
    if (!pend || Date.now() > pend.exp) { pwPending.delete(u.username); fail(400, 'The confirmation code has expired. Start the password change again.'); }
    if (!checkPw(next, pend.pwHash)) fail(400, 'The new password is not the one the code was sent for. Start the password change again.');
    if (sha256(u.username + ':' + code) !== pend.codeHash) {
      if (++pend.tries >= 5) pwPending.delete(u.username);
      audit(ctx.user, 'Password change: wrong confirmation code', null, null, null, null, null, ctx.ip);
      fail(400, pend.tries >= 5 ? 'Too many wrong codes. Start the password change again.' : 'The confirmation code is not correct.');
    }
    pwPending.delete(u.username);
  }
  db.prepare('UPDATE users SET pw_hash=?, must_change=0 WHERE username=?').run(hashPw(next), u.username);
  audit(ctx.user, 'Password changed', null, null, null, byMail ? 'Confirmed with the code e-mailed to the user' : 'E-mail not set up on the server: changed without e-mail confirmation', null, ctx.ip);
  if (byMail) queueMail(u.email, 'JRS eQMS – your password was changed', `Hello ${u.fullname},

Your eQMS password was changed on ${tsText(now())}. If this was not you, tell your administrator at once.

JRS eQMS – automatic message. Do not reply.`);
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
  // every user has an e-mail address: notifications and password-change confirmations are e-mailed
  if (!String(email || '').trim()) fail(400, 'Enter the e-mail address of the user (notifications and password confirmations are sent to it).');
  if (!EMAIL_RE.test(String(email).trim())) fail(400, 'Enter a valid e-mail address, e.g. name@company.com.');
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
    const em = String(ctx.body.email).trim().toLowerCase(); if (!em) fail(400, 'Every user needs an e-mail address; it cannot be removed.'); if (!EMAIL_RE.test(em)) fail(400, 'Enter a valid e-mail address, e.g. name@company.com.');
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

module.exports = { pwPending, maskMail };
