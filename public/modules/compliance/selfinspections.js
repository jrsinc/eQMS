/* Module "Self-inspections" (Compliance). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPTS, DEPT_CODES, t, sec } = Q;
  MODULES.selfinspections = {
    name: 'Self-inspections', single: 'self-inspection', group: 'Compliance', prefix: 'SI', hideFrom: ['extaud'],
    intro: 'Self-inspections per JRS/SOP/QAS/004 (agenda FRM/QAS/040, report FRM/QAS/003, response and CAPA plan FRM/QAS/041). Confidential: not shown to external auditors.',
    numbering: (d, y) => ({ pre: `JRS-SI-${y}-`, pad: 3 }),
    list: ['number', 'auditeeDept', 'plannedDate', 'leadAuditor', 'dueDate', 'status'],
    fields: [
      sec('Planning and agenda (FRM/QAS/040)'),
      { k: 'auditeeDept', label: 'Auditee section / department', type: 'select', req: true, options: DEPT_CODES, optionLabels: DEPTS },
      { k: 'title', label: 'Audit objective', type: 'text', req: true, full: true },
      { k: 'auditee', label: 'Auditee name', type: 'user', req: true },
      { k: 'scheduleRef', label: 'Annual schedule (FRM/QAS/038)', type: 'recordref', refTypes: ['sischedule'] },
      { k: 'unscheduledTrigger', label: 'Unscheduled self-inspection – trigger', type: 'select', options: ['Quality event / deviation', 'Complaint', 'External audit observation', 'Repetitive failure', 'Other (QA / Quality Head decision)'] },
      { k: 'postponeReason', label: 'Advanced or postponed (max. 1 month) – reason', type: 'select', options: ['Regulatory or customer audit in the period', 'Auditee has other commitments'] },
      { k: 'plannedDate', label: 'Date of audit', type: 'date', req: true },
      { k: 'duration', label: 'Timing / duration', type: 'text' },
      { k: 'leadAuditor', label: 'Lead auditor (QA expert)', type: 'user', req: true },
      { k: 'coAuditor', label: 'Co-auditor (cross-functional)', type: 'user', req: true },
      { k: 'consultant', label: 'External consultant (optional)', type: 'text' },
      { k: 'activities', label: 'Audit activities / focus areas (including follow-up of previous CAPA)', type: 'textarea', full: true },
      { k: 'notifiedOn', label: 'Agenda e-mailed to auditee on (at least 3 working days before)', type: 'date' },
      sec('Self-inspection report (FRM/QAS/003)'),
      { k: 'auditDate', label: 'Date of self-inspection (completed)', type: 'date' },
      { k: 'reportDate', label: 'Date of audit report (within 15 calendar days)', type: 'date' },
      { k: 'summary', label: 'Executive summary', type: 'textarea', full: true },
      { k: 'observations', label: 'Observations, response and CAPA plan (FRM/QAS/003 and FRM/QAS/041)', type: 'table', full: true, cols: [
        { k: 'no', label: 'Obs. #' }, { k: 'system', label: 'System / sub-system' }, { k: 'category', label: 'Category', options: ['Minor', 'Major', 'Critical'] },
        { k: 'description', label: 'Description of observation' }, { k: 'recommendation', label: 'Recommendation' },
        { k: 'corrective', label: 'Corrective action' }, { k: 'caDue', label: 'CA due date', type: 'date' },
        { k: 'preventive', label: 'Preventive action' }, { k: 'paDue', label: 'PA due date', type: 'date' },
        { k: 'responsible', label: 'Responsible person', type: 'user' }, { k: 'capa', label: 'CAPA no.', ref: ['capa'] }, { k: 'status', label: 'Status', options: ['Open', 'Complied'] }] },
      sec('Response and closure'),
      { k: 'dueDate', label: 'Response due (15 calendar days from the report)', type: 'readonly', fmt: 'date' },
      { k: 'extendedDue', label: 'Extended response due (approved extension – one only)', type: 'readonly', fmt: 'date' },
      { k: 'responseDate', label: 'Response and CAPA plan submitted on', type: 'readonly', fmt: 'date' },
      { k: 'responseTimeliness', label: 'Response timeliness', type: 'computed' },
      { k: 'qaVerification', label: 'QA verification of compliance', type: 'textarea', full: true }
    ],
    compute: { responseTimeliness: (d) => !d.responseDate ? '' : d.responseDate <= (d.extendedDue || d.dueDate) ? 'On time' : 'Late – submitted after the due date' },
    states: ['Planned', 'Notified', 'In Progress', 'Report Issued', 'Response Submitted', 'Auditor Review', 'Response Accepted', 'Closed', 'Cancelled'],
    transitions: [
      t('Planned', 'Notified', 'Agenda sent – confirm date and audit team', ['qa'], { needs: ['notifiedOn'], checks: ['siTeam', 'siSchedule', 'siNotice'] }),
      t('Planned', 'Cancelled', 'Cancel', ['qa'], { reason: true, sign: 'Approved' }),
      t('Notified', 'In Progress', 'Start self-inspection (pre-meeting held)', ['any'], { checks: ['isAuditor'] }),
      t('In Progress', 'Report Issued', 'Issue report', ['any'], { sign: 'Prepared – lead auditor', needs: ['auditDate', 'reportDate', 'summary'], checks: ['isLeadAuditor', 'siReport'] }),
      t('Report Issued', 'Response Submitted', 'Submit response and CAPA plan', ['any'], { sign: 'Response submitted – CAPA plan owner', checks: ['isAuditee', 'siResponse'] }),
      t('Response Submitted', 'Auditor Review', 'Manager of CAPA plan owner approval', ['hod'], { sign: 'Approved – manager of CAPA plan owner' }),
      t('Response Submitted', 'Report Issued', 'Return to auditee', ['hod'], { reason: true }),
      t('Auditor Review', 'Response Accepted', 'Accept response and CAPA plan', ['any'], { sign: 'CAPA plan approved – lead auditor', checks: ['isLeadAuditor'] }),
      t('Auditor Review', 'Report Issued', 'Return to auditee for rectification', ['any'], { reason: true, checks: ['isAuditor'] }),
      t('Response Accepted', 'Closed', 'QA verification – close self-inspection', ['qa'], { sign: 'Verified and closed – QA', needs: ['qaVerification'], checks: ['siClosure'], sodWith: 'Response submitted' })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
