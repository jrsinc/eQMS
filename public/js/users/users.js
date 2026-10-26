/* Users and roles. */
'use strict';
// ---------- users ----------
const f_pwNote = (ok, u) => ok.mailConfigured === false ? 'User updated. E-mail is not set up – if you reset the password, give it to the user yourself.' : !u.email ? 'User updated. The user has no e-mail address – give a reset password to them yourself.' : 'User updated';
async function usersView() {
  if (!ME.allAccess) return dashboard();
  USERS = await api('GET', '/api/users'); const sys = await api('GET', '/api/config');
  const noMail = USERS.filter(u => u.active && !u.email);
  // Heads of Department come from the organogram and every QA user assigns numbers, so those two roles are not ticked here
  const roleBox = (sel) => ([k, v]) => `<label><input type="checkbox" name="roles" value="${k}" ${sel.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`;
  const roleChecks = (sel = []) => `<p class="small muted" style="margin:.2rem 0">Main role</p><div class="checks">${CFG.MAIN_ROLES.map(k => [k, CFG.ROLES[k]]).map(roleBox(sel)).join('')}</div>
    <p class="small muted" style="margin:.6rem 0 .2rem">Additional permissions for specific modules</p><div class="checks">${Object.entries(CFG.ROLES).filter(([k]) => !CFG.MAIN_ROLES.includes(k) && !CFG.DERIVED_ROLES.includes(k)).map(roleBox(sel)).join('')}</div>
    <p class="small muted">Head of Department is set in the organogram; all QA users assign record numbers.</p>`;
  // register-of-signatures details (JRS/SOP/QAS/009)
  const regFields = (u = {}) => `<div class="grid"><div><label class="f">Designation</label><input type="text" name="designation" value="${esc(u.designation || '')}"></div>
    <div><label class="f">Department</label><select name="department"><option value=""></option>${Object.entries(CFG.DEPTS).map(([k, v]) => `<option value="${k}" ${u.department === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
    <div><label class="f">Reports to (line manager)</label><select name="reportsTo"><option value=""></option>${USERS.filter(x => x.active && x.username !== u.username).map(x => `<option value="${esc(x.username)}" ${u.reports_to === x.username ? 'selected' : ''}>${esc(x.fullname)}</option>`).join('')}</select></div>
    </div>`;
  const regVals = (f) => ({ designation: val(f, 'designation'), department: val(f, 'department'), reportsTo: val(f, 'reportsTo') });
  shell('users', `<div class="spread"><div><h1>Users and roles</h1><p class="muted">User IDs are unique and never reused. Deactivate instead of deleting. Administrators and management have all access; department users raise deviations and complaints and write reports for their department.</p></div><div class="row"><button class="btn primary" id="nu">New user</button><button class="btn" id="ux">Access review CSV</button></div></div>
    ${sys.mail ? '' : '<div class="banner" role="note">E-mail is not set up on the server (SMTP settings in .env), so notifications and password confirmations are not e-mailed yet.</div>'}
    ${noMail.length ? `<div class="banner" role="note">${noMail.length} active user${noMail.length > 1 ? 's have' : ' has'} no e-mail address and will not receive notifications or password-change confirmations: ${esc(noMail.map(u => u.fullname).join(', '))}. Every user needs an e-mail address.</div>` : ''}
    <div class="table-wrap"><table class="t"><thead><tr><th>User ID</th><th>Name</th><th>E-mail</th><th>Department</th><th>Reports to</th><th>Roles</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
    ${USERS.map(u => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.fullname)}</td><td class="small">${u.email ? esc(u.email) : '<span class="pill warn">Missing</span>'}</td><td>${esc(deptName(u.department))}</td><td>${esc(userName(u.reports_to))}</td><td class="small">${esc(u.roles.map(r => CFG.ROLES[r]).join(', '))}</td><td>${u.locked ? '<span class="pill bad">Locked</span>' : u.active ? '<span class="pill done">Active</span>' : '<span class="pill grey">Inactive</span>'}</td><td class="small">${dmyt(u.last_login)}</td><td><button class="btn" data-edit="${esc(u.username)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`);
  $('#nu').addEventListener('click', async () => {
    const ok = await modal({ title: 'New user', ok: 'Create user', html: `<div class="grid"><div><label class="f">User ID</label><input type="text" name="username"></div><div><label class="f">Full name</label><input type="text" name="fullname"></div>
      <div><label class="f">E-mail <span class="req">*</span></label><input type="email" name="email" placeholder="name@company.com"></div><div><label class="f">Initial password</label><input type="password" name="password" autocomplete="new-password"></div></div>
      ${regFields()}<div><label class="f">Roles</label>${roleChecks()}</div><div><label class="f">Reason / access request reference</label><input type="text" name="reason"></div>`,
      onOk: (f) => api('POST', '/api/users', { username: val(f, 'username'), fullname: val(f, 'fullname'), email: val(f, 'email'), password: f.password.value, reason: val(f, 'reason'), roles: $$('input[name=roles]:checked', f).map(x => x.value), ...regVals(f) }) });
    if (ok) { toast(ok.emailed ? 'User created – the temporary password was e-mailed to them' : 'User created – e-mail is not set up, so give them the temporary password yourself; they must change it at first sign-in'); usersView(); }
  });
  $$('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const u = USERS.find(x => x.username === b.dataset.edit);
    const ok = await modal({ title: 'Edit ' + u.username, ok: 'Save', html: `<div><label class="f">E-mail <span class="req">*</span></label><input type="email" name="email" value="${esc(u.email || '')}" placeholder="name@company.com"></div>${regFields(u)}<div><label class="f">Roles</label>${roleChecks(u.roles)}</div>
      <div class="row"><label><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>${u.locked ? '<label><input type="checkbox" name="unlock"> Unlock account</label>' : ''}</div>
      <div><label class="f">Reset password (optional)</label><input type="password" name="password" autocomplete="new-password"></div><div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/users/' + u.username, { roles: $$('input[name=roles]:checked', f).map(x => x.value), active: f.active.checked, unlock: f.unlock ? f.unlock.checked : false, password: f.password.value || undefined, reason: val(f, 'reason'), email: val(f, 'email'), ...regVals(f) }) });
    if (ok) { toast(ok.emailed ? `User updated – new password e-mailed to ${u.email}` : f_pwNote(ok, u)); usersView(); }
  }));
  $('#ux').addEventListener('click', () => download(`user_access_review_${today()}.csv`, toCsv([['User ID', 'Name', 'Department', 'Reports to', 'Roles', 'Active', 'Locked', 'Last login', 'Created'], ...USERS.map(u => [u.username, u.fullname, u.department, u.reports_to, u.roles.join('; '), u.active ? 'Yes' : 'No', u.locked ? 'Yes' : 'No', u.last_login, u.created_at])])));
}

