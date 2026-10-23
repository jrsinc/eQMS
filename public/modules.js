/* QualiSuite eQMS — shared configuration (browser + Node).
 * Every module is defined here: fields, workflow states, transitions,
 * which roles may perform them and which require an e-signature.
 * Edit this file to configure the system; both server and UI read it. */
(function (root) {
  // Main roles: admin and management have all access; QA approves and assigns all record numbers;
  // department staff (Operation, Packaging, IT, HR …) hold the general role and belong to a department.
  // 'hod' and 'numgen' are not assigned by hand: Heads of Department come from the organogram and QA assigns numbers.
  // The other roles are additional permissions for specific modules.
  const ROLES = {
    admin: 'System administrator (all access)',
    mgmt: 'Management (all access)',
    qa: 'QA (reviews, approvals and record number assignment)',
    user: 'Department user (raise deviations / complaints, write reports)',
    rp: 'Responsible Person (GDP)',
    author: 'Document author / owner',
    sme: 'Department reviewer / SME',
    cs: 'Clinical supply manager',
    unblinded: 'Unblinded randomization officer',
    trainer: 'Training coordinator',
    auditor: 'Internal auditor',
    pm: 'Project Manager (client communication)',
    extaud: 'External auditor / inspector (read-only)',
    hod: 'Head of Department (set in the organogram)',
    numgen: 'Record number assignment (all QA users)'
  };
  const MAIN_ROLES = ['admin', 'mgmt', 'qa', 'user'], DERIVED_ROLES = ['hod', 'numgen'];

  const CLASS = ['Critical', 'Major', 'Minor'];
  const SITES = ['JRS INC', 'JRS IND', 'JRS INC SMT'];
  // Departments are maintained in the eQMS (System → Departments). Their codes also form CAPA numbers (JRS/SOP/QAS/006)
  // and document division codes (JRS/SOP/QAS/021). Every select field refers to these two objects, so they are
  // updated in place when the department list changes (setDepartments).
  const DEPTS = {
    OPS: 'OPS – Operation', HRM: 'HRM – HR', PKG: 'PKG – Packaging', QAS: 'QAS – QA', ITS: 'ITS – IT'
  };
  const DEPT_CODES = Object.keys(DEPTS);
  const setDepartments = (list) => {
    for (const k of Object.keys(DEPTS)) delete DEPTS[k];
    DEPT_CODES.length = 0;
    for (const d of list) { DEPTS[d.code] = d.code + ' – ' + d.name + (d.active === 0 || d.active === false ? ' (inactive)' : ''); DEPT_CODES.push(d.code); }
  };
  const EC_DUE = ['3 months', '6 months', '9 months', '12 months', 'Not applicable'];

  // Helpers shared by browser and server (dates are ISO yyyy-mm-dd, calculated in UTC)
  const t = (from, to, label, roles, opts = {}) => ({ from, to, label, roles, ...opts });
  // Form section. opts: part (links signatures of transitions with the same part), create (shown on the new-record form),
  // edit ({ state: [roles | 'initiator'] } – who may change the section's fields in which state)
  const sec = (label, opts = {}) => ({ type: 'section', label, ...opts });
  const iso = (d) => d.toISOString().slice(0, 10);
  const plusDays = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
  const dayDiff = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 864e5);
  const todayIso = () => iso(new Date());
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // JRS/SOP/QAS/020 Appendix 2, RPN = S × O × D (1–125). Bands made contiguous: Minor 1–19, Moderate 20–44, Major 45–79, Critical 80–125
  const rpnLevel = (n) => !n ? '' : n >= 80 ? 'Critical' : n >= 45 ? 'Major' : n >= 20 ? 'Moderate' : 'Minor';
  const score = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 0; };
  const fmeaRow = (r) => {
    const n = score(r.s) * score(r.o) * score(r.d), p = score(r.ps) * score(r.po) * score(r.pd);
    return { rpn: n ? String(n) : '', level: rpnLevel(n), prpn: p ? String(p) : '', plevel: rpnLevel(p) };
  };

  // JRS/SOP/QAS/021 document types and number codes (JRS/SOP/DIV/XXX, JRS/POL/…, JRS/WI/…, JRS/FRM/…)
  const DOC_CODES = { SOP: 'SOP', Policy: 'POL', 'Work Instruction': 'WI', Form: 'FRM' };
  // JRS/SOP/QAS/003
  const TRAINING_TYPES = ['Induction', 'SOP training – read & understand', 'SOP training – instructor-led', 'On-the-job training', 'GMP / GDP / GCP', 'Annual refresher', 'Retraining', 'Self-reading (Manager and above)', 'Qualification / validation protocol', 'Other'];
  const PASS_MARK = 80;
  const trainingScore = (d) => {
    const q = (d.questions || []).filter(x => +x.marks > 0);
    if (!q.length) return null;
    return Math.round(100 * q.reduce((a, x) => a + (+x.obtained || 0), 0) / q.reduce((a, x) => a + +x.marks, 0));
  };
  // FRM/QAS/032 trainer assessment; the SOP defines no pass mark – 70 of 100 is used until QA defines one
  const TRAINER_PARAMS = [['p1', 'Educated, qualified and experienced in cGMP and the pharmaceutical quality system', 10], ['p2', 'Skilled and well-behaved towards trainees', 10],
    ['p3', 'SME / fluency of languages', 10], ['p4', 'Experience, technical competence, confidence', 10], ['p5', 'Delivers the content, good speaker, answers questions', 20],
    ['p6', 'Teaches to learning objectives with appropriate techniques', 20], ['p7', 'Overall technical competency', 20]];
  const TRAINER_PASS = 70;
  // JRS/SOP/QAS/012 §5.4.6 retention matrix (years from archival, or Permanent)
  const RETENTION = {
    'List of SOPs / forms / WI / policies': 15, 'SOPs / WI / forms / policies (current and obsolete)': 15, 'Contracts / agreements (clients, vendors, consultants)': 'Permanent',
    'Facility layout': 15, 'Equipment qualification protocols / reports': 15, 'Essential documents (Quality Manual, BCP, approved vendor / customer lists, audits, logs)': 15,
    'HR employee files': 15, 'Training records and employee training files': 15, 'QMS records (change control, deviations, CAPA, complaints, logs)': 15,
    'Calibration records and equipment validation reports': 15, 'Pest control records': 15, 'Product recall reports': 15,
    'Project-specific files (project manual, packaging records, label proofs, shipment and receipt documents)': 15, 'Temperature records': 15,
    'Mock recall reports': 15, 'Data archived electronically': 15
  };

  // JRS/SOP/QAS/005 Attachment 1 – supplier risk assessment: RPN = severity × occurrence × detection (1–125)
  const SUP_SEVERITY = { 5: '5 – Catastrophic', 4: '4 – High risk', 3: '3 – Moderate risk', 2: '2 – Low risk', 1: '1 – Negligible' };
  const SUP_OCCURRENCE = { 5: '5 – Frequent', 4: '4 – Probable', 3: '3 – Occasional', 2: '2 – Remote', 1: '1 – Unlikely' };
  const SUP_DETECTION = { 5: '5 – Very low', 4: '4 – Low', 3: '3 – Moderate', 2: '2 – High', 1: '1 – Very high' };
  // scoring criteria of JRS/SOP/QAS/005 Attachment 1, shown with the three scores
  const SUP_GUIDE = [
    ['Severity – criticality of the material / service and impact on end product quality', [
      ['5 Catastrophic', 'Most important to product quality: API, excipients for parenteral products, any material sourced from (or with supply chain in) a high-risk location'],
      ['4 High risk', 'Lower impact on product quality but associated with regulatory requirements: primary packaging, non-sterile excipients, regulated printed packaging, depot service provider'],
      ['3 Moderate risk', 'Loss of operating capability, management intervention required: logistics, validation, comparator product supplier, CSV, specialty courier, validated shipping system, IRT'],
      ['2 Low risk', 'Impact on operations and efficiency, not pervasive: ancillary material, destruction, pest control, calibration, preventive maintenance, secondary material'],
      ['1 Negligible', 'Limited or no impact: housekeeping, fire safety equipment maintenance, tertiary packing material']]],
    ['Occurrence – supply history and status of the supplier\'s quality system', [
      ['5 Frequent', '> 90 % – expected to occur in most circumstances'], ['4 Probable', '60–89 % – will probably occur in most circumstances'],
      ['3 Occasional', '25–59 % – will probably occur at some time'], ['2 Remote', '10–24 % – could occur at some time'], ['1 Unlikely', '< 10 % – may occur in exceptional circumstances']]],
    ['Detection – possibility of detecting a quality failure and the stage at which it is detected', [
      ['5 Very low', 'No known control to detect the failure, or very low probability of detection'], ['4 Low', 'Low probability of detection; failure not functionally obvious but can be detected'],
      ['3 Moderate', 'Moderate probability of detection; failure not obvious but easily detected'], ['2 High', 'High probability of detection; failure obvious but may not be detected immediately'],
      ['1 Very high', 'Detection almost certain; failure promptly and readily detected']]],
    ['Risk ranking – RPN = severity × occurrence × detection', [
      ['80–125 Catastrophic', 'Supplier questionnaire and site audit – every two years'], ['45–75 High risk', 'Site audit – every three years'],
      ['20–40 Moderate risk', 'Questionnaire based audit – every five years'], ['1–18 Low risk', 'Certificate verification – annually or as needed']]]
  ];
  // risk ranking table of the SOP (products of 1–5 scores fall in these bands)
  const supRisk = (d) => {
    const rpn = (+d.severity || 0) * (+d.occurrence || 0) * (+d.detection || 0);
    if (!rpn) return { rpn: 0, level: '', audit: '', frequency: '', months: 0 };
    return rpn >= 80 ? { rpn, level: 'Catastrophic', audit: 'Supplier questionnaire and site audit', frequency: 'Every two years', months: 24 }
      : rpn >= 45 ? { rpn, level: 'High risk', audit: 'Site audit', frequency: 'Every three years', months: 36 }
      : rpn >= 20 ? { rpn, level: 'Moderate risk', audit: 'Questionnaire based audit', frequency: 'Every five years', months: 60 }
      : { rpn, level: 'Low risk', audit: 'Certificate verification', frequency: 'Annually or as needed', months: 12 };
  };

  const RISK_STAGES = ['Risk Assessment', 'HOD Review'];

  const MODULES = {
    documents: {
      name: 'Documents', single: 'document', group: 'Documents & training', prefix: 'DOC',
      intro: 'Controlled SOPs, policies, work instructions and forms per JRS/SOP/QAS/021 (templates FRM/QAS/046 and 047, list of controlled documents FRM/QAS/048). Number JRS/type/division/serial; numbers are never reused.',
      numbering: (d) => ({ pre: `JRS/${DOC_CODES[d.docType]}/${d.division}/`, pad: 3 }),
      list: ['number', 'version', 'title', 'docType', 'effectiveDate', 'nextReview', 'status'],
      fields: [
        sec('Document', { edit: { Draft: ['initiator', 'qa'] } }),
        { k: 'docType', label: 'Document type', type: 'select', req: true, lock: true, options: Object.keys(DOC_CODES) },
        { k: 'division', label: 'Division (sets the document number)', type: 'select', req: true, lock: true, options: DEPT_CODES, optionLabels: DEPTS },
        { k: 'title', label: 'Title (stored in capitals; [GLB] added when it applies to more than one site)', type: 'text', req: true, full: true },
        { k: 'sites', label: 'Applicable site(s)', type: 'multicheck', req: true, options: SITES },
        { k: 'relatedSop', label: 'Related SOP (forms)', type: 'recordref', refTypes: ['documents'] },
        { k: 'version', label: 'Version', type: 'readonly' },
        { k: 'revisionType', label: 'Revision type', type: 'readonly' },
        { k: 'changeControl', label: 'Change control no. (required for a revision with technical or procedural changes)', type: 'recordref', refTypes: ['changes'] },
        { k: 'revisionSummary', label: 'Reason for issue / summary of changes (revision history)', type: 'textarea', full: true },
        { k: 'reviewer', label: 'Reviewer (SME / Head of Department)', type: 'user', req: true },
        { k: 'crossDepts', label: 'Cross-functional review – departments whose function is affected', type: 'multicheck', options: DEPT_CODES, optionLabels: DEPTS },
        { k: 'trainingImpact', label: 'Training before the effective date', type: 'select', req: true, options: ['Read & Understand', 'Instructor-led', 'Assessment required', 'None'] },
        { k: 'trainingRoles', label: 'Roles to be trained', type: 'multicheck', options: Object.keys(ROLES) },
        { k: 'content', label: 'Document content (or attach the approved Word / PDF file below)', type: 'textarea', full: true, rows: 10 },
        sec('Approval and effective date', { edit: { Draft: ['initiator', 'qa'], Approval: ['qa'] } }),
        { k: 'effectiveDate', label: 'Effective date (at least 8 calendar days after approval)', type: 'date' },
        { k: 'shortNotice', label: 'QA justification if effective in less than 8 days', type: 'textarea', full: true },
        { k: 'nextReview', label: 'Periodic review due (3 years from effective date)', type: 'readonly', fmt: 'date' },
        { k: 'sharepointUrl', label: 'SharePoint link (published copy)', type: 'readonly' }
      ],
      states: ['Draft', 'In Review', 'QA Review', 'Approval', 'Approved – Training', 'Effective', 'Superseded', 'Obsolete'],
      transitions: [
        t('Draft', 'In Review', 'Submit for review', ['any'], { sign: 'Prepared – author', needs: ['reviewer', 'sites', 'revisionSummary'], checks: ['isInitiator', 'docRevisionCC'] }),
        t('In Review', 'Draft', 'Return to author', ['any'], { reason: true, checks: ['isReviewer'] }),
        t('In Review', 'QA Review', 'Complete review', ['any'], { sign: 'Reviewed – SME / Head of Department', checks: ['isReviewer', 'deptApprovalsDone'] }),
        t('QA Review', 'Draft', 'Return to author', ['qa'], { reason: true }),
        t('QA Review', 'Approval', 'QA review complete (GDocP, format, numbering, regulatory)', ['qa'], { sign: 'Reviewed – QA' }),
        t('Approval', 'Draft', 'Reject', ['qa'], { reason: true }),
        t('Approval', 'Approved – Training', 'Approve document (Head QA)', ['qa'], { sign: 'Approved – Head QA', sod: true, sodWith: 'Reviewed – QA', needs: ['effectiveDate'], checks: ['docEffective8'] }),
        t('Approved – Training', 'Effective', 'Make effective', ['qa'], { sign: 'Made effective – QA', checks: ['docEffectiveToday', 'docTrainingDone'] }),
        t('Effective', 'Obsolete', 'Discontinue – make obsolete (link the approved change control first)', ['qa'], { sign: 'Made obsolete – QA', reason: true, checks: ['docDiscontinueCC'] })
      ],
      deptApproval: { state: 'In Review', field: 'crossDepts', label: 'Cross-functional review' }
    },

    training: {
      name: 'Training records', single: 'training record', group: 'Documents & training', prefix: 'TRN',
      intro: 'Training records per JRS/SOP/QAS/003: attendance (FRM/QAS/002) and assessment (FRM/QAS/034). Pass mark 80%; the training log is signed by both trainee and certified trainer; only trained personnel work independently.',
      list: ['number', 'trainee', 'title', 'trainingType', 'dueDate', 'status'],
      fields: [
        sec('Training (FRM/QAS/002)'),
        { k: 'trainee', label: 'Trainee', type: 'user', req: true },
        { k: 'title', label: 'Topic / subject of training', type: 'text', req: true, full: true },
        { k: 'docRef', label: 'Reference SOP / document no.', type: 'recordref', refTypes: ['documents'] },
        { k: 'docVersion', label: 'Document version', type: 'readonly' },
        { k: 'trainingType', label: 'Type of training', type: 'select', req: true, options: TRAINING_TYPES },
        { k: 'mode', label: 'Mode of training', type: 'select', options: ['Classroom', 'Online (remote)', 'Self-training', 'On-the-job'] },
        { k: 'trainer', label: 'Certified trainer (FRM/QAS/033)', type: 'user' },
        { k: 'dueDate', label: 'Due date', type: 'date', req: true },
        { k: 'trainingDate', label: 'Date of training', type: 'date' },
        { k: 'sourceRecord', label: 'Triggered by (TNI, CAPA, deviation, change control, audit)', type: 'recordref', refTypes: ['tni', 'capa', 'investigations', 'changes', 'selfinspections', 'extaudits', 'documents'] },
        { k: 'attempt', label: 'Attempt', type: 'readonly' },
        sec('Assessment (FRM/QAS/034)'),
        { k: 'assessment', label: 'Written assessment required', type: 'checkbox' },
        { k: 'questions', label: 'Questions', type: 'table', full: true, cols: [{ k: 'question', label: 'Question' }, { k: 'answer', label: 'Answer' }, { k: 'marks', label: 'Marks', type: 'number' }, { k: 'obtained', label: 'Marks obtained', type: 'number' }] },
        { k: 'score', label: 'Result', type: 'computed' },
        { k: 'gapTopic', label: 'Score 80–99%: trainee did not understand the procedure for … (topic explained again)', type: 'textarea', full: true },
        { k: 'notes', label: 'Notes', type: 'textarea', full: true }
      ],
      compute: { score: (d) => { const s = trainingScore(d); return s == null ? '' : `${s}% – ${s >= PASS_MARK ? 'Satisfactory (≥ 80%)' : 'Unsatisfactory (< 80%) – retraining required'}`; } },
      states: ['Assigned', 'In Progress', 'Trainer Evaluation', 'Completed', 'Failed', 'Cancelled'],
      transitions: [
        t('Assigned', 'In Progress', 'Start training', ['any'], { checks: ['isTrainee'] }),
        t('In Progress', 'Completed', 'Sign as read and understood (self-reading)', ['any'], { sign: 'Read and understood – trainee', checks: ['isTrainee', 'trSelfReading'] }),
        t('In Progress', 'Trainer Evaluation', 'Sign training log – trainee', ['any'], { sign: 'Trained – trainee', needs: ['trainer', 'trainingDate', 'mode'], checks: ['isTrainee', 'trNotSelfReading'] }),
        t('Trainer Evaluation', 'Completed', 'Evaluate and sign – certified trainer', ['any'], { sign: 'Evaluated – certified trainer', checks: ['isTrainer', 'certifiedTrainer', 'trPass'] }),
        t('Trainer Evaluation', 'Failed', 'Record unsatisfactory result (< 80%)', ['any'], { sign: 'Evaluated – certified trainer', checks: ['isTrainer', 'certifiedTrainer', 'trFail'] }),
        t('Failed', 'Assigned', 'Retrain and reassess', ['any'], { checks: ['isTrainer'] }),
        t('Assigned', 'Cancelled', 'Cancel', ['trainer', 'qa'], { reason: true })
      ]
    },

    tni: {
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
    },

    trainers: {
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
    },


    issues: {
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
    },

    archives: {
      name: 'Record archive', single: 'archived record', group: 'Documents & training', prefix: 'ARC',
      intro: 'Archival log per JRS/SOP/QAS/012 (FRM/QAS/028): records are verified, sealed and archived by QA each year, retained for 15 years (contracts permanently, or as the customer requests), retrieved on request and returned within 7 working days, and destroyed by QA after the retention period.',
      list: ['number', 'title', 'recordType', 'boxId', 'destroyFrom', 'status'],
      fields: [
        sec('Record', { edit: { 'Pending Archival': ['initiator', 'qa'] } }),
        { k: 'title', label: 'Document title', type: 'text', req: true, full: true },
        { k: 'recordType', label: 'Record type (retention matrix)', type: 'select', req: true, options: Object.keys(RETENTION) },
        { k: 'retention', label: 'Retention period', type: 'computed' },
        { k: 'mode', label: 'Kept as', type: 'select', req: true, options: ['Physical', 'Electronic', 'Physical and electronic'] },
        { k: 'version', label: 'Version no.', type: 'text' },
        { k: 'versionDate', label: 'Version date', type: 'date' },
        { k: 'uniqueId', label: 'Unique ID', type: 'text', req: true },
        { k: 'boxId', label: 'Box ID', type: 'text' },
        { k: 'location', label: 'Storage location', type: 'select', req: true, options: ['On-site archive', 'Off-site storage (qualified vendor)', 'Electronic (restricted OneDrive / shared drive)'] },
        { k: 'vendor', label: 'Off-site storage vendor (must be approved)', type: 'recordref', refTypes: ['vendors'] },
        { k: 'client', label: 'Client (client-specific records)', type: 'text' },
        { k: 'clientRetention', label: 'Client-requested retention / destruction instruction', type: 'text', full: true },
        sec('Archival', { edit: { 'Pending Archival': ['qa'] } }),
        { k: 'verified', label: 'Department and QA checked signatures, completed entries and struck-off blanks; sealed and labelled', type: 'checkbox', full: true },
        { k: 'archivalDate', label: 'Archival date', type: 'date' },
        { k: 'destroyFrom', label: 'Eligible for destruction from', type: 'computed' },
        sec('Retrieval log (return within 7 working days)', { edit: { Archived: ['qa'], Retrieved: ['qa'] } }),
        { k: 'retrievals', label: 'Retrievals', type: 'table', full: true, cols: [{ k: 'date', label: 'Retrieval date', type: 'date' }, { k: 'by', label: 'Requested by' }, { k: 'purpose', label: 'Purpose' }, { k: 'returned', label: 'Return date', type: 'date' }, { k: 'rearchived', label: 'Re-archival date', type: 'date' }] },
        sec('Destruction', { edit: { Archived: ['qa'] } }),
        { k: 'destructionDate', label: 'Destruction date', type: 'date' },
        { k: 'destructionMethod', label: 'Method', type: 'select', options: ['Paper shredder', 'Secure electronic deletion'] }
      ],
      compute: {
        retention: (d) => { const r = RETENTION[d.recordType]; return !r ? '' : r === 'Permanent' ? 'Permanent' : `${r} years from archival` + (d.client ? ' (or as the client requests)' : ''); },
        destroyFrom: (d) => { const r = RETENTION[d.recordType]; return !r || !d.archivalDate ? '' : r === 'Permanent' ? 'Never (permanent)' : plusDays(d.archivalDate, Math.round(r * 365.25)); }
      },
      states: ['Pending Archival', 'Archived', 'Retrieved', 'Destroyed'],
      transitions: [
        t('Pending Archival', 'Archived', 'Archive – QA verified', ['qa'], { sign: 'Archived – QA verified', needs: ['verified', 'archivalDate'], checks: ['arLocation'] }),
        t('Archived', 'Retrieved', 'Release for retrieval (QA approved)', ['qa'], { sign: 'Retrieval approved – QA', checks: ['arRetrievalOpen'] }),
        t('Retrieved', 'Archived', 'Returned – re-archive', ['qa'], { sign: 'Re-archived – QA', checks: ['arRetrievalClosed'] }),
        t('Archived', 'Destroyed', 'Destroy (retention period ended)', ['qa'], { sign: 'Destroyed – QA', reason: true, needs: ['destructionDate', 'destructionMethod'], checks: ['arDestroy'] })
      ]
    },

    investigations: {
      name: 'Deviations & complaints', single: 'deviation or complaint', group: 'Quality events', prefix: 'INV',
      intro: 'Quality event investigations per JRS/SOP/QAS/022 (form JRS/FRM/QAS/054, register JRS/FRM/QAS/055). Deviation = event while the item is in JRS custody; complaint = event outside JRS custody reported by a customer, sponsor or other external party. A record is visible to its initiator, the responsible department and its Head, QA and management.',
      numbering: (d, y) => ({ pre: `JRS-${d.invType === 'Complaint' ? 'COM' : 'DEVN'}-${y}-`, pad: 3 }),
      list: ['number', 'invType', 'title', 'respDept', 'criticality', 'dueDate', 'status'],
      // only the people involved see a record: initiator, responsible person, responsible department and its Head (plus QA, admin, management)
      deptScoped: true,
      fields: [
        sec('Request to QA', { part: 'R', create: true, edit: { Requested: ['initiator', 'qa'], 'Request Update': ['initiator'] } }),
        { k: 'invType', label: 'Investigation type', type: 'select', req: true, lock: true, options: ['Deviation', 'Complaint'] },
        { k: 'site', label: 'Applicable JRS site', type: 'select', req: true, options: SITES },
        { k: 'title', label: 'Short description', type: 'text', req: true, full: true },
        { k: 'dateIdentified', label: 'Date identified / received', type: 'date', req: true },
        { k: 'respPerson', label: 'Responsible person (sets the responsible department)', type: 'user' },
        { k: 'respDept', label: 'Responsible department (department of the responsible person)', type: 'readonly', optionLabels: DEPTS },
        { k: 'qaNotified', label: 'Date reported to QA (request date)', type: 'readonly', fmt: 'date' },
        { k: 'reporting', label: '24-hour reporting to QA', type: 'computed' },
        { k: 'requestDetails', label: 'What happened – request details for QA', type: 'textarea', req: true, full: true },
        { k: 'requestNo', label: 'Request no.', type: 'readonly' },
        sec('Part A – Initiation (initiator / responsible department)', { part: 'A', edit: { Initiation: ['initiator', 'responsible', 'respdept'], 'Part A Update': ['initiator', 'responsible', 'respdept'] } }),
        { k: 'dateOpened', label: 'Date opened (number assigned)', type: 'readonly', fmt: 'date' },
        { k: 'dueDate', label: 'Date due (30 calendar days; Critical: 10 working days)', type: 'readonly', fmt: 'date' },
        { k: 'extendedDue', label: 'Extended due date (approved extension request)', type: 'readonly', fmt: 'date' },
        { k: 'eventOrigin', label: 'Event origin (area / process / party)', type: 'text', req: true },
        { k: 'receivedVia', label: 'Received via (if complaint)', type: 'select', options: ['Email', 'Phone', 'Fax', 'Customer portal', 'Letter', 'Other'] },
        { k: 'clientComplaintNo', label: 'Client complaint no. (if applicable)', type: 'text' },
        { k: 'reportingIndividual', label: 'Name of reporting individual', type: 'text' },
        { k: 'receivedBy', label: 'Complaint received by', type: 'user' },
        { k: 'customer', label: 'Customer / sponsor name', type: 'text' },
        { k: 'customerNotified', label: 'Customer / sponsor notified on', type: 'date' },
        { k: 'notifyStatus', label: 'Customer notification (3 calendar days)', type: 'computed' },
        { k: 'description', label: 'Detailed description', type: 'textarea', full: true },
        { k: 'immediate', label: 'Immediate action taken (containment, segregation, data and evidence preserved)', type: 'textarea', full: true },
        sec('Part B – QA review (locked once QA submits it)', { part: 'B', edit: { 'QA Review': ['qa'] } }),
        { k: 'criticality', label: 'Criticality (if unclear between two, assign the higher)', type: 'select', options: ['Minor', 'Major', 'Critical'] },
        { k: 'fieldAlert', label: 'Field alert report (if complaint)', type: 'select', options: ['No', 'Yes'] },
        { k: 'recall', label: 'Product recall', type: 'select', options: ['No', 'Yes – per JRS/SOP/OPS/013'] },
        { k: 'processStep', label: 'Process step', type: 'text' },
        { k: 'materialStatus', label: 'Current status of material', type: 'select', options: ['Quarantined / on hold', 'Available / released', 'Distributed', 'At investigator site', 'Returned', 'Destroyed', 'Not applicable'] },
        { k: 'impactedAreas', label: 'Impacted area(s) / function(s)', type: 'multicheck', options: ['Comparator sourcing', 'Clinical trial ancillary management', 'Warehousing', 'Receipt', 'Storage', 'Distribution', 'Packaging (kitting & assembly)', 'Returns management', 'Destruction'] },
        { k: 'impactedProducts', label: 'Impacted product(s)', type: 'multicheck', options: ['Blinded', 'Unblinded / open label', 'Randomized', 'Non-randomized', 'Shipper boxes', 'Ancillary supply', 'Bulk drug', 'Finished kit(s)', 'Comparator drug / NIMP', 'Labels', 'TempTale(s)', 'Other'] },
        { k: 'productDetails', label: 'Product / material details (name, lot, kit nos.)', type: 'text', full: true },
        { k: 'tempRange', label: 'Temperature range', type: 'select', options: ['Not applicable', 'Controlled ambient (+15 to +25 °C)', 'Cold chain / refrigerated (+2 to +8 °C)', 'Frozen (-25 to -15 °C)', 'Uncontrolled'] },
        { k: 'qaReviewComment', label: 'QA review comment', type: 'textarea', full: true },
        sec('Part C – Investigation and root cause analysis (responsible person / department)', { part: 'C', edit: { Investigation: ['responsible', 'respdept'] } }),
        { k: 'invLog', label: 'Investigation log – add an entry each time the investigation is updated', type: 'table', full: true, cols: [{ k: 'date', label: 'Date', type: 'date' }, { k: 'entry', label: 'Investigation update / finding' }] },
        { k: 'invPlan', label: 'Investigation plan', type: 'textarea', full: true },
        { k: 'investigation', label: 'Investigation (process records, equipment, data-logger data, training of personnel involved, recall assessment)', type: 'textarea', full: true },
        { k: 'historicalReview', label: 'Historical review (prior deviations, complaints, CAPA, recurring failure modes)', type: 'textarea', full: true },
        { k: 'rcaTools', label: 'Root cause analysis tools', type: 'multicheck', options: ['Fishbone (6M)', '5 Whys', 'Fault tree analysis', 'TapRooT', 'Process mapping', 'RCA not performed – justified'] },
        { k: 'rootCause', label: 'Root cause / probable root cause (or justification if no RCA)', type: 'textarea', full: true },
        { k: 'riskAssessment', label: 'Risk / impact assessment (patient safety, quality, identity, packaging & labelling, storage, distribution, other lots, GxP, customer requirements, recurrence)', type: 'textarea', full: true },
        { k: 'productImpact', label: 'Product / material impact', type: 'textarea', full: true },
        { k: 'conclusion', label: 'Conclusion', type: 'textarea', full: true },
        { k: 'capaRequired', label: 'CAPA required?', type: 'select', options: ['Yes', 'No'] },
        { k: 'capaJustification', label: 'Justification if no CAPA is required', type: 'textarea', full: true },
        sec('Part D – Head of Department approval', { part: 'D', edit: { 'HOD Approval': ['depthead'] } }),
        { k: 'hodApprover', label: 'Approving Head of Department (from the organogram)', type: 'readonly', fmt: 'user' },
        { k: 'hodComment', label: 'Head of Department comment', type: 'textarea', full: true },
        sec('Part E – QA evaluation and closure (final report)', { part: 'E', edit: { 'QA Evaluation': ['qa'], 'Customer Approval': ['qa', 'pm'] } }),
        { k: 'finalDisposition', label: 'Final disposition', type: 'select', options: ['Not applicable', 'Release / use as is', 'Reject', 'Return to sponsor / supplier', 'Destroy', 'Hold pending customer decision'] },
        { k: 'qaEvalComment', label: 'QA evaluation comment', type: 'textarea', full: true },
        { k: 'customerApproval', label: 'Customer approval (per QTA)', type: 'select', options: ['Pending', 'Approved by customer', 'Deemed closed – no response after 3 follow-ups', 'Not applicable (no customer impact)'] },
        { k: 'reportSent', label: 'QA-approved report shared with customer on', type: 'date' },
        { k: 'followUp1', label: 'Customer follow-up 1', type: 'date' },
        { k: 'followUp2', label: 'Customer follow-up 2', type: 'date' },
        { k: 'followUp3', label: 'Customer follow-up 3', type: 'date' },
        { k: 'nextFollowUp', label: 'Customer follow-up reminder', type: 'computed' }
      ],
      compute: {
        reporting: (d) => !d.dateIdentified || !d.qaNotified ? '' : dayDiff(d.dateIdentified, d.qaNotified) <= 1 ? 'Met (within 24 hours)' : 'Late (more than 24 hours) – record the reason in the description',
        notifyStatus: (d) => {
          if (String(d.customerApproval || '').startsWith('Not applicable')) return 'Not applicable';
          if (!d.dateIdentified) return '';
          const by = plusDays(d.dateIdentified, 3);
          if (d.customerNotified) return d.customerNotified <= by ? 'Met (within 3 days)' : 'Late (more than 3 days)';
          return todayIso() > by ? 'Overdue – notify the customer / sponsor' : 'Due by ' + by;
        },
        nextFollowUp: (d) => {
          if (d.customerApproval !== 'Pending' || !d.reportSent) return '';
          const n = [d.followUp1, d.followUp2, d.followUp3].filter(Boolean).length;
          return n < 3 ? `Follow-up ${n + 1} due ${plusDays(d.reportSent, 15 * (n + 1))}` : `Deemed closure possible from ${plusDays(d.reportSent, 45)}`;
        }
      },
      // Request → QA (approve: number assigned automatically / need to update / reject) → Part A (initiator or responsible department)
      // → Part B (QA; may return Part A for update; A and B lock when QA submits) → Part C investigation → Head of Department → QA evaluation and closure
      tempNumbering: (d, y) => ({ pre: `REQ-${y}-`, pad: 4 }),
      states: ['Requested', 'Request Update', 'Initiation', 'QA Review', 'Part A Update', 'Investigation', 'HOD Approval', 'QA Evaluation', 'Customer Approval', 'Closed', 'Rejected', 'Cancelled'],
      transitions: [
        t('Requested', 'Initiation', 'Approve request – assign number', ['qa'], { part: 'R', sign: 'Request approved – QA (number assigned)', sod: true, needs: ['respPerson'] }),
        t('Requested', 'Request Update', 'Need to update – return to initiator', ['qa'], { part: 'R', reason: true }),
        t('Requested', 'Rejected', 'Reject request', ['qa'], { part: 'R', sign: 'Request rejected – QA', reason: true }),
        t('Request Update', 'Requested', 'Resubmit request to QA', ['any'], { part: 'R', checks: ['isInitiator'] }),
        t('Initiation', 'QA Review', 'Submit Part A to QA', ['any'], { part: 'A', sign: 'Part A submitted – initiator / responsible person', needs: ['eventOrigin', 'description', 'immediate'], checks: ['isPartAOwner'] }),
        t('Initiation', 'Cancelled', 'Cancel (raised in error)', ['qa'], { reason: true, sign: 'Cancelled – QA' }),
        t('QA Review', 'Part A Update', 'Need to update – return Part A', ['qa'], { reason: true }),
        t('Part A Update', 'QA Review', 'Resubmit Part A to QA', ['any'], { part: 'A', optional: true, sign: 'Part A updated – initiator / responsible person', needs: ['eventOrigin', 'description', 'immediate'], checks: ['isPartAOwner'] }),
        t('QA Review', 'Investigation', 'Submit Part B – start investigation', ['qa'], { part: 'B', sign: 'Part B approved – QA', sod: true, needs: ['respPerson', 'criticality', 'impactedAreas'] }),
        t('Investigation', 'HOD Approval', 'Submit investigation (Part C) to Head of Department', ['any'], { part: 'C', sign: 'Investigation completed – responsible person', needs: ['investigation', 'rootCause', 'riskAssessment', 'conclusion', 'capaRequired'], checks: ['isPartCOwner', 'capaDecision', 'hodAvailable'] }),
        t('HOD Approval', 'QA Evaluation', 'Approve – Head of Department', ['any'], { part: 'D', sign: 'Approved – Head of Department', checks: ['isHodApprover'] }),
        t('HOD Approval', 'Investigation', 'Reject – return to responsible person', ['any'], { part: 'D', sign: 'Rejected – Head of Department', reason: true, checks: ['isHodApprover'] }),
        t('QA Evaluation', 'Closed', 'Approve and close – QA', ['qa'], { part: 'E', sign: 'Approved and closed – QA', sod: true, needs: ['finalDisposition', 'customerApproval', 'qaEvalComment'], checks: ['capaDecision', 'capaLinked', 'customerNotInvolved'] }),
        t('QA Evaluation', 'Customer Approval', 'Approve – send report to customer', ['qa'], { part: 'E', sign: 'Approved – QA (report to customer)', sod: true, needs: ['finalDisposition', 'customerApproval', 'qaEvalComment'], checks: ['capaDecision', 'capaLinked', 'customerInvolved'] }),
        t('QA Evaluation', 'Investigation', 'Reject – return for further investigation', ['qa'], { part: 'E', sign: 'Rejected – QA evaluation', reason: true, needs: ['qaEvalComment'] }),
        t('Customer Approval', 'Closed', 'Close – customer approved or deemed closed', ['qa', 'pm'], { part: 'E', sign: 'Closed – customer approval recorded', checks: ['customerClosure'] })
      ]
    },

    capa: {
      name: 'CAPA', single: 'CAPA', group: 'Quality events', prefix: 'CAPA',
      intro: 'Corrective and preventive actions per JRS/SOP/QAS/006 (form JRS/FRM/QAS/006 Parts A–E, register JRS/FRM/QAS/016). Number CAPA/department/serial/year; the serial restarts each year per department.',
      numbering: (d, y) => ({ pre: `CAPA/${d.respDept}/`, suf: '/' + String(y).slice(2), pad: 3 }),
      list: ['number', 'title', 'source', 'respDept', 'respPerson', 'dueDate', 'status'],
      // visible to the initiator, the responsible department and its Head, QA and management
      deptScoped: true,
      fields: [
        sec('Part A – Initiation (initiator)', { part: 'A', create: true, edit: { Initiated: ['initiator'] } }),
        { k: 'title', label: 'Short description of CAPA', type: 'text', req: true, full: true },
        { k: 'respDept', label: 'Responsible department (sets the CAPA number)', type: 'select', req: true, lock: true, options: DEPT_CODES, optionLabels: DEPTS },
        { k: 'respPerson', label: 'Responsible person', type: 'user', req: true },
        { k: 'dateOpened', label: 'Date opened', type: 'readonly', fmt: 'date' },
        { k: 'dueDate', label: 'Due date', type: 'date', req: true },
        { k: 'extendedDue', label: 'Extended due date (approved extension request)', type: 'readonly', fmt: 'date' },
        { k: 'source', label: 'Source of CAPA', type: 'select', req: true, options: ['Deviation', 'Complaint', 'Internal audit / self-inspection', 'External audit', 'Regulatory inspection / compliance', 'Product recall', 'Risk management', 'Incident report', 'Returned goods', 'CAPA not effective', 'Other'] },
        { k: 'sourceRecord', label: 'Reference document no. (source record)', type: 'recordref', refTypes: ['investigations', 'selfinspections', 'extaudits', 'risks', 'changes', 'capa', 'mgmtreviews'] },
        { k: 'nonconformance', label: 'Description of nonconformance', type: 'textarea', req: true, full: true },
        { k: 'capaDetail', label: 'Detailed description of CAPA', type: 'textarea', full: true },
        { k: 'correction', label: 'Proposed correction', type: 'textarea', full: true },
        { k: 'corrDue', label: 'Correction – target due date', type: 'date' },
        { k: 'corrExt', label: 'Correction – extended target due date', type: 'readonly', fmt: 'date' },
        { k: 'corrective', label: 'Proposed corrective action(s)', type: 'textarea', full: true },
        { k: 'caDue', label: 'Corrective action – target due date', type: 'date' },
        { k: 'caExt', label: 'Corrective action – extended target due date', type: 'readonly', fmt: 'date' },
        { k: 'preventive', label: 'Proposed preventive action(s)', type: 'textarea', full: true },
        { k: 'paDue', label: 'Preventive action – target due date', type: 'date' },
        { k: 'paExt', label: 'Preventive action – extended target due date', type: 'readonly', fmt: 'date' },
        { k: 'clientReported', label: 'External incident reported by a client (CAPA report to client/sponsor within 21 days)', type: 'checkbox', full: true },
        sec('Part B – Pre-approval: Head of the responsible department', { part: 'B', edit: { 'HOD Pre-Approval': ['depthead'] } }),
        { k: 'hodApprover', label: 'Head of Department (from the organogram)', type: 'readonly', fmt: 'user' },
        { k: 'hodComment', label: 'Department Head comment', type: 'textarea', full: true },
        sec('Part B – Pre-approval: Quality Assurance and effectiveness check', { part: 'B2', edit: { 'QA Pre-Approval': ['qa'] } }),
        { k: 'qaPreComment', label: 'QA comment', type: 'textarea', full: true },
        { k: 'ecRequired', label: 'Effectiveness check', type: 'select', options: ['Required', 'Not required'] },
        { k: 'ecReason', label: 'Reason if effectiveness check is not required', type: 'textarea', full: true },
        { k: 'ecDue', label: 'Effectiveness check due (from QA closure)', type: 'select', options: EC_DUE },
        sec('Part C – Implementation status (responsible person / department)', { part: 'C', edit: { Implementation: ['responsible', 'respdept'] } }),
        { k: 'corrDone', label: 'Correction completed', type: 'textarea', full: true },
        { k: 'corrDate', label: 'Correction – implementation date', type: 'date' },
        { k: 'corrRef', label: 'Correction – reference document no.', type: 'text' },
        { k: 'caDone', label: 'Corrective action(s) taken', type: 'textarea', full: true },
        { k: 'caDate', label: 'Corrective action – implementation date', type: 'date' },
        { k: 'caRef', label: 'Corrective action – reference document no.', type: 'text' },
        { k: 'paDone', label: 'Preventive action(s) taken', type: 'textarea', full: true },
        { k: 'paDate', label: 'Preventive action – implementation date', type: 'date' },
        { k: 'paRef', label: 'Preventive action – reference document no.', type: 'text' },
        sec('Part C – Verification by the Head of Department', { part: 'C2', edit: { 'HOD Verification': ['depthead'] } }),
        { k: 'hodVerifyComment', label: 'Head of Department verification comment', type: 'textarea', full: true },
        sec('CAPA report to the client (when a client reported the incident)', { edit: { Implementation: ['qa'], 'HOD Verification': ['qa'], 'QA Closure': ['qa'] } }),
        { k: 'clientReportDue', label: 'CAPA report to client due', type: 'computed' },
        { k: 'clientReportSent', label: 'CAPA report sent to client on', type: 'date' },
        sec('Part D – Evaluation and closure by QA', { part: 'D', edit: { 'QA Closure': ['qa'] } }),
        { k: 'closureRemarks', label: 'Remarks for closure by QA', type: 'textarea', full: true },
        { k: 'ecDueDate', label: 'Due date for effectiveness check', type: 'readonly', fmt: 'date' },
        sec('Part E – Effectiveness verification', { part: 'E', edit: { 'Effectiveness Check': ['qa', 'responsible'] } }),
        { k: 'effective', label: 'Is the CAPA effective?', type: 'select', options: ['Yes', 'No'] },
        { k: 'ecRespComment', label: 'Responsible person comment', type: 'textarea', full: true },
        { k: 'ecQaComment', label: 'QA comment', type: 'textarea', full: true }
      ],
      compute: { clientReportDue: (d) => d.clientReported && d.dateOpened ? plusDays(d.dateOpened, 21) + ' (or as directed by the client)' : '' },
      states: ['Initiated', 'HOD Pre-Approval', 'QA Pre-Approval', 'Implementation', 'HOD Verification', 'QA Closure', 'Effectiveness Check', 'Closed', 'Cancelled'],
      transitions: [
        t('Initiated', 'HOD Pre-Approval', 'Submit Part A to Head of Department', ['any'], { part: 'A', sign: 'Part A submitted – initiator', checks: ['isInitiator', 'capaPlan', 'hodAvailable'] }),
        t('Initiated', 'Cancelled', 'Cancel', ['qa'], { reason: true, sign: 'Cancelled – QA' }),
        t('HOD Pre-Approval', 'QA Pre-Approval', 'Approve – Head of Department', ['any'], { part: 'B', sign: 'Pre-approved – Head of Department', needs: ['hodComment'], checks: ['isHodApprover'] }),
        t('HOD Pre-Approval', 'Initiated', 'Reject – return to initiator', ['any'], { part: 'B', sign: 'Rejected – Head of Department', reason: true, checks: ['isHodApprover'] }),
        t('QA Pre-Approval', 'Implementation', 'Approve Part B – QA', ['qa'], { part: 'B2', sign: 'Pre-approved – QA', sod: true, needs: ['qaPreComment', 'ecRequired'], checks: ['capaPlan', 'ecDecision'] }),
        t('QA Pre-Approval', 'Initiated', 'Reject – return to initiator', ['qa'], { part: 'B2', sign: 'Rejected – QA', reason: true }),
        t('Implementation', 'HOD Verification', 'Submit Part C to Head of Department', ['any'], { part: 'C', sign: 'Implemented – responsible person', checks: ['isPartCOwner', 'capaImplemented', 'hodAvailable'] }),
        t('HOD Verification', 'QA Closure', 'Verify – Head of Department', ['any'], { part: 'C2', sign: 'Verified – Head of Department', checks: ['isHodApprover'] }),
        t('HOD Verification', 'Implementation', 'Return – implementation incomplete', ['any'], { reason: true, checks: ['isHodApprover'] }),
        t('QA Closure', 'Closed', 'Close – CAPA completed', ['qa'], { part: 'D', sign: 'Closed – QA', needs: ['closureRemarks'], checks: ['ecNotRequired'] }),
        t('QA Closure', 'Effectiveness Check', 'Close – effectiveness check pending', ['qa'], { part: 'D', sign: 'Closed – QA (effectiveness check pending)', needs: ['closureRemarks'], checks: ['ecIsRequired'] }),
        t('QA Closure', 'Implementation', 'Return to responsible department', ['qa'], { reason: true }),
        t('Effectiveness Check', 'Closed', 'Record effectiveness verification', ['qa'], { part: 'E', sign: 'Effectiveness verified – QA', needs: ['effective', 'ecQaComment'] })
      ]
    },

    changes: {
      name: 'Change control', group: 'Quality events', prefix: 'CC',
      intro: 'Change control per JRS/SOP/QAS/007 (form JRS/FRM/QAS/007, register JRS/FRM/QAS/017). Every department can view change controls. A change must be pre-approved (QA, responsible person, Head of Department, QA and any departments QA names) before it is implemented.',
      numbering: (d, y) => ({ pre: `CC-JRS-${y}-`, pad: 3 }),
      // Part A (initiator, drafts) → Part B (QA: approve – number assigned / reject) → responsible person → Head of the responsible department
      // → QA approval (effectiveness check, optional departments) → optional approvals → implementation → change control report (department)
      // → QA review and report → closed, or effectiveness check once the assigned period has passed
      tempNumbering: (d, y) => ({ pre: `REQ-CC-${y}-`, pad: 4 }),
      createHelp: 'Fill in Part A and save it as a draft; submit it to QA when it is complete. The change control number is assigned when QA approves Part B. The responsible department is the department of the responsible person.',
      createLabel: 'Save Part A draft',
      list: ['number', 'title', 'nature', 'respDept', 'classification', 'dueDate', 'status'],
      fields: [
        sec('Part A – Change request (initiator / responsible department)', { part: 'A', create: true, edit: { Draft: ['initiator', 'responsible', 'respdept'] } }),
        { k: 'title', label: 'Short description', type: 'text', req: true, full: true },
        { k: 'nature', label: 'Nature of change', type: 'select', req: true, options: ['Permanent', 'Temporary'] },
        { k: 'respPerson', label: 'Responsible person (sets the responsible department)', type: 'user' },
        { k: 'respDept', label: 'Responsible department (department of the responsible person)', type: 'readonly', optionLabels: DEPTS },
        { k: 'dueDate', label: 'Target date (permanent change: within 90 days)', type: 'date' },
        { k: 'tempStart', label: 'Temporary change – start date', type: 'date' },
        { k: 'tempEnd', label: 'Temporary change – end date', type: 'date' },
        { k: 'changeType', label: 'Change type', type: 'multicheck', options: ['Quality system', 'Facility / utilities (HVAC, cold room, freezer, power backup)', 'Equipment / instrument', 'Process / method', 'Clinical trial supply / packaging / labelling', 'Computerized system / eQMS / IRT / IVRS', 'Documentation (SOP, format, record)', 'Regulatory', 'Other'] },
        { k: 'impactedAreas', label: 'Impacted area(s)', type: 'multicheck', options: ['Comparator sourcing', 'Clinical trial ancillaries', 'Labelling', 'Secondary packaging', 'Storage (+15 to +25 °C)', 'Storage (+2 to +8 °C)', 'Storage (−25 to −15 °C)', 'Distribution', 'Returns', 'Destruction', 'Other'] },
        { k: 'current', label: 'Current practice / situation', type: 'textarea', full: true },
        { k: 'description', label: 'Description of change', type: 'textarea', full: true },
        { k: 'justification', label: 'Reason / justification for change', type: 'textarea', full: true },
        { k: 'requestNo', label: 'Request no.', type: 'readonly' },
        { k: 'dateOpened', label: 'Date opened (number assigned)', type: 'readonly', fmt: 'date' },
        { k: 'extendedDue', label: 'Extended due date (approved extension request)', type: 'readonly', fmt: 'date' },
        sec('Part B – QA review and impact assessment', { part: 'B', edit: { 'QA Review': ['qa'] } }),
        { k: 'impactCheck', label: 'Impact assessment', type: 'checklist', full: true, rows: ['Subject / patient safety', 'Product quality / integrity', 'Data integrity (ALCOA+)', 'GMP / GCP / GDP compliance', 'Client requirement (client notification / approval required)', 'Regulatory filings', 'Validation / qualification', 'Cold chain', 'Labelling / packaging', 'Computer system (21 CFR Part 11)', 'Training requirement'] },
        { k: 'impactSummary', label: 'Impact summary', type: 'textarea', full: true },
        { k: 'classification', label: 'Change classification', type: 'select', options: ['Minor', 'Major', 'Critical'] },
        { k: 'classRationale', label: 'Classification rationale', type: 'textarea', full: true },
        { k: 'riskRequired', label: 'Risk assessment (JRS/SOP/QAS/020)', type: 'select', options: ['Required', 'Not required'] },
        { k: 'riskRef', label: 'Risk assessment reference', type: 'recordref', refTypes: ['risks'] },
        { k: 'clientPre', label: 'Client pre-communication', type: 'select', options: ['Required', 'Not required'] },
        { k: 'clientPost', label: 'Client post-communication', type: 'select', options: ['Required', 'Not required'] },
        { k: 'clientComments', label: 'Client communication comments', type: 'textarea', full: true },
        { k: 'pm', label: 'Person responsible for client communication (Project Manager)', type: 'user' },
        { k: 'qaReviewComment', label: 'QA review comment', type: 'textarea', full: true },
        sec('Implementation plan – activity closure dates are updated during implementation', { edit: { 'QA Review': ['qa'], Implementation: ['initiator', 'responsible', 'respdept', 'qa'] } }),
        { k: 'plan', label: 'Implementation plan', type: 'table', full: true, cols: [{ k: 'activity', label: 'Activity' }, { k: 'dept', label: 'Responsible department', type: 'dept' }, { k: 'person', label: 'Responsible person', type: 'user' }, { k: 'due', label: 'Target due date', type: 'date' }, { k: 'closed', label: 'Activity closure date', type: 'date' }] },
        sec('Part C – Pre-approval: responsible person and Head of Department', { part: 'C', edit: { 'RP Review': ['responsible'], 'HOD Approval': ['depthead'] } }),
        { k: 'rpComment', label: 'Responsible person review comment', type: 'textarea', full: true },
        { k: 'hodApprover', label: 'Approving Head of Department (from the organogram)', type: 'readonly', fmt: 'user' },
        { k: 'hodComment', label: 'Head of Department comment', type: 'textarea', full: true },
        sec('Part D – QA approval, effectiveness check and other departments', { part: 'D', edit: { 'QA Approval': ['qa'] } }),
        { k: 'ecRequired', label: 'Effectiveness check', type: 'select', options: ['Required', 'Not required'] },
        { k: 'ecDue', label: 'Effectiveness check due (period after final implementation)', type: 'select', options: EC_DUE },
        { k: 'ecReason', label: 'Reason if effectiveness check is not required', type: 'textarea', full: true },
        { k: 'optionalDepts', label: 'Approval also needed from other departments (max. 4)', type: 'multicheck', max: 4, options: DEPT_CODES, optionLabels: DEPTS },
        { k: 'qaApprovalComment', label: 'QA approval comment', type: 'textarea', full: true },
        sec('Part E – Change control report (responsible department)', { part: 'E', edit: { Implementation: ['initiator', 'responsible', 'respdept', 'pm'] } }),
        { k: 'finalImplDate', label: 'Date of final implementation', type: 'date' },
        { k: 'restored', label: 'Temporary change – original condition restored', type: 'select', options: ['Yes', 'No'] },
        { k: 'finalSummary', label: 'Change control report – what was implemented, evidence, deviations from the plan', type: 'textarea', full: true },
        { k: 'clientCommunicated', label: 'Client communicated (by Project Manager)', type: 'select', options: ['Yes', 'No', 'N/A'] },
        sec('Part F – QA review and closure report', { part: 'F', edit: { 'QA Closure Review': ['qa'] } }),
        { k: 'qaReport', label: 'QA review report', type: 'textarea', full: true },
        { k: 'ecDueDate', label: 'Effectiveness check due on', type: 'readonly', fmt: 'date' },
        sec('Part G – Effectiveness check (after the assigned period)', { part: 'G', edit: { 'Closed – EC Pending': ['qa', 'responsible'] } }),
        { k: 'effective', label: 'Is the change effective?', type: 'select', options: ['Yes', 'No', 'N/A'] },
        { k: 'ecRespComment', label: 'Responsible person comment', type: 'textarea', full: true },
        { k: 'ecQaComment', label: 'QA comment', type: 'textarea', full: true }
      ],
      states: ['Draft', 'QA Review', 'RP Review', 'HOD Approval', 'QA Approval', 'Optional Approvals', 'Implementation', 'QA Closure Review', 'Closed – EC Pending', 'Closed', 'Rejected', 'Cancelled'],
      transitions: [
        t('Draft', 'QA Review', 'Submit Part A to QA', ['any'], { part: 'A', sign: 'Part A submitted – initiator / responsible department', needs: ['respPerson', 'dueDate', 'changeType', 'description', 'justification'], checks: ['isCcDept', 'ccDue90', 'ccTemp'] }),
        t('Draft', 'Cancelled', 'Cancel draft', ['any'], { reason: true, checks: ['isCcDept'] }),
        t('QA Review', 'Draft', 'Need to update – return Part A', ['qa'], { reason: true }),
        t('QA Review', 'RP Review', 'Approve Part B – assign number', ['qa'], { part: 'B', sign: 'Part B approved – QA (number assigned)', sod: true, needs: ['impactCheck', 'impactSummary', 'classification', 'classRationale', 'riskRequired', 'plan', 'clientPre', 'clientPost'], checks: ['ccDue90', 'ccTemp', 'ccRiskClass', 'ccRiskRef', 'ccClientPm'] }),
        t('QA Review', 'Rejected', 'Reject change', ['qa'], { part: 'B', sign: 'Change rejected – QA', reason: true }),
        t('RP Review', 'HOD Approval', 'Review and approve – responsible person', ['any'], { part: 'C', sign: 'Reviewed and approved – responsible person', checks: ['isRespPerson', 'hodAvailable'] }),
        t('RP Review', 'QA Review', 'Return to QA', ['any'], { reason: true, checks: ['isRespPerson'] }),
        t('HOD Approval', 'QA Approval', 'Approve – Head of Department', ['any'], { part: 'C', sign: 'Approved – Head of Department', checks: ['isHodApprover'] }),
        t('HOD Approval', 'QA Review', 'Reject – return to QA', ['any'], { part: 'C', sign: 'Rejected – Head of Department', reason: true, checks: ['isHodApprover'] }),
        t('QA Approval', 'Optional Approvals', 'Approve – QA (send to other departments)', ['qa'], { part: 'D', sign: 'Pre-approved – QA', sod: true, needs: ['ecRequired'], checks: ['ecDecision', 'ccHasOptional'] }),
        t('QA Approval', 'Implementation', 'Approve – QA (pre-approval complete)', ['qa'], { part: 'D', sign: 'Pre-approved – QA', sod: true, needs: ['ecRequired'], checks: ['ecDecision', 'ccNoOptional'] }),
        t('QA Approval', 'QA Review', 'Return to QA review', ['qa'], { reason: true }),
        t('Optional Approvals', 'Implementation', 'Start implementation', ['any'], { checks: ['ccOptional'] }),
        t('Implementation', 'QA Closure Review', 'Submit change control report', ['any'], { part: 'E', sign: 'Change control report – responsible department', needs: ['finalImplDate', 'finalSummary'], checks: ['isCcDept', 'ccPlanClosed', 'ccRestored'] }),
        t('QA Closure Review', 'Implementation', 'Return – report incomplete', ['qa'], { reason: true }),
        t('QA Closure Review', 'Closed', 'Close – QA report', ['qa'], { part: 'F', sign: 'Closed – QA review report', needs: ['qaReport'], checks: ['ccClientComm', 'ccNoEC'] }),
        t('QA Closure Review', 'Closed – EC Pending', 'Close – effectiveness check pending', ['qa'], { part: 'F', sign: 'Closed – QA review report (effectiveness check pending)', needs: ['qaReport'], checks: ['ccClientComm', 'ccNeedsEC'] }),
        t('Closed – EC Pending', 'Closed', 'Record effectiveness check', ['qa'], { part: 'G', sign: 'Effectiveness verified – QA', needs: ['effective', 'ecQaComment'], checks: ['ccEcDue'] })
      ],
      deptApproval: { state: 'Optional Approvals', field: 'optionalDepts', label: 'Other department approvals' }
    },

    extensions: {
      name: 'Extension requests', single: 'extension request', group: 'Quality events', prefix: 'ER',
      intro: 'Due-date extensions for change controls, deviations, complaints, CAPA and self-inspection responses (form JRS/FRM/QAS/045). Request one with the "Request extension" button beside the due date on the record. Only one extension per due date, requested and approved before that date.',
      // extension requests are raised from the due date on the record, not from a separate form
      noCreate: true,
      numbering: (d, y) => ({ pre: `ER-${y}-`, pad: 3 }),
      list: ['number', 'documentId', 'recordType', 'scope', 'originalDue', 'requestedDate', 'requesterDept', 'status'],
      fields: [
        sec('Extension request (requester)', { create: true, edit: { Draft: ['initiator'] } }),
        { k: 'documentId', label: 'Document ID (record to extend)', type: 'recordref', refTypes: ['investigations', 'capa', 'changes', 'selfinspections'], req: true, lock: true },
        { k: 'scope', label: 'Due date to extend', type: 'select', req: true, lock: true, def: 'Overall due date', options: ['Overall due date', 'Correction (CAPA)', 'Corrective action (CAPA)', 'Preventive action (CAPA)'] },
        { k: 'recordType', label: 'Record type', type: 'readonly' },
        { k: 'originalDue', label: 'Original due date', type: 'readonly', fmt: 'date' },
        { k: 'requestedDate', label: 'Requested extension date', type: 'date', req: true },
        { k: 'justification', label: 'Justification of extension / delay', type: 'textarea', req: true, full: true },
        { k: 'interimUpdate', label: 'Interim update', type: 'textarea', req: true, full: true },
        { k: 'impactAssessment', label: 'Impact assessment (product quality, patient safety, regulatory compliance, business operations)', type: 'textarea', req: true, full: true },
        { k: 'requesterDept', label: 'Requester department', type: 'readonly', optionLabels: DEPTS },
        sec('Head of Department', { edit: { 'HOD Review': ['depthead'] } }),
        { k: 'hodApprover', label: 'Head of Department (organogram – department of the record)', type: 'readonly', fmt: 'user' },
        { k: 'hodComment', label: 'Head of Department comments', type: 'textarea', full: true },
        sec('Head of Quality / designee', { edit: { 'Head of Quality Approval': ['qa'] } }),
        { k: 'qaComment', label: 'Head of Quality / designee comments', type: 'textarea', full: true }
      ],
      states: ['Draft', 'HOD Review', 'Head of Quality Approval', 'Approved', 'Rejected'],
      transitions: [
        t('Draft', 'HOD Review', 'Submit request', ['any'], { sign: 'Requested', checks: ['erValid'] }),
        t('HOD Review', 'Head of Quality Approval', 'Head of Department approval', ['any'], { sign: 'Approved – Head of Department', checks: ['isHodApprover', 'erValid'] }),
        t('HOD Review', 'Rejected', 'Reject', ['any'], { sign: 'Rejected', reason: true, checks: ['isHodApprover'] }),
        t('Head of Quality Approval', 'Approved', 'Head of Quality approval', ['qa'], { sign: 'Approved – Head of Quality', sod: true, checks: ['erValid'] }),
        t('Head of Quality Approval', 'Rejected', 'Reject', ['qa'], { sign: 'Rejected', reason: true })
      ]
    },

    selfinspections: {
      name: 'Self-inspections', single: 'self-inspection', group: 'Compliance', prefix: 'SI', hideFrom: ['extaud'],
      intro: 'Self-inspections per JRS/SOP/QAS/004 (agenda FRM/QAS/040, report FRM/QAS/003, response and CAPA plan FRM/QAS/041). Confidential: not shown to external auditors.',
      numbering: (d, y) => ({ pre: `JRS-SI-${y}-`, pad: 3 }),
      list: ['number', 'auditeeDept', 'plannedDate', 'leadAuditor', 'dueDate', 'status'],
      fields: [
        sec('Planning and agenda (FRM/QAS/040)'),
        { k: 'auditeeDept', label: 'Auditee section / department', type: 'select', req: true, options: DEPT_CODES, optionLabels: DEPTS },
        { k: 'title', label: 'Audit objective', type: 'text', req: true, full: true },
        { k: 'auditee', label: 'Auditee name', type: 'user', req: true },
        { k: 'scheduleRef', label: 'Annual schedule (FRM/QAS/038)', type: 'recordref', refTypes: ['sischedule'] },
        { k: 'unscheduledTrigger', label: 'Unscheduled self-inspection – trigger', type: 'select', options: ['Quality event / deviation', 'Complaint', 'External audit observation', 'Repetitive failure', 'Other (QA / Quality Head decision)'] },
        { k: 'postponeReason', label: 'Advanced or postponed (max. 1 month) – reason', type: 'select', options: ['Regulatory or customer audit in the period', 'Auditee has other commitments'] },
        { k: 'plannedDate', label: 'Date of audit', type: 'date', req: true },
        { k: 'duration', label: 'Timing / duration', type: 'text' },
        { k: 'leadAuditor', label: 'Lead auditor (QA expert)', type: 'user', req: true },
        { k: 'coAuditor', label: 'Co-auditor (cross-functional)', type: 'user', req: true },
        { k: 'consultant', label: 'External consultant (optional)', type: 'text' },
        { k: 'activities', label: 'Audit activities / focus areas (including follow-up of previous CAPA)', type: 'textarea', full: true },
        { k: 'notifiedOn', label: 'Agenda e-mailed to auditee on (at least 3 working days before)', type: 'date' },
        sec('Self-inspection report (FRM/QAS/003)'),
        { k: 'auditDate', label: 'Date of self-inspection (completed)', type: 'date' },
        { k: 'reportDate', label: 'Date of audit report (within 15 calendar days)', type: 'date' },
        { k: 'summary', label: 'Executive summary', type: 'textarea', full: true },
        { k: 'observations', label: 'Observations, response and CAPA plan (FRM/QAS/003 and FRM/QAS/041)', type: 'table', full: true, cols: [
          { k: 'no', label: 'Obs. #' }, { k: 'system', label: 'System / sub-system' }, { k: 'category', label: 'Category', options: ['Minor', 'Major', 'Critical'] },
          { k: 'description', label: 'Description of observation' }, { k: 'recommendation', label: 'Recommendation' },
          { k: 'corrective', label: 'Corrective action' }, { k: 'caDue', label: 'CA due date', type: 'date' },
          { k: 'preventive', label: 'Preventive action' }, { k: 'paDue', label: 'PA due date', type: 'date' },
          { k: 'responsible', label: 'Responsible person', type: 'user' }, { k: 'capa', label: 'CAPA no.', ref: ['capa'] }, { k: 'status', label: 'Status', options: ['Open', 'Complied'] }] },
        sec('Response and closure'),
        { k: 'dueDate', label: 'Response due (15 calendar days from the report)', type: 'readonly', fmt: 'date' },
        { k: 'extendedDue', label: 'Extended response due (approved extension – one only)', type: 'readonly', fmt: 'date' },
        { k: 'responseDate', label: 'Response and CAPA plan submitted on', type: 'readonly', fmt: 'date' },
        { k: 'responseTimeliness', label: 'Response timeliness', type: 'computed' },
        { k: 'qaVerification', label: 'QA verification of compliance', type: 'textarea', full: true }
      ],
      compute: { responseTimeliness: (d) => !d.responseDate ? '' : d.responseDate <= (d.extendedDue || d.dueDate) ? 'On time' : 'Late – submitted after the due date' },
      states: ['Planned', 'Notified', 'In Progress', 'Report Issued', 'Response Submitted', 'Auditor Review', 'Response Accepted', 'Closed', 'Cancelled'],
      transitions: [
        t('Planned', 'Notified', 'Agenda sent – confirm date and audit team', ['qa'], { needs: ['notifiedOn'], checks: ['siTeam', 'siSchedule', 'siNotice'] }),
        t('Planned', 'Cancelled', 'Cancel', ['qa'], { reason: true, sign: 'Approved' }),
        t('Notified', 'In Progress', 'Start self-inspection (pre-meeting held)', ['any'], { checks: ['isAuditor'] }),
        t('In Progress', 'Report Issued', 'Issue report', ['any'], { sign: 'Prepared – lead auditor', needs: ['auditDate', 'reportDate', 'summary'], checks: ['isLeadAuditor', 'siReport'] }),
        t('Report Issued', 'Response Submitted', 'Submit response and CAPA plan', ['any'], { sign: 'Response submitted – CAPA plan owner', checks: ['isAuditee', 'siResponse'] }),
        t('Response Submitted', 'Auditor Review', 'Manager of CAPA plan owner approval', ['hod'], { sign: 'Approved – manager of CAPA plan owner' }),
        t('Response Submitted', 'Report Issued', 'Return to auditee', ['hod'], { reason: true }),
        t('Auditor Review', 'Response Accepted', 'Accept response and CAPA plan', ['any'], { sign: 'CAPA plan approved – lead auditor', checks: ['isLeadAuditor'] }),
        t('Auditor Review', 'Report Issued', 'Return to auditee for rectification', ['any'], { reason: true, checks: ['isAuditor'] }),
        t('Response Accepted', 'Closed', 'QA verification – close self-inspection', ['qa'], { sign: 'Verified and closed – QA', needs: ['qaVerification'], checks: ['siClosure'], sodWith: 'Response submitted' })
      ]
    },

    sischedule: {
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
    },

    auditors: {
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
    },

    extaudits: {
      name: 'External audits & inspections', single: 'external audit', group: 'Compliance', prefix: 'EA',
      intro: 'Customer, regulatory and third-party audits of JRS per JRS/SOP/QAS/002 (register FRM/QAS/012, response FRM/QAS/013) and regulatory inspections per JRS/SOP/QAS/008. Every audit finding is answered through a CAPA (JRS/SOP/QAS/006).',
      numbering: (d, y) => ({ pre: `JRS-EA-${y}-`, pad: 3 }),
      list: ['number', 'title', 'auditType', 'auditStart', 'findingCounts', 'status'],
      fields: [
        sec('Audit request and planning'),
        { k: 'title', label: 'Name of auditing entity', type: 'text', req: true, full: true },
        { k: 'auditType', label: 'Type', type: 'select', req: true, options: ['Customer / client audit', 'Regulatory inspection', 'Third-party audit'] },
        { k: 'planned', label: 'Planned or unplanned', type: 'select', req: true, options: ['Planned', 'Unplanned'] },
        { k: 'mode', label: 'Mode', type: 'select', options: ['On-site', 'Virtual (video)'] },
        { k: 'auditorName', label: 'Name of auditor', type: 'text' },
        { k: 'auditorCompany', label: 'Auditor company', type: 'text' },
        { k: 'auditorEmail', label: 'Auditor e-mail', type: 'email' },
        { k: 'auditorContact', label: 'Auditor contact details', type: 'text' },
        { k: 'auditStart', label: 'Date of external audit (start)', type: 'date' },
        { k: 'auditEnd', label: 'Date of external audit (end)', type: 'date' },
        { k: 'host', label: 'JRS host (QA Manager / designee)', type: 'user' },
        { k: 'cdaSigned', label: 'Confidentiality agreement signed on', type: 'date' },
        { k: 'agenda', label: 'Final agenda from the requestor', type: 'textarea', full: true },
        { k: 'attendees', label: 'Audit attendees', type: 'table', full: true, cols: [{ k: 'name', label: 'Name' }, { k: 'company', label: 'Company' }] },
        sec('Report and response (FRM/QAS/013)'),
        { k: 'reportDate', label: 'Date of external audit report', type: 'date' },
        { k: 'responseDue', label: 'Response due date (set by the auditor)', type: 'date' },
        { k: 'findings', label: 'Audit findings and JRS response', type: 'table', full: true, cols: [{ k: 'no', label: 'Sr. no.' }, { k: 'finding', label: 'Audit finding' }, { k: 'category', label: 'Category', options: ['Observation', 'Minor', 'Major', 'Critical'] }, { k: 'response', label: 'Initial / final response with action items' }, { k: 'due', label: 'Due date', type: 'date' }, { k: 'capa', label: 'CAPA no.', ref: ['capa'] }, { k: 'cc', label: 'Change control no.', ref: ['changes'] }, { k: 'status', label: 'Status', options: ['Open', 'Closed'] }] },
        { k: 'findingCounts', label: 'Findings (Critical / Major / Minor / Observation)', type: 'computed' },
        { k: 'clientFormat', label: "Response sent in the client's own format", type: 'checkbox' },
        { k: 'initialResponse', label: 'Date of initial response', type: 'date' },
        sec('Closure'),
        { k: 'finalResponse', label: 'Date of final response', type: 'date' },
        { k: 'clientClosure', label: 'Closure confirmed by the requestor', type: 'select', options: ['Confirmed', 'Not provided by the requestor'] },
        { k: 'closureNotes', label: 'Closure notes', type: 'textarea', full: true }
      ],
      compute: { findingCounts: (d) => { const c = { Critical: 0, Major: 0, Minor: 0, Observation: 0 }; for (const f of d.findings || []) if (f.category in c) c[f.category]++; return `${c.Critical} / ${c.Major} / ${c.Minor} / ${c.Observation}`; } },
      states: ['Requested', 'Confirmed', 'Audit Completed', 'Report Received', 'Response Prepared', 'Response Approved', 'Closed', 'Cancelled'],
      transitions: [
        t('Requested', 'Confirmed', 'Confirm audit (agenda and confidentiality agreement in place)', ['qa'], { needs: ['auditStart', 'cdaSigned', 'agenda'] }),
        t('Requested', 'Cancelled', 'Cancel', ['qa'], { reason: true }),
        t('Confirmed', 'Audit Completed', 'Record close-out meeting held', ['qa'], { needs: ['attendees'] }),
        t('Audit Completed', 'Report Received', 'Report received and accepted', ['qa'], { needs: ['reportDate', 'responseDue'], checks: ['eaFindings'] }),
        t('Report Received', 'Response Prepared', 'Prepare response', ['qa'], { sign: 'Prepared – QA Manager', checks: ['eaResponse'] }),
        t('Response Prepared', 'Report Received', 'Return for rework', ['qa'], { reason: true }),
        t('Response Prepared', 'Response Approved', 'Approve response', ['qa'], { sign: 'Approved – Head QA', sodWith: 'Prepared' }),
        t('Response Approved', 'Closed', 'Close audit', ['qa'], { sign: 'Closed – QA', needs: ['initialResponse', 'finalResponse', 'clientClosure'], checks: ['eaClosure'] })
      ]
    },

    vendors: {
      name: 'Suppliers', single: 'supplier', group: 'Supply chain', prefix: 'SUP',
      intro: 'Supplier qualification per JRS/SOP/QAS/005. Any department requests a supplier qualification; QA completes the supplier risk assessment (JRS/FRM/QAS/042). The risk priority number decides the evaluation: certificate verification, supplier questionnaire (JRS/FRM/QAS/004), site audit (agenda JRS/FRM/QAS/021, report JRS/FRM/QAS/020) or questionnaire and site audit. Approved suppliers form the approved supplier list (JRS/FRM/QAS/005).',
      numbering: (d, y) => ({ pre: `SUP-${y}-`, pad: 3 }),
      numberLabel: 'Supplier no.',
      list: ['number', 'title', 'country', 'services', 'rpn', 'riskLevel', 'auditType', 'licenceExpiry', 'requalDate', 'status'],
      // approved supplier list (JRS/FRM/QAS/005), downloadable as PDF or CSV
      masterList: { title: 'Approved supplier list', code: 'JRS/FRM/QAS/005', status: 'Approved', cols: [['number', 'Supplier ID', 70], ['title', 'Supplier name', 170], ['country', 'Country', 80], ['services', 'Services provided', 220], ['effectiveDate', 'Effective date', 80], ['requalDate', 'Requalification (review) date', 100]] },
      // highest risk first (risk priority number)
      listSort: (a, b) => (+b.data.rpn || 0) - (+a.data.rpn || 0) || a.number.localeCompare(b.number),
      attachOnRequestOnly: true,
      createTitle: 'Request supplier qualification', createLabel: 'Submit request to QA',
      attachHint: 'attach any documents you already have (company profile, licences, certificates); after the request only QA can add documents',
      createHelp: 'Any department can request a supplier qualification (JRS/SOP/QAS/005 §5.1). Give the supplier, why it is needed, the sites and services, and the contact details; attach any documents you already have. QA then completes the risk assessment and evaluation.',
      // one issued copy per supplier and qualification cycle; later downloads return the same file
      issueForm: { file: 'JRS-FRM-QAS-004 v3.0 Vendor qualification checklist.pdf', code: 'JRS/FRM/QAS/004', label: 'Supplier questionnaire (JRS/FRM/QAS/004)', roles: ['qa'], fromRecordOnly: true, oncePerCycle: true, inSection: true, lockCopy: true, issueText: 'Issue questionnaire', notIssuedText: 'QA issues it during the quality review.', when: (d, status) => ['Under Quality Review', 'On Hold'].includes(status) && /uestionnaire/.test(d.auditType || '') },
      fields: [
        sec('Supplier qualification request (any department)', { create: true, edit: { 'Risk Assessment': ['qa'], 'Under Quality Review': ['qa'], Approved: ['qa'], 'On Hold': ['qa'] } }),
        { k: 'title', label: 'Supplier name', type: 'text', req: true, full: true },
        { k: 'reason', label: 'Reason to qualify (new requirement, quality improvement, discontinuation by current supplier, supplier rejection, business continuity …)', type: 'textarea', req: true, full: true },
        { k: 'sites', label: 'Applicable site(s)', type: 'multicheck', req: true, options: SITES },
        { k: 'services', label: 'Services / materials provided', type: 'text', req: true, full: true },
        { k: 'address', label: 'Supplier address', type: 'textarea', req: true, full: true },
        { k: 'country', label: 'Country', type: 'text', req: true },
        { k: 'contactPerson', label: 'Contact person', type: 'text', req: true },
        { k: 'contactPhone', label: 'Contact number (country code + 10-digit number, e.g. +1 6315551234)', type: 'phone' },
        { k: 'contactEmail', label: 'Contact e-mail', type: 'email', req: true },
        { k: 'requesterDept', label: 'Requesting department', type: 'readonly', optionLabels: DEPTS },
        sec('Supplier risk assessment (JRS/FRM/QAS/042) – QA', { part: 'R', edit: { 'Risk Assessment': ['qa'] } }),
        { type: 'guide', label: 'Scoring criteria (JRS/SOP/QAS/005 Attachment 1)', rows: SUP_GUIDE },
        { k: 'severity', label: 'Severity score (A)', type: 'select', options: ['5', '4', '3', '2', '1'], optionLabels: SUP_SEVERITY },
        { k: 'occurrence', label: 'Occurrence score (B)', type: 'select', options: ['5', '4', '3', '2', '1'], optionLabels: SUP_OCCURRENCE },
        { k: 'detection', label: 'Detection score (C)', type: 'select', options: ['5', '4', '3', '2', '1'], optionLabels: SUP_DETECTION },
        { k: 'rpn', label: 'Risk priority number (RPN = A × B × C)', type: 'computed' },
        { k: 'riskLevel', label: 'Risk level', type: 'computed' },
        { k: 'auditType', label: 'Type of evaluation required', type: 'computed' },
        { k: 'auditFrequency', label: 'Requalification frequency', type: 'computed' },
        sec('Risk assessment review – Head of Department (JRS/FRM/QAS/042 approved by)', { part: 'H', showIf: (d) => !!d.hodApprover, edit: { 'HOD Review': ['depthead'] } }),
        { k: 'hodApprover', label: 'Head of Department (organogram – requesting department)', type: 'readonly', fmt: 'user' },
        { k: 'hodComment', label: 'Head of Department review comment', type: 'textarea', full: true },
        // evaluation required by the risk level (JRS/SOP/QAS/005 §5.2–5.5); each part asks only for what that evaluation needs
        sec('Supplier licence', { part: 'E', showIf: (d, st) => !RISK_STAGES.includes(st) && !!d.auditType, edit: { 'Under Quality Review': ['qa'], 'On Hold': ['qa'], Approved: ['qa'] } }),
        { k: 'licenceNo', label: 'Licence no.', type: 'text' },
        { k: 'licenceExpiry', label: 'Licence expiry date', type: 'date' },
        sec('Certificate verification', { part: 'E', showIf: (d, st) => !RISK_STAGES.includes(st) && /Certificate/.test(d.auditType || ''), edit: { 'Under Quality Review': ['qa'], 'On Hold': ['qa'] } }),
        { type: 'docs', label: 'Documents', docs: [['licence', 'Licence copy']] },
        { k: 'licenceVerified', label: 'Licence verified (checklist: licence copy checked, licence no. and expiry date confirmed)', type: 'checkbox', full: true },
        sec('Supplier questionnaire (JRS/FRM/QAS/004)', { part: 'E', showIf: (d, st) => !RISK_STAGES.includes(st) && /uestionnaire/.test(d.auditType || ''), edit: { 'Under Quality Review': ['qa'], 'On Hold': ['qa'] } }),
        { type: 'issue', label: 'Questionnaire' },
        { type: 'docs', label: 'Documents', docs: [['questionnaire', 'Filled questionnaire']] },
        sec('Site audit', { part: 'E', showIf: (d, st) => !RISK_STAGES.includes(st) && /ite audit/.test(d.auditType || ''), edit: { 'Under Quality Review': ['qa'], 'On Hold': ['qa'] } }),
        { k: 'auditDate', label: 'Audit date', type: 'date' },
        { k: 'auditCertDate', label: 'Audit certificate (JRS/FRM/QAS/027) date', type: 'date' },
        { type: 'docs', label: 'Documents', docs: [['auditCert', 'Audit certificate']] },
        sec('Site audit plan and agenda (JRS/FRM/QAS/021) – optional', { part: 'E', showIf: (d, st) => !RISK_STAGES.includes(st) && /ite audit/.test(d.auditType || ''), edit: { 'Under Quality Review': ['qa'], 'On Hold': ['qa'] } }),
        { k: 'auditCategory', label: 'Audit category', type: 'select', options: ['Prospective supplier audit', 'Planned supplier audit', 'Cause-based supplier audit'] },
        { k: 'auditMethod', label: 'Audit method', type: 'select', options: ['On-site', 'Virtual / remote'] },
        { k: 'auditLocation', label: 'Audit location', type: 'text' },
        { k: 'leadAuditor', label: 'Lead auditor (qualified auditor, JRS/FRM/QAS/043)', type: 'user' },
        { k: 'auditTeam', label: 'Audit support team', type: 'text' },
        { k: 'auditeeRep', label: 'Auditee representative(s)', type: 'text' },
        { k: 'auditPurpose', label: 'Purpose and scope of the audit', type: 'textarea', full: true },
        { k: 'agenda', label: 'Audit schedule (agenda)', type: 'table', full: true, cols: [{ k: 'date', label: 'Date', type: 'date' }, { k: 'time', label: 'Time' }, { k: 'activity', label: 'Activity / area' }, { k: 'participants', label: 'Participants' }] },
        sec('Quality review result (approved supplier list JRS/FRM/QAS/005)', { part: 'A', showIf: (d, st) => !RISK_STAGES.includes(st), edit: { 'Under Quality Review': ['qa'], 'On Hold': ['qa'], Approved: ['qa'] } }),
        { k: 'approvedFor', label: 'Supplier approved for (materials / services)', type: 'text', full: true },
        { k: 'effectiveDate', label: 'Effective date', type: 'date' },
        { k: 'requalDate', label: 'Requalification date (suggested from the risk level frequency; can be changed)', type: 'date' },
        { k: 'qtaRef', label: 'Quality technical agreement (signed after a successful audit, before commercial procurement)', type: 'text' },
        { k: 'approvedOn', label: 'Approved on', type: 'readonly', fmt: 'date' },
        { k: 'qaConclusion', label: 'QA conclusion', type: 'textarea', full: true },
        sec('Qualification history (previous qualification cycles)', { showIf: (d) => (d.qualHistory || []).length > 0, edit: {} }),
        { k: 'qualHistory', label: 'Previous qualifications', type: 'table', full: true, cols: [{ k: 'cycle', label: 'Cycle' }, { k: 'riskLevel', label: 'Risk level (RPN)' }, { k: 'auditType', label: 'Evaluation' }, { k: 'effectiveDate', label: 'Effective date', type: 'date' }, { k: 'requalDate', label: 'Requalification date', type: 'date' }, { k: 'outcome', label: 'Outcome' }] }
      ],
      compute: {
        rpn: (d) => supRisk(d).rpn ? String(supRisk(d).rpn) : '',
        riskLevel: (d) => supRisk(d).level,
        auditType: (d) => supRisk(d).audit,
        auditFrequency: (d) => supRisk(d).frequency
      },
      // risk assessment (QA) → Head of Department review → audit decided, Under Quality Review → Approved / Rejected / On Hold;
      // requalification repeats the cycle
      states: ['Risk Assessment', 'HOD Review', 'Under Quality Review', 'Approved', 'On Hold', 'Rejected'],
      transitions: [
        t('Risk Assessment', 'HOD Review', 'Submit risk assessment to Head of Department', ['qa'], { part: 'R', sign: 'Risk assessment prepared – QA', needs: ['severity', 'occurrence', 'detection'], checks: ['supHodAvailable'] }),
        t('HOD Review', 'Under Quality Review', 'Approve risk assessment – Head of Department', ['any'], { part: 'H', sign: 'Risk assessment approved – Head of Department', needs: ['hodComment'], checks: ['isHodApprover'] }),
        t('HOD Review', 'Risk Assessment', 'Return to QA', ['any'], { part: 'H', sign: 'Risk assessment returned – Head of Department', reason: true, checks: ['isHodApprover'] }),
        t('Risk Assessment', 'Rejected', 'Reject supplier', ['qa'], { part: 'R', sign: 'Supplier rejected – QA', reason: true }),
        t('Under Quality Review', 'Approved', 'Approve supplier', ['qa'], { part: 'A', sign: 'Supplier approved – QA', needs: ['licenceNo', 'licenceExpiry', 'approvedFor', 'effectiveDate', 'requalDate', 'qaConclusion'], checks: ['supEvaluationDone'] }),
        t('Under Quality Review', 'On Hold', 'Put on hold', ['qa'], { part: 'A', sign: 'Supplier on hold – QA', reason: true }),
        t('Under Quality Review', 'Rejected', 'Reject supplier', ['qa'], { part: 'A', sign: 'Supplier rejected – QA', reason: true }),
        t('Under Quality Review', 'Risk Assessment', 'Return to risk assessment', ['qa'], { reason: true }),
        t('On Hold', 'Under Quality Review', 'Resume quality review', ['qa'], { reason: true }),
        t('On Hold', 'Approved', 'Approve supplier', ['qa'], { part: 'A', sign: 'Supplier approved – QA', needs: ['licenceNo', 'licenceExpiry', 'approvedFor', 'effectiveDate', 'requalDate', 'qaConclusion'], checks: ['supEvaluationDone'] }),
        t('On Hold', 'Rejected', 'Reject supplier', ['qa'], { part: 'A', sign: 'Supplier rejected – QA', reason: true }),
        t('Approved', 'On Hold', 'Put on hold', ['qa'], { part: 'A', sign: 'Supplier on hold – QA', reason: true }),
        t('Approved', 'Risk Assessment', 'Start requalification (same process)', ['qa'], { reason: true })
      ]
    },

    customers: {
      name: 'Customers', single: 'customer', group: 'Supply chain', prefix: 'CUS',
      intro: 'Customer qualification per JRS/SOP/OPS/010 and form JRS/FRM/QAS/010 (new customer creation form). Any department can request a customer qualification and attach the completed form and licences with the request. QA reviews them and qualifies, rejects or puts the customer on hold; after the request only QA can change the record or add documents.',
      numbering: (d, y) => ({ pre: `CUS-${y}-`, pad: 3 }),
      list: ['number', 'title', 'country', 'licenceNo', 'licenceExpiry', 'effectiveDate', 'reviewDate', 'status'],
      // customer master list – qualified customers, downloadable as PDF or CSV
      masterList: { title: 'Customer master list – qualified customers', status: 'Qualified', cols: [['number', 'Customer ID', 90], ['title', 'Customer name', 260], ['country', 'Country', 120], ['effectiveDate', 'Effective date', 110], ['reviewDate', 'Review date', 110]] },
      // the requester attaches documents with the request only; afterwards only QA adds documents
      attachOnRequestOnly: true,
      createTitle: 'Request customer qualification', createLabel: 'Submit request to QA',
      attachHint: 'attach the completed customer form and licence copies now; after the request only QA can add documents',
      createHelp: 'Any department can request a customer qualification. Attach the completed customer form (JRS/FRM/QAS/010, download it from the Customers list) and the licence copy. QA reviews the request and qualifies, rejects or puts the customer on hold.',
      issueForm: { file: 'JRS-FRM-QAS-010 v2.0 New customer creation form.pdf', code: 'JRS/FRM/QAS/010', label: 'New customer creation form (JRS/FRM/QAS/010)', prefill: { 'NAME OF CUSTOMER COMPANYORGANIZATION': 'title', 'SHIP TO ADDRESS': 'address', 'LICENSE': 'licenceNo', 'CUSTOMER ACCOUNT NUMBER': '#number' },
        // issued from the customer record, once per customer; later downloads return the same file (stays fillable)
        fromRecordOnly: true, oncePerCycle: true, inSection: true, issueText: 'Issue customer form', notIssuedText: 'Issued from the customer record.', when: (d, status) => status !== 'Rejected' },
      // customer number CUS-YYYY-NNN, generated when the request is submitted
      numberLabel: 'Customer no.',
      fields: [
        sec('Customer qualification', { part: 'Q', create: true, edit: { 'Under QA Review': ['qa'], 'On Hold': ['qa'], Qualified: ['qa'] } }),
        { k: 'title', label: 'Customer name', type: 'text', req: true, full: true },
        { k: 'country', label: 'Country', type: 'text', req: true },
        { k: 'address', label: 'Ship-to address', type: 'textarea', req: true, full: true },
        { k: 'licenceNo', label: 'Licence no.', type: 'text', req: true },
        { k: 'licenceExpiry', label: 'Licence expiry date', type: 'date', req: true },
        { k: 'licenceLink', label: 'Licence verification link (register entry, if available)', type: 'url', full: true },
        { k: 'effectiveDate', label: 'Effective date (qualification date; set automatically when qualified if empty)', type: 'date' },
        { k: 'reviewDate', label: 'Review date (next customer review)', type: 'date' },
        { k: 'requesterDept', label: 'Requesting department', type: 'readonly', optionLabels: DEPTS },
        { type: 'issue', label: 'Customer form' }
      ],
      states: ['Under QA Review', 'Qualified', 'On Hold', 'Rejected'],
      transitions: [
        t('Under QA Review', 'Qualified', 'Qualify customer', ['qa'], { part: 'Q', sign: 'Customer qualified – QA', needs: ['licenceNo', 'licenceExpiry', 'reviewDate'], checks: ['custLicenceValid', 'custReviewDate', 'custDocuments'] }),
        t('Under QA Review', 'On Hold', 'Put on hold', ['qa'], { part: 'Q', sign: 'Put on hold – QA', reason: true }),
        t('Under QA Review', 'Rejected', 'Reject customer', ['qa'], { part: 'Q', sign: 'Customer rejected – QA', reason: true }),
        t('On Hold', 'Qualified', 'Qualify customer', ['qa'], { part: 'Q', sign: 'Customer qualified – QA', needs: ['licenceNo', 'licenceExpiry', 'reviewDate'], checks: ['custLicenceValid', 'custReviewDate', 'custDocuments'] }),
        t('On Hold', 'Rejected', 'Reject customer', ['qa'], { part: 'Q', sign: 'Customer rejected – QA', reason: true }),
        t('Qualified', 'On Hold', 'Put on hold', ['qa'], { part: 'Q', sign: 'Put on hold – QA', reason: true })
      ]
    },

    helpdesk: {
      name: 'Help desk', single: 'help ticket', group: 'Help', prefix: 'HLP',
      intro: 'Report an error or a problem with the eQMS. Every employee can raise a ticket; it goes to the system administrators, who are notified by e-mail. You see your own tickets; administrators see all of them.',
      numbering: (d, y) => ({ pre: `HLP-${y}-`, pad: 3 }),
      numberLabel: 'Ticket no.',
      // employees see the tickets they raised; administrators (and management) see all
      ownOnly: true,
      attachOnCreate: true, // screenshots with the ticket
      createTitle: 'Raise a ticket', createLabel: 'Send to the administrators',
      createHelp: 'Describe what you were doing, what happened and what you expected. Add a screenshot if you can.',
      list: ['number', 'title', 'category', 'priority', 'area', 'assignedTo', 'status'],
      fields: [
        sec('Ticket', { create: true, edit: { Open: ['initiator'] } }),
        { k: 'title', label: 'Short summary', type: 'text', req: true, full: true },
        { k: 'category', label: 'Category', type: 'select', req: true, def: 'Error / something does not work', options: ['Error / something does not work', 'Cannot sign in / access or permission', 'Question / how do I…', 'Change or improvement request', 'Other'] },
        { k: 'priority', label: 'Priority', type: 'select', req: true, def: 'Medium', options: ['High – I cannot work', 'Medium', 'Low'] },
        { k: 'area', label: 'Where in the system (module or page)', type: 'text' },
        { k: 'description', label: 'What happened (steps, error message, what you expected)', type: 'textarea', req: true, full: true },
        sec('Administrator', { edit: { Open: ['admin'], 'In Progress': ['admin'] } }),
        { k: 'assignedTo', label: 'Assigned to (administrator)', type: 'readonly', fmt: 'user' },
        { k: 'adminNotes', label: 'Notes / reply to the employee', type: 'textarea', full: true },
        { k: 'resolution', label: 'Resolution (what was done)', type: 'textarea', full: true }
      ],
      states: ['Open', 'In Progress', 'Resolved', 'Closed', 'Cancelled'],
      transitions: [
        t('Open', 'In Progress', 'Take the ticket', ['admin']),
        t('Open', 'Resolved', 'Resolve', ['admin'], { needs: ['resolution'] }),
        t('In Progress', 'Resolved', 'Resolve', ['admin'], { needs: ['resolution'] }),
        t('Resolved', 'Closed', 'Confirm it is fixed', ['any'], { checks: ['isInitiator'] }),
        t('Resolved', 'In Progress', 'Not fixed – reopen', ['any'], { checks: ['isInitiator'], reason: true }),
        t('Open', 'Cancelled', 'Cancel ticket', ['any'], { checks: ['isInitiator'], reason: true })
      ]
    },

    comparators: {
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
    },

    packaging: {
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
    },

    labels: {
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
    },

    randomization: {
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
    },

    risks: {
      name: 'Risk assessments', single: 'risk assessment', group: 'Compliance', prefix: 'RA',
      intro: 'Quality risk management per JRS/SOP/QAS/020 and ICH Q9(R1): FMEA on form JRS/FRM/QAS/036, RPN = severity × occurrence × detection (each 1–5), register JRS/FRM/QAS/037. Minor 1–19 · Moderate 20–44 · Major 45–79 · Critical 80–125.',
      numbering: (d, y) => ({ pre: `RA/JRS/${y}-`, pad: 3 }),
      list: ['number', 'title', 'site', 'highestRisk', 'status'],
      fields: [
        { k: 'site', label: 'Applicable site', type: 'select', req: true, options: SITES },
        { k: 'title', label: 'Title of risk assessment', type: 'text', req: true, full: true },
        { k: 'referenceDoc', label: 'Reference document no. (if applicable)', type: 'recordref', refTypes: ['changes', 'investigations', 'capa', 'selfinspections', 'extaudits', 'documents'] },
        { k: 'team', label: 'Team (SMEs and a person knowledgeable in QRM)', type: 'text', full: true },
        { k: 'scope', label: 'Scope / process assessed', type: 'textarea', full: true },
        { k: 'fmea', label: 'FMEA – scores 1 to 5 for severity (S), occurrence (O) and detection (D)', type: 'table', full: true, rowCompute: fmeaRow, cols: [
          { k: 'id', label: 'ID#' }, { k: 'step', label: 'Process step' }, { k: 'mode', label: 'Potential failure mode' }, { k: 'effect', label: 'Potential failure effect' },
          { k: 's', label: 'S', type: 'score' }, { k: 'cause', label: 'Potential causes' }, { k: 'o', label: 'O', type: 'score' }, { k: 'control', label: 'Preventive control' }, { k: 'd', label: 'D', type: 'score' },
          { k: 'rpn', label: 'RPN', computed: true }, { k: 'level', label: 'Risk level', computed: true },
          { k: 'mitigation', label: 'Mitigation plan' }, { k: 'ps', label: 'Post S', type: 'score' }, { k: 'po', label: 'Post O', type: 'score' }, { k: 'pd', label: 'Post D', type: 'score' },
          { k: 'prpn', label: 'Post RPN', computed: true }, { k: 'plevel', label: 'Residual level', computed: true },
          { k: 'accept', label: 'Accept risk', options: ['Yes', 'No'] }, { k: 'comments', label: 'Comments / justification' }] },
        { k: 'highestRisk', label: 'Highest current risk', type: 'computed' },
        { k: 'conclusion', label: 'Conclusion', type: 'textarea', full: true },
        { k: 'reviewDate', label: 'Next risk review (optional)', type: 'date' }
      ],
      compute: {
        highestRisk: (d) => {
          const n = Math.max(0, ...(d.fmea || []).map(r => { const c = fmeaRow(r); return +(c.prpn || c.rpn) || 0; }));
          return n ? `${n} – ${rpnLevel(n)}` : '';
        }
      },
      states: ['Draft', 'HOD Review', 'QA Approval', 'Approved', 'Residual Risk Review'],
      transitions: [
        t('Draft', 'HOD Review', 'Submit (prepared by SME)', ['any'], { sign: 'Prepared – SME', needs: ['fmea', 'conclusion'], checks: ['raScores'] }),
        t('HOD Review', 'Draft', 'Return to SME', ['hod'], { reason: true }),
        t('HOD Review', 'QA Approval', 'Head of Department review', ['hod'], { sign: 'Reviewed – Head of Department', checks: ['raScores'] }),
        t('QA Approval', 'QA Approval', 'Senior leadership acceptance of unmitigated Critical risk', ['mgmt'], { sign: 'Risk accepted – senior leadership', checks: ['raCriticalOpen'] }),
        t('QA Approval', 'Draft', 'Return to SME', ['qa'], { reason: true }),
        t('QA Approval', 'Approved', 'Approve risk assessment', ['qa'], { sign: 'Approved – QA Head', sod: true, checks: ['raScores', 'raActions'] }),
        t('Approved', 'Residual Risk Review', 'Re-assess residual risk after mitigation', ['any']),
        t('Residual Risk Review', 'Approved', 'Approve residual risk assessment', ['qa'], { sign: 'Approved – residual risk', checks: ['raScores', 'raActions', 'raResidual'] })
      ]
    },

    mgmtreviews: {
      name: 'Management reviews', single: 'management review', group: 'Compliance', prefix: 'QMR', hideFrom: ['extaud'],
      intro: 'Quarterly quality management review per JRS/SOP/QAS/019 (minutes on form JRS/FRM/QAS/035). Data for all agenda topics and KPIs is compiled from the eQMS. Internal only – not shared with customers or external auditors.',
      numbering: (d) => ({ fixed: `QMR-${d.year}-${d.quarter}` }),
      list: ['number', 'meetingDate', 'nextMeeting', 'status'],
      fields: [
        { k: 'quarter', label: 'Target quarter', type: 'select', req: true, lock: true, options: ['Q1', 'Q2', 'Q3', 'Q4'] },
        { k: 'year', label: 'Year', type: 'number', req: true, lock: true },
        { k: 'meetingDate', label: 'Date of QMR meeting', type: 'date' },
        { k: 'nextMeeting', label: 'Next QMR meeting (planned date)', type: 'date' },
        { k: 'attendees', label: 'Attendance – mandatory attendees must be present', type: 'table', full: true,
          def: [{ name: '', designation: 'Manager Quality Assurance', mandatory: 'Yes', attendance: '' }, { name: '', designation: 'Director International Business', mandatory: 'Yes', attendance: '' }],
          cols: [{ k: 'name', label: 'Name' }, { k: 'designation', label: 'Designation' }, { k: 'mandatory', label: 'Mandatory', options: ['Yes', 'No'] }, { k: 'attendance', label: 'Attendance', options: ['Present', 'Absent'] }] },
        { k: 'prevActions', label: 'Status of actions from the previous QMR', type: 'table', full: true, cols: [{ k: 'from', label: 'From QMR' }, { k: 'recommendation', label: 'Recommendation' }, { k: 'responsibility', label: 'Responsibility' }, { k: 'target', label: 'Target date', type: 'date' }, { k: 'update', label: 'Update' }, { k: 'status', label: 'Status', options: ['Open', 'Closed'] }] },
        { k: 'discussion', label: 'Discussion of the agenda topics (compiled data shown below)', type: 'textarea', full: true, rows: 8 },
        { k: 'actions', label: 'Action plan', type: 'table', full: true, cols: [{ k: 'recommendation', label: 'Recommendation' }, { k: 'responsibility', label: 'Responsibility' }, { k: 'target', label: 'Target completion date', type: 'date' }, { k: 'capa', label: 'CAPA no. (if any)', ref: ['capa'] }, { k: 'remarks', label: 'Remarks' }] },
        { k: 'conclusion', label: 'Conclusion', type: 'textarea', full: true }
      ],
      states: ['Planned', 'Data Compiled', 'Meeting Held', 'Minutes Compiled', 'Authorized'],
      transitions: [
        t('Data Compiled', 'Meeting Held', 'Record meeting held', ['qa'], { needs: ['meetingDate'], checks: ['qmrAttendance'] }),
        t('Meeting Held', 'Minutes Compiled', 'Compile minutes', ['qa'], { sign: 'Compiled – Manager QA', needs: ['discussion', 'conclusion', 'nextMeeting'], checks: ['qmrMinutes'] }),
        t('Minutes Compiled', 'Meeting Held', 'Return minutes for correction', ['mgmt', 'qa'], { reason: true }),
        t('Minutes Compiled', 'Authorized', 'Authorize minutes', ['mgmt'], { sign: 'Authorized – Director / Management Representative', sodWith: 'Compiled' })
      ]
    },

    atreviews: {
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
    }
  };
  // audit trail review scope: every module plus system events (sign-ins, users, settings)
  MODULES.atreviews.fields.find(f => f.k === 'scope').options = [...Object.keys(MODULES).filter(k => k !== 'atreviews'), 'system'];
  MODULES.atreviews.fields.find(f => f.k === 'scope').optionLabels = Object.fromEntries([...Object.entries(MODULES).map(([k, m]) => [k, m.name]), ['system', 'System events (sign-ins, users, settings)']]);

  // Enrich: every transition from any open state to "Reopened" is not allowed; closures are final.
  // phone: country code and a 10-digit number (+1 6315551234, +91-9876543210); e-mail: name@domain.tld
  const PHONE_RE = /^\+\d{1,3}[ -]?\d{10}$/, EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  // module groups switched off for now: nobody sees them, administrators included (MODULE_GROUPS_OFF in .env overrides the list)
  const GROUPS_OFF = ['Compliance', 'Clinical supply', 'Documents & training'];
  const api = { GROUPS_OFF, PHONE_RE, EMAIL_RE, supRisk, ROLES, MAIN_ROLES, DERIVED_ROLES, MODULES, SITES, DEPTS, DEPT_CODES, setDepartments, rpnLevel, fmeaRow, trainingScore, PASS_MARK, TRAINER_PARAMS, TRAINER_PASS, RETENTION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QMS_CONFIG = api;
})(typeof window !== 'undefined' ? window : globalThis);
