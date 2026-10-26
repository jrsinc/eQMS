/* Module "Secondary packaging" (Clinical supply). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t } = Q;
  MODULES.packaging = {
    name: 'Secondary packaging', group: 'Clinical supply', prefix: 'PKG',
    intro: 'Packaging jobs with line clearance, reconciliation and QP certification.',
    list: ['number', 'title', 'study', 'kits', 'status'],
    fields: [
      { k: 'title', label: 'Packaging job description', type: 'text', req: true, full: true },
      { k: 'study', label: 'Study / protocol no.', type: 'text', req: true },
      { k: 'randList', label: 'Randomization list no.', type: 'text', req: true },
      { k: 'labelRef', label: 'Approved label no.', type: 'text', req: true },
      { k: 'kits', label: 'Number of kits', type: 'number', req: true },
      { k: 'mpi', label: 'Master packaging instruction no.', type: 'text' },
      { k: 'lineClearStart', label: 'Line clearance before job (second-person verified)', type: 'checkbox' },
      { k: 'issued', label: 'Labels issued', type: 'number' },
      { k: 'used', label: 'Labels used', type: 'number' },
      { k: 'damaged', label: 'Labels damaged / destroyed', type: 'number' },
      { k: 'returned', label: 'Labels returned', type: 'number' },
      { k: 'reconciliation', label: 'Reconciliation result (computed)', type: 'computed' },
      { k: 'blindCheck', label: 'Blinding integrity check (appearance, weight)', type: 'textarea', full: true },
      { k: 'lineClearEnd', label: 'Line clearance after job', type: 'checkbox' }
    ],
    compute: { reconciliation: (d) => { if (!d.issued) return ''; const diff = (+d.issued) - (+d.used || 0) - (+d.damaged || 0) - (+d.returned || 0); return diff === 0 ? 'Balanced (0)' : 'Discrepancy (' + diff + ') – raise deviation'; } },
    states: ['Planned', 'In Progress', 'Reconciled', 'QP Certified', 'Rejected'],
    transitions: [
      t('Planned', 'In Progress', 'Start job (line cleared)', ['cs'], { sign: 'Verified', needs: ['lineClearStart'] }),
      t('In Progress', 'Reconciled', 'Complete reconciliation', ['cs'], { sign: 'Verified', needs: ['issued', 'lineClearEnd'], checkRecon: true }),
      t('Reconciled', 'QP Certified', 'QP certify', ['qa'], { sign: 'QP certified', sod: true }),
      t('Reconciled', 'Rejected', 'Reject batch', ['qa'], { sign: 'Rejected', reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
