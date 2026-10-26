/* Departments. */
'use strict';
// ---------- departments (admin and management create them) ----------
async function departmentsView() {
  const deps = await api('GET', '/api/departments'); CFG.setDepartments(deps); USERS = await api('GET', '/api/users');
  const members = (c) => USERS.filter(u => u.active && u.department === c).length;
  shell('departments', `<div class="spread"><div><h1>Departments</h1><p class="muted">Department codes form CAPA and document numbers and are never reused. Administrators and management create and rename departments; the Head of each department and the hierarchy are kept in the organogram.</p></div>
    <div class="row">${ME.allAccess ? '<button class="btn primary" id="nd">New department</button>' : ''}${ME.canEditOrg ? '<a class="btn" href="#/organogram">Open organogram</a>' : ''}</div></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Part of</th><th>Head of Department</th><th>Head's email</th><th>Members</th><th>Status</th><th></th></tr></thead><tbody>
    ${deps.map(d => `<tr><td class="mono">${esc(d.code)}</td><td>${esc(d.name)}</td><td>${esc(d.parent ? deptName(d.parent) : '')}</td><td>${d.hod ? esc(userName(d.hod)) : '<span class="pill warn">Not set</span>'}</td><td>${(() => { const e = (USERS.find(u => u.username === d.hod) || {}).email; return e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : ''; })()}</td><td>${members(d.code)}</td>
      <td>${d.active ? '<span class="pill done">Active</span>' : '<span class="pill grey">Inactive</span>'}</td><td>${ME.allAccess ? `<button class="btn" data-ed="${esc(d.code)}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`);
  const parentSel = (cur, self) => `<select name="parent"><option value="">– none (top level) –</option>${deps.filter(d => d.code !== self).map(d => `<option value="${esc(d.code)}" ${cur === d.code ? 'selected' : ''}>${esc(deptName(d.code))}</option>`).join('')}</select>`;
  $('#nd')?.addEventListener('click', async () => {
    const ok = await modal({ title: 'New department', ok: 'Create department', html: `<div class="grid"><div><label class="f">Code (2–6 capital letters) <span class="req">*</span></label><input type="text" name="code" maxlength="6" style="text-transform:uppercase"></div>
      <div><label class="f">Name <span class="req">*</span></label><input type="text" name="name"></div><div><label class="f">Part of (parent department)</label>${parentSel('', '')}</div></div>
      <div><label class="f">Reason</label><input type="text" name="reason"></div>`,
      onOk: (f) => api('POST', '/api/departments', { code: val(f, 'code').toUpperCase(), name: val(f, 'name'), parent: val(f, 'parent'), reason: val(f, 'reason') }) });
    if (ok) { toast('Department created'); departmentsView(); }
  });
  $$('[data-ed]').forEach(b => b.addEventListener('click', async () => {
    const d = deps.find(x => x.code === b.dataset.ed);
    const ok = await modal({ title: 'Edit ' + d.code, ok: 'Save', html: `<div class="grid"><div><label class="f">Name</label><input type="text" name="name" value="${esc(d.name)}"></div><div><label class="f">Part of (parent department)</label>${parentSel(d.parent, d.code)}</div></div>
      <label class="row"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Active</label><div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/departments/' + d.code, { name: val(f, 'name'), parent: val(f, 'parent'), active: f.active.checked, reason: val(f, 'reason') }) });
    if (ok) { toast('Department updated'); departmentsView(); }
  }));
}

