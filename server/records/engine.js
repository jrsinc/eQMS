/* Record engine: numbering, field rules, versions, links, visibility. */
'use strict';
const { DEPTS, EMAIL_RE, MODULES, PHONE_RE, supRisk } = require('../../public/modules.js');
const { db, now, sha256, uid } = require('../core/db.js');
const { addDays, addMonths, addWorkingDays, today } = require('../core/util.js');
const { audit } = require('../core/audit.js');
const { fail } = require('../core/http.js');
const { OFF_TYPES, allAccess, hasRole, userLabel } = require('../core/auth.js');
const { userDept } = require('../org/departments.js');

function rowToRecord(r) { return r && { ...r, data: JSON.parse(r.data) }; }
function getRecord(id) { const r = rowToRecord(db.prepare('SELECT * FROM records WHERE id=? AND deleted=0').get(id)); if (!r) fail(404, 'Record not found'); return r; }
const contentHash = (rec) => { const { printLog, deptApprovals, stateEnteredAt, formIssues, ...d } = rec.data; return sha256(JSON.stringify({ id: rec.id, data: d })); };
// Record numbers: module-specific format from modules.js (e.g. JRS-DEVN-2026-001, CAPA/QAS/001/26), default PREFIX-YYYY-NNNN
function nextNumber(type, data, format) {
  const mod = MODULES[type], y = new Date().getFullYear(), fn = format || mod.numbering;
  const { pre, suf = '', pad = 4, fixed } = fn ? fn(data, y) : { pre: mod.prefix + '-' + y + '-' };
  if (fixed) { // one record per period, e.g. SIS-2026, QMR-2026-Q3
    if (db.prepare('SELECT 1 FROM records WHERE number=? AND deleted=0').get(fixed)) fail(409, `${fixed} already exists.`);
    return fixed;
  }
  let max = 0;
  for (const r of db.prepare('SELECT number FROM records WHERE number LIKE ?').all(pre + '%' + suf)) {
    const mid = r.number.slice(pre.length, r.number.length - suf.length);
    if (/^\d+$/.test(mid)) max = Math.max(max, +mid);
  }
  return pre + String(max + 1).padStart(pad, '0') + suf;
}
function applyComputed(mod, data) {
  const c = MODULES[mod].compute || {};
  for (const k of Object.keys(c)) data[k] = c[k](data);
}
function sanitize(mod, input) {
  const out = {};
  for (const f of MODULES[mod].fields) {
    if (!f.k || !(f.k in input) || f.type === 'computed' || f.type === 'readonly') continue;
    let v = input[f.k];
    if (f.type === 'number') v = v === '' || v == null ? '' : Number(v);
    else if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'multicheck') {
      v = Array.isArray(v) ? v.filter(x => f.options.includes(x)) : [];
      if (f.max && v.length > f.max) fail(400, `${f.label}: select at most ${f.max}.`);
    } else if (f.type === 'checklist') {
      const src = v && typeof v === 'object' ? v : {};
      v = Object.fromEntries(f.rows.map(row => { const x = src[row] || {}; return [row, { v: ['Yes', 'No'].includes(x.v) ? x.v : '', r: String(x.r ?? '').slice(0, 2000) }]; }));
    } else if (f.type === 'table') {
      const cols = f.cols.filter(c => !c.computed);
      v = (Array.isArray(v) ? v : []).slice(0, 100)
        .map(row => Object.fromEntries(cols.map(c => [c.k, String((row || {})[c.k] ?? '').trim().slice(0, 2000)])))
        .filter(row => Object.values(row).some(Boolean));
      for (const row of v) for (const c of cols) {
        const x = row[c.k]; if (!x) continue;
        if (c.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(x)) fail(400, `${f.label}: ${c.label} must be a date.`);
        if (c.type === 'score' && !/^[1-5]$/.test(x)) fail(400, `${f.label}: ${c.label} must be a whole number from 1 to 5.`);
        if (c.type === 'number' && !(Number(x) >= 0)) fail(400, `${f.label}: ${c.label} must be a number.`);
        if (c.options && !c.options.includes(x)) fail(400, `${f.label}: invalid ${c.label} "${x}".`);
        if (c.type === 'user' && !db.prepare('SELECT 1 FROM users WHERE username=?').get(x)) fail(400, `${f.label}: ${c.label} must be a user of the system.`);
        if (c.type === 'dept' && !DEPTS[x]) fail(400, `${f.label}: unknown department "${x}".`);
        if (c.ref) { row[c.k] = x.toUpperCase(); if (!byNumber(row[c.k], c.ref)) fail(400, `${f.label}: no ${c.ref.map(t => MODULES[t].name).join(' / ')} record with number ${row[c.k]}.`); }
      }
      if (f.rowCompute) v = v.map(row => ({ ...row, ...f.rowCompute(row) }));
    } else if (f.type === 'recordref') {
      v = v == null ? '' : String(v).trim().toUpperCase();
      if (v && !byNumber(v, f.refTypes)) fail(400, `${f.label}: no ${f.refTypes.map(t => MODULES[t].name.toLowerCase()).join(' / ')} record with number ${v}.`);
    } else v = v == null ? '' : String(v).slice(0, 20000);
    if (f.type === 'select' && v && !f.options.includes(v)) fail(400, `Invalid value for ${f.label}`);
    if (f.type === 'url' && v && !/^https?:\/\/[^\s]+$/i.test(v)) fail(400, `${f.label}: enter a web address starting with http:// or https://.`);
    if (f.type === 'phone' && v && !PHONE_RE.test(v.trim())) fail(400, `${f.label.split(' (')[0]}: enter the country code and the 10-digit number, e.g. +1 6315551234.`);
    if (f.type === 'email' && v && !EMAIL_RE.test(v.trim())) fail(400, `${f.label.split(' (')[0]}: enter a valid e-mail address, e.g. name@company.com.`);
    if ((f.type === 'phone' || f.type === 'email') && v) v = v.trim();
    out[f.k] = v;
  }
  return out;
}
const isEmpty = (f, v) => f && f.type === 'checklist' ? !v || f.rows.some(r => !(v[r] && v[r].v))
  : v === '' || v == null || v === false || (Array.isArray(v) && !v.length);
const fmt = (v) => v && typeof v === 'object' && !(Array.isArray(v) && v.every(x => typeof x !== 'object')) ? JSON.stringify(v)
  : Array.isArray(v) ? v.join('; ') : v === true ? 'Yes' : v === false ? 'No' : v;
const LOCKED = new Set(['Effective', 'Superseded', 'Obsolete', 'Completed', 'Closed', 'Cancelled', 'Approved', 'Released',
  'Rejected', 'QP Certified', 'Released to IRT', 'Withdrawn', 'Retired', 'Disqualified', 'Failed', 'Reconciled', 'Voided', 'Optional Approvals', 'Authorized']);
const EDITABLE_ALWAYS = new Set(['vendors', 'customers', 'risks']);
function sign(user, rec, meaning, from, to) {
  db.prepare('INSERT INTO signatures (record_id,username,fullname,meaning,from_state,to_state,ts,content_hash) VALUES (?,?,?,?,?,?,?,?)')
    .run(rec.id, user.username, user.fullname, meaning, from, to, now(), contentHash(rec));
}
function saveRecord(rec) {
  db.prepare('UPDATE records SET title=?, status=?, data=?, updated_at=? WHERE id=?').run(rec.data.title || '', rec.status, JSON.stringify(rec.data), now(), rec.id);
  snapshot(rec);
}
// ---------- version history: a read-only copy of the record each time its content, status or number changes ----------
let ACTOR = null;
const setActor = (a) => { ACTOR = a; }; // set by the HTTP handler and start-up migrations
 // signed-in user and reason of the request being handled (set by the HTTP handler)
function snapshot(rec, user = ACTOR && ACTOR.user) {
  const data = JSON.stringify(rec.data), last = db.prepare('SELECT no, status, number, data FROM versions WHERE record_id=? ORDER BY no DESC LIMIT 1').get(rec.id);
  if (last && last.status === rec.status && last.number === rec.number && last.data === data) return;
  db.prepare('INSERT INTO versions (record_id,no,ts,username,fullname,status,number,data,reason) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(rec.id, last ? last.no + 1 : 1, now(), user ? user.username : 'system', user ? user.fullname : 'System', rec.status, rec.number, data, (ACTOR && ACTOR.reason) || null);
}
function createdSummary(rec) {
  const parts = [`Status: ${rec.status}`];
  for (const f of MODULES[rec.type].fields) {
    const v = rec.data[f.k]; if (!f.k || f.type === 'computed' || v === '' || v == null || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${f.label.split(' (')[0]}: ${f.type === 'user' || f.fmt === 'user' ? userLabel(v) : f.type === 'table' ? v.length + ' row(s)' : f.type === 'checklist' ? 'completed' : fmt(v)}`);
  }
  return parts.join('; ');
}
function createRecord(user, type, data, ip, reasonText) {
  const mod = MODULES[type];
  for (const f of mod.fields) if (f.k && data[f.k] === undefined && f.def !== undefined) data[f.k] = f.def;
  // modules with a request stage get a temporary request number; the record number is assigned later (see AFTER)
  if (mod.fields.some(f => f.k === 'dateOpened') && !mod.tempNumbering) data.dateOpened = today();
  const rec = { id: uid(), type, number: data.__number || nextNumber(type, data, mod.tempNumbering), status: mod.states[0], data };
  delete data.__number;
  if (mod.tempNumbering) data.requestNo = rec.number;
  data.stateEnteredAt = now();
  if (DERIVE[type]) DERIVE[type](rec);
  applyComputed(type, data);
  db.prepare('INSERT INTO records (id,type,number,title,status,data,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(rec.id, type, rec.number, data.title || '', rec.status, JSON.stringify(data), user.username, now(), now());
  rec.created_by = user.username;
  snapshot(rec, user);
  // one entry with every value entered (instead of one "Field set" entry per field)
  audit(user, 'Record created', rec, null, null, createdSummary(rec), reasonText, ip);
  linkRefs(user, rec, ip);
  return rec;
}

// ---------- linked records (investigation ↔ CAPA ↔ change control ↔ extension …) ----------
function byNumber(number, types) {
  const r = rowToRecord(db.prepare('SELECT * FROM records WHERE number=? AND deleted=0 ORDER BY created_at DESC LIMIT 1').get(String(number || '').trim().toUpperCase()));
  return r && (!types || types.includes(r.type)) ? r : null;
}
function link(user, r1, r2, ip) {
  if (!r1 || !r2 || r1.id === r2.id) return;
  const [a, b] = [r1.id, r2.id].sort();
  if (db.prepare('SELECT 1 FROM links WHERE a=? AND b=?').get(a, b)) return;
  db.prepare('INSERT INTO links (a,b,created_by,ts) VALUES (?,?,?,?)').run(a, b, user.username, now());
  audit(user, 'Record linked', r1, 'link', null, r2.number, null, ip);
  audit(user, 'Record linked', r2, 'link', null, r1.number, null, ip);
}
function linked(id) {
  return db.prepare('SELECT r.* FROM links l JOIN records r ON r.id = CASE WHEN l.a=? THEN l.b ELSE l.a END WHERE (l.a=? OR l.b=?) AND r.deleted=0 ORDER BY r.created_at')
    .all(id, id, id).map(rowToRecord);
}
function linkRefs(user, rec, ip) {
  for (const f of MODULES[rec.type].fields) {
    if (f.type === 'recordref' && rec.data[f.k]) link(user, rec, byNumber(rec.data[f.k], f.refTypes), ip);
    if (f.type === 'table') for (const c of f.cols.filter(c => c.ref)) for (const row of rec.data[f.k] || []) if (row[c.k]) link(user, rec, byNumber(row[c.k], c.ref), ip);
  }
}
// Form sections: who may change a section's fields at which stage (section opts.edit in modules.js)
function sectionOf(mod, k) { let s = null; for (const f of mod.fields) { if (f.type === 'section') s = f; else if (f.k === k) return s; } return null; }
// pseudo-roles: initiator, responsible (person), respdept (member of the responsible department), depthead (Head approving the record)
const canEditSection = (s, rec, user) => !s || !s.edit || (s.edit[rec.status] || []).some(r =>
  r === 'initiator' ? rec.created_by === user.username : r === 'responsible' ? rec.data.respPerson === user.username
    : r === 'respdept' ? !!user.department && user.department === rec.data.respDept : r === 'depthead' ? rec.data.hodApprover === user.username
    : hasRole(user, [r])) || (allAccess(user) && (s.edit[rec.status] || []).length > 0);
const hiddenFor = (user, type) => {
  const m = MODULES[type]; if (!m) return false;
  if (OFF_TYPES.has(type)) return true;
  if (allAccess(user)) return false;
  if (m.visibleTo && !user.roles.some(r => m.visibleTo.includes(r))) return true;
  return !!m.hideFrom && user.roles.every(r => m.hideFrom.includes(r));
};
const HIDEABLE = Object.keys(MODULES).filter(k => MODULES[k].hideFrom || MODULES[k].visibleTo || OFF_TYPES.has(k));
// The audit trail, record history and version history are visible to QA, administrators and management only
const canSeeAudit = (user) => user.roles.includes('qa') || allAccess(user);
const needAudit = (user) => { if (!canSeeAudit(user)) fail(403, 'The audit trail and version history are visible to QA, administrators and management only.'); };
// Department-scoped modules (modules.js "deptScoped"): only the initiator, the responsible person, members of the responsible
// department, the Heads above it and the approving Head see the record – plus QA, admin, management and read-only inspectors.
// Project managers see events that go to the customer.
function canSee(user, rec) {
  if (!MODULES[rec.type] || hiddenFor(user, rec.type)) return false;
  if (MODULES[rec.type].ownOnly) return rec.created_by === user.username || user.roles.includes('admin') || allAccess(user); // help desk: own tickets
  if (!MODULES[rec.type].deptScoped || allAccess(user) || user.roles.includes('qa') || user.roles.includes('extaud')) return true;
  const d = rec.data, me = user.username;
  if (rec.created_by === me || d.respPerson === me || d.hodApprover === me) return true;
  if (d.respDept && (user.department === d.respDept || (user.deptsUnder || []).includes(d.respDept))) return true;
  return user.roles.includes('pm') && (rec.status === 'Customer Approval' || (rec.status === 'Closed' && d.customerApproval && !String(d.customerApproval).startsWith('Not applicable')));
}
function visibleRecord(user, rec) { if (!canSee(user, rec)) fail(404, 'Record not found'); return rec; }

// ---------- SOP business rules ----------
// Derived values recalculated whenever a record is created, edited or moves state.
const DERIVE = {
  // JRS/SOP/QAS/022: investigation complete within 30 calendar days of opening; Critical events within 10 working days
  // suppliers: requalification date suggested from the effective date and the risk level frequency
  vendors: (r) => { const d = r.data; if (d.effectiveDate && !d.requalDate && supRisk(d).months) d.requalDate = addMonths(d.effectiveDate, supRisk(d).months); },
  changes: (r) => {
    const d = r.data; d.respDept = d.respPerson ? userDept(d.respPerson) : '';
    if (!d.assignedTo && d.respPerson) d.assignedTo = d.respPerson; // change owner: the responsible person unless named
    if (d.dueDate && !d.originalDue) d.originalDue = d.dueDate;      // the first target date is kept
    // change level from impact and complexity: L0 minor / low; L2 critical, or major / high; otherwise L1
    d.changeLevel = !d.classification || !d.complexity ? '' : d.classification === 'Critical' || (d.classification === 'Major' && d.complexity === 'High') ? 'L2'
      : d.classification === 'Minor' && d.complexity === 'Low' ? 'L0' : 'L1';
    // all change control activities complete: every plan activity closed and every action item of this change closed or cancelled
    const items = r.number ? db.prepare("SELECT status FROM records WHERE type='actionitems' AND deleted=0 AND json_extract(data, '$.parentRef')=?").all(r.number) : [];
    d.allActivitiesComplete = (d.plan || []).length || items.length ? ((d.plan || []).every(p => p.closed) && items.every(i => ['Closed', 'Cancelled'].includes(i.status)) ? 'Yes' : 'No') : '';
  },
  actionitems: (r) => { r.data.respDept = r.data.respPerson ? userDept(r.data.respPerson) : ''; },
  investigations: (r) => { const d = r.data; d.respDept = d.respPerson ? userDept(d.respPerson) : ''; d.dueDate = !d.criticality ? '' : d.criticality === 'Critical' ? addWorkingDays(d.dateOpened, 10) : addDays(d.dateOpened, 30); },
  // JRS/SOP/QAS/021: titles in capitals, "[GLB]" when the document applies to more than one site
  documents: (r) => { const d = r.data, base = String(d.title || '').replace(/^\[GLB\]\s*/i, '').toUpperCase(); d.title = ((d.sites || []).length > 1 ? '[GLB] ' : '') + base; }
};

module.exports = { setActor, rowToRecord, getRecord, contentHash, nextNumber, applyComputed, sanitize, isEmpty, fmt, LOCKED, EDITABLE_ALWAYS, sign, saveRecord, ACTOR, snapshot, createdSummary, createRecord, byNumber, link, linked, linkRefs, sectionOf, canEditSection, hiddenFor, HIDEABLE, canSeeAudit, needAudit, canSee, visibleRecord, DERIVE };
