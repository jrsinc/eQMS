/* Module "Self-inspection schedule" (Compliance). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPT_CODES, t, MONTHS } = Q;
  MODULES.sischedule = {
    name: 'Self-inspection schedule', single: 'self-inspection schedule', group: 'Compliance', prefix: 'SIS',
    intro: 'Annual risk-based self-inspection schedule (JRS/SOP/QAS/004, form JRS/FRM/QAS/038): at least four self-inspections a year, high-risk areas first, approved by the Head of Quality by the end of January.',
    numbering: (d) => ({ fixed: `SIS-${d.year}` }),
    list: ['number', 'year', 'approveBy', 'status'],
    fields: [
      { k: 'year', label: 'Year', type: 'number', req: true, lock: true },
      { k: 'approveBy', label: 'Approval deadline', type: 'computed' },
      { k: 'riskRef', label: 'Risk assessment used for scheduling (JRS/SOP/QAS/020)', type: 'recordref', refTypes: ['risks'] },
      { k: 'riskBasis', label: 'Risk basis (personnel, premises, equipment, documentation, packaging, distribution, previous findings)', type: 'textarea', full: true },
      { k: 'plan', label: 'Schedule', type: 'table', full: true, cols: [{ k: 'dept', label: 'Section / department', options: DEPT_CODES }, { k: 'month', label: 'Planned month', options: MONTHS }, { k: 'start', label: 'Audit start date', type: 'date' }, { k: 'end', label: 'Audit end date', type: 'date' }, { k: 'remarks', label: 'Remarks' }] }
    ],
    compute: { approveBy: (d) => d.year ? `Approve by ${d.year}-01-31` : '' },
    states: ['Draft', 'Approved'],
    transitions: [
      t('Draft', 'Approved', 'Approve schedule', ['qa'], { sign: 'Approved – Head of Quality', sod: true, needs: ['plan'], checks: ['sisMinimum'] }),
      t('Approved', 'Draft', 'Revise schedule (addendum)', ['qa'], { reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
