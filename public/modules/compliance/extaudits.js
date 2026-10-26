/* Module "External audits & inspections" (Compliance). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t, sec } = Q;
  MODULES.extaudits = {
    name: 'External audits & inspections', single: 'external audit', group: 'Compliance', prefix: 'EA',
    intro: 'Customer, regulatory and third-party audits of JRS per JRS/SOP/QAS/002 (register FRM/QAS/012, response FRM/QAS/013) and regulatory inspections per JRS/SOP/QAS/008. Every audit finding is answered through a CAPA (JRS/SOP/QAS/006).',
    numbering: (d, y) => ({ pre: `JRS-EA-${y}-`, pad: 3 }),
    list: ['number', 'title', 'auditType', 'auditStart', 'findingCounts', 'status'],
    fields: [
      sec('Audit request and planning'),
      { k: 'title', label: 'Name of auditing entity', type: 'text', req: true, full: true },
      { k: 'auditType', label: 'Type', type: 'select', req: true, options: ['Customer / client audit', 'Regulatory inspection', 'Third-party audit'] },
      { k: 'planned', label: 'Planned or unplanned', type: 'select', req: true, options: ['Planned', 'Unplanned'] },
      { k: 'mode', label: 'Mode', type: 'select', options: ['On-site', 'Virtual (video)'] },
      { k: 'auditorName', label: 'Name of auditor', type: 'text' },
      { k: 'auditorCompany', label: 'Auditor company', type: 'text' },
      { k: 'auditorEmail', label: 'Auditor e-mail', type: 'email' },
      { k: 'auditorContact', label: 'Auditor contact details', type: 'text' },
      { k: 'auditStart', label: 'Date of external audit (start)', type: 'date' },
      { k: 'auditEnd', label: 'Date of external audit (end)', type: 'date' },
      { k: 'host', label: 'JRS host (QA Manager / designee)', type: 'user' },
      { k: 'cdaSigned', label: 'Confidentiality agreement signed on', type: 'date' },
      { k: 'agenda', label: 'Final agenda from the requestor', type: 'textarea', full: true },
      { k: 'attendees', label: 'Audit attendees', type: 'table', full: true, cols: [{ k: 'name', label: 'Name' }, { k: 'company', label: 'Company' }] },
      sec('Report and response (FRM/QAS/013)'),
      { k: 'reportDate', label: 'Date of external audit report', type: 'date' },
      { k: 'responseDue', label: 'Response due date (set by the auditor)', type: 'date' },
      { k: 'findings', label: 'Audit findings and JRS response', type: 'table', full: true, cols: [{ k: 'no', label: 'Sr. no.' }, { k: 'finding', label: 'Audit finding' }, { k: 'category', label: 'Category', options: ['Observation', 'Minor', 'Major', 'Critical'] }, { k: 'response', label: 'Initial / final response with action items' }, { k: 'due', label: 'Due date', type: 'date' }, { k: 'capa', label: 'CAPA no.', ref: ['capa'] }, { k: 'cc', label: 'Change control no.', ref: ['changes'] }, { k: 'status', label: 'Status', options: ['Open', 'Closed'] }] },
      { k: 'findingCounts', label: 'Findings (Critical / Major / Minor / Observation)', type: 'computed' },
      { k: 'clientFormat', label: "Response sent in the client's own format", type: 'checkbox' },
      { k: 'initialResponse', label: 'Date of initial response', type: 'date' },
      sec('Closure'),
      { k: 'finalResponse', label: 'Date of final response', type: 'date' },
      { k: 'clientClosure', label: 'Closure confirmed by the requestor', type: 'select', options: ['Confirmed', 'Not provided by the requestor'] },
      { k: 'closureNotes', label: 'Closure notes', type: 'textarea', full: true }
    ],
    compute: { findingCounts: (d) => { const c = { Critical: 0, Major: 0, Minor: 0, Observation: 0 }; for (const f of d.findings || []) if (f.category in c) c[f.category]++; return `${c.Critical} / ${c.Major} / ${c.Minor} / ${c.Observation}`; } },
    states: ['Requested', 'Confirmed', 'Audit Completed', 'Report Received', 'Response Prepared', 'Response Approved', 'Closed', 'Cancelled'],
    transitions: [
      t('Requested', 'Confirmed', 'Confirm audit (agenda and confidentiality agreement in place)', ['qa'], { needs: ['auditStart', 'cdaSigned', 'agenda'] }),
      t('Requested', 'Cancelled', 'Cancel', ['qa'], { reason: true }),
      t('Confirmed', 'Audit Completed', 'Record close-out meeting held', ['qa'], { needs: ['attendees'] }),
      t('Audit Completed', 'Report Received', 'Report received and accepted', ['qa'], { needs: ['reportDate', 'responseDue'], checks: ['eaFindings'] }),
      t('Report Received', 'Response Prepared', 'Prepare response', ['qa'], { sign: 'Prepared – QA Manager', checks: ['eaResponse'] }),
      t('Response Prepared', 'Report Received', 'Return for rework', ['qa'], { reason: true }),
      t('Response Prepared', 'Response Approved', 'Approve response', ['qa'], { sign: 'Approved – Head QA', sodWith: 'Prepared' }),
      t('Response Approved', 'Closed', 'Close audit', ['qa'], { sign: 'Closed – QA', needs: ['initialResponse', 'finalResponse', 'clientClosure'], checks: ['eaClosure'] })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
