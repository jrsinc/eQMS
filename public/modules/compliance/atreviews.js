/* Module "Audit trail reviews" (Compliance). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t, sec } = Q;
  MODULES.atreviews = {
    name: 'Audit trail reviews', single: 'audit trail review', group: 'Compliance', prefix: 'ATR', visibleTo: ['qa', 'admin'],
    intro: 'Periodic review of the audit trail for data integrity (EU GMP Annex 11 §9, 21 CFR Part 11, ALCOA+). Starting the review compiles a summary of the period from the audit trail; one QA person reviews and signs, a second QA person approves. Visible to QA and administrators only.',
    list: ['number', 'periodFrom', 'periodTo', 'anomalies', 'status'],
    fields: [
      sec('Review period', { edit: { Planned: ['qa'] } }),
      { k: 'title', label: 'Review title', type: 'text', req: true, full: true, def: 'Audit trail review' },
      { k: 'periodFrom', label: 'Period from', type: 'date', req: true },
      { k: 'periodTo', label: 'Period to', type: 'date', req: true },
      { k: 'scope', label: 'Modules reviewed (none ticked = all modules and system events such as sign-ins and user changes)', type: 'multicheck', options: [] },
      sec('Review and outcome', { edit: { 'Under Review': ['qa'] } }),
      { k: 'reviewer', label: 'Reviewer (QA)', type: 'user' },
      { k: 'findings', label: 'Findings (unexpected or late changes, changes without an adequate reason, failed sign-ins, access and role changes)', type: 'textarea', full: true },
      { k: 'anomalies', label: 'Outcome', type: 'select', options: ['No anomalies found', 'Anomalies found – deviation or CAPA raised'] },
      { k: 'investigationRef', label: 'Deviation / CAPA raised', type: 'recordref', refTypes: ['investigations', 'capa'] },
      { k: 'conclusion', label: 'Conclusion', type: 'textarea', full: true }
    ],
    states: ['Planned', 'Under Review', 'QA Approval', 'Approved'],
    transitions: [
      t('Planned', 'Under Review', 'Start review – compile the audit trail summary', ['qa'], { needs: ['periodFrom', 'periodTo'], checks: ['atrPeriod'] }),
      t('Under Review', 'QA Approval', 'Sign review', ['qa'], { sign: 'Reviewed – audit trail reviewer', needs: ['findings', 'anomalies', 'conclusion'], checks: ['atrOutcome'] }),
      t('QA Approval', 'Under Review', 'Return to reviewer', ['qa'], { reason: true }),
      t('QA Approval', 'Approved', 'Approve review', ['qa'], { sign: 'Approved – QA', sodWith: 'Reviewed' })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
