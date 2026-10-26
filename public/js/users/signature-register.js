/* Register of signatures (JRS/SOP/QAS/009). */
'use strict';
// ---------- register of signatures (JRS/SOP/QAS/009) ----------
async function signatureRegister() {
  USERS = await api('GET', '/api/users');
  const status = (u) => !u.active ? `<span class="pill grey">Inactive${u.inactive_date ? ' from ' + dmy(u.inactive_date) : ''}</span>` : !u.esig_accepted ? '<span class="pill warn">Not registered</span>'
    : u.esigCurrent ? '<span class="pill done">Registered</span>' : '<span class="pill bad">Re-registration due</span>';
  const me = USERS.find(u => u.username === ME.username) || {};
  shell('signatures', `<div class="spread"><div><h1>Signature register</h1><p class="muted">Electronic register of signatures (replaces FRM/QAS/008). A user registers by accepting the electronic signature statement at first signing; registration is renewed every 5 years. Superseded entries stay in the audit trail.</p></div><div class="row"><button class="btn primary" id="sr">${me.hasSignature && me.esigCurrent ? 'Re-register my signature' : 'Register my signature'}</button><button class="btn" id="sx">Export CSV</button></div></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>User ID</th><th>Designation</th><th>Department</th><th>Initials</th><th>Signature</th><th>Registered on</th><th>Re-register by</th><th>Status</th></tr></thead><tbody>
    ${USERS.map(u => `<tr><td>${esc(u.fullname)}</td><td class="mono">${esc(u.username)}</td><td>${esc(u.designation || '')}</td><td>${esc(CFG.DEPTS[u.department] || u.department || '')}</td><td class="mono">${esc(u.initials || '')}</td><td>${u.hasSignature ? `<img class="sig-thumb" alt="Signature of ${esc(u.fullname)}" src="/api/users/${encodeURIComponent(u.username)}/signature?v=${encodeURIComponent(u.esig_accepted || '')}">` : ''}</td><td>${dmy(u.esig_accepted)}</td><td>${dmy(u.reregisterBy)}</td><td>${status(u)}</td></tr>`).join('')}</tbody></table></div>`);
  $('#sr').addEventListener('click', async () => { if (await registerSignature()) signatureRegister(); });
  $('#sx').addEventListener('click', () => download(`signature_register_${today()}.csv`, toCsv([['Name', 'User ID', 'Designation', 'Department', 'Initials', 'Registered on', 'Re-register by', 'Active', 'Inactive from'], ...USERS.map(u => [u.fullname, u.username, u.designation, u.department, u.initials, u.esig_accepted, u.reregisterBy, u.active ? 'Yes' : 'No', u.inactive_date])])));
}

