/* Departments and organogram; demo data. */
'use strict';
const { DERIVED_ROLES, setDepartments } = require('../../public/modules.js');
const { CFG } = require('../core/config.js');
const { db, now } = require('../core/db.js');
const { hashPw } = require('../core/passwords.js');
const { audit } = require('../core/audit.js');

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
const loadDepartments = () => setDepartments(deptRows());
 // the shared select options (modules.js) follow the department list
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

module.exports = { deptRows, deptMap, loadDepartments, deptChain, activeUser, hodFor, deptsHeaded, userDept, seedDemo, seedOrganogram };
