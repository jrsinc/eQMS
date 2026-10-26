/* Sign-in, password change and automatic lock. */
'use strict';
// ---------- auth screens ----------
function renderLogin(msg = '') {
  clearInterval(idleTimer);
  $('#app').innerHTML = `${envBanner()}<div class="login"><div class="side"><h1>Quality records you can stand behind in an inspection.</h1>
    <p>Documents, training, deviations and complaints, CAPA, change control, audits, suppliers and clinical supply — one validated system with a full audit trail and electronic signatures.</p></div>
    <form id="lf"><div class="brand login-brand"><img class="brand-logo" src="/logo.png" alt="Jupiter Research Services"></div><p class="muted small" style="margin:-.4rem 0 0">Electronic Quality Management System</p>
    <h2>Sign in</h2><div><label class="f" for="u">User ID or email</label><input id="u" type="text" autocomplete="username" required></div>
    <div><label class="f" for="p">Password</label><input id="p" type="password" autocomplete="current-password" required></div>
    <div class="error" role="alert">${esc(msg)}</div><button class="btn primary">Sign in</button>
    <p class="small muted">Authorised users only. All activity is recorded in the audit trail.</p></form></div>`;
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { ME = await api('POST', '/api/login', { username: $('#u').value, password: $('#p').value }); await afterLogin(); }
    catch (x) { $('.error').textContent = x.message; }
  });
  $('#u').focus();
}
async function afterLogin() {
  if (ME.mustChange) return renderPasswordChange(true);
  USERS = await api('GET', '/api/users');
  CFG.setDepartments(await api('GET', '/api/departments'));
  startIdle(); if (!location.hash) location.hash = '#/dashboard'; route();
}
function renderPasswordChange(forced) {
  const html = `<div class="panel" style="max-width:480px"><h2>${forced ? 'Set a new password' : 'Change password'}</h2>
   ${forced ? '<p class="muted">Your password was set by an administrator. Choose a new one to continue.</p>' : ''}
   <form id="pf" class="stack"><div><label class="f">Current password</label><input type="password" name="current" autocomplete="current-password"></div>
   <div><label class="f">New password (min. 10 characters, upper, lower, number)</label><input type="password" name="next" autocomplete="new-password"></div>
   <div><label class="f">Repeat new password</label><input type="password" name="again" autocomplete="new-password"></div>
   <div id="pcode" hidden><label class="f">Confirmation code (sent to your e-mail)</label><input type="text" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"><p class="small muted" id="pcodeto"></p></div>
   <div class="error"></div><button class="btn primary" id="psave">Save password</button></form></div>`;
  if (forced) $('#app').innerHTML = `<div class="content">${html}</div>`; else shell('password', html);
  $('#pf').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      if (f.next.value !== f.again.value) throw new Error('New passwords do not match.');
      const r = await api('POST', '/api/password', { current: f.current.value, next: f.next.value, code: f.code.value.trim() || undefined });
      if (r.codeSent) { $('#pcode').hidden = false; $('#pcodeto').textContent = `A 6-digit code was e-mailed to ${r.to}. It is valid for 10 minutes.`; $('#psave').textContent = 'Confirm password change'; f.code.focus(); toast('Confirmation code e-mailed'); return; }
      ME.mustChange = false; toast('Password changed'); if (forced) afterLogin(); else location.hash = '#/dashboard';
    } catch (x) { $('.error', f).textContent = x.message; }
  });
}
function startIdle() {
  clearInterval(idleTimer); idleLeft = (ME.idleMinutes || 15) * 60;
  idleTimer = setInterval(async () => {
    idleLeft--; const el = $('#idle'); if (el) el.textContent = `${Math.floor(idleLeft / 60)}:${String(idleLeft % 60).padStart(2, '0')}`;
    if (idleLeft <= 0) { clearInterval(idleTimer); ME = null; renderLogin('Locked after inactivity. Sign in again.'); }
  }, 1000);
}
function resetIdle() { if (ME) idleLeft = (ME.idleMinutes || 15) * 60; }
['click', 'keydown'].forEach(ev => document.addEventListener(ev, resetIdle));

