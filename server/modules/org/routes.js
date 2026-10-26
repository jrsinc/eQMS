/* Departments and organogram API. */
'use strict';
const { db, now } = require('../../core/db.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { allAccess, canEditOrg } = require('../../core/auth.js');
const { activeUser, deptChain, deptMap, deptRows, loadDepartments } = require('../../org/departments.js');

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

module.exports = { DEPT_CODE, checkParent, setOrg };
