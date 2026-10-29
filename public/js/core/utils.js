/* Utilities: escaping, dates, roles, status pills, due dates. */
'use strict';
const CFG = window.QMS_CONFIG, MODS = CFG.MODULES;
let ME = null, USERS = [], HEALTH = {}, ALL = [], idleTimer = null, idleLeft = 0, QS = new URLSearchParams();

// ---------- utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const addWorkingDaysIso = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); while (n > 0) { x.setUTCDate(x.getUTCDate() + 1); if (x.getUTCDay() % 6) n--; } return x.toISOString().slice(0, 10); };
const addDaysIso = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dmy(v) { if (!v) return ''; const d = new Date(v.length === 10 ? v + 'T00:00:00' : v); if (isNaN(d)) return esc(v); return `${String(d.getDate()).padStart(2, '0')}-${MON[d.getMonth()]}-${d.getFullYear()}`; }
function dmyt(v) { if (!v) return ''; const d = new Date(v); return `${dmy(v)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const userName = (u) => (USERS.find(x => x.username === u) || {}).fullname || u || '';
// admin and management have all access (the server applies the same rule)
const hasRole = (roles) => ME && (roles.includes('any') || ME.roles.some(r => roles.includes(r)) || (ME.allAccess && !roles.every(r => ['unblinded', 'extaud'].includes(r))));
const deptName = (c) => CFG.DEPTS[c] || c || '';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
function download(name, content, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const csvCell = (v) => { const s = Array.isArray(v) ? v.join('; ') : String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\n');

const DONE = new Set(['Effective', 'Superseded', 'Obsolete', 'Completed', 'Closed', 'Cancelled', 'Approved', 'Released', 'Rejected', 'QP Certified', 'Released to IRT', 'Withdrawn', 'Retired', 'Disqualified', 'Qualified', 'Blocked', 'Authorized', 'Certified', 'Archived', 'Destroyed']);
const GOOD = new Set(['Effective', 'Completed', 'Closed', 'Approved', 'Released', 'QP Certified', 'Qualified', 'Released to IRT', 'Authorized', 'Certified', 'Archived']);
const BAD = new Set(['Rejected', 'Failed', 'Blocked', 'Disqualified', 'Suspended']);
const GREY = new Set(['Superseded', 'Obsolete', 'Cancelled', 'Withdrawn', 'Retired', 'Draft']);
const pill = (s) => `<span class="pill ${GOOD.has(s) ? 'done' : BAD.has(s) ? 'bad' : GREY.has(s) ? 'grey' : ''}">${esc(s)}</span>`;
const EC_STATES = new Set(['Effectiveness Check', 'Closed – EC Pending']);
// The date a record is due by in its current status (approved extensions replace the original due date)
function dueOf(r) {
  const d = r.data;
  if (EC_STATES.has(r.status)) return d.ecDueDate;
  if (r.type === 'investigations' && r.status === 'Customer Approval') return '';
  if (['investigations', 'capa', 'changes'].includes(r.type)) return d.extendedDue || d.dueDate;
  if (r.type === 'selfinspections') return ['Planned', 'Notified'].includes(r.status) ? d.plannedDate : r.status === 'Report Issued' ? d.extendedDue || d.dueDate : '';
  if (r.type === 'extaudits') return ['Report Received', 'Response Prepared'].includes(r.status) ? d.responseDue : '';
  if (r.type === 'documents') return r.status === 'Approved – Training' ? d.effectiveDate : r.status === 'Effective' ? d.nextReview : '';
  if (r.type === 'archives' && r.status === 'Retrieved') { const x = (d.retrievals || []).slice(-1)[0]; return x && x.date ? addWorkingDaysIso(x.date, 7) : ''; }
  if (r.type === 'customers') return r.status === 'Qualified' ? d.reviewDate : '';
  if (r.type === 'vendors') return r.status === 'Approved' ? d.requalDate : r.status === 'Under Quality Review' && d.auditReportDate && !d.complianceReceived ? addDaysIso(d.auditReportDate, 30) : '';
  if (r.type === 'actionitems') return r.status === 'Open' ? d.dueDate : '';
  return { training: d.dueDate, comparators: d.neededBy, risks: d.reviewDate }[r.type];
}
const isOverdue = (r) => { const v = dueOf(r); return !!v && !DONE.has(r.status) && v < today(); };
const dataFields = (m) => m.fields.filter(f => f.k);
const singular = (m) => m.single || m.name.toLowerCase().replace(/s$/, '');
// The audit trail, record history and version history are for QA, administrators and management only (the server enforces it too)
const auditAccess = () => !!ME && (ME.roles.includes('qa') || ME.allAccess);
const isOff = (k) => !!ME && (ME.modulesOff || []).includes(k); // switched-off module groups: hidden from everyone
const canSeeModule = (m) => !isOff(Object.keys(MODS).find(k => MODS[k] === m)) && (ME.allAccess || !(m.visibleTo && !ME.roles.some(r => m.visibleTo.includes(r))) && !(m.hideFrom && ME.roles.every(r => m.hideFrom.includes(r))));
const NO_AUDIT_ACCESS = '<div class="panel"><h2>Audit trail</h2><p>The audit trail and version history are visible to QA, administrators and management only.</p></div>';
// Readable audit entries: field labels instead of internal keys, names instead of user IDs, dates as DD-MMM-YYYY
function fieldLabel(type, key) {
  if (!key) return '';
  if (key === 'status') return 'Status';
  if (key === 'stateEnteredAt') return 'Stage entered at (system)';
  const f = MODS[type] && MODS[type].fields.find(x => x.k === key);
  return f ? f.label : key;
}
function auditValue(type, key, v) {
  if (v == null || v === '') return '';
  if (key === 'stateEnteredAt' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dmyt(v);
  const f = MODS[type] && MODS[type].fields.find(x => x.k === key);
  if (!f) return v;
  if (f.type === 'user' || f.fmt === 'user') return userName(v);
  if ((f.type === 'date' || f.fmt === 'date') && /^\d{4}-\d{2}-\d{2}/.test(v)) return dmy(v);
  if (f.type === 'checklist' || f.type === 'table') { try { return plain(f, JSON.parse(v)); } catch { return v; } }
  if (f.optionLabels && f.optionLabels[v]) return f.optionLabels[v];
  return v;
}
const recordLabel = (a) => a.record_type && MODS[a.record_type] ? MODS[a.record_type].name : a.record_id ? '' : 'System';
// Fields on the new-record form: only the request section(s) when the module has them, otherwise all fields
function createFields(m) {
  if (!m.fields.some(f => f.type === 'section' && f.create)) return m.fields;
  let on = false; return m.fields.filter(f => { if (f.type === 'section') on = !!f.create; return on; });
}
// Plain-text value for print and CSV
function plain(f, v) {
  if (f.type === 'checklist') return f.rows.map(row => { const x = (v || {})[row] || {}; return `${row}: ${x.v || '–'}${x.r ? ' (' + x.r + ')' : ''}`; }).join('\n');
  if (f.type === 'table') return (v || []).map(row => f.cols.map(c => `${c.label}: ${row[c.k] || '–'}`).join(' | ')).join('\n');
  return Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : v ?? '';
}

