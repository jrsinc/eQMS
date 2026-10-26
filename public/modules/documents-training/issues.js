/* Module "Document issuance" (Documents & training). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t } = Q;
  MODULES.issues = {
    name: 'Document issuance', group: 'Documents & training', prefix: 'ISS',
    intro: 'Controlled issue of SOPs, forms, logbooks and batch records with an issue stamp on every page.',
    list: ['number', 'docNumber', 'title', 'copies', 'returnBy', 'status'],
    fields: [
      { k: 'docNumber', label: 'Document no. to issue (must be Effective)', type: 'text', req: true },
      { k: 'title', label: 'Document title (filled automatically)', type: 'readonly' },
      { k: 'docVersion', label: 'Version issued (filled automatically)', type: 'readonly' },
      { k: 'copyType', label: 'Copy type (JRS/SOP/QAS/021)', type: 'select', req: true, options: ['Controlled copy (department display / reference)', 'Uncontrolled copy (customer / external / authorised person)', 'Form issued by QA (ISSUED BY QA, FRM/QAS/050)', 'Bound logbook (pre-numbered pages)'] },
      { k: 'copies', label: 'Number of copies', type: 'number', req: true, def: 1 },
      { k: 'issuedTo', label: 'Issued to (username)', type: 'user', req: true },
      { k: 'purpose', label: 'Purpose / batch / lot / equipment', type: 'text', req: true, full: true },
      { k: 'returnBy', label: 'Return by', type: 'date', req: true },
      { k: 'returned', label: 'Copies returned (completed)', type: 'number' },
      { k: 'destroyed', label: 'Copies returned unused and destroyed', type: 'number' },
      { k: 'reconciliation', label: 'Reconciliation (computed)', type: 'computed' },
      { k: 'notes', label: 'Return notes (scan of completed form attached below)', type: 'textarea', full: true }
    ],
    compute: { reconciliation: (d) => { if (!d.copies) return ''; const diff = (+d.copies) - (+d.returned || 0) - (+d.destroyed || 0); return diff === 0 ? 'Balanced (0)' : diff > 0 ? 'Outstanding (' + diff + ')' : 'Discrepancy (' + diff + ') – raise deviation'; } },
    states: ['Requested', 'Approved', 'Issued', 'Returned', 'Reconciled', 'Voided'],
    transitions: [
      t('Requested', 'Approved', 'Approve issue', ['qa'], { sign: 'Approved for issue', sod: true }),
      t('Requested', 'Voided', 'Reject request', ['qa'], { reason: true }),
      t('Issued', 'Returned', 'Record return', ['qa', 'any'], { needs: ['returned'] }),
      t('Returned', 'Reconciled', 'Reconcile and close', ['qa'], { sign: 'Reconciled', checkRecon: true }),
      t('Issued', 'Voided', 'Void issue (lost / withdrawn)', ['qa'], { sign: 'Voided', reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
