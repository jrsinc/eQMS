/* QualiSuite eQMS — shared configuration (browser + Node).
 * Every module is defined here: fields, workflow states, transitions,
 * which roles may perform them and which require an e-signature.
 * Edit this file to configure the system; both server and UI read it. */
(function (root) {
  const ROLES = {
    admin: 'System administrator',
    qa: 'QA reviewer / QA head / QP',
    rp: 'Responsible Person (GDP)',
    author: 'Document author / owner',
    sme: 'Department reviewer / SME',
    cs: 'Clinical supply manager',
    unblinded: 'Unblinded randomization officer',
    trainer: 'Training coordinator',
    auditor: 'Internal auditor',
    hod: 'Department Head',
    pm: 'Project Manager (client communication)',
    mgmt: 'Senior leadership / Management Representative',
    numgen: 'Record number generator (QA)',
    extaud: 'External auditor / inspector (read-only)',
    user: 'General user'
  };

  const CLASS = ['Critical', 'Major', 'Minor'];
  const SITES = ['JRS INC', 'JRS IND', 'JRS INC SMT'];
  // Division codes per JRS/SOP/QAS/021 (also used in CAPA numbers, JRS/SOP/QAS/006)
  const DEPTS = {
    QAS: 'QAS – Quality Assurance', OPS: 'OPS – Operations', ADM: 'ADM – Administration', PKG: 'PKG – Packaging',
    ENG: 'ENG – Engineering', PMT: 'PMT – Project Management', HRM: 'HRM – Human Resource Management',
    ITS: 'ITS – IT Services', SMT: 'SMT – JRS INC Somerset facility'
  };
  const DEPT_CODES = Object.keys(DEPTS);
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
      intro: 'Quality event investigations per JRS/SOP/QAS/022 (form JRS/FRM/QAS/054, register JRS/FRM/QAS/055). Deviation = event while the item is in JRS custody; complaint = event outside JRS custody reported by a customer, sponsor or other external party.',
      numbering: (d, y) => ({ pre: `JRS-${d.invType === 'Complaint' ? 'COM' : 'DEVN'}-${y}-`, pad: 3 }),
      list: ['number', 'invType', 'title', 'criticality', 'dueDate', 'status'],
      fields: [
        sec('Request to QA', { part: 'R', create: true, edit: { Requested: ['initiator', 'qa'] } }),
        { k: 'invType', label: 'Investigation type', type: 'select', req: true, lock: true, options: ['Deviation', 'Complaint'] },
        { k: 'site', label: 'Applicable JRS site', type: 'select', req: true, options: SITES },
        { k: 'title', label: 'Short description', type: 'text', req: true, full: true },
        { k: 'dateIdentified', label: 'Date identified / received', type: 'date', req: true },
        { k: 'qaNotified', label: 'Date reported to QA (request date)', type: 'readonly', fmt: 'date' },
        { k: 'reporting', label: '24-hour reporting to QA', type: 'computed' },
        { k: 'requestDetails', label: 'What happened – request details for QA', type: 'textarea', req: true, full: true },
        { k: 'requestNo', label: 'Request no.', type: 'readonly' },
        sec('Part 1 (A) – Initiation', { part: 'A', edit: { Initiation: ['initiator'], 'QA Assessment': ['qa'] } }),
        { k: 'dateOpened', label: 'Date opened (number assigned)', type: 'readonly', fmt: 'date' },
        { k: 'dueDate', label: 'Date due (30 calendar days; Critical: 10 working days)', type: 'readonly', fmt: 'date' },
        { k: 'extendedDue', label: 'Extended due date (approved extension request)', type: 'readonly', fmt: 'date' },
        { k: 'respPerson', label: 'Responsible person / SME', type: 'user' },
        { k: 'respDept', label: 'Responsible department', type: 'select', options: DEPT_CODES, optionLabels: DEPTS },
        { k: 'eventOrigin', label: 'Event origin (area / process / party)', type: 'text' },
        { k: 'receivedVia', label: 'Received via (if complaint)', type: 'select', options: ['Email', 'Phone', 'Fax', 'Customer portal', 'Letter', 'Other'] },
        { k: 'clientComplaintNo', label: 'Client complaint no. (if applicable)', type: 'text' },
        { k: 'reportingIndividual', label: 'Name of reporting individual', type: 'text' },
        { k: 'receivedBy', label: 'Complaint received by', type: 'user' },
        { k: 'customer', label: 'Customer / sponsor name', type: 'text' },
        { k: 'customerNotified', label: 'Customer / sponsor notified on', type: 'date' },
        { k: 'notifyStatus', label: 'Customer notification (3 calendar days)', type: 'computed' },
        { k: 'description', label: 'Detailed description', type: 'textarea', full: true },
        { k: 'immediate', label: 'Immediate action taken (containment, segregation, data and evidence preserved)', type: 'textarea', full: true },
        sec('Part 2 (B) – Initial quality review and pre-approval', { part: 'B', edit: { 'QA Assessment': ['qa'] } }),
        { k: 'criticality', label: 'Criticality (if unclear between two, assign the higher)', type: 'select', options: ['Minor', 'Major', 'Critical'] },
        { k: 'fieldAlert', label: 'Field alert report (if complaint)', type: 'select', options: ['No', 'Yes'] },
        { k: 'recall', label: 'Product recall', type: 'select', options: ['No', 'Yes – per JRS/SOP/OPS/013'] },
        { k: 'processStep', label: 'Process step', type: 'text' },
        { k: 'materialStatus', label: 'Current status of material', type: 'select', options: ['Quarantined / on hold', 'Available / released', 'Distributed', 'At investigator site', 'Returned', 'Destroyed', 'Not applicable'] },
        { k: 'impactedAreas', label: 'Impacted area(s) / function(s)', type: 'multicheck', options: ['Comparator sourcing', 'Clinical trial ancillary management', 'Warehousing', 'Receipt', 'Storage', 'Distribution', 'Packaging (kitting & assembly)', 'Returns management', 'Destruction'] },
        { k: 'impactedProducts', label: 'Impacted product(s)', type: 'multicheck', options: ['Blinded', 'Unblinded / open label', 'Randomized', 'Non-randomized', 'Shipper boxes', 'Ancillary supply', 'Bulk drug', 'Finished kit(s)', 'Comparator drug / NIMP', 'Labels', 'TempTale(s)', 'Other'] },
        { k: 'productDetails', label: 'Product / material details (name, lot, kit nos.)', type: 'text', full: true },
        { k: 'tempRange', label: 'Temperature range', type: 'select', options: ['Not applicable', 'Controlled ambient (+15 to +25 °C)', 'Cold chain / refrigerated (+2 to +8 °C)', 'Frozen (-25 to -15 °C)', 'Uncontrolled'] },
        { k: 'qaReviewComment', label: 'Quality approver comment', type: 'textarea', full: true },
        sec('Part 3 (C) – Investigation and evaluation (QA and RP)', { part: 'C', edit: { Investigation: ['qa', 'rp'] } }),
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
        sec('Part 4 (D) – QA / RP evaluation, customer approval and closure', { part: 'D', edit: { Evaluation: ['qa', 'rp'], 'Customer Approval': ['qa', 'pm'] } }),
        { k: 'finalDisposition', label: 'Final disposition', type: 'select', options: ['Not applicable', 'Release / use as is', 'Reject', 'Return to sponsor / supplier', 'Destroy', 'Hold pending customer decision'] },
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
      // Request → QA approval → number assigned → Part 1 (initiator) → Part 2 (QA) → pre-approval (QA + RP) → Part 3 → Part 4 (QA + RP) → customer → closed
      tempNumbering: (d, y) => ({ pre: `REQ-${y}-`, pad: 4 }),
      states: ['Requested', 'Number Assignment', 'Initiation', 'QA Assessment', 'Pre-Approval', 'Investigation', 'Evaluation', 'Customer Approval', 'Closed', 'Rejected', 'Cancelled'],
      transitions: [
        t('Requested', 'Number Assignment', 'Approve request', ['qa'], { part: 'R', sign: 'Request approved – QA', sod: true }),
        t('Requested', 'Rejected', 'Reject request', ['qa'], { part: 'R', sign: 'Request rejected – QA', reason: true }),
        t('Number Assignment', 'Initiation', 'Assign deviation / complaint number', ['numgen'], { part: 'R', sign: 'Number assigned – number generator' }),
        t('Initiation', 'QA Assessment', 'Submit Part 1 to QA', ['any'], { part: 'A', sign: 'Initiated – investigation initiator', needs: ['description', 'immediate'], checks: ['isInitiator'] }),
        t('Initiation', 'Cancelled', 'Cancel (raised in error)', ['qa'], { reason: true, sign: 'Cancelled – QA' }),
        t('QA Assessment', 'Initiation', 'Return Part 1 to initiator', ['qa'], { reason: true }),
        t('QA Assessment', 'Pre-Approval', 'Complete Part 2 – submit for pre-approval', ['qa'], { part: 'B', sign: 'Assessed – QA (Part 2)', needs: ['description', 'immediate', 'respDept', 'criticality', 'impactedAreas'] }),
        t('Pre-Approval', 'Pre-Approval', 'Pre-approve – QA', ['qa'], { part: 'B', sign: 'Pre-approved – QA', cosign: true, sod: true }),
        t('Pre-Approval', 'Pre-Approval', 'Pre-approve – RP', ['rp'], { part: 'B', sign: 'Pre-approved – RP', cosign: true, sod: true }),
        t('Pre-Approval', 'QA Assessment', 'Return to QA assessment', ['qa', 'rp'], { reason: true }),
        t('Investigation', 'Evaluation', 'Submit investigation (Part 3)', ['qa', 'rp'], { part: 'C', sign: 'Investigation completed – QA / RP', needs: ['investigation', 'historicalReview', 'rootCause', 'riskAssessment', 'conclusion', 'capaRequired'], checks: ['capaDecision'] }),
        t('Evaluation', 'Investigation', 'Return for further investigation', ['qa', 'rp'], { reason: true }),
        t('Evaluation', 'Evaluation', 'Approve Part 4 – QA', ['qa'], { part: 'D', sign: 'Approved – QA evaluation', cosign: true, sod: true, needs: ['finalDisposition', 'customerApproval'], checks: ['capaDecision', 'capaLinked'] }),
        t('Evaluation', 'Evaluation', 'Approve Part 4 – RP', ['rp'], { part: 'D', sign: 'Approved – RP evaluation', cosign: true, sod: true, needs: ['finalDisposition', 'customerApproval'], checks: ['capaDecision', 'capaLinked'] }),
        t('Customer Approval', 'Closed', 'Close – customer approved or deemed closed', ['qa', 'pm'], { part: 'D', sign: 'Closed – customer approval recorded', checks: ['customerClosure'] })
      ],
      // Steps that need two signatures from different people; the record moves on once both are given
      cosign: {
        'Pre-Approval': { meanings: ['Pre-approved – QA', 'Pre-approved – RP'], next: () => 'Investigation' },
        'Evaluation': { meanings: ['Approved – QA evaluation', 'Approved – RP evaluation'], next: (r) => String(r.data.customerApproval).startsWith('Not applicable') ? 'Closed' : 'Customer Approval' }
      }
    },

    rca: {
      name: 'Root cause analysis', group: 'Quality events', prefix: 'RCA',
      intro: '5 Whys and Ishikawa (6M) investigations linked to deviations, complaints and audit findings.',
      list: ['number', 'title', 'method', 'rootCategory', 'status'],
      fields: [
        { k: 'title', label: 'Problem statement', type: 'text', req: true, full: true },
        { k: 'sourceRecord', label: 'Source record no. (deviation, complaint, audit or CAPA)', type: 'recordref', refTypes: ['investigations', 'selfinspections', 'extaudits', 'capa'], req: true },
        { k: 'method', label: 'Method', type: 'select', req: true, options: ['5 Whys', 'Ishikawa (6M)', '5 Whys + Ishikawa', 'Fault tree', 'TapRooT', 'Process mapping', 'Is / Is-not', 'Kepner-Tregoe'] },
        { k: 'team', label: 'RCA team', type: 'text', full: true },
        { k: 'why1', label: 'Why 1', type: 'text', full: true }, { k: 'why2', label: 'Why 2', type: 'text', full: true },
        { k: 'why3', label: 'Why 3', type: 'text', full: true }, { k: 'why4', label: 'Why 4', type: 'text', full: true },
        { k: 'why5', label: 'Why 5', type: 'text', full: true },
        { k: 'fb_man', label: 'Fishbone – Man (people)', type: 'textarea' }, { k: 'fb_machine', label: 'Fishbone – Machine', type: 'textarea' },
        { k: 'fb_method', label: 'Fishbone – Method', type: 'textarea' }, { k: 'fb_material', label: 'Fishbone – Material', type: 'textarea' },
        { k: 'fb_measure', label: 'Fishbone – Measurement', type: 'textarea' }, { k: 'fb_env', label: 'Fishbone – Environment', type: 'textarea' },
        { k: 'rootCategory', label: 'Root-cause category', type: 'select', req: true, options: ['Procedure', 'Equipment', 'Material / supplier', 'Environment', 'Design', 'Management system', 'Human error – slip', 'Human error – lapse', 'Human error – mistake', 'Human error – violation', 'Not identified (most probable cause)'] },
        { k: 'systemic', label: 'Systemic factors evaluated (required before human error)', type: 'textarea', full: true },
        { k: 'conclusion', label: 'Root cause conclusion and contributing factors', type: 'textarea', req: true, full: true }
      ],
      states: ['Draft', 'Under Review', 'Approved'],
      transitions: [
        t('Draft', 'Under Review', 'Submit for QA review', ['any']),
        t('Under Review', 'Draft', 'Return', ['qa'], { reason: true }),
        t('Under Review', 'Approved', 'Approve RCA', ['qa'], { sign: 'Approved', sod: true })
      ]
    },

    capa: {
      name: 'CAPA', group: 'Quality events', prefix: 'CAPA',
      intro: 'Corrective and preventive actions per JRS/SOP/QAS/006 (form JRS/FRM/QAS/006 Parts A–E, register JRS/FRM/QAS/016). Number CAPA/department/serial/year; the serial restarts each year per department.',
      numbering: (d, y) => ({ pre: `CAPA/${d.respDept}/`, suf: '/' + String(y).slice(2), pad: 3 }),
      list: ['number', 'title', 'source', 'respPerson', 'dueDate', 'status'],
      fields: [
        sec('Part A – Initiation'),
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
        { k: 'clientReportDue', label: 'CAPA report to client due', type: 'computed' },
        { k: 'clientReportSent', label: 'CAPA report sent to client on', type: 'date' },
        sec('Part B – Pre-approval'),
        { k: 'hodComment', label: 'Department Head comment', type: 'textarea', full: true },
        { k: 'qaPreComment', label: 'QA comment', type: 'textarea', full: true },
        { k: 'ecRequired', label: 'Effectiveness check', type: 'select', options: ['Required', 'Not required'] },
        { k: 'ecReason', label: 'Reason if effectiveness check is not required', type: 'textarea', full: true },
        { k: 'ecDue', label: 'Effectiveness check due (from QA closure)', type: 'select', options: EC_DUE },
        sec('Part C – Implementation status'),
        { k: 'corrDone', label: 'Correction completed', type: 'textarea', full: true },
        { k: 'corrDate', label: 'Correction – implementation date', type: 'date' },
        { k: 'corrRef', label: 'Correction – reference document no.', type: 'text' },
        { k: 'caDone', label: 'Corrective action(s) taken', type: 'textarea', full: true },
        { k: 'caDate', label: 'Corrective action – implementation date', type: 'date' },
        { k: 'caRef', label: 'Corrective action – reference document no.', type: 'text' },
        { k: 'paDone', label: 'Preventive action(s) taken', type: 'textarea', full: true },
        { k: 'paDate', label: 'Preventive action – implementation date', type: 'date' },
        { k: 'paRef', label: 'Preventive action – reference document no.', type: 'text' },
        sec('Part D – Evaluation and closure by QA'),
        { k: 'closureRemarks', label: 'Remarks for closure by QA', type: 'textarea', full: true },
        { k: 'ecDueDate', label: 'Due date for effectiveness check', type: 'readonly', fmt: 'date' },
        sec('Part E – Effectiveness verification'),
        { k: 'effective', label: 'Is the CAPA effective?', type: 'select', options: ['Yes', 'No'] },
        { k: 'ecRespComment', label: 'Responsible person comment', type: 'textarea', full: true },
        { k: 'ecQaComment', label: 'QA comment', type: 'textarea', full: true }
      ],
      compute: { clientReportDue: (d) => d.clientReported && d.dateOpened ? plusDays(d.dateOpened, 21) + ' (or as directed by the client)' : '' },
      states: ['Initiated', 'HOD Pre-Approval', 'QA Pre-Approval', 'Implementation', 'HOD Verification', 'QA Closure', 'Effectiveness Check', 'Closed', 'Cancelled'],
      transitions: [
        t('Initiated', 'HOD Pre-Approval', 'Submit for pre-approval', ['any'], { checks: ['capaPlan'] }),
        t('Initiated', 'Cancelled', 'Cancel', ['qa'], { reason: true, sign: 'Approved' }),
        t('HOD Pre-Approval', 'QA Pre-Approval', 'Department Head pre-approval', ['hod'], { sign: 'Pre-approved – Department Head' }),
        t('HOD Pre-Approval', 'Initiated', 'Return to initiator', ['hod'], { reason: true }),
        t('QA Pre-Approval', 'Implementation', 'QA pre-approval', ['qa'], { sign: 'Approved – QA', sod: true, needs: ['ecRequired'], checks: ['capaPlan', 'ecDecision'] }),
        t('QA Pre-Approval', 'Initiated', 'Return to initiator', ['qa'], { reason: true }),
        t('Implementation', 'HOD Verification', 'Record implementation', ['any'], { sign: 'Implemented – Responsible Person', checks: ['respOrQa', 'capaImplemented'] }),
        t('HOD Verification', 'Implementation', 'Return – implementation incomplete', ['hod'], { reason: true }),
        t('HOD Verification', 'QA Closure', 'Verify implementation', ['hod'], { sign: 'Verified – Department Head' }),
        t('QA Closure', 'Effectiveness Check', 'QA close – effectiveness check pending', ['qa'], { sign: 'Closed – QA', needs: ['closureRemarks'], checks: ['ecIsRequired'] }),
        t('QA Closure', 'Closed', 'QA close (no effectiveness check)', ['qa'], { sign: 'Closed – QA', needs: ['closureRemarks'], checks: ['ecNotRequired'] }),
        t('Effectiveness Check', 'Closed', 'Record effectiveness verification', ['qa'], { sign: 'Effectiveness verified – QA', needs: ['effective', 'ecQaComment'] })
      ]
    },

    changes: {
      name: 'Change control', group: 'Quality events', prefix: 'CC',
      intro: 'Change control per JRS/SOP/QAS/007 (form JRS/FRM/QAS/007 Parts A–E, register JRS/FRM/QAS/017). A change control must be approved before the change is implemented.',
      numbering: (d, y) => ({ pre: `CC-JRS-${y}-`, pad: 3 }),
      // Request → QA approval → number assigned → Part A (initiator) → Parts B + C (QA) → pre-approval (QA + RP) → optional approvals → implementation → Part D closure (QA + RP) → Part E
      tempNumbering: (d, y) => ({ pre: `REQ-CC-${y}-`, pad: 4 }),
      list: ['number', 'title', 'nature', 'classification', 'dueDate', 'status'],
      fields: [
        sec('Request to QA', { part: 'R', create: true, edit: { Requested: ['initiator', 'qa'], 'QA Assessment': ['qa'] } }),
        { k: 'title', label: 'Short description', type: 'text', req: true, full: true },
        { k: 'nature', label: 'Nature of change', type: 'select', req: true, options: ['Permanent', 'Temporary'] },
        { k: 'requestDetails', label: 'Proposed change and reason – request details for QA', type: 'textarea', req: true, full: true },
        { k: 'requestNo', label: 'Request no.', type: 'readonly' },
        sec('Part A (1) – Initiation', { part: 'A', edit: { Initiation: ['initiator'], 'QA Assessment': ['qa'] } }),
        { k: 'respPerson', label: 'Change control responsible person', type: 'user' },
        { k: 'dateOpened', label: 'Date opened (number assigned)', type: 'readonly', fmt: 'date' },
        { k: 'respDept', label: 'Responsible department', type: 'select', options: DEPT_CODES, optionLabels: DEPTS },
        { k: 'dueDate', label: 'Date due (permanent change: within 90 days)', type: 'date' },
        { k: 'extendedDue', label: 'Extended due date (approved extension request)', type: 'readonly', fmt: 'date' },
        { k: 'tempStart', label: 'Temporary change – start date', type: 'date' },
        { k: 'tempEnd', label: 'Temporary change – end date', type: 'date' },
        { k: 'changeType', label: 'Change type', type: 'multicheck', options: ['Quality system', 'Facility / utilities (HVAC, cold room, freezer, power backup)', 'Equipment / instrument', 'Process / method', 'Clinical trial supply / packaging / labelling', 'Computerized system / eQMS / IRT / IVRS', 'Documentation (SOP, format, record)', 'Regulatory', 'Other'] },
        { k: 'impactedAreas', label: 'Impacted area(s)', type: 'multicheck', options: ['Comparator sourcing', 'Clinical trial ancillaries', 'Labelling', 'Secondary packaging', 'Storage (+15 to +25 °C)', 'Storage (+2 to +8 °C)', 'Storage (−25 to −15 °C)', 'Distribution', 'Returns', 'Destruction', 'Other'] },
        { k: 'current', label: 'Current practice / situation', type: 'textarea', full: true },
        { k: 'description', label: 'Description of change', type: 'textarea', full: true },
        { k: 'justification', label: 'Reason / justification for change', type: 'textarea', full: true },
        sec('Part B (2) – Impact assessment (QA)', { part: 'B', edit: { 'QA Assessment': ['qa'] } }),
        { k: 'impactCheck', label: 'Impact assessment', type: 'checklist', full: true, rows: ['Subject / patient safety', 'Product quality / integrity', 'Data integrity (ALCOA+)', 'GMP / GCP / GDP compliance', 'Client requirement (client notification / approval required)', 'Regulatory filings', 'Validation / qualification', 'Cold chain', 'Labelling / packaging', 'Computer system (21 CFR Part 11)', 'Training requirement'] },
        { k: 'impactSummary', label: 'Impact summary', type: 'textarea', full: true },
        { k: 'classification', label: 'Change classification', type: 'select', options: ['Minor', 'Major', 'Critical'] },
        { k: 'classRationale', label: 'Classification rationale', type: 'textarea', full: true },
        { k: 'riskRequired', label: 'Risk assessment (JRS/SOP/QAS/020)', type: 'select', options: ['Required', 'Not required'] },
        { k: 'riskRef', label: 'Risk assessment reference', type: 'recordref', refTypes: ['risks'] },
        sec('Implementation plan (Part B) – activity closure dates are updated during implementation', { edit: { 'QA Assessment': ['qa'], Implementation: ['initiator', 'responsible', 'qa'] } }),
        { k: 'plan', label: 'Implementation plan', type: 'table', full: true, cols: [{ k: 'activity', label: 'Activity' }, { k: 'dept', label: 'Responsible department' }, { k: 'person', label: 'Responsible person' }, { k: 'due', label: 'Target due date', type: 'date' }, { k: 'closed', label: 'Activity closure date', type: 'date' }] },
        sec('Part C (3) – Pre-approval (QA and RP)', { part: 'C', edit: { 'QA Assessment': ['qa'] } }),
        { k: 'clientPre', label: 'Client pre-communication', type: 'select', options: ['Required', 'Not required'] },
        { k: 'clientPost', label: 'Client post-communication', type: 'select', options: ['Required', 'Not required'] },
        { k: 'clientComments', label: 'Client communication comments', type: 'textarea', full: true },
        { k: 'pm', label: 'Person responsible for client communication (Project Manager)', type: 'user' },
        { k: 'ecRequired', label: 'Effectiveness check', type: 'select', options: ['Required', 'Not required'] },
        { k: 'ecReason', label: 'Reason if effectiveness check is not required', type: 'textarea', full: true },
        { k: 'ecDue', label: 'Effectiveness check due (from final implementation)', type: 'select', options: EC_DUE },
        { k: 'optionalDepts', label: 'Optional approvals – impacted departments (max. 4)', type: 'multicheck', max: 4, options: DEPT_CODES, optionLabels: DEPTS },
        sec('Part D (4) – Closure (QA and RP)', { part: 'D', edit: { Implementation: ['initiator', 'responsible', 'qa'], 'Pending Closure': ['qa', 'rp', 'pm'] } }),
        { k: 'finalImplDate', label: 'Date of final implementation', type: 'date' },
        { k: 'restored', label: 'Temporary change – original condition restored', type: 'select', options: ['Yes', 'No'] },
        { k: 'finalSummary', label: 'Final summary', type: 'textarea', full: true },
        { k: 'clientCommunicated', label: 'Client communicated (by Project Manager)', type: 'select', options: ['Yes', 'No', 'N/A'] },
        { k: 'ecDueDate', label: 'Due date for effectiveness check', type: 'readonly', fmt: 'date' },
        sec('Part E (5) – Effectiveness verification', { part: 'E', edit: { 'Closed – EC Pending': ['qa', 'responsible'] } }),
        { k: 'effective', label: 'Is the change effective?', type: 'select', options: ['Yes', 'No', 'N/A'] },
        { k: 'ecRespComment', label: 'Responsible person comment', type: 'textarea', full: true },
        { k: 'ecQaComment', label: 'QA comment', type: 'textarea', full: true }
      ],
      states: ['Requested', 'Number Assignment', 'Initiation', 'QA Assessment', 'Pre-Approval', 'Optional Approvals', 'Implementation', 'Pending Closure', 'Closed – EC Pending', 'Closed', 'Rejected', 'Cancelled'],
      transitions: [
        t('Requested', 'Number Assignment', 'Approve request', ['qa'], { part: 'R', sign: 'Request approved – QA', sod: true }),
        t('Requested', 'Rejected', 'Reject request', ['qa'], { part: 'R', sign: 'Request rejected – QA', reason: true }),
        t('Number Assignment', 'Initiation', 'Assign change control number', ['numgen'], { part: 'R', sign: 'Number assigned – number generator' }),
        t('Initiation', 'QA Assessment', 'Submit Part A to QA', ['any'], { part: 'A', sign: 'Initiated – change initiator', needs: ['respPerson', 'respDept', 'dueDate', 'changeType', 'description', 'justification'], checks: ['isInitiator', 'ccDue90', 'ccTemp'] }),
        t('Initiation', 'Cancelled', 'Cancel (raised in error)', ['qa'], { reason: true, sign: 'Cancelled – QA' }),
        t('QA Assessment', 'Initiation', 'Return Part A to initiator', ['qa'], { reason: true }),
        t('QA Assessment', 'Pre-Approval', 'Complete Parts B and C – submit for pre-approval', ['qa'], { part: 'B', sign: 'Assessed – QA (Parts B and C)', needs: ['respPerson', 'respDept', 'dueDate', 'changeType', 'description', 'justification', 'impactCheck', 'impactSummary', 'classification', 'classRationale', 'riskRequired', 'plan', 'clientPre', 'clientPost', 'ecRequired'], checks: ['ccDue90', 'ccTemp', 'ccRiskClass', 'ccRiskRef', 'ecDecision', 'ccClientPm'] }),
        t('Pre-Approval', 'Pre-Approval', 'Pre-approve – QA', ['qa'], { part: 'C', sign: 'Pre-approved – QA', cosign: true, sod: true }),
        t('Pre-Approval', 'Pre-Approval', 'Pre-approve – RP', ['rp'], { part: 'C', sign: 'Pre-approved – RP', cosign: true, sod: true }),
        t('Pre-Approval', 'QA Assessment', 'Return to QA assessment', ['qa', 'rp'], { reason: true }),
        t('Pre-Approval', 'Rejected', 'Reject change', ['qa'], { part: 'C', sign: 'Change rejected – QA', reason: true }),
        t('Optional Approvals', 'Implementation', 'Start implementation', ['any'], { checks: ['ccOptional'] }),
        t('Implementation', 'Pending Closure', 'All activities complete – submit for closure', ['any'], { part: 'D', sign: 'Implemented – responsible person', needs: ['finalImplDate', 'finalSummary'], checks: ['isResponsible', 'ccPlanClosed'] }),
        t('Pending Closure', 'Implementation', 'Return – closure incomplete', ['qa', 'rp'], { reason: true }),
        t('Pending Closure', 'Pending Closure', 'Approve closure – QA', ['qa'], { part: 'D', sign: 'Closure approved – QA', cosign: true, checks: ['ccClientComm', 'ccRestored'] }),
        t('Pending Closure', 'Pending Closure', 'Approve closure – RP', ['rp'], { part: 'D', sign: 'Closure approved – RP', cosign: true, checks: ['ccClientComm', 'ccRestored'] }),
        t('Closed – EC Pending', 'Closed', 'Record effectiveness verification', ['qa'], { part: 'E', sign: 'Effectiveness verified – QA', needs: ['effective', 'ecQaComment'] })
      ],
      deptApproval: { state: 'Optional Approvals', field: 'optionalDepts', label: 'Optional approvals' },
      cosign: {
        'Pre-Approval': { meanings: ['Pre-approved – QA', 'Pre-approved – RP'], next: (r) => (r.data.optionalDepts || []).length ? 'Optional Approvals' : 'Implementation' },
        'Pending Closure': { meanings: ['Closure approved – QA', 'Closure approved – RP'], next: (r) => r.data.ecRequired === 'Required' ? 'Closed – EC Pending' : 'Closed' }
      }
    },

    extensions: {
      name: 'Extension requests', single: 'extension request', group: 'Quality events', prefix: 'ER',
      intro: 'Due-date extensions for change controls, deviations, complaints and CAPA (form JRS/FRM/QAS/045). Only one extension per record, requested and approved before the current due date.',
      numbering: (d, y) => ({ pre: `ER-${y}-`, pad: 3 }),
      list: ['number', 'documentId', 'recordType', 'originalDue', 'requestedDate', 'status'],
      fields: [
        { k: 'documentId', label: 'Document ID (record to extend)', type: 'recordref', refTypes: ['investigations', 'capa', 'changes', 'selfinspections'], req: true, lock: true },
        { k: 'scope', label: 'Due date to extend', type: 'select', req: true, lock: true, def: 'Overall due date', options: ['Overall due date', 'Correction (CAPA)', 'Corrective action (CAPA)', 'Preventive action (CAPA)'] },
        { k: 'recordType', label: 'Record type', type: 'readonly' },
        { k: 'originalDue', label: 'Original due date', type: 'readonly', fmt: 'date' },
        { k: 'requestedDate', label: 'Requested extension date', type: 'date', req: true },
        { k: 'justification', label: 'Justification of extension / delay', type: 'textarea', req: true, full: true },
        { k: 'interimUpdate', label: 'Interim update', type: 'textarea', req: true, full: true },
        { k: 'impactAssessment', label: 'Impact assessment (product quality, patient safety, regulatory compliance, business operations)', type: 'textarea', req: true, full: true },
        { k: 'hodComment', label: 'Head of Department comments', type: 'textarea', full: true },
        { k: 'qaComment', label: 'Head of Quality / designee comments', type: 'textarea', full: true }
      ],
      states: ['Draft', 'HOD Review', 'Head of Quality Approval', 'Approved', 'Rejected'],
      transitions: [
        t('Draft', 'HOD Review', 'Submit request', ['any'], { sign: 'Requested', checks: ['erValid'] }),
        t('HOD Review', 'Head of Quality Approval', 'Head of Department approval', ['hod'], { sign: 'Approved – Head of Department', checks: ['erValid'] }),
        t('HOD Review', 'Rejected', 'Reject', ['hod'], { sign: 'Rejected', reason: true }),
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
          { k: 'responsible', label: 'Responsible person' }, { k: 'capa', label: 'CAPA no.', ref: ['capa'] }, { k: 'status', label: 'Status', options: ['Open', 'Complied'] }] },
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
        { k: 'auditorEmail', label: 'Auditor e-mail', type: 'text' },
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
      name: 'Vendors', group: 'Supply chain', prefix: 'VEN',
      intro: 'Supplier qualification, licences, risk score and approved supplier list.',
      list: ['number', 'title', 'category', 'riskLevel', 'licenceExpiry', 'status'],
      fields: [
        { k: 'title', label: 'Vendor legal name', type: 'text', req: true, full: true },
        { k: 'category', label: 'Category', type: 'select', req: true, options: ['API / excipient', 'Primary packaging', 'Secondary packaging components', 'Label stock / printing', 'Comparator source – MAH', 'Comparator source – wholesaler', 'CMO / CPO', 'Testing laboratory', 'Logistics / courier', 'Depot', 'IT / SaaS', 'Calibration / maintenance'] },
        { k: 'address', label: 'Site address', type: 'textarea', full: true },
        { k: 'licences', label: 'Licences / certificates (MIA, WDA, GDP, ISO)', type: 'text', full: true },
        { k: 'licenceExpiry', label: 'Earliest licence / certificate expiry', type: 'date' },
        { k: 'criticality', label: 'Criticality (1–5)', type: 'number' },
        { k: 'performance', label: 'Performance risk (1–5)', type: 'number' },
        { k: 'riskLevel', label: 'Risk level (computed)', type: 'computed' },
        { k: 'qualMethod', label: 'Qualification method', type: 'select', options: ['Questionnaire', 'Paper audit', 'Remote audit', 'On-site audit'] },
        { k: 'qaAgreement', label: 'Quality agreement no. / date', type: 'text' },
        { k: 'requalDate', label: 'Next requalification', type: 'date' },
        { k: 'notes', label: 'Qualification summary', type: 'textarea', full: true }
      ],
      compute: { riskLevel: (d) => { const s = (+d.criticality || 0) * (+d.performance || 0); return s ? (s >= 15 ? 'High (' + s + ')' : s >= 8 ? 'Medium (' + s + ')' : 'Low (' + s + ')') : ''; } },
      states: ['Prospective', 'Under Qualification', 'Approved', 'Conditionally Approved', 'Suspended', 'Disqualified'],
      transitions: [
        t('Prospective', 'Under Qualification', 'Start qualification', ['qa', 'rp', 'cs']),
        t('Under Qualification', 'Approved', 'Approve vendor', ['qa', 'rp'], { sign: 'Approved', sod: true, needs: ['licences', 'qualMethod'] }),
        t('Under Qualification', 'Conditionally Approved', 'Approve with conditions', ['qa', 'rp'], { sign: 'Approved', reason: true }),
        t('Conditionally Approved', 'Approved', 'Lift conditions', ['qa', 'rp'], { sign: 'Approved' }),
        t('Approved', 'Suspended', 'Suspend', ['qa', 'rp'], { sign: 'Approved', reason: true }),
        t('Suspended', 'Approved', 'Reinstate', ['qa', 'rp'], { sign: 'Approved', reason: true }),
        t('Suspended', 'Disqualified', 'Disqualify', ['qa'], { sign: 'Approved', reason: true })
      ]
    },

    customers: {
      name: 'Customers', group: 'Supply chain', prefix: 'CUS',
      intro: 'GDP bona-fides verification for customers, sponsors and clinical sites.',
      list: ['number', 'title', 'customerType', 'licenceNo', 'licenceExpiry', 'status'],
      fields: [
        { k: 'title', label: 'Customer legal name', type: 'text', req: true, full: true },
        { k: 'customerType', label: 'Customer type', type: 'select', req: true, options: ['Wholesaler', 'Pharmacy', 'Hospital', 'Clinical site', 'Sponsor', 'CRO', 'Depot', 'Export customer'] },
        { k: 'address', label: 'Ship-to address', type: 'textarea', full: true },
        { k: 'licenceNo', label: 'Licence / authorisation no.', type: 'text', req: true },
        { k: 'licenceExpiry', label: 'Licence expiry', type: 'date' },
        { k: 'verifiedIn', label: 'Verified in register (e.g. EudraGMDP, national)', type: 'text' },
        { k: 'sanctions', label: 'Sanctions / denied-party screening', type: 'select', options: ['Not done', 'Clear', 'Match – escalated'] },
        { k: 'cd', label: 'Controlled drugs licence held', type: 'checkbox' },
        { k: 'agreement', label: 'Quality / technical agreement', type: 'text' },
        { k: 'notes', label: 'Due-diligence notes', type: 'textarea', full: true }
      ],
      states: ['Pending', 'Qualified', 'Blocked'],
      transitions: [
        t('Pending', 'Qualified', 'Qualify customer (bona fides verified)', ['rp', 'qa'], { sign: 'Approved', needs: ['licenceNo', 'verifiedIn'], checkSanctions: true }),
        t('Qualified', 'Blocked', 'Block customer', ['rp', 'qa'], { reason: true, sign: 'Approved' }),
        t('Blocked', 'Pending', 'Re-open qualification', ['rp', 'qa'], { reason: true })
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
    }
  };

  // Enrich: every transition from any open state to "Reopened" is not allowed; closures are final.
  const api = { ROLES, MODULES, SITES, DEPTS, rpnLevel, fmeaRow, trainingScore, PASS_MARK, TRAINER_PARAMS, TRAINER_PASS, RETENTION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QMS_CONFIG = api;
})(typeof window !== 'undefined' ? window : globalThis);
