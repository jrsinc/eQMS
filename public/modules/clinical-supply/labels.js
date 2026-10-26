/* Module "Label design" (Clinical supply). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t } = Q;
  MODULES.labels = {
    name: 'Label design', group: 'Clinical supply', prefix: 'LBL',
    intro: 'Clinical label templates with variable fields, multi-step approval and controlled printing.',
    list: ['number', 'title', 'study', 'country', 'version', 'status'],
    fields: [
      { k: 'title', label: 'Label name', type: 'text', req: true, full: true },
      { k: 'study', label: 'Study / protocol no.', type: 'text', req: true },
      { k: 'country', label: 'Country / language', type: 'text', req: true },
      { k: 'version', label: 'Version', type: 'text', def: '1.0' },
      { k: 'sponsor', label: 'Sponsor name and address', type: 'textarea', full: true },
      { k: 'template', label: 'Label text – use {KIT}, {BATCH}, {EXPIRY}, {PROTOCOL}, {SPONSOR}', type: 'textarea', full: true, rows: 9,
        def: 'For clinical trial use only\nProtocol: {PROTOCOL}\nKit no.: {KIT}\nBatch: {BATCH}\nUse by: {EXPIRY}\nTake as directed by the study doctor.\nStore below 25 °C. Keep out of the sight and reach of children.\nSponsor: {SPONSOR}' },
      { k: 'width', label: 'Label width (mm)', type: 'number', def: 90 },
      { k: 'height', label: 'Label height (mm)', type: 'number', def: 50 },
      { k: 'translation', label: 'Translation / back-translation reference', type: 'text' }
    ],
    states: ['Draft', 'Regulatory Review', 'Sponsor Approval', 'QA Approval', 'Approved', 'Retired'],
    transitions: [
      t('Draft', 'Regulatory Review', 'Submit for review', ['cs', 'author']),
      t('Regulatory Review', 'Sponsor Approval', 'Regulatory approve', ['sme', 'qa'], { sign: 'Reviewed – regulatory' }),
      t('Sponsor Approval', 'QA Approval', 'Record sponsor approval', ['cs'], { sign: 'Sponsor approval recorded' }),
      t('QA Approval', 'Approved', 'QA approve – lock artwork', ['qa'], { sign: 'Approved', sod: true }),
      t('Regulatory Review', 'Draft', 'Return', ['sme', 'qa'], { reason: true }),
      t('QA Approval', 'Draft', 'Reject', ['qa'], { reason: true }),
      t('Approved', 'Retired', 'Retire', ['qa'], { sign: 'Approved', reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
