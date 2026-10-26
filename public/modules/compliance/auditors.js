/* Module "Qualified auditors" (Compliance). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPTS, DEPT_CODES, t } = Q;
  MODULES.auditors = {
    name: 'Qualified auditors', single: 'qualified auditor', group: 'Compliance', prefix: 'AUDR',
    intro: 'List of qualified auditors (JRS/FRM/QAS/039 for self-inspections, JRS/FRM/QAS/043 for supplier audits). Only qualified auditors can be assigned to an audit.',
    numbering: () => ({ pre: 'AUDR-', pad: 3 }),
    list: ['number', 'auditor', 'department', 'designation', 'scope', 'status'],
    fields: [
      { k: 'auditor', label: 'Auditor', type: 'user', req: true, lock: true },
      { k: 'department', label: 'Department', type: 'select', req: true, options: DEPT_CODES, optionLabels: DEPTS },
      { k: 'designation', label: 'Designation', type: 'text', req: true },
      { k: 'experience', label: 'Experience (years)', type: 'number', req: true },
      { k: 'scope', label: 'Qualified for', type: 'multicheck', req: true, options: ['Self-inspection (FRM/QAS/039)', 'Supplier audit (FRM/QAS/043)'] },
      { k: 'basis', label: 'Qualification basis (education, audit training, audits observed or led)', type: 'textarea', req: true, full: true }
    ],
    states: ['Proposed', 'Qualified', 'Withdrawn'],
    transitions: [
      t('Proposed', 'Qualified', 'Approve – add to list of qualified auditors', ['qa'], { sign: 'Approved – Head of Quality', sod: true }),
      t('Qualified', 'Withdrawn', 'Withdraw from list', ['qa'], { sign: 'Withdrawn', reason: true }),
      t('Withdrawn', 'Proposed', 'Propose again', ['qa'], { reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
