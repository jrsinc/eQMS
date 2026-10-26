/* Module "Documents" (Documents & training). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, ROLES, SITES, DEPTS, DEPT_CODES, t, sec, DOC_CODES } = Q;
  MODULES.documents = {
    name: 'Documents', single: 'document', group: 'Documents & training', prefix: 'DOC',
    intro: 'Controlled SOPs, policies, work instructions and forms per JRS/SOP/QAS/021 (templates FRM/QAS/046 and 047, list of controlled documents FRM/QAS/048). Number JRS/type/division/serial; numbers are never reused.',
    numbering: (d) => ({ pre: `JRS/${DOC_CODES[d.docType]}/${d.division}/`, pad: 3 }),
    list: ['number', 'version', 'title', 'docType', 'effectiveDate', 'nextReview', 'status'],
    fields: [
      sec('Document', { edit: { Draft: ['initiator', 'qa'] } }),
      { k: 'docType', label: 'Document type', type: 'select', req: true, lock: true, options: Object.keys(DOC_CODES) },
      { k: 'division', label: 'Division (sets the document number)', type: 'select', req: true, lock: true, options: DEPT_CODES, optionLabels: DEPTS },
      { k: 'title', label: 'Title (stored in capitals; [GLB] added when it applies to more than one site)', type: 'text', req: true, full: true },
      { k: 'sites', label: 'Applicable site(s)', type: 'multicheck', req: true, options: SITES },
      { k: 'relatedSop', label: 'Related SOP (forms)', type: 'recordref', refTypes: ['documents'] },
      { k: 'version', label: 'Version', type: 'readonly' },
      { k: 'revisionType', label: 'Revision type', type: 'readonly' },
      { k: 'changeControl', label: 'Change control no. (required for a revision with technical or procedural changes)', type: 'recordref', refTypes: ['changes'] },
      { k: 'revisionSummary', label: 'Reason for issue / summary of changes (revision history)', type: 'textarea', full: true },
      { k: 'reviewer', label: 'Reviewer (SME / Head of Department)', type: 'user', req: true },
      { k: 'crossDepts', label: 'Cross-functional review – departments whose function is affected', type: 'multicheck', options: DEPT_CODES, optionLabels: DEPTS },
      { k: 'trainingImpact', label: 'Training before the effective date', type: 'select', req: true, options: ['Read & Understand', 'Instructor-led', 'Assessment required', 'None'] },
      { k: 'trainingRoles', label: 'Roles to be trained', type: 'multicheck', options: Object.keys(ROLES) },
      { k: 'content', label: 'Document content (or attach the approved Word / PDF file below)', type: 'textarea', full: true, rows: 10 },
      sec('Approval and effective date', { edit: { Draft: ['initiator', 'qa'], Approval: ['qa'] } }),
      { k: 'effectiveDate', label: 'Effective date (at least 8 calendar days after approval)', type: 'date' },
      { k: 'shortNotice', label: 'QA justification if effective in less than 8 days', type: 'textarea', full: true },
      { k: 'nextReview', label: 'Periodic review due (3 years from effective date)', type: 'readonly', fmt: 'date' },
      { k: 'sharepointUrl', label: 'SharePoint link (published copy)', type: 'readonly' }
    ],
    states: ['Draft', 'In Review', 'QA Review', 'Approval', 'Approved – Training', 'Effective', 'Superseded', 'Obsolete'],
    transitions: [
      t('Draft', 'In Review', 'Submit for review', ['any'], { sign: 'Prepared – author', needs: ['reviewer', 'sites', 'revisionSummary'], checks: ['isInitiator', 'docRevisionCC'] }),
      t('In Review', 'Draft', 'Return to author', ['any'], { reason: true, checks: ['isReviewer'] }),
      t('In Review', 'QA Review', 'Complete review', ['any'], { sign: 'Reviewed – SME / Head of Department', checks: ['isReviewer', 'deptApprovalsDone'] }),
      t('QA Review', 'Draft', 'Return to author', ['qa'], { reason: true }),
      t('QA Review', 'Approval', 'QA review complete (GDocP, format, numbering, regulatory)', ['qa'], { sign: 'Reviewed – QA' }),
      t('Approval', 'Draft', 'Reject', ['qa'], { reason: true }),
      t('Approval', 'Approved – Training', 'Approve document (Head QA)', ['qa'], { sign: 'Approved – Head QA', sod: true, sodWith: 'Reviewed – QA', needs: ['effectiveDate'], checks: ['docEffective8'] }),
      t('Approved – Training', 'Effective', 'Make effective', ['qa'], { sign: 'Made effective – QA', checks: ['docEffectiveToday', 'docTrainingDone'] }),
      t('Effective', 'Obsolete', 'Discontinue – make obsolete (link the approved change control first)', ['qa'], { sign: 'Made obsolete – QA', reason: true, checks: ['docDiscontinueCC'] })
    ],
    deptApproval: { state: 'In Review', field: 'crossDepts', label: 'Cross-functional review' }
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
