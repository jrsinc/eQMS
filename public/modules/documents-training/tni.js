/* Module "Training need identification" (Documents & training). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPTS, DEPT_CODES, t, sec, TRAINING_TYPES } = Q;
  MODULES.tni = {
    name: 'Training need identification', single: 'training need identification', group: 'Documents & training', prefix: 'TNI',
    intro: 'Training need identification per JRS/SOP/QAS/003 (FRM/QAS/030) and training certificate (FRM/QAS/031). Prepared by the Head of Department, approved by the Head of Quality; must include QA SOPs. Approval assigns the training; the certificate is effective on the Head of Quality signature.',
    list: ['number', 'employee', 'department', 'designation', 'status'],
    fields: [
      sec('Employee details'),
      { k: 'employee', label: 'Employee', type: 'user', req: true, lock: true },
      { k: 'dateJoining', label: 'Date of joining', type: 'date' },
      { k: 'designation', label: 'Designation', type: 'text', req: true },
      { k: 'department', label: 'Department', type: 'select', req: true, options: DEPT_CODES, optionLabels: DEPTS },
      { k: 'reason', label: 'Reason', type: 'select', req: true, options: ['New joiner (induction)', 'Transfer / new responsibilities', 'Return after more than 3 months leave', 'Annual retraining', 'Other'] },
      sec('Training needs (FRM/QAS/030)'),
      { k: 'plan', label: 'Training subjects', type: 'table', full: true, cols: [{ k: 'subject', label: 'Training subject' }, { k: 'refDoc', label: 'Reference SOP / document no.', ref: ['documents'] }, { k: 'type', label: 'Type', options: TRAINING_TYPES }] },
      sec('Training certificate (FRM/QAS/031)'),
      { k: 'area', label: 'Qualified to carry out activities in (area / section)', type: 'text', full: true },
      { k: 'certificateDate', label: 'Certificate effective date (Head of Quality signature)', type: 'readonly', fmt: 'date' }
    ],
    states: ['Draft', 'Head of Quality Approval', 'Training In Progress', 'Certificate Issued', 'Certified'],
    transitions: [
      t('Draft', 'Head of Quality Approval', 'Prepare TNI (Head of Department)', ['hod'], { sign: 'Prepared – Head of Department', needs: ['plan'], checks: ['tniPlan'] }),
      t('Head of Quality Approval', 'Draft', 'Return to Head of Department', ['qa'], { reason: true }),
      t('Head of Quality Approval', 'Training In Progress', 'Approve TNI – assign training', ['qa'], { sign: 'Approved – Head of Quality', sod: true }),
      t('Training In Progress', 'Certificate Issued', 'Issue training certificate (line manager)', ['hod'], { sign: 'Certificate issued – line manager', needs: ['area'], checks: ['tniDone'] }),
      t('Certificate Issued', 'Certified', 'Approve certificate (Head of Quality)', ['qa'], { sign: 'Certificate approved – Head of Quality' })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
