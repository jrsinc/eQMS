/* Records API: create, edit, workflow, attachments. */
'use strict';
const crypto = require('node:crypto');
const { DEPTS, MODULES } = require('../../../public/modules.js');
const { db, now, uid } = require('../../core/db.js');
const { addDays, addMonths, today } = require('../../core/util.js');
const { audit, verifyAudit } = require('../../core/audit.js');
const { fail, failMissing, route } = require('../../core/http.js');
const { allAccess, hasRole, userLabel, verifySignature } = require('../../core/auth.js');
const { hodFor } = require('../../org/departments.js');
const { DERIVE, EDITABLE_ALWAYS, LOCKED, applyComputed, byNumber, canEditSection, canSee, canSeeAudit, contentHash, createRecord, fmt, getRecord, hiddenFor, isEmpty, link, linkRefs, linked, needAudit, rowToRecord, sanitize, saveRecord, sectionOf, sign, visibleRecord } = require('../../records/engine.js');
const { CC_APPROVED, CHECKS, erCheck, onTransition } = require('../../records/rules.js');
const { notifyStatus } = require('../notifications/notify.js');
// defined in modules loaded later: resolved when called
const effectiveDoc = (...a) => require('../documents/issuance.js').effectiveDoc(...a);

route('GET', '/api/records', (ctx) => {
  const type = ctx.query.get('type');
  const rows = type ? db.prepare('SELECT * FROM records WHERE type=? AND deleted=0 ORDER BY created_at DESC').all(type)
    : db.prepare('SELECT * FROM records WHERE deleted=0 ORDER BY updated_at DESC LIMIT 2000').all();
  return rows.map(rowToRecord).filter(r => MODULES[r.type] && canSee(ctx.user, r)); // records of retired modules stay in the database
});
route('GET', '/api/records/:id', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), h = contentHash(rec);
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=? ORDER BY id').all(rec.id).map(s => ({ ...s, current: s.content_hash === h }));
  const atts = db.prepare('SELECT id,name,mime,size,sha256,uploaded_by,ts,stage,category FROM attachments WHERE record_id=? ORDER BY ts').all(rec.id);
  const auditAccess = canSeeAudit(ctx.user);
  const trail = auditAccess ? db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id DESC').all(rec.id) : [];
  const rl = rec.type === 'randomization' ? db.prepare('SELECT generated_by, ts FROM rand_lists WHERE record_id=?').get(rec.id) : null;
  const mod = MODULES[rec.type];
  const editable = EDITABLE_ALWAYS.has(rec.type) || !LOCKED.has(rec.status);
  const transitions = mod.transitions.filter(t => t.from === rec.status).map(t => ({ ...t, allowed: hasRole(ctx.user, t.roles) }));
  const links = linked(rec.id).filter(r => canSee(ctx.user, r)).map(r => ({ id: r.id, number: r.number, type: r.type, title: r.data.title || '', status: r.status }));
  const versionCount = auditAccess ? db.prepare('SELECT COUNT(*) AS n FROM versions WHERE record_id=?').get(rec.id).n : 0;
  return { record: rec, signatures: sigs, attachments: atts, audit: trail, auditAccess, versionCount, transitions, editable, randList: rl, links };
});
// Version history of one record (QA and admin): every saved version, and one version's full content
route('GET', '/api/records/:id/versions', (ctx) => {
  needAudit(ctx.user);
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  const versions = db.prepare('SELECT no, ts, username, fullname, status, number, reason FROM versions WHERE record_id=? ORDER BY no DESC').all(rec.id);
  // controlled documents also have issued versions (1.0, 2.0 …) as separate records under the same number
  const docVersions = rec.type === 'documents' ? db.prepare("SELECT * FROM records WHERE type='documents' AND number=? AND deleted=0 ORDER BY created_at DESC").all(rec.number).map(rowToRecord)
    .map(r => ({ id: r.id, version: r.data.version, status: r.status, revisionType: r.data.revisionType, changeControl: r.data.changeControl, summary: r.data.revisionSummary,
      approvedOn: r.data.approvedOn, effectiveDate: r.data.effectiveDate, supersededOn: r.data.supersededOn, author: r.created_by })) : [];
  audit(ctx.user, 'Version history viewed', rec, null, null, null, null, ctx.ip);
  return { versions, docVersions };
});
route('GET', '/api/records/:id/versions/:no', (ctx) => {
  needAudit(ctx.user);
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  const v = db.prepare('SELECT * FROM versions WHERE record_id=? AND no=?').get(rec.id, +ctx.params.no); if (!v) fail(404, 'Version not found');
  return { ...v, data: JSON.parse(v.data) };
});
route('POST', '/api/records', (ctx) => {
  const { type, data, linkFrom } = ctx.body;
  const src = linkFrom ? getRecord(linkFrom) : null;
  if (!MODULES[type]) fail(400, 'Unknown module');
  if (hiddenFor(ctx.user, type)) fail(403, 'Your roles do not give access to this module.');
  if (type === 'randomization' && !hasRole(ctx.user, ['unblinded'])) fail(403, 'Only unblinded randomization officers can create randomization lists.');
  if (type === 'extensions' && !linkFrom) fail(400, 'Request an extension with the "Request extension" button beside the due date on the record.');
  const clean = sanitize(type, data || {});
  // modules with a request section: only its fields are entered (and required) when the record is created
  const mod = MODULES[type], hasCreate = mod.fields.some(f => f.type === 'section' && f.create);
  const onCreateForm = (k) => !hasCreate || !!(sectionOf(mod, k) || {}).create;
  for (const k of Object.keys(clean)) if (!onCreateForm(k)) delete clean[k];
  const missing = mod.fields.filter(f => f.req && onCreateForm(f.k) && (clean[f.k] === '' || clean[f.k] == null) && f.def === undefined);
  if (missing.length) failMissing(missing, 'Required fields are empty');
  if (type === 'investigations') clean.qaNotified = today();
  if (type === 'documents') { clean.version = '1.0'; clean.revisionType = 'New document'; }
  if (type === 'training') {
    clean.attempt = '1';
    const doc = clean.docRef ? byNumber(clean.docRef, ['documents']) : null;
    if (doc) clean.docVersion = doc.data.version;
  }
  if (type === 'issues') {
    const doc = effectiveDoc(clean.docNumber);
    clean.title = doc.data.title; clean.docVersion = doc.data.version;
    if (!(+clean.copies >= 1 && +clean.copies <= 100)) fail(400, 'Copies must be between 1 and 100.');
  }
  if (type === 'customers' || type === 'vendors') clean.requesterDept = ctx.user.department || '';
  if (type === 'vendors') clean.cycleStartedAt = now();
  if (type === 'extensions') {
    const { target, due } = erCheck(clean);
    if (src && src.id !== target.id) fail(400, 'The extension must be requested from the record it extends.');
    visibleRecord(ctx.user, target);
    clean.title = 'Extension of ' + target.number;
    clean.recordType = target.type === 'investigations' ? target.data.invType : target.type === 'selfinspections' ? 'Self-inspection response' : MODULES[target.type].name;
    clean.originalDue = due;
    // the Head of the department responsible for the record approves first (organogram); never the requester
    clean.requesterDept = ctx.user.department || '';
    const dept = target.data.respDept || target.data.auditeeDept;
    clean.hodApprover = dept ? hodFor(dept, ctx.user.username) : '';
    if (!clean.hodApprover) fail(400, `No Head of Department in the organogram can approve an extension for ${target.number}${dept ? ' (' + (DEPTS[dept] || dept) + ')' : ''}. Ask management or the Head of QA to set one.`);
  }
  if (type === 'auditors') {
    if (db.prepare("SELECT * FROM records WHERE type='auditors' AND status<>'Withdrawn' AND deleted=0").all().map(rowToRecord).some(r => r.data.auditor === clean.auditor))
      fail(409, `${userLabel(clean.auditor)} is already on the auditor list. Update the existing record instead.`);
    clean.title = userLabel(clean.auditor);
  }
  if (type === 'sischedule') {
    if (!(clean.year >= 2000 && clean.year <= 2100)) fail(400, 'Enter a valid year.');
    clean.title = 'Self-inspection schedule ' + clean.year;
  }
  if (type === 'mgmtreviews') {
    if (!(clean.year >= 2000 && clean.year <= 2100)) fail(400, 'Enter a valid year.');
    clean.title = `Quality management review ${clean.quarter}/${clean.year}`;
    // JRS/SOP/QAS/019: each review carries forward and updates the actions of the previous QMR
    const key = (d) => d.year * 10 + +String(d.quarter).slice(1);
    const prev = db.prepare("SELECT * FROM records WHERE type='mgmtreviews' AND status='Authorized' AND deleted=0").all().map(rowToRecord)
      .filter(r => key(r.data) < key(clean)).sort((a, b) => key(b.data) - key(a.data))[0];
    if (prev) clean.prevActions = [
      ...(prev.data.prevActions || []).filter(a => a.status !== 'Closed'),
      ...(prev.data.actions || []).map(a => ({ from: prev.number, recommendation: a.recommendation, responsibility: a.responsibility, target: a.target, update: '', status: 'Open' }))
    ].map(a => ({ ...a, update: '' }));
  }
  const rec = createRecord(ctx.user, type, clean, ctx.ip);
  notifyStatus(ctx.user, rec, '', rec.status);
  if (src) link(ctx.user, src, rec, ctx.ip);
  for (const a of (Array.isArray(ctx.body.attachments) ? ctx.body.attachments : []).slice(0, 20)) addAttachment(ctx, rec, a);
  return rec;
});
// The form sends every field. An empty value – '', null, [] (no boxes ticked), false (unticked), an empty table or an
// unanswered checklist – is the same as a field never filled in, so it is not a change (and needs no edit right)
const emptyValue = (v) => v == null || v === '' || v === false || (Array.isArray(v) ? v.every(emptyValue) : typeof v === 'object' && Object.values(v).every(emptyValue));
const sameValue = (a, b) => (emptyValue(a) && emptyValue(b)) || JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
route('PUT', '/api/records/:id', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), mod = MODULES[rec.type];
  if (!EDITABLE_ALWAYS.has(rec.type) && LOCKED.has(rec.status)) fail(409, `Record is ${rec.status} and cannot be edited. Raise a change or revision.`);
  if (rec.type === 'randomization' && !hasRole(ctx.user, ['unblinded'])) fail(403, 'Unblinded role required.');
  const reason = String(ctx.body.reason || '').trim(); if (!reason) fail(400, 'Reason for change is required.');
  const clean = sanitize(rec.type, ctx.body.data || {});
  if (rec.type === 'issues' && rec.status !== 'Requested') { delete clean.docNumber; delete clean.copies; delete clean.issuedTo; }
  for (const f of mod.fields) if (f.lock && f.k in clean && !sameValue(clean[f.k], rec.data[f.k])) fail(400, `${f.label} cannot be changed after the record is created.`);
  for (const [k, v] of Object.entries(clean)) {
    if (sameValue(rec.data[k], v)) continue;
    const s = sectionOf(mod, k);
    if (!canEditSection(s, rec, ctx.user)) fail(403, `"${s.label}" cannot be changed by you at stage "${rec.status}".`);
  }
  let changes = 0;
  for (const [k, v] of Object.entries(clean)) {
    const old = rec.data[k];
    if (!sameValue(old, v)) { rec.data[k] = v; audit(ctx.user, 'Field changed', rec, k, fmt(old), fmt(v), reason, ctx.ip); changes++; }
  }
  if (changes) {
    if (DERIVE[rec.type]) { const before = JSON.stringify(rec.data); DERIVE[rec.type](rec); if (JSON.stringify(rec.data) !== before) audit(ctx.user, 'Derived values recalculated', rec, null, null, rec.type === 'investigations' ? 'Due date ' + rec.data.dueDate : 'Title ' + rec.data.title, reason, ctx.ip); }
    applyComputed(rec.type, rec.data); saveRecord(rec); linkRefs(ctx.user, rec, ctx.ip);
  }
  return { changes };
});
route('POST', '/api/records/:id/links', (ctx) => {
  const rec = getRecord(ctx.params.id), other = byNumber(ctx.body.number);
  if (!other) fail(404, `No record with number ${ctx.body.number || ''}.`);
  if (other.id === rec.id) fail(400, 'A record cannot be linked to itself.');
  link(ctx.user, rec, other, ctx.ip);
  return { ok: true };
});
// Departmental approvals (modules.js "deptApproval"): change control optional approvals 1–4 (JRS/SOP/QAS/007 Part C),
// cross-functional review of documents (JRS/SOP/QAS/021)
route('POST', '/api/records/:id/dept-approve', (ctx) => {
  const rec = getRecord(ctx.params.id), cfg = MODULES[rec.type].deptApproval;
  if (!cfg || rec.status !== cfg.state) fail(409, cfg ? `${cfg.label} are recorded at stage "${cfg.state}".` : 'This record has no departmental approvals.');
  const dept = String(ctx.body.dept || ''), list = rec.data.deptApprovals || [];
  if (!allAccess(ctx.user) && !ctx.user.deptsUnder.includes(dept)) fail(403, `Only the Head of ${DEPTS[dept] || dept} (organogram) can give this approval.`);
  if (!(rec.data[cfg.field] || []).includes(dept)) fail(400, `${dept || 'This department'} is not named for ${cfg.label.toLowerCase()} on ${rec.number}.`);
  if (list.some(a => a.dept === dept)) fail(409, `${dept} has already approved ${rec.number}.`);
  verifySignature(ctx.user, ctx.body);
  const comment = String(ctx.body.comment || '').slice(0, 2000);
  list.push({ dept, by: ctx.user.username, name: ctx.user.fullname, ts: now(), comment });
  rec.data.deptApprovals = list; saveRecord(rec);
  const meaning = rec.type === 'changes' ? `Approved – optional approval (${dept})` : `Reviewed – cross-functional (${dept})`;
  audit(ctx.user, `${cfg.label} (e-signed: ${meaning})`, rec, 'deptApprovals', null, dept + (comment ? ': ' + comment : ''), null, ctx.ip);
  sign(ctx.user, rec, meaning, rec.status, rec.status);
  return { ok: true };
});
// JRS/SOP/QAS/019 §5 / FRM/QAS/035: compile the data for every agenda topic and the KPIs (§5.17) from the eQMS
function qmrMetrics(year, quarter) {
  const q = +String(quarter).slice(1), qs = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, qe = addDays(addMonths(qs, 3), -1);
  const ys = `${year}-01-01`, ps = addMonths(qs, -3), pe = addDays(qs, -1);
  const all = db.prepare('SELECT * FROM records WHERE deleted=0').all().map(rowToRecord);
  const opened = (r) => (r.data.dateOpened || r.created_at).slice(0, 10);
  const inQ = (r) => opened(r) >= qs && opened(r) <= qe, inY = (r) => opened(r) >= ys && opened(r) <= qe, inP = (r) => opened(r) >= ps && opened(r) <= pe;
  const isOpen = (r) => !LOCKED.has(r.status) && !r.status.startsWith('Closed');
  const due = (r) => r.status === 'Effectiveness Check' || r.status === 'Closed – EC Pending' ? r.data.ecDueDate : r.data.extendedDue || r.data.dueDate;
  const overdue = (r) => isOpen(r) && due(r) && due(r) < today();
  const of = (type, f = () => true) => all.filter(r => r.type === type && f(r));
  const row = (label, list, extra) => [label, list.filter(inQ).length, list.filter(inY).length, extra ?? ''];
  const trend = (list) => { const a = list.filter(inQ).length, b = list.filter(inP).length; return a > b ? `Up from ${b} last quarter` : a < b ? `Down from ${b} last quarter` : `Same as last quarter (${b})`; };
  const dev = of('investigations', r => r.data.invType === 'Deviation'), cmp = of('investigations', r => r.data.invType === 'Complaint');
  const eventRows = (list) => [row('Total', list, trend(list)), ...['Critical', 'Major', 'Minor'].map(c => row(c, list.filter(r => r.data.criticality === c))),
    row('Still open', list.filter(isOpen)), row('Overdue', list.filter(overdue)), row('With CAPA required', list.filter(r => r.data.capaRequired === 'Yes'))];
  const capa = of('capa'), cc = of('changes'), trn = of('training').filter(r => r.status !== 'Cancelled' && r.data.dueDate >= ys && r.data.dueDate <= qe);
  const trnQ = trn.filter(r => r.data.dueDate >= qs), pct = (l) => l.length ? Math.round(100 * l.filter(r => r.status === 'Completed').length / l.length) + '%' : 'n/a';
  const si = of('selfinspections'), ea = of('extaudits');
  const siDone = si.filter(r => ['Report Issued', 'Response Submitted', 'Auditor Review', 'Response Accepted', 'Closed'].includes(r.status));
  const findings = [...si.flatMap(r => (r.data.observations || []).map(o => ({ r, c: o.category, open: o.status !== 'Complied' }))), ...ea.flatMap(r => (r.data.findings || []).map(f => ({ r, c: f.category, open: f.status !== 'Closed' })))];
  const fRow = (c) => [c, findings.filter(f => f.c === c && inQ(f.r)).length, findings.filter(f => f.c === c && inY(f.r)).length, ''];
  const temp = dev.filter(r => r.data.tempRange && r.data.tempRange !== 'Not applicable');
  const vendors = of('vendors'), byStatus = (l) => Object.entries(l.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + 1 }), {}));
  const months = (q - 1) * 3 + 3, chain = verifyAudit();
  const prevQmr = of('mgmtreviews', r => r.status === 'Authorized').sort((a, b) => (b.data.year * 10 + +b.data.quarter.slice(1)) - (a.data.year * 10 + +a.data.quarter.slice(1)))[0];
  return {
    generatedAt: now(), period: { quarter: `${quarter}/${year}`, from: qs, to: qe, ytdFrom: ys },
    columns: ['Item', `This quarter (${qs} – ${qe})`, `Year to date (from ${ys})`, 'Notes'],
    sections: [
      { title: '1. Status of actions from the previous QMR', rows: prevQmr ? [['Actions raised at ' + prevQmr.number, (prevQmr.data.actions || []).length, '', 'Updates are recorded in "Status of actions from the previous QMR"']] : [['No previous authorized QMR', '', '', '']] },
      { title: '2. Complaints', rows: eventRows(cmp) },
      { title: '3. Deviations', rows: [...eventRows(dev), row('Temperature-related', temp)] },
      { title: '4. Change control', rows: [row('Raised', cc), ...['Critical', 'Major', 'Minor'].map(c => row(c, cc.filter(r => r.data.classification === c))), row('Temporary changes', cc.filter(r => r.data.nature === 'Temporary')), row('Still open', cc.filter(isOpen)), row('Overdue', cc.filter(overdue))] },
      { title: '5. CAPA and CAPA effectiveness', rows: [row('Raised', capa), row('Closed', capa.filter(r => r.status === 'Closed')), row('Overdue', capa.filter(overdue)), row('Effectiveness check: effective', capa.filter(r => r.data.effective === 'Yes')), row('Effectiveness check: not effective', capa.filter(r => r.data.effective === 'No'))] },
      { title: '6. Training and effectiveness', rows: [['Assignments due', trnQ.length, trn.length, ''], ['Completed', trnQ.filter(r => r.status === 'Completed').length, trn.filter(r => r.status === 'Completed').length, ''], ['Compliance', pct(trnQ), pct(trn), ''], ['Triggered by CAPA / deviation / complaint', trnQ.filter(r => /^(CAPA|JRS-)/.test(r.data.sourceRecord || '')).length, trn.filter(r => /^(CAPA|JRS-)/.test(r.data.sourceRecord || '')).length, '']] },
      { title: '7. Audits (self-inspection, customer, regulatory)', rows: [['Self-inspections performed', siDone.filter(inQ).length, siDone.filter(inY).length, 'At least 4 per year (JRS/SOP/QAS/004)'], ...['Customer / client audit', 'Regulatory inspection', 'Third-party audit'].map(t => row(t, ea.filter(r => r.data.auditType === t))), ...['Critical', 'Major', 'Minor', 'Observation'].map(fRow), ['Open findings', findings.filter(f => f.open && inQ(f.r)).length, findings.filter(f => f.open && inY(f.r)).length, '']] },
      { title: '8. Area, equipment and system qualification', rows: [['Not yet recorded in the eQMS', '', '', 'Validation module (JRS/SOP/QAS/018) planned']] },
      { title: '9. Environmental monitoring (temperature / humidity excursions)', rows: [row('Temperature-related deviations', temp)] },
      { title: '10. Vendor qualification', rows: byStatus(vendors).map(([s, n]) => [s, n, n, 'Current status']).concat(vendors.length ? [] : [['No vendors recorded', '', '', '']]) },
      { title: '11. Recall and mock recall', rows: [row('Events with product recall', of('investigations', r => String(r.data.recall).startsWith('Yes')))] },
      { title: '12. Self-inspection, regulatory and customer audits with open CAPA', rows: [['Audits not yet closed', [...si, ...ea].filter(r => isOpen(r) && inQ(r)).length, [...si, ...ea].filter(r => isOpen(r) && inY(r)).length, '']] },
      { title: '13. Overall QMS status', rows: [['Open CAPA / overdue', capa.filter(isOpen).length, capa.filter(overdue).length, 'Open / overdue now'], ['Open deviations / overdue', dev.filter(isOpen).length, dev.filter(overdue).length, 'Open / overdue now'], ['Open change controls / overdue', cc.filter(isOpen).length, cc.filter(overdue).length, 'Open / overdue now'], ['Open complaints / overdue', cmp.filter(isOpen).length, cmp.filter(overdue).length, 'Open / overdue now'], ['Extension requests', of('extensions').filter(inQ).length, of('extensions').filter(inY).length, ''], ['Audit trail integrity', chain.ok ? 'Intact' : 'BROKEN', '', `${chain.checked} entries verified`]] }
    ],
    kpis: [
      ['Right first time (RFT)', 'n/a', 'Needs order / shipment data – not yet in the eQMS'],
      ['Deviation rate (per month, year to date)', (dev.filter(inY).length / months).toFixed(1), `Deviations: ${dev.filter(inY).length} in ${months} months`],
      ['Complaint rate (per month, year to date)', (cmp.filter(inY).length / months).toFixed(1), `Complaints: ${cmp.filter(inY).length} in ${months} months`],
      ['Training compliance (year to date)', pct(trn), `${trn.filter(r => r.status === 'Completed').length} of ${trn.length} assignments completed`],
      ['Critical audit findings (year to date)', findings.filter(f => f.c === 'Critical' && inY(f.r)).length, 'Patient- or product-impacting'],
      ['Overdue CAPA / deviations / complaints / change controls', [capa, dev, cmp, cc].map(l => l.filter(overdue).length).join(' / '), 'Now'],
      ['Data integrity compliance', chain.ok ? 'Audit trail intact' : 'Audit trail BROKEN', `${chain.checked} entries verified`],
      ['Supplier performance', 'n/a', 'Supplier qualification module not yet aligned to JRS/SOP/QAS/005']
    ]
  };
}
route('POST', '/api/records/:id/compile', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'mgmtreviews') fail(400, 'Only management reviews compile data.');
  if (!hasRole(ctx.user, ['qa'])) fail(403, 'QA role required.');
  if (!['Planned', 'Data Compiled', 'Meeting Held'].includes(rec.status)) fail(409, 'Data can be compiled only before the minutes are compiled.');
  const from = rec.status;
  rec.data.metrics = qmrMetrics(rec.data.year, rec.data.quarter);
  if (from === 'Planned') rec.status = 'Data Compiled';
  saveRecord(rec);
  audit(ctx.user, 'QMR data compiled', rec, 'metrics', null, `${rec.data.metrics.period.from} – ${rec.data.metrics.period.to}`, null, ctx.ip);
  if (from !== rec.status) audit(ctx.user, 'Status changed', rec, 'status', from, rec.status, null, ctx.ip);
  return { ok: true, status: rec.status };
});
// Co-signed step (modules.js "cosign"): each sign-off is recorded; once every required sign-off has been given
// in the current stage, by different people, the record moves to the next stage.
function coSign(ctx, rec, mod, t) {
  const group = mod.cosign[rec.status], from = rec.status;
  const given = () => db.prepare('SELECT username, meaning FROM signatures WHERE record_id=? AND ts>=?').all(rec.id, rec.data.stateEnteredAt || '').filter(s => group.meanings.includes(s.meaning));
  const before = given();
  if (before.some(s => s.meaning === t.sign)) fail(409, `"${t.sign}" has already been given at this stage.`);
  if (before.some(s => s.username === ctx.user.username)) fail(403, 'Segregation of duties: the sign-offs at this stage must be given by different people.');
  verifySignature(ctx.user, ctx.body);
  sign(ctx.user, rec, t.sign, from, from);
  audit(ctx.user, 'Signed (e-signed: ' + t.sign + ')', rec, 'status', from, from, ctx.body.reason, ctx.ip);
  const done = group.meanings.every(m => given().some(s => s.meaning === m));
  if (done) {
    const next = group.next(rec);
    rec.status = next; rec.data.stateEnteredAt = now();
    onTransition(ctx.user, rec, next, ctx.ip);
    audit(ctx.user, 'Status changed (all sign-offs given)', rec, 'status', from, next, null, ctx.ip);
  }
  saveRecord(rec);
  if (done) notifyStatus(ctx.user, rec, from, rec.status);
  return { ok: true, status: rec.status, pending: group.meanings.filter(m => !given().some(s => s.meaning === m)) };
}
route('POST', '/api/records/:id/transition', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), mod = MODULES[rec.type];
  // several sign-offs can share a from/to pair (co-signatures); the label picks the one meant
  const cands = mod.transitions.filter(x => x.from === rec.status && x.to === ctx.body.to);
  const t = cands.length > 1 ? cands.find(x => x.label === ctx.body.label) : cands[0];
  if (!t) fail(409, cands.length ? 'Choose which sign-off to give.' : `Cannot move from ${rec.status} to ${ctx.body.to}.`);
  if (!hasRole(ctx.user, t.roles)) fail(403, `Your roles do not allow "${t.label}".`);
  if (t.reason && !String(ctx.body.reason || '').trim()) fail(400, 'A reason is required for this step.');
  const missing = (t.needs || []).map(k => mod.fields.find(x => x.k === k)).filter(f => isEmpty(f, rec.data[f.k]));
  if (missing.length) failMissing(missing, `Complete these fields before "${t.label}"`);
  for (const c of t.checks || []) CHECKS[c](rec, ctx.user);
  if (t.sod && rec.created_by === ctx.user.username) fail(403, 'Segregation of duties: the record initiator cannot approve it.');
  if (t.sodWith && db.prepare('SELECT 1 FROM signatures WHERE record_id=? AND username=? AND meaning LIKE ?').get(rec.id, ctx.user.username, t.sodWith + '%'))
    fail(403, `Segregation of duties: you signed "${t.sodWith}" on this record and cannot also sign this step.`);
  if (t.needsList) {
    const rl = db.prepare('SELECT generated_by FROM rand_lists WHERE record_id=?').get(rec.id);
    if (!rl) fail(400, 'Generate the list first.');
    if (rl.generated_by === ctx.user.username) fail(403, 'Segregation of duties: the list generator cannot approve it.');
  }
  if (t.traineeOnly && rec.data.trainee !== ctx.user.username) fail(403, 'Only the trainee can sign their own training record.');
  if (t.checkScore && rec.data.passMark !== '' && rec.data.passMark != null && !(+rec.data.score >= +rec.data.passMark)) fail(400, `Score ${rec.data.score || 0}% is below the pass mark ${rec.data.passMark}%.`);
  if (t.checkSanctions && rec.data.sanctions !== 'Clear') fail(400, 'Sanctions screening must be "Clear" before qualification.');
  if (t.checkRecon && !String(rec.data.reconciliation).startsWith('Balanced')) fail(400, 'Label reconciliation is not balanced. Raise a deviation before completing.');
  if (t.cosign) return coSign(ctx, rec, mod, t);
  if (t.sign) verifySignature(ctx.user, ctx.body);
  const from = rec.status; rec.status = t.to;
  if (from !== t.to) rec.data.stateEnteredAt = now();
  onTransition(ctx.user, rec, t.to, ctx.ip);
  saveRecord(rec);
  audit(ctx.user, t.sign ? 'Status changed (e-signed: ' + t.sign + ')' : 'Status changed', rec, 'status', from, t.to, ctx.body.reason, ctx.ip);
  if (t.sign) sign(ctx.user, rec, t.sign, from, t.to);
  if (from !== rec.status) notifyStatus(ctx.user, rec, from, rec.status);
  return { ok: true, status: rec.status };
});
route('POST', '/api/records/:id/revise', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'documents' || rec.status !== 'Effective') fail(409, 'Only effective documents can be revised.');
  if (!hasRole(ctx.user, ['author', 'qa'])) fail(403, 'Author or QA role required.');
  if (db.prepare("SELECT 1 FROM records WHERE type='documents' AND number=? AND status IN ('Draft','In Review','QA Review','Approval','Approved – Training') AND deleted=0").get(rec.number)) fail(409, 'A revision of this document is already in progress.');
  // JRS/SOP/QAS/021 §5.9: a revision with changes needs an approved change control; a periodic review without change still issues a new version but needs no training
  const revisionType = ctx.body.revisionType === 'Periodic review – no change' ? 'Periodic review – no change' : 'Revision – technical / procedural change';
  const reason = String(ctx.body.reason || '').trim(); if (!reason) fail(400, 'A reason for the revision is required.');
  if (revisionType.startsWith('Revision')) {
    const cc = byNumber(ctx.body.changeControl, ['changes']);
    if (!cc || !CC_APPROVED.includes(cc.status)) fail(400, 'A revision with technical or procedural changes needs an approved change control (JRS/SOP/QAS/007).');
  }
  const [maj] = String(rec.data.version || '1.0').split('.');
  const { approvedOn, deptApprovals, stateEnteredAt, supersededOn, ...keep } = rec.data;
  const data = { ...keep, version: (parseInt(maj, 10) + 1) + '.0', revisionType, changeControl: revisionType.startsWith('Revision') ? String(ctx.body.changeControl).toUpperCase() : '',
    revisionSummary: reason, effectiveDate: '', shortNotice: '', nextReview: '', sharepointUrl: '', supersedes: rec.id, __number: rec.number };
  const rev = createRecord(ctx.user, 'documents', data, ctx.ip, `${revisionType} of ${rec.number} v${rec.data.version}: ${reason}`);
  link(ctx.user, rec, rev, ctx.ip);
  return rev;
});
// Attachments can be added at every stage; each file keeps the stage it was added at. Closed records take files from QA only.
function addAttachment(ctx, rec, file) {
  const buf = Buffer.from(String(file.base64 || ''), 'base64'); if (!buf.length) fail(400, 'Empty file');
  if (buf.length > 25 * 1024 * 1024) fail(413, 'Maximum file size is 25 MB.');
  const id = uid(), h = crypto.createHash('sha256').update(buf).digest('hex');
  const cat = String(file.category || '').replace(/[^\w-]/g, '').slice(0, 30) || null;
  db.prepare('INSERT INTO attachments (id,record_id,name,mime,size,sha256,blob,uploaded_by,ts,stage,category) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, rec.id, String(file.name || 'file').slice(0, 200), String(file.mime || ''), buf.length, h, buf, ctx.user.username, now(), rec.status, cat);
  audit(ctx.user, 'Attachment added', rec, 'attachment', null, `${file.name} (stage ${rec.status}${cat ? '; ' + cat : ''}; SHA-256 ${h.slice(0, 16)}…)`, file.reason || ctx.body.reason, ctx.ip);
  return { id, sha256: h };
}
route('POST', '/api/records/:id/attachments', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  if (LOCKED.has(rec.status) && !EDITABLE_ALWAYS.has(rec.type) && !hasRole(ctx.user, ['qa'])) fail(409, `Record is ${rec.status}. Only QA can add attachments now.`);
  if (MODULES[rec.type].attachOnRequestOnly && !hasRole(ctx.user, ['qa'])) fail(403, 'Documents are attached with the request. After that only QA can add documents.');
  return addAttachment(ctx, rec, ctx.body);
});
route('GET', '/api/attachments/:id', (ctx) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id=?').get(ctx.params.id); if (!a) fail(404, 'Not found');
  visibleRecord(ctx.user, getRecord(a.record_id));
  const buf = Buffer.from(a.blob);
  if (crypto.createHash('sha256').update(buf).digest('hex') !== a.sha256) fail(500, 'Integrity check failed: file checksum does not match.');
  audit(ctx.user, 'Attachment downloaded', getRecord(a.record_id), 'attachment', null, a.name, null, ctx.ip);
  return { __raw: buf, headers: { 'Content-Type': a.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(a.name)}"` } };
});

route('POST', '/api/records/:id/printed', (ctx) => {
  const rec = getRecord(ctx.params.id);
  audit(ctx.user, 'Record printed (uncontrolled copy)', rec, null, null, null, ctx.body.reason, ctx.ip);
  return { ok: true };
});

module.exports = { emptyValue, sameValue, qmrMetrics, coSign, addAttachment };
