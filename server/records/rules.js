/* SOP business rules: derived fields, checks, workflow side effects. */
'use strict';
const { DEPTS, MODULES, PASS_MARK, RETENTION, TRAINER_PARAMS, TRAINER_PASS, supRisk, trainingScore } = require('../../public/modules.js');
const { db, now } = require('../core/db.js');
const { MONTHS, addDays, addMonths, addWorkingDays, daysBetween, today, utc } = require('../core/util.js');
const { audit, verifyAudit } = require('../core/audit.js');
const { fail } = require('../core/http.js');
const { allAccess, userLabel } = require('../core/auth.js');
const { hodFor } = require('../org/departments.js');
const { DERIVE, LOCKED, applyComputed, byNumber, contentHash, createRecord, link, linked, nextNumber, rowToRecord, saveRecord } = require('./engine.js');

// change control states from pre-approval onwards (the change may be implemented)
const CC_APPROVED = ['Optional Approvals', 'Implementation', 'QA Closure Review', 'Closed – EC Pending', 'Closed'];
const need = (ok, msg) => { if (!ok) fail(400, msg); };
const blank = (v) => v === '' || v == null || (Array.isArray(v) && !v.length);
const ecMonths = (v) => parseInt(v, 10) || 0;
// Form JRS/FRM/QAS/045 – which due date an extension request moves
const ER_FIELDS = { 'Overall due date': ['dueDate', 'extendedDue'], 'Correction (CAPA)': ['corrDue', 'corrExt'], 'Corrective action (CAPA)': ['caDue', 'caExt'], 'Preventive action (CAPA)': ['paDue', 'paExt'] };
function erCheck(d, selfId) {
  const target = byNumber(d.documentId, ['investigations', 'capa', 'changes', 'selfinspections']);
  if (!target) fail(400, `No deviation, complaint, CAPA, change control or self-inspection with number ${d.documentId}.`);
  if (LOCKED.has(target.status) || target.status.startsWith('Closed')) fail(400, `${target.number} is ${target.status}. Extensions apply only to open records.`);
  const scope = d.scope || 'Overall due date';
  if (scope !== 'Overall due date' && target.type !== 'capa') fail(400, 'Action-level extensions apply to CAPA only.');
  const [dueK, extK] = ER_FIELDS[scope];
  const due = target.data[dueK];
  if (!due) fail(400, `${target.number} has no ${scope.toLowerCase()} to extend yet.`);
  if (target.data[extK]) fail(400, `${target.number} has already been extended once. Only one extension is allowed.`);
  const other = db.prepare("SELECT * FROM records WHERE type='extensions' AND deleted=0 AND status<>'Rejected' AND id<>?").all(selfId || '')
    .map(rowToRecord).find(x => x.data.documentId === target.number && (x.data.scope || 'Overall due date') === scope);
  if (other) fail(400, `Extension request ${other.number} already exists for ${target.number}. Only one extension is allowed.`);
  if (today() > due) fail(400, `The due date ${due} has passed. An extension must be requested and approved before the due date.`);
  if (!(d.requestedDate > due)) fail(400, `The requested extension date must be later than the current due date (${due}).`);
  return { target, extK, due };
}
// Named checks referenced by transitions in modules.js (opts.checks)
const CHECKS = {
  isInitiator: (r, u) => { if (r.created_by !== u.username && !allAccess(u)) fail(403, 'Only the initiator completes and submits this part.'); },
  // deviations and complaints: Part A by the initiator or the responsible department, Part C by the responsible person / department,
  // Part D by the Head of the responsible department (from the organogram)
  isPartAOwner: (r, u) => { if (![r.created_by, r.data.respPerson].includes(u.username) && !(u.department && u.department === r.data.respDept) && !allAccess(u)) fail(403, 'Only the initiator, the responsible person or the responsible department submits Part A.'); },
  isPartCOwner: (r, u) => { if (r.data.respPerson !== u.username && !(u.department && u.department === r.data.respDept) && !allAccess(u)) fail(403, 'Only the responsible person or the responsible department can do this step.'); },
  hodAvailable: (r) => need(hodFor(r.data.respDept, r.data.respPerson), `No Head of Department can approve for ${DEPTS[r.data.respDept] || 'the responsible department'}. Ask management or the Head of QA to set the Head in the organogram.`),
  // extension requests: the Head of the department responsible for the record being extended (organogram)
  erHod: (r, u) => {
    const t = byNumber(r.data.documentId), dept = t && (t.data.respDept || t.data.auditeeDept);
    if (dept && !allAccess(u) && !u.deptsUnder.includes(dept)) fail(403, `Only the Head of ${DEPTS[dept] || dept} (organogram) approves this extension.`);
  },
  isHodApprover: (r, u) => { if (r.data.hodApprover !== u.username && !allAccess(u)) fail(403, `Only the Head of Department named on the record (${userLabel(r.data.hodApprover)}) can approve or reject.`); },
  // audit trail review
  atrPeriod: (r) => need(r.data.periodFrom <= r.data.periodTo && r.data.periodTo <= today(), 'The review period must end today or earlier, and start before it ends.'),
  atrOutcome: (r) => { if (String(r.data.anomalies).startsWith('Anomalies')) need(r.data.investigationRef, 'Anomalies found: raise a deviation or CAPA and enter its number.'); },
  // JRS/SOP/QAS/021 – documents
  docRevisionCC: (r) => {
    if (!String(r.data.revisionType).startsWith('Revision')) return;
    const cc = byNumber(r.data.changeControl, ['changes']);
    need(cc && CC_APPROVED.includes(cc.status), 'A revision with technical or procedural changes needs an approved change control (JRS/SOP/QAS/007).');
  },
  isReviewer: (r, u) => { if (r.data.reviewer !== u.username) fail(403, 'Only the assigned reviewer can perform this step.'); },
  deptApprovalsDone: (r) => {
    const cfg = MODULES[r.type].deptApproval, done = (r.data.deptApprovals || []).map(a => a.dept), open = (r.data[cfg.field] || []).filter(x => !done.includes(x));
    need(!open.length, `${cfg.label} outstanding: ${open.join(', ')}.`);
  },
  docEffective8: (r) => need(r.data.effectiveDate >= addDays(today(), 8) || !blank(r.data.shortNotice), `The effective date must be at least 8 calendar days after approval (${addDays(today(), 8)} or later), or QA must justify the shorter period.`),
  docEffectiveToday: (r) => need(today() >= r.data.effectiveDate, `The document becomes effective on ${r.data.effectiveDate}.`),
  docTrainingDone: (r) => {
    const open = db.prepare("SELECT * FROM records WHERE type='training' AND deleted=0 AND status NOT IN ('Completed','Cancelled')").all().map(rowToRecord)
      .filter(t => t.data.docRef === r.number && t.data.docVersion === r.data.version);
    need(!open.length, `Training must be completed before the effective date: ${open.length} assignment(s) open (${open.map(t => userLabel(t.data.trainee)).join(', ')}).`);
  },
  docDiscontinueCC: (r) => need(linked(r.id).some(x => x.type === 'changes' && CC_APPROVED.includes(x.status)), 'Discontinuation needs a pre-approved change control linked to this document.'),
  // JRS/SOP/QAS/003 – training
  isTrainee: (r, u) => { if (r.data.trainee !== u.username) fail(403, 'Only the trainee can sign this step.'); },
  isTrainer: (r, u) => { if (r.data.trainer !== u.username) fail(403, 'Only the assigned trainer can sign this step.'); },
  certifiedTrainer: (r, u) => need(db.prepare("SELECT data FROM records WHERE type='trainers' AND status='Certified' AND deleted=0").all().some(x => JSON.parse(x.data).trainer === u.username), `${u.fullname} is not on the list of certified trainers (FRM/QAS/033).`),
  trSelfReading: (r) => need(String(r.data.trainingType).startsWith('Self-reading') && !r.data.assessment, 'Only self-reading (Manager and above) without assessment is signed by the trainee alone; other training is evaluated by a certified trainer.'),
  trNotSelfReading: (r) => need(!String(r.data.trainingType).startsWith('Self-reading'), 'Self-reading is signed as read and understood.'),
  trPass: (r) => {
    if (!r.data.assessment) return;
    const s = trainingScore(r.data);
    need(s != null, 'Record the assessment marks (FRM/QAS/034).');
    need(s >= PASS_MARK, `Score ${s}% is below the pass mark of ${PASS_MARK}%: record the unsatisfactory result and retrain.`);
    if (s < 100) need(!blank(r.data.gapTopic), `Score ${s}%: record the topic the trainee did not understand and that it was explained again.`);
  },
  trFail: (r) => { const s = trainingScore(r.data); need(r.data.assessment && s != null && s < PASS_MARK, 'Only an assessment score below 80% is recorded as unsatisfactory.'); },
  tniPlan: (r) => {
    const rows = r.data.plan || [];
    rows.forEach((x, i) => need(x.subject && x.type, `Training subject ${i + 1}: enter the subject and type.`));
    need(rows.some(x => /\/QAS\//.test(x.refDoc || '')), 'The TNI must include QA SOPs (JRS/SOP/QAS/…).');
  },
  tniDone: (r) => {
    const open = db.prepare("SELECT * FROM records WHERE type='training' AND deleted=0 AND status NOT IN ('Completed','Cancelled')").all().map(rowToRecord).filter(t => t.data.sourceRecord === r.number);
    need(!open.length, `${open.length} training assignment(s) from this TNI are not completed yet.`);
  },
  trainerScores: (r) => {
    let total = 0;
    for (const [k, label, max] of TRAINER_PARAMS) { const v = r.data[k]; need(v !== '' && v != null && +v >= 0 && +v <= max, `${label}: enter a score from 0 to ${max}.`); total += +v; }
    need(total >= TRAINER_PASS, `Total ${total} of 100 is below the acceptance criterion of ${TRAINER_PASS}.`);
  },
  // JRS/SOP/QAS/012 – record retention
  arLocation: (r) => {
    if (!String(r.data.location).startsWith('Off-site')) return;
    const v = byNumber(r.data.vendor, ['vendors']);
    need(v && v.status === 'Approved', 'Off-site storage needs a qualified, approved vendor (audit, qualification checklist, confidentiality and service agreement).');
  },
  arRetrievalOpen: (r) => { const x = (r.data.retrievals || []).slice(-1)[0]; need(x && x.date && x.by && x.purpose && !x.returned, 'Record the retrieval request (date, requested by, purpose) in the retrieval log.'); },
  arRetrievalClosed: (r) => { const x = (r.data.retrievals || []).slice(-1)[0]; need(x && x.returned && x.rearchived, 'Record the return date and re-archival date in the retrieval log.'); },
  arDestroy: (r) => {
    const d = r.data, y = RETENTION[d.recordType];
    need(y !== 'Permanent', `${d.recordType} are kept permanently.`);
    const from = MODULES.archives.compute.destroyFrom(d);
    need(today() >= from || (!blank(d.client) && !blank(d.clientRetention)), `The retention period ends on ${from}. Earlier destruction only on the client's documented instruction.`);
  },
  isResponsible: (r, u) => { if (![r.created_by, r.data.respPerson].includes(u.username) && !u.roles.includes('qa')) fail(403, 'Only the initiator, the responsible person or QA can submit this step.'); },
  capaDecision: (r) => need(r.data.capaRequired !== 'No' || !blank(r.data.capaJustification), 'Justify why no CAPA is required (JRS/SOP/QAS/022).'),
  capaLinked: (r) => need(r.data.capaRequired !== 'Yes' || linked(r.id).some(x => x.type === 'capa'), 'CAPA is marked as required: raise or link the CAPA before QA approval.'),
  customerInvolved: (r) => need(!String(r.data.customerApproval).startsWith('Not applicable'), 'Customer approval is "Not applicable": use "QA approve and close".'),
  customerNotInvolved: (r) => need(String(r.data.customerApproval).startsWith('Not applicable'), 'This event needs customer approval. Use "QA approve – send report to customer", or set customer approval to "Not applicable" if there is no customer impact.'),
  customerClosure: (r) => {
    const d = r.data;
    if (d.customerApproval === 'Approved by customer') return;
    need(String(d.customerApproval).startsWith('Deemed closed'), 'Record the customer approval, or deemed closure after 3 follow-ups within 45 days.');
    need(d.reportSent, 'Enter the date the QA-approved report was shared with the customer.');
    const f = [d.followUp1, d.followUp2, d.followUp3].filter(Boolean);
    need(f.length === 3 && f.every(x => x >= d.reportSent), 'Deemed closure needs 3 customer follow-ups after the report was shared.');
    need(daysBetween(d.reportSent, today()) >= 45, `Deemed closure is possible 45 days after the report was shared (from ${addDays(d.reportSent, 45)}).`);
  },
  capaPlan: (r) => {
    const d = r.data, acts = [['correction', 'corrDue', 'Correction'], ['corrective', 'caDue', 'Corrective action'], ['preventive', 'paDue', 'Preventive action']].filter(([k]) => !blank(d[k]));
    need(acts.length, 'Propose at least one correction, corrective action or preventive action.');
    for (const [, due, label] of acts) need(d[due], `${label}: enter the target due date.`);
  },
  capaImplemented: (r) => {
    const d = r.data;
    for (const [k, done, date, label] of [['correction', 'corrDone', 'corrDate', 'Correction'], ['corrective', 'caDone', 'caDate', 'Corrective action'], ['preventive', 'paDone', 'paDate', 'Preventive action']])
      if (!blank(d[k])) need(!blank(d[done]) && d[date], `${label}: record what was done and the implementation date (Part C).`);
  },
  ecDecision: (r) => {
    if (r.data.ecRequired === 'Not required') need(!blank(r.data.ecReason), 'Give the reason why no effectiveness check is required.');
    else need(ecMonths(r.data.ecDue), 'Select when the effectiveness check is due (3, 6, 9 or 12 months).');
  },
  ecIsRequired: (r) => need(r.data.ecRequired === 'Required', 'No effectiveness check is required: use "Close – CAPA completed".'),
  ecNotRequired: (r) => need(r.data.ecRequired === 'Not required', 'An effectiveness check is required: use "Close – effectiveness check pending".'),
  ccDue90: (r) => { const from = r.data.dateOpened || today(); if (r.data.nature === 'Permanent') need(r.data.dueDate <= addDays(from, 90), `A permanent change must be due within 90 days (by ${addDays(from, 90)}).`); },
  ccTemp: (r) => { if (r.data.nature === 'Temporary') need(r.data.tempStart && r.data.tempEnd && r.data.tempEnd >= r.data.tempStart, 'Temporary change: enter the start and end dates (end on or after start).'); },
  ccRiskClass: (r) => { if (['Major', 'Critical'].includes(r.data.classification)) need(r.data.riskRequired === 'Required', `${r.data.classification} changes require a risk assessment (JRS/SOP/QAS/020).`); },
  ccRiskRef: (r) => { if (r.data.riskRequired === 'Required') need(r.data.riskRef, 'Enter the risk assessment reference.'); },
  ccClientPm: (r) => { if (r.data.clientPre === 'Required' || r.data.clientPost === 'Required') need(r.data.pm, 'Name the person responsible for client communication.'); },
  ccOptional: (r) => {
    const done = (r.data.deptApprovals || []).map(a => a.dept), open = (r.data.optionalDepts || []).filter(x => !done.includes(x));
    need(!open.length, 'Optional approvals outstanding: ' + open.join(', ') + '.');
  },
  // change control: responsible person, Head of Department, department report, effectiveness check after its period
  // customers (JRS/FRM/QAS/010)
  custLicenceValid: (r) => need(r.data.licenceExpiry >= today(), `The licence expired on ${r.data.licenceExpiry}. Obtain the current licence before qualification.`),
  // suppliers (JRS/SOP/QAS/005): the evaluation required by the risk assessment is complete
  supEvaluationDone: (r) => {
    const d = r.data, a = supRisk(d).audit;
    need(a, 'Complete the risk assessment first.');
    // documents of this qualification cycle, by document type
    const has = (cat) => !!db.prepare('SELECT 1 FROM attachments WHERE record_id=? AND category=? AND ts>=? LIMIT 1').get(r.id, cat, d.cycleStartedAt || '');
    need(d.licenceExpiry > today(), `The licence expired on ${d.licenceExpiry}. Record the current licence no. and expiry date.`);
    need(d.requalDate > (d.effectiveDate || today()), 'The requalification date must be after the effective date.');
    if (/Certificate/.test(a)) { need(has('licence'), 'Certificate verification: attach the licence copy.'); need(d.licenceVerified === true, 'Certificate verification: tick "Licence verified" on the checklist.'); }
    if (/uestionnaire/.test(a)) need(has('questionnaire'), 'Supplier questionnaire: attach the filled questionnaire.');
    if (/ite audit/.test(a)) { need(d.auditDate && d.auditCertDate, 'Site audit: record the audit date and the audit certificate date.'); need(has('auditCert'), 'Site audit: attach the audit certificate.'); }
  },
  // the Head of the requesting department reviews the supplier risk assessment; never the QA person who prepared it
  supHodAvailable: (r, u) => need(hodFor(r.data.requesterDept, u.username), `No Head of Department in the organogram can review the risk assessment${r.data.requesterDept ? ' for ' + (DEPTS[r.data.requesterDept] || r.data.requesterDept) : ' (the request has no department)'}. Ask management or the Head of QA to set one.`),
  custReviewDate: (r) => need(r.data.reviewDate > today(), 'Set the next review date (after today).'),
  custDocuments: (r) => need(db.prepare('SELECT 1 FROM attachments WHERE record_id=? LIMIT 1').get(r.id), 'Attach the completed customer form and the licence copies before qualification.'),
  isRespPerson: (r, u) => { if (r.data.respPerson !== u.username && !allAccess(u)) fail(403, `Only the responsible person (${userLabel(r.data.respPerson)}) can review this step.`); },
  isCcDept: (r, u) => { if (![r.created_by, r.data.respPerson].includes(u.username) && !(u.department && u.department === r.data.respDept) && !allAccess(u)) fail(403, 'Only the initiator, the responsible person or the responsible department can do this step.'); },
  ccHasOptional: (r) => need((r.data.optionalDepts || []).length, 'No other departments are named: use "Approve – QA (pre-approval complete)".'),
  ccNoOptional: (r) => need(!(r.data.optionalDepts || []).length, 'Other departments are named for approval: use "Approve – QA (send to other departments)".'),
  ccNeedsEC: (r) => need(r.data.ecRequired === 'Required', 'No effectiveness check is required: use "Close – QA report".'),
  ccNoEC: (r) => need(r.data.ecRequired !== 'Required', 'An effectiveness check is required: use "Close – effectiveness check pending".'),
  ccEcDue: (r) => need(!r.data.ecDueDate || today() >= r.data.ecDueDate, `The effectiveness check is due on ${r.data.ecDueDate}, after the assigned period.`),
  ccPlanClosed: (r) => { const open = (r.data.plan || []).filter(p => !p.closed); need(!open.length, `${open.length} implementation activit${open.length === 1 ? 'y is' : 'ies are'} not closed yet.`); },
  ccClientComm: (r) => {
    if (r.data.clientPost === 'Required') need(r.data.clientCommunicated === 'Yes', 'Client post-communication is required: confirm the client was communicated.');
    else need(r.data.clientCommunicated, 'Record whether the client was communicated.');
  },
  ccRestored: (r) => { if (r.data.nature === 'Temporary') need(r.data.restored, 'Temporary change: record whether the original condition was restored.'); },
  erValid: (r) => { erCheck(r.data, r.id); },

  // JRS/SOP/QAS/004 – self-inspection
  siTeam: (r) => {
    const d = r.data;
    need(d.leadAuditor && d.coAuditor && d.leadAuditor !== d.coAuditor, 'At least two auditors are required: a lead auditor and a co-auditor.');
    const team = [d.leadAuditor, d.coAuditor].map(u => ({ u, a: qualifiedAuditor(u, 'Self-inspection') }));
    for (const x of team) need(x.a, `${userLabel(x.u)} is not on the list of qualified self-inspection auditors (FRM/QAS/039).`);
    for (const x of team) need(x.a.data.department !== d.auditeeDept, `${userLabel(x.u)} belongs to the audited department (${d.auditeeDept}) and cannot audit it.`);
    if (d.auditeeDept !== 'QAS') {
      need(team[0].a.data.department === 'QAS', 'The lead auditor must be a QA expert (qualified auditor from QAS).');
      need(team[1].a.data.department !== 'QAS', 'The co-auditor must be cross-functional (not from QAS).');
    }
    need(![d.leadAuditor, d.coAuditor].includes(d.auditee), 'The auditee cannot be on the audit team.');
  },
  siSchedule: (r) => {
    const d = r.data;
    if (!d.scheduleRef) return need(d.unscheduledTrigger, 'Link the annual schedule, or record the trigger for an unscheduled self-inspection.');
    const s = byNumber(d.scheduleRef, ['sischedule']);
    need(s && s.status === 'Approved', `Schedule ${d.scheduleRef} is not approved.`);
    const row = (s.data.plan || []).find(p => p.dept === d.auditeeDept);
    need(row, `${d.auditeeDept} is not on schedule ${s.number}. Record the self-inspection as unscheduled or revise the schedule.`);
    const p = utc(d.plannedDate), diff = p.getUTCMonth() + 12 * (p.getUTCFullYear() - +s.data.year) - MONTHS.indexOf(row.month);
    need(Math.abs(diff) <= 1, `${d.auditeeDept} is scheduled for ${row.month}: a self-inspection may be advanced or postponed by one month at most.`);
    if (diff) need(d.postponeReason, 'Record why the self-inspection was advanced or postponed.');
  },
  siNotice: (r) => need(addWorkingDays(r.data.notifiedOn, 3) <= r.data.plannedDate, 'The auditee must be notified at least 3 working days before the self-inspection.'),
  isAuditor: (r, u) => { if (![r.data.leadAuditor, r.data.coAuditor].includes(u.username)) fail(403, 'Only the assigned auditors can perform this step.'); },
  isLeadAuditor: (r, u) => { if (r.data.leadAuditor !== u.username) fail(403, 'Only the lead auditor can perform this step.'); },
  isAuditee: (r, u) => { if (r.data.auditee !== u.username) fail(403, 'Only the auditee (CAPA plan owner) can submit the response.'); },
  siReport: (r) => {
    const d = r.data;
    need(d.reportDate >= d.auditDate && daysBetween(d.auditDate, d.reportDate) <= 15, 'The report must be issued within 15 calendar days of the self-inspection.');
    (d.observations || []).forEach((o, i) => need(o.category && o.description, `Observation ${o.no || i + 1}: enter the category and description.`));
  },
  siResponse: (r) => (r.data.observations || []).forEach((o, i) => need(o.corrective && o.caDue && o.responsible, `Observation ${o.no || i + 1}: enter the corrective action, its due date and the responsible person.`)),
  siClosure: (r) => (r.data.observations || []).forEach((o, i) => {
    need(o.capa, `Observation ${o.no || i + 1}: every audit finding is answered through a CAPA (JRS/SOP/QAS/006) – enter the CAPA number.`);
    need(o.status === 'Complied', `Observation ${o.no || i + 1} is not yet complied with.`);
  }),
  sisMinimum: (r) => {
    const rows = (r.data.plan || []).filter(p => p.dept && p.month);
    need(rows.length >= 4, `At least four self-inspections a year are required (${rows.length} scheduled).`);
  },
  // JRS/SOP/QAS/002 – external audit
  eaFindings: (r) => (r.data.findings || []).forEach((f, i) => need(f.finding && f.category, `Finding ${f.no || i + 1}: enter the finding and its category.`)),
  eaResponse: (r) => (r.data.findings || []).forEach((f, i) => need(f.response && f.due, `Finding ${f.no || i + 1}: every finding needs a response with action items and a due date.`)),
  eaClosure: (r) => (r.data.findings || []).forEach((f, i) => {
    if (f.category !== 'Observation') need(f.capa, `Finding ${f.no || i + 1}: every audit finding is answered through a CAPA (JRS/SOP/QAS/006) – enter the CAPA number.`);
    need(f.status === 'Closed', `Finding ${f.no || i + 1} is still open.`);
  }),
  // JRS/SOP/QAS/020 – quality risk management
  raScores: (r) => {
    const rows = r.data.fmea || [];
    need(rows.length, 'Add at least one failure mode to the FMEA.');
    rows.forEach((x, i) => need(x.mode && x.s && x.o && x.d, `FMEA row ${x.id || i + 1}: enter the failure mode and scores for S, O and D.`));
  },
  raCriticalOpen: (r) => need((r.data.fmea || []).some(x => x.level === 'Critical' && blank(x.mitigation)), 'Senior leadership acceptance is only needed for a Critical risk without mitigation.'),
  raActions: (r) => {
    const accepted = db.prepare("SELECT content_hash FROM signatures WHERE record_id=? AND meaning LIKE 'Risk accepted%'").all(r.id).some(s => s.content_hash === contentHash(r));
    (r.data.fmea || []).forEach((x, i) => {
      const lab = `FMEA row ${x.id || i + 1}`, open = blank(x.mitigation);
      need(x.accept, `${lab}: record whether the risk is accepted.`);
      if (open && x.level === 'Major') need(x.comments, `${lab}: a Major risk without mitigation needs a justification.`);
      if (open && x.level === 'Critical') {
        need(x.comments, `${lab}: a Critical risk without mitigation needs a justification.`);
        need(accepted, `${lab}: a Critical risk without mitigation needs senior leadership acceptance.`);
      }
      if (x.accept === 'Yes' && (x.s === '5' || x.ps === '5')) need(x.comments, `${lab}: accepting a risk with severity 5 must be justified.`);
    });
  },
  raResidual: (r) => (r.data.fmea || []).forEach((x, i) => { if (!blank(x.mitigation)) need(x.ps && x.po && x.pd, `FMEA row ${x.id || i + 1}: score the residual risk (post-action S, O and D).`); }),
  // JRS/SOP/QAS/019 – management review
  qmrAttendance: (r) => {
    const rows = r.data.attendees || [];
    need(rows.length, 'Record the attendance.');
    for (const a of rows.filter(x => x.mandatory === 'Yes')) need(a.name && a.attendance === 'Present', `Mandatory attendee "${a.designation || a.name}" must be present.`);
  },
  qmrMinutes: (r) => {
    const d = r.data;
    need(d.metrics, 'Compile the QMR data first.');
    (d.prevActions || []).forEach((a, i) => need(a.update && a.status, `Previous action ${i + 1}: record the update and status.`));
    (d.actions || []).forEach((a, i) => need(a.recommendation && a.responsibility && a.target, `Action ${i + 1}: enter the recommendation, responsibility and target date.`));
  }
};
// Audit trail review (EU GMP Annex 11 §9, data integrity): what happened in the period, and the events a reviewer looks at first
function auditSummary(from, to, scope) {
  const types = scope.filter(s => s !== 'system'), system = !scope.length || scope.includes('system');
  const rows = db.prepare('SELECT a.*, r.type AS record_type FROM audit a LEFT JOIN records r ON r.id = a.record_id WHERE a.ts >= ? AND a.ts < ? ORDER BY a.id')
    .all(from, addDays(to, 1)).filter(a => !scope.length || (a.record_type ? types.includes(a.record_type) : system));
  const top = (key) => { const m = new Map(); for (const a of rows) m.set(a[key] || '—', (m.get(a[key] || '—') || 0) + 1); return [...m].sort((x, y) => y[1] - x[1]).slice(0, 20); };
  const flags = [
    ['Failed sign-ins', /^Login failed/], ['Accounts locked', /^Account locked/], ['Failed e-signatures', /^E-signature failed/],
    ['User accounts created or changed (roles, activation, password resets)', /^User (created|roles changed|activated|deactivated|unlocked)|^Password reset/],
    ['Field changes (each with a reason)', /^Field changed/], ['Records exported or printed', /^Record (exported|printed)/],
    ['Attachments downloaded', /^Attachment downloaded/], ['Unblinded randomization lists viewed', /^Unblinded list viewed/],
    ['Audit trail exported, printed or viewed per record', /^Audit trail (exported|report printed)|^Version history viewed/]
  ].map(([label, re]) => [label, rows.filter(a => re.test(a.action)).length]);
  const chain = verifyAudit();
  return { generatedAt: now(), period: { from, to }, scope: scope.length ? scope : ['All modules and system events'], total: rows.length,
    records: new Set(rows.map(a => a.record_id).filter(Boolean)).size, byUser: top('fullname'), byAction: top('action'), flags,
    chain: { ok: chain.ok, checked: chain.checked, brokenAt: chain.brokenAt || null } };
}
function assignNumber(u, r, ip) {
  if (!r.number.startsWith('REQ-')) return; // already numbered (e.g. returned to the initiator and re-submitted)
  const old = r.number;
  r.number = nextNumber(r.type, r.data); r.data.dateOpened = today();
  db.prepare('UPDATE records SET number=? WHERE id=?').run(r.number, r.id);
  audit(u, 'Record number assigned', r, 'number', old, r.number, null, ip);
}
function qualifiedAuditor(username, scope) {
  return db.prepare("SELECT * FROM records WHERE type='auditors' AND status='Qualified' AND deleted=0").all().map(rowToRecord)
    .find(r => r.data.auditor === username && (r.data.scope || []).some(s => s.startsWith(scope)));
}
// the approving Head of Department comes from the organogram whenever a record reaches a Head of Department step
function assignHod(u, r, ip) {
  const old = r.data.hodApprover; r.data.hodApprover = hodFor(r.data.respDept, r.data.respPerson);
  if (old !== r.data.hodApprover) audit(u, 'Approver assigned from the organogram', r, 'hodApprover', old, r.data.hodApprover, null, ip);
}
// Side effects after a state change, keyed "module:new state"
const AFTER = {
  // the designated number generator assigns the record number once QA has approved the request
  'investigations:Initiation': (u, r, ip) => assignNumber(u, r, ip),
  // the approving Head of Department comes from the organogram when the investigation is submitted
  'investigations:HOD Approval': (u, r, ip) => assignHod(u, r, ip),
  // approved supplier list: approval date of this qualification cycle (effective and requalification dates are set by QA)
  'vendors:Approved': (u, r) => { r.data.approvedOn = today(); },
  'customers:Qualified': (u, r) => { if (!r.data.effectiveDate) r.data.effectiveDate = today(); },
  // help desk: the administrator who takes or resolves the ticket is assigned to it
  'helpdesk:In Progress': (u, r) => { r.data.assignedTo = u.username; },
  'helpdesk:Resolved': (u, r) => { if (!r.data.assignedTo) r.data.assignedTo = u.username; },
  'vendors:HOD Review': (u, r, ip) => { const old = r.data.hodApprover; r.data.hodApprover = hodFor(r.data.requesterDept, u.username); if (old !== r.data.hodApprover) audit(u, 'Approver assigned from the organogram', r, 'hodApprover', old, r.data.hodApprover, null, ip); },
  // requalification: the same process again – the finished cycle goes to the history, its review results are cleared
  'vendors:Risk Assessment': (u, r, ip) => {
    const d = r.data; if (!d.approvedOn) return; // returned from the quality review in the same cycle
    const cycle = (d.qualHistory || []).length + 1;
    (d.qualHistory ||= []).push({ cycle: String(cycle), riskLevel: `${d.riskLevel || ''} (${d.rpn || ''})`, auditType: d.auditType || '', effectiveDate: d.effectiveDate || '', requalDate: d.requalDate || '', outcome: 'Approved ' + d.approvedOn });
    for (const k of ['licenceVerified', 'auditCategory', 'auditMethod', 'auditDate', 'auditLocation', 'leadAuditor', 'auditTeam', 'auditeeRep', 'auditPurpose', 'agenda', 'effectiveDate', 'requalDate', 'auditCertDate', 'approvedOn', 'qaConclusion', 'hodApprover', 'hodComment']) delete d[k];
    d.cycleStartedAt = now();
    audit(u, 'Requalification started', r, 'qualHistory', null, `Cycle ${cycle} archived; new risk assessment and quality review`, null, ip);
  },
  'capa:HOD Pre-Approval': (u, r, ip) => assignHod(u, r, ip),
  'capa:HOD Verification': (u, r, ip) => assignHod(u, r, ip),
  'documents:Approved – Training': (u, r, ip) => { r.data.approvedOn = today(); assignDocTraining(u, r, ip); },
  'documents:Effective': (u, r, ip) => makeEffective(u, r, ip),
  'training:Assigned': (u, r) => { // retraining after an unsatisfactory assessment
    r.data.attempt = String((+r.data.attempt || 1) + 1);
    r.data.questions = (r.data.questions || []).map(q => ({ ...q, obtained: '' })); r.data.gapTopic = '';
  },
  'tni:Training In Progress': (u, r, ip) => {
    for (const row of r.data.plan || []) {
      const doc = row.refDoc ? byNumber(row.refDoc, ['documents']) : null;
      const t = createRecord(u, 'training', { trainee: r.data.employee, title: doc ? `${doc.number} v${doc.data.version} – ${doc.data.title}` : row.subject,
        docRef: doc ? doc.number : '', docVersion: doc ? doc.data.version : '', trainingType: row.type || 'Induction', dueDate: addDays(today(), 30), sourceRecord: r.number, attempt: '1' }, ip, `Assigned from ${r.number}`);
      link(u, r, t, ip);
    }
  },
  'tni:Certified': (u, r) => { r.data.certificateDate = today(); },
  'atreviews:Under Review': (u, r) => { r.data.summary = auditSummary(r.data.periodFrom, r.data.periodTo, r.data.scope || []); },
  'changes:RP Review': (u, r, ip) => assignNumber(u, r, ip),
  'changes:HOD Approval': (u, r, ip) => assignHod(u, r, ip),
  'capa:Effectiveness Check': (u, r) => { r.data.ecDueDate = addMonths(today(), ecMonths(r.data.ecDue)); },
  'capa:Closed': (u, r, ip) => {
    if (r.data.effective !== 'No') return;
    const d = r.data;
    const n = createRecord(u, 'capa', { title: 'Follow-up CAPA – ' + d.title, respDept: d.respDept, respPerson: d.respPerson, dueDate: addDays(today(), 30), source: 'CAPA not effective',
      nonconformance: `Effectiveness check of ${r.number} found the CAPA not effective. ${d.ecQaComment || ''}` }, ip, `Raised automatically: ${r.number} not effective`);
    link(u, r, n, ip);
  },
  'changes:Closed – EC Pending': (u, r) => { r.data.ecDueDate = addMonths(r.data.finalImplDate || today(), ecMonths(r.data.ecDue)); },
  'selfinspections:Report Issued': (u, r) => { r.data.dueDate = addDays(r.data.reportDate, 15); },
  'selfinspections:Response Submitted': (u, r) => { r.data.responseDate = today(); },
  'extensions:Approved': (u, r, ip) => {
    const { target, extK } = erCheck(r.data, r.id);
    const old = target.data[extK]; target.data[extK] = r.data.requestedDate; saveRecord(target);
    audit(u, 'Field changed', target, extK, old, r.data.requestedDate, `Extension request ${r.number} approved`, ip);
  }
};

// ---------- workflow side effects ----------
function onTransition(user, rec, to, ip) {
  if (AFTER[rec.type + ':' + to]) AFTER[rec.type + ':' + to](user, rec, ip);
  if (DERIVE[rec.type]) DERIVE[rec.type](rec);
  applyComputed(rec.type, rec.data);
}

// ---------- JRS/SOP/QAS/021 + 003: document approval assigns training, due before the effective date ----------
function assignDocTraining(user, rec, ip) {
  const d = rec.data;
  if (d.trainingImpact === 'None' || d.revisionType === 'Periodic review – no change' || !(d.trainingRoles || []).length) return 0;
  // the author, reviewer(s) and approver need no separate training
  const exempt = new Set([rec.created_by, d.reviewer, user.username, ...db.prepare('SELECT username FROM signatures WHERE record_id=?').all(rec.id).map(s => s.username)]);
  const users = db.prepare('SELECT username, roles FROM users WHERE active=1').all().filter(u => !exempt.has(u.username) && JSON.parse(u.roles).some(r => d.trainingRoles.includes(r)));
  for (const u of users) createRecord(user, 'training', {
    trainee: u.username, title: `${rec.number} v${d.version} – ${d.title}`, docRef: rec.number, docVersion: d.version,
    trainingType: d.trainingImpact === 'Read & Understand' ? 'SOP training – read & understand' : 'SOP training – instructor-led',
    assessment: d.trainingImpact === 'Assessment required', dueDate: d.effectiveDate, sourceRecord: rec.number, attempt: '1'
  }, ip, `Assigned on approval of ${rec.number} v${d.version}; training due before the effective date`);
  return users.length;
}
function makeEffective(user, rec, ip) {
  const d = rec.data;
  d.nextReview = addDays(d.effectiveDate, Math.round(3 * 365.25)); // periodic review within 3 years
  for (const old of db.prepare("SELECT * FROM records WHERE type='documents' AND number=? AND status='Effective' AND id<>? AND deleted=0").all(rec.number, rec.id).map(rowToRecord)) {
    old.status = 'Superseded'; old.data.supersededOn = today(); old.data.stateEnteredAt = now(); saveRecord(old);
    audit(user, 'Status changed', old, 'status', 'Effective', 'Superseded', `Superseded by version ${d.version} – master stamped SUPERSEDED and archived; issued copies to be retrieved`, ip);
  }
}

module.exports = { CC_APPROVED, need, blank, ecMonths, ER_FIELDS, erCheck, CHECKS, auditSummary, assignNumber, qualifiedAuditor, assignHod, AFTER, onTransition, assignDocTraining, makeEffective };
