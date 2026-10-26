/* Module "Certified trainers" (Documents & training). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPTS, DEPT_CODES, t, TRAINER_PARAMS, TRAINER_PASS } = Q;
  MODULES.trainers = {
    name: 'Certified trainers', single: 'trainer assessment', group: 'Documents & training', prefix: 'TRC',
    intro: 'Trainer assessment (FRM/QAS/032) and list of certified trainers (FRM/QAS/033) per JRS/SOP/QAS/003. Only certified trainers deliver and evaluate training.',
    numbering: () => ({ pre: 'TRC-', pad: 3 }),
    list: ['number', 'trainer', 'department', 'topics', 'total', 'status'],
    fields: [
      { k: 'trainer', label: 'Name of trainer', type: 'user', req: true, lock: true },
      { k: 'department', label: 'Department', type: 'select', req: true, options: DEPT_CODES, optionLabels: DEPTS },
      { k: 'qualification', label: 'Qualification', type: 'text', req: true },
      { k: 'experience', label: 'Experience', type: 'text', req: true },
      { k: 'topics', label: 'Training topics', type: 'text', req: true, full: true },
      { k: 'observer', label: 'Observer', type: 'user' },
      ...TRAINER_PARAMS.map(([k, label, max]) => ({ k, label: `${label} (max. ${max})`, type: 'number' })),
      { k: 'total', label: `Total (of 100; pass mark ${TRAINER_PASS})`, type: 'computed' }
    ],
    compute: { total: (d) => { const n = TRAINER_PARAMS.reduce((a, [k]) => a + (+d[k] || 0), 0); return n ? `${n} – ${n >= TRAINER_PASS ? 'meets acceptance criteria' : 'below acceptance criteria'}` : ''; } },
    states: ['Assessment', 'Head of Quality Approval', 'Certified', 'Withdrawn'],
    transitions: [
      t('Assessment', 'Head of Quality Approval', 'Submit assessment (Head of Department)', ['hod'], { sign: 'Prepared – Head of Department', checks: ['trainerScores'] }),
      t('Head of Quality Approval', 'Assessment', 'Return', ['qa'], { reason: true }),
      t('Head of Quality Approval', 'Certified', 'Approve – add to certified trainer list', ['qa'], { sign: 'Approved – Head of Quality', sod: true, checks: ['trainerScores'] }),
      t('Certified', 'Withdrawn', 'Withdraw', ['qa'], { sign: 'Withdrawn – QA', reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
