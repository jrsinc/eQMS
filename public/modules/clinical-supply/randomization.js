/* Module "Kit randomization" (Clinical supply). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t } = Q;
  MODULES.randomization = {
    name: 'Kit randomization', group: 'Clinical supply', prefix: 'RND',
    intro: 'Kit-level block randomization lists with seed, dual approval and blinded views.',
    list: ['number', 'title', 'study', 'kits', 'status'],
    fields: [
      { k: 'title', label: 'List description', type: 'text', req: true, full: true },
      { k: 'study', label: 'Study / protocol no.', type: 'text', req: true },
      { k: 'arms', label: 'Treatment codes (comma-separated)', type: 'text', req: true, def: 'A,B' },
      { k: 'ratio', label: 'Allocation ratio (e.g. 1:1 or 2:1)', type: 'text', req: true, def: '1:1' },
      { k: 'blockSize', label: 'Block size', type: 'number', req: true, def: 4 },
      { k: 'kits', label: 'Number of kits', type: 'number', req: true, def: 100 },
      { k: 'startKit', label: 'First kit number', type: 'number', def: 1001 },
      { k: 'seed', label: 'Seed (blank = system generated)', type: 'text' },
      { k: 'checksum', label: 'List checksum (SHA-256)', type: 'readonly' }
    ],
    states: ['Draft', 'Generated', 'Approved', 'Released to IRT', 'Withdrawn'],
    transitions: [
      t('Generated', 'Approved', 'Approve list (second person)', ['unblinded', 'qa'], { sign: 'Approved', sod: true, needsList: true }),
      t('Approved', 'Released to IRT', 'Release to IRT', ['unblinded'], { sign: 'Released' }),
      t('Generated', 'Draft', 'Discard list', ['unblinded'], { reason: true }),
      t('Approved', 'Withdrawn', 'Withdraw', ['qa'], { sign: 'Approved', reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
