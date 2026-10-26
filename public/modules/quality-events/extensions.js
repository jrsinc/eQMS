/* Module "Extension requests" (Quality events). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPTS, t, sec } = Q;
  MODULES.extensions = {
    name: 'Extension requests', single: 'extension request', group: 'Quality events', prefix: 'ER',
    intro: 'Due-date extensions for change controls, deviations, complaints, CAPA and self-inspection responses (form JRS/FRM/QAS/045). Request one with the "Request extension" button beside the due date on the record. Only one extension per due date, requested and approved before that date.',
    // extension requests are raised from the due date on the record, not from a separate form
    noCreate: true,
    numbering: (d, y) => ({ pre: `ER-${y}-`, pad: 3 }),
    list: ['number', 'documentId', 'recordType', 'scope', 'originalDue', 'requestedDate', 'requesterDept', 'status'],
    fields: [
      sec('Extension request (requester)', { create: true, edit: { Draft: ['initiator'] } }),
      { k: 'documentId', label: 'Document ID (record to extend)', type: 'recordref', refTypes: ['investigations', 'capa', 'changes', 'selfinspections'], req: true, lock: true },
      { k: 'scope', label: 'Due date to extend', type: 'select', req: true, lock: true, def: 'Overall due date', options: ['Overall due date', 'Correction (CAPA)', 'Corrective action (CAPA)', 'Preventive action (CAPA)'] },
      { k: 'recordType', label: 'Record type', type: 'readonly' },
      { k: 'originalDue', label: 'Original due date', type: 'readonly', fmt: 'date' },
      { k: 'requestedDate', label: 'Requested extension date', type: 'date', req: true },
      { k: 'justification', label: 'Justification of extension / delay', type: 'textarea', req: true, full: true },
      { k: 'interimUpdate', label: 'Interim update', type: 'textarea', req: true, full: true },
      { k: 'impactAssessment', label: 'Impact assessment (product quality, patient safety, regulatory compliance, business operations)', type: 'textarea', req: true, full: true },
      { k: 'requesterDept', label: 'Requester department', type: 'readonly', optionLabels: DEPTS },
      sec('Head of Department', { edit: { 'HOD Review': ['depthead'] } }),
      { k: 'hodApprover', label: 'Head of Department (organogram – department of the record)', type: 'readonly', fmt: 'user' },
      { k: 'hodComment', label: 'Head of Department comments', type: 'textarea', full: true },
      sec('Head of Quality / designee', { edit: { 'Head of Quality Approval': ['qa'] } }),
      { k: 'qaComment', label: 'Head of Quality / designee comments', type: 'textarea', full: true }
    ],
    states: ['Draft', 'HOD Review', 'Head of Quality Approval', 'Approved', 'Rejected'],
    transitions: [
      t('Draft', 'HOD Review', 'Submit request', ['any'], { sign: 'Requested', checks: ['erValid'] }),
      t('HOD Review', 'Head of Quality Approval', 'Head of Department approval', ['any'], { sign: 'Approved – Head of Department', checks: ['isHodApprover', 'erValid'] }),
      t('HOD Review', 'Rejected', 'Reject', ['any'], { sign: 'Rejected', reason: true, checks: ['isHodApprover'] }),
      t('Head of Quality Approval', 'Approved', 'Head of Quality approval', ['qa'], { sign: 'Approved – Head of Quality', sod: true, checks: ['erValid'] }),
      t('Head of Quality Approval', 'Rejected', 'Reject', ['qa'], { sign: 'Rejected', reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
