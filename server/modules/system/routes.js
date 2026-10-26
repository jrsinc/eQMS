/* Health, sign-in, session and configuration API. */
'use strict';
const crypto = require('node:crypto');
const { ROLES } = require('../../../public/modules.js');
const { CFG } = require('../../core/config.js');
const { db, now } = require('../../core/db.js');
const { checkPw } = require('../../core/passwords.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { neverLocked, pub, sessions, withOrg } = require('../../core/auth.js');
const { deptRows } = require('../../org/departments.js');
const { mailOn } = require('../../core/mail.js');

route('GET', '/api/health', () => ({ ok: true, org: CFG.orgName, envLabel: CFG.envLabel, sharepoint: !!(CFG.sp.tenant && CFG.sp.clientId && CFG.sp.siteId) }), { public: true });

route('POST', '/api/login', async (ctx) => {
  const { username, password } = ctx.body;
  // sign in with the user ID or the email address
  const id = String(username || '').toLowerCase().trim();
  const u = db.prepare("SELECT * FROM users WHERE username=? OR (email<>'' AND lower(email)=?)").get(id, id);
  if (!u || !u.active) { audit(null, 'Login failed', null, 'username', null, username, 'Unknown or inactive user', ctx.ip); fail(401, 'User ID or password incorrect.'); }
  const admin = neverLocked(u);
  if (u.locked && !admin) fail(423, 'Account locked. Contact your administrator.');
  if (!checkPw(String(password || ''), u.pw_hash)) {
    const failed = u.failed + 1, locked = failed >= CFG.maxFailed && !admin ? 1 : 0;
    if (admin && failed >= CFG.maxFailed) await new Promise(r => setTimeout(r, 2000)); // administrators are not locked: slow repeated guesses down instead
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

module.exports = {  };
