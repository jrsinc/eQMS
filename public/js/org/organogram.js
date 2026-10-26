/* Organogram. */
'use strict';
// ---------- organogram (management, the Head of QA and administrators) ----------
// Each department shows its Head and members by reporting line. Approvals follow it: the Head of the responsible
// department approves; without a Head (or when the Head is the person approved) the Head of the parent department does.
async function organogramView() {
  if (!ME.canEditOrg) return dashboard();
  const og = await api('GET', '/api/organogram'); CFG.setDepartments(og.departments);
  const deps = og.departments, users = og.users.filter(u => u.active), byCode = Object.fromEntries(deps.map(d => [d.code, d]));
  const kids = (code) => code ? deps.filter(d => d.parent === code) : deps.filter(d => !d.parent || !byCode[d.parent]);
  const person = (u, all) => { const reports = all.filter(x => x.reports_to === u.username);
    return `<li><button class="link" data-person="${esc(u.username)}">${esc(u.fullname)}</button> <span class="small muted">${esc(u.designation || u.roles.map(r => CFG.ROLES[r]).filter(Boolean)[0] || '')}</span>${reports.length ? `<ul>${reports.map(x => person(x, all)).join('')}</ul>` : ''}</li>`; };
  const node = (d) => {
    const mem = users.filter(u => u.department === d.code), top = mem.filter(u => !mem.some(x => x.username === u.reports_to));
    const head = d.hod ? users.find(u => u.username === d.hod) : null;
    return `<li><div class="org-node ${d.active ? '' : 'inactive'}"><div class="spread"><b>${esc(d.name)}</b> <span class="mono small">${esc(d.code)}</span></div>
      <div class="small">Head: ${head ? esc(head.fullname) : '<span class="pill warn">Not set – the Head of the parent department approves</span>'}</div>
      <button class="btn small-btn" data-dept="${esc(d.code)}">Set Head / position</button>
      ${mem.length ? `<ul class="org-people">${top.map(u => person(u, mem)).join('')}</ul>` : '<p class="small muted">No members yet.</p>'}</div>
      ${kids(d.code).length ? `<ul>${kids(d.code).map(node).join('')}</ul>` : ''}</li>`;
  };
  const noDept = users.filter(u => !u.department || !byCode[u.department]);
  shell('organogram', `<div class="spread"><div><h1>Organogram</h1><p class="muted">Departments, their Heads and reporting lines. Approvals follow this hierarchy: the Head of the responsible department approves; if a department has no Head, or the Head is the person whose work is approved, the Head of the department above approves (then the line manager). Every change is recorded in the audit trail.</p></div>
    <a class="btn" href="#/departments">Departments list</a></div>
    <div class="panel"><ul class="org-tree">${kids('').map(node).join('')}</ul></div>
    ${noDept.length ? `<div class="panel"><h3>Not assigned to a department</h3><ul class="org-people">${noDept.map(u => `<li><button class="link" data-person="${esc(u.username)}">${esc(u.fullname)}</button> <span class="small muted">${esc(u.roles.map(r => CFG.ROLES[r]).join(', '))}</span></li>`).join('')}</ul></div>` : ''}`);
  const userSel = (name, cur, skip) => `<select name="${name}"><option value="">– none –</option>${users.filter(u => u.username !== skip).map(u => `<option value="${esc(u.username)}" ${cur === u.username ? 'selected' : ''}>${esc(u.fullname)}${u.department ? ' – ' + esc(u.department) : ''}</option>`).join('')}</select>`;
  $$('[data-dept]').forEach(b => b.addEventListener('click', async () => {
    const d = byCode[b.dataset.dept];
    const ok = await modal({ title: d.name, ok: 'Save', html: `<div class="grid"><div><label class="f">Head of Department</label>${userSel('hod', d.hod)}</div>
      <div><label class="f">Part of (parent department)</label><select name="parent"><option value="">– none (top level) –</option>${deps.filter(x => x.code !== d.code).map(x => `<option value="${esc(x.code)}" ${d.parent === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>
      <div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/departments/' + d.code, { hod: val(f, 'hod'), parent: val(f, 'parent'), reason: val(f, 'reason') }) });
    if (ok) { toast('Organogram updated'); organogramView(); }
  }));
  $$('[data-person]').forEach(b => b.addEventListener('click', async () => {
    const u = og.users.find(x => x.username === b.dataset.person);
    const ok = await modal({ title: u.fullname, ok: 'Save', html: `<div class="grid"><div><label class="f">Department</label><select name="department"><option value=""></option>${deps.map(x => `<option value="${esc(x.code)}" ${u.department === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div><label class="f">Reports to</label>${userSel('reportsTo', u.reports_to, u.username)}</div></div><div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/organogram/users/' + u.username, { department: val(f, 'department'), reportsTo: val(f, 'reportsTo'), reason: val(f, 'reason') }) });
    if (ok) { toast('Organogram updated'); USERS = await api('GET', '/api/users'); organogramView(); }
  }));
}

