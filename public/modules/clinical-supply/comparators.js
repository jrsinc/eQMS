/* Module "Comparator sourcing" (Clinical supply). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t } = Q;
  MODULES.comparators = {
    name: 'Comparator sourcing', group: 'Clinical supply', prefix: 'CSR',
    intro: 'Sourcing of marketed comparators from qualified sources, with receipt and authenticity checks.',
    list: ['number', 'title', 'study', 'quantity', 'neededBy', 'status'],
    fields: [
      { k: 'title', label: 'Comparator (INN / brand, strength, pack)', type: 'text', req: true, full: true },
      { k: 'study', label: 'Study / protocol no.', type: 'text', req: true },
      { k: 'quantity', label: 'Quantity (packs)', type: 'number', req: true },
      { k: 'market', label: 'Market / country of origin', type: 'text' },
      { k: 'minExpiry', label: 'Minimum required expiry', type: 'date' },
      { k: 'neededBy', label: 'Needed by', type: 'date' },
      { k: 'vendor', label: 'Source vendor (must be Approved)', type: 'text' },
      { k: 'lot', label: 'Lot(s) received', type: 'text' },
      { k: 'expiry', label: 'Expiry of received lot', type: 'date' },
      { k: 'docs', label: 'Receipt documents', type: 'multicheck', options: ['CoA / CoC', 'Pedigree / supply chain', 'Temperature data', 'Import licence', 'FMD decommissioned', 'Invoice'] },
      { k: 'authenticity', label: 'Authenticity / integrity inspection result', type: 'textarea', full: true },
      { k: 'manipulation', label: 'Manipulation planned (over-encapsulation, de-blistering) – CC no.', type: 'text' }
    ],
    states: ['Requested', 'Sourcing', 'Received – Quarantine', 'Released', 'Rejected'],
    transitions: [
      t('Requested', 'Sourcing', 'Approve request', ['cs', 'qa'], { sign: 'Approved' }),
      t('Sourcing', 'Received – Quarantine', 'Record receipt', ['cs'], { needs: ['lot', 'vendor'] }),
      t('Received – Quarantine', 'Released', 'QA release for use', ['qa'], { sign: 'Released', sod: true, needs: ['authenticity'] }),
      t('Received – Quarantine', 'Rejected', 'Reject', ['qa'], { sign: 'Rejected', reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
