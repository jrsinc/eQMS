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
    user: 'General user'
  };

  const CLASS = ['Critical', 'Major', 'Minor'];
  const SITES = ['Site 1 – Manufacturing', 'Site 2 – Wholesale / GDP warehouse', 'Site 3 – Clinical packaging'];

  // Helper to build a transition
  const t = (from, to, label, roles, opts = {}) => ({ from, to, label, roles, ...opts });

  const MODULES = {
    documents: {
      name: 'Documents', group: 'Documents & training', prefix: 'DOC',
      intro: 'Controlled SOPs, work instructions, policies, forms and specifications.',
      list: ['number', 'docType', 'title', 'version', 'status', 'nextReview'],
      fields: [
        { k: 'docType', label: 'Document type', type: 'select', req: true, options: ['Quality Manual', 'Policy', 'SOP', 'Work Instruction', 'Form / Template', 'Specification', 'Master Batch Record', 'Packaging Instruction', 'Label Template', 'Validation Protocol', 'Validation Report', 'Quality Agreement', 'Site Master File'] },
        { k: 'title', label: 'Title', type: 'text', req: true, full: true },
        { k: 'version', label: 'Version', type: 'text', req: true, def: '1.0' },
        { k: 'department', label: 'Department', type: 'select', options: ['Quality Assurance', 'Quality Control', 'Production', 'Clinical Supply', 'Warehouse / GDP', 'Engineering', 'Regulatory Affairs', 'IT'] },
        { k: 'site', label: 'Site', type: 'select', options: SITES },
        { k: 'parent', label: 'Parent document no.', type: 'text' },
        { k: 'trainingImpact', label: 'Training impact', type: 'select', req: true, options: ['None', 'Read & Understand', 'Instructor-led', 'Assessment required'] },
        { k: 'trainingRoles', label: 'Roles to be trained', type: 'multicheck', options: Object.keys(ROLES) },
        { k: 'reviewYears', label: 'Periodic review (years)', type: 'number', def: 2 },
        { k: 'effectiveDate', label: 'Effective date', type: 'date' },
        { k: 'nextReview', label: 'Next periodic review', type: 'date' },
        { k: 'sharepointUrl', label: 'SharePoint link (draft / published)', type: 'text', full: true },
        { k: 'content', label: 'Document content / summary of changes', type: 'textarea', full: true, rows: 10 }
      ],
      states: ['Draft', 'In Review', 'In Approval', 'Effective', 'Superseded', 'Obsolete'],
      transitions: [
        t('Draft', 'In Review', 'Send for review', ['author', 'qa']),
        t('In Review', 'Draft', 'Return to author', ['sme', 'qa'], { reason: true }),
        t('In Review', 'In Approval', 'Complete review', ['sme', 'qa'], { sign: 'Reviewed' }),
        t('In Approval', 'Effective', 'Approve and make effective', ['qa'], { sign: 'Approved', sod: true }),
        t('In Approval', 'Draft', 'Reject', ['qa'], { reason: true }),
        t('Effective', 'Superseded', 'Supersede', ['qa'], { sign: 'Approved', reason: true }),
        t('Effective', 'Obsolete', 'Make obsolete', ['qa'], { sign: 'Approved', reason: true })
      ]
    },

    training: {
      name: 'Training records', group: 'Documents & training', prefix: 'TRN',
      intro: 'Read & understand, classroom, on-the-job and e-learning assignments.',
      list: ['number', 'trainee', 'title', 'trainingType', 'dueDate', 'status'],
      fields: [
        { k: 'trainee', label: 'Trainee (username)', type: 'user', req: true },
        { k: 'title', label: 'Course / document', type: 'text', req: true, full: true },
        { k: 'docRef', label: 'Linked document no.', type: 'text' },
        { k: 'trainingType', label: 'Training type', type: 'select', req: true, options: ['Read & Understand', 'Instructor-led', 'On-the-job', 'e-Learning', 'External', 'GMP/GDP induction', 'Annual refresher'] },
        { k: 'trainer', label: 'Trainer (username)', type: 'user' },
        { k: 'dueDate', label: 'Due date', type: 'date', req: true },
        { k: 'passMark', label: 'Pass mark (%)', type: 'number' },
        { k: 'score', label: 'Assessment score (%)', type: 'number' },
        { k: 'sourceRecord', label: 'Triggered by (CAPA / CC / Deviation no.)', type: 'text' },
        { k: 'notes', label: 'Notes', type: 'textarea', full: true }
      ],
      states: ['Assigned', 'In Progress', 'Completed', 'Failed', 'Cancelled'],
      transitions: [
        t('Assigned', 'In Progress', 'Start', ['any']),
        t('In Progress', 'Completed', 'Sign as trained', ['any'], { sign: 'Trained – read and understood', traineeOnly: true, checkScore: true }),
        t('In Progress', 'Failed', 'Record failed assessment', ['trainer', 'qa'], { reason: true }),
        t('Failed', 'Assigned', 'Re-assign', ['trainer', 'qa']),
        t('Assigned', 'Cancelled', 'Cancel', ['trainer', 'qa'], { reason: true })
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
        { k: 'copyType', label: 'Copy type', type: 'select', req: true, options: ['Controlled – executed record (form / logbook / batch record)', 'Controlled – working copy (SOP / WI)'] },
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

    deviations: {
      name: 'Deviations', group: 'Quality events', prefix: 'DEV',
      intro: 'Unplanned and planned departures from approved procedures, specifications or GDP conditions.',
      list: ['number', 'title', 'category', 'classification', 'dueDate', 'status'],
      fields: [
        { k: 'title', label: 'Short description', type: 'text', req: true, full: true },
        { k: 'planned', label: 'Planned deviation', type: 'checkbox' },
        { k: 'category', label: 'Category', type: 'select', req: true, options: ['Manufacturing', 'Packaging', 'Labelling', 'Laboratory / OOS', 'Equipment', 'Facility / utilities', 'Temperature excursion', 'Documentation', 'Supplier', 'Clinical supply / blinding', 'Data integrity', 'GDP / distribution'] },
        { k: 'classification', label: 'Classification', type: 'select', req: true, options: CLASS },
        { k: 'site', label: 'Site', type: 'select', options: SITES },
        { k: 'occurred', label: 'Date occurred', type: 'date', req: true },
        { k: 'dueDate', label: 'Closure due', type: 'date' },
        { k: 'product', label: 'Product(s)', type: 'text' },
        { k: 'batch', label: 'Batch / lot / kit nos.', type: 'text' },
        { k: 'study', label: 'Clinical study', type: 'text' },
        { k: 'description', label: 'What happened (who, what, where, when)', type: 'textarea', req: true, full: true },
        { k: 'immediate', label: 'Immediate / containment actions', type: 'textarea', full: true },
        { k: 'impact', label: 'Impact assessment (product, other batches, validated state, MA, study, patient)', type: 'textarea', full: true },
        { k: 'reportable', label: 'Regulatory reportable?', type: 'select', options: ['No', 'Yes – field alert / authority', 'Yes – serious breach (CTR)', 'Under assessment'] },
        { k: 'rootCause', label: 'Root cause summary (see linked RCA)', type: 'textarea', full: true },
        { k: 'disposition', label: 'Batch disposition recommendation', type: 'select', options: ['N/A', 'Release', 'Reject', 'Rework', 'Hold pending further data'] }
      ],
      states: ['Open', 'Investigation', 'QA Review', 'Closed', 'Cancelled'],
      transitions: [
        t('Open', 'Investigation', 'QA triage – start investigation', ['qa'], { sign: 'Reviewed' }),
        t('Investigation', 'QA Review', 'Submit investigation', ['sme', 'qa', 'author']),
        t('QA Review', 'Investigation', 'Return for more investigation', ['qa'], { reason: true }),
        t('QA Review', 'Closed', 'Approve and close', ['qa'], { sign: 'Approved', sod: true, needs: ['rootCause'] }),
        t('Open', 'Cancelled', 'Cancel (raised in error)', ['qa'], { reason: true, sign: 'Approved' })
      ]
    },

    rca: {
      name: 'Root cause analysis', group: 'Quality events', prefix: 'RCA',
      intro: '5 Whys and Ishikawa (6M) investigations linked to deviations, complaints and audit findings.',
      list: ['number', 'title', 'method', 'rootCategory', 'status'],
      fields: [
        { k: 'title', label: 'Problem statement', type: 'text', req: true, full: true },
        { k: 'sourceRecord', label: 'Source record no.', type: 'text', req: true },
        { k: 'method', label: 'Method', type: 'select', req: true, options: ['5 Whys', 'Ishikawa (6M)', '5 Whys + Ishikawa', 'Fault tree', 'Is / Is-not', 'Kepner-Tregoe'] },
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
      intro: 'Corrective and preventive actions with effectiveness checks.',
      list: ['number', 'title', 'source', 'owner', 'dueDate', 'status'],
      fields: [
        { k: 'title', label: 'CAPA title', type: 'text', req: true, full: true },
        { k: 'source', label: 'Source', type: 'select', req: true, options: ['Deviation', 'Complaint', 'Internal audit', 'Supplier audit', 'Regulatory inspection', 'OOS / OOT', 'Trend / PQR', 'Management review', 'Risk assessment', 'Recall', 'Self-identified'] },
        { k: 'sourceRecord', label: 'Source record no.', type: 'text' },
        { k: 'actionType', label: 'Action type', type: 'select', req: true, options: ['Correction', 'Corrective action', 'Preventive action'] },
        { k: 'owner', label: 'Action owner (username)', type: 'user', req: true },
        { k: 'dueDate', label: 'Due date', type: 'date', req: true },
        { k: 'rootCause', label: 'Root cause addressed', type: 'textarea', full: true },
        { k: 'plan', label: 'Action plan', type: 'textarea', req: true, full: true },
        { k: 'evidence', label: 'Implementation evidence', type: 'textarea', full: true },
        { k: 'ecCriteria', label: 'Effectiveness check – criteria and method', type: 'textarea', full: true },
        { k: 'ecDate', label: 'Effectiveness check due', type: 'date' },
        { k: 'ecResult', label: 'Effectiveness result', type: 'select', options: ['Pending', 'Effective', 'Not effective – new CAPA raised'] }
      ],
      states: ['Open', 'Plan Approved', 'Implemented', 'Effectiveness Check', 'Closed', 'Cancelled'],
      transitions: [
        t('Open', 'Plan Approved', 'Approve CAPA plan', ['qa'], { sign: 'Approved', sod: true, needs: ['plan', 'ecCriteria'] }),
        t('Plan Approved', 'Implemented', 'Record implementation', ['any'], { sign: 'Implemented', needs: ['evidence'] }),
        t('Implemented', 'Effectiveness Check', 'Verify implementation', ['qa'], { sign: 'Verified' }),
        t('Effectiveness Check', 'Closed', 'Close as effective', ['qa'], { sign: 'Approved', needs: ['ecResult'] }),
        t('Open', 'Cancelled', 'Cancel', ['qa'], { reason: true, sign: 'Approved' })
      ]
    },

    changes: {
      name: 'Change control', group: 'Quality events', prefix: 'CC',
      intro: 'Change control and change management: impact, regulatory assessment, implementation and readiness.',
      list: ['number', 'title', 'changeType', 'classification', 'targetDate', 'status'],
      fields: [
        { k: 'title', label: 'Change title', type: 'text', req: true, full: true },
        { k: 'changeType', label: 'Change type', type: 'select', req: true, options: ['Facility', 'Equipment', 'Process', 'Analytical method', 'Specification', 'Supplier / material', 'Packaging / label artwork', 'Computerised system', 'Document', 'Organisational', 'Regulatory (MA variation)', 'Clinical supply (protocol / label / pack design)'] },
        { k: 'classification', label: 'Classification', type: 'select', req: true, options: CLASS },
        { k: 'duration', label: 'Permanent / temporary', type: 'select', options: ['Permanent', 'Temporary', 'Emergency'] },
        { k: 'targetDate', label: 'Target implementation date', type: 'date' },
        { k: 'current', label: 'Current state', type: 'textarea', full: true },
        { k: 'proposed', label: 'Proposed change', type: 'textarea', req: true, full: true },
        { k: 'justification', label: 'Justification', type: 'textarea', req: true, full: true },
        { k: 'impactAreas', label: 'Impacted areas (SME sign-off required)', type: 'multicheck', options: ['QA', 'QC', 'Production', 'Engineering', 'Validation', 'Regulatory', 'IT / CSV', 'Supply chain', 'Clinical supply', 'EHS', 'Customers / sponsors'] },
        { k: 'impact', label: 'Impact assessment', type: 'textarea', full: true },
        { k: 'regImpact', label: 'Regulatory impact', type: 'select', options: ['None', 'EU Type IA', 'EU Type IB', 'EU Type II', 'US CBE-0', 'US CBE-30', 'US PAS', 'CTA substantial modification', 'Annual report'] },
        { k: 'customerNotify', label: 'Customer / sponsor notification required', type: 'checkbox' },
        { k: 'plan', label: 'Implementation plan (tasks, owners, dates)', type: 'textarea', full: true },
        { k: 'readiness', label: 'Readiness checklist complete', type: 'multicheck', options: ['Documents effective', 'Training complete', 'Validation complete', 'ERP / master data updated', 'Stock reconciled', 'Communication sent'] },
        { k: 'firstBatch', label: 'First batch / kit lot under change', type: 'text' },
        { k: 'review', label: 'Post-implementation review / effectiveness', type: 'textarea', full: true }
      ],
      states: ['Draft', 'Impact Assessment', 'Approved', 'Implementation', 'Post-Implementation Review', 'Closed', 'Rejected'],
      transitions: [
        t('Draft', 'Impact Assessment', 'Submit for impact assessment', ['any']),
        t('Impact Assessment', 'Approved', 'Approve change', ['qa'], { sign: 'Approved', sod: true, needs: ['impact'] }),
        t('Impact Assessment', 'Rejected', 'Reject change', ['qa'], { sign: 'Rejected', reason: true }),
        t('Approved', 'Implementation', 'Start implementation', ['any']),
        t('Implementation', 'Post-Implementation Review', 'Implementation complete', ['any'], { sign: 'Implemented', needs: ['plan'] }),
        t('Post-Implementation Review', 'Closed', 'Close change', ['qa'], { sign: 'Approved', needs: ['review'] })
      ]
    },

    complaints: {
      name: 'Complaints', group: 'Quality events', prefix: 'CMP',
      intro: 'Product, distribution and clinical-kit complaints with adverse-event screening and recall decision.',
      list: ['number', 'title', 'complaintType', 'product', 'received', 'status'],
      fields: [
        { k: 'title', label: 'Summary', type: 'text', req: true, full: true },
        { k: 'source', label: 'Complainant type', type: 'select', req: true, options: ['Customer – wholesaler', 'Pharmacy / hospital', 'Healthcare professional', 'Patient', 'Clinical site', 'Sponsor / CRO', 'Internal'] },
        { k: 'complaintType', label: 'Complaint type', type: 'select', req: true, options: ['Quality defect', 'Packaging / labelling', 'Suspected falsified', 'Distribution / temperature', 'Lack of effect', 'Clinical kit issue', 'Service'] },
        { k: 'received', label: 'Date received', type: 'date', req: true },
        { k: 'customer', label: 'Customer / site', type: 'text' },
        { k: 'product', label: 'Product', type: 'text' },
        { k: 'batch', label: 'Batch / lot', type: 'text' },
        { k: 'kit', label: 'Kit no. / serial no.', type: 'text' },
        { k: 'ae', label: 'Adverse event involved?', type: 'select', req: true, options: ['No', 'Yes – forwarded to PV', 'Unknown'] },
        { k: 'description', label: 'Complaint description (no patient identifiers)', type: 'textarea', req: true, full: true },
        { k: 'hazard', label: 'Health hazard assessment / recall decision', type: 'textarea', full: true },
        { k: 'sample', label: 'Sample status', type: 'select', options: ['No sample', 'Requested', 'Received', 'Retained sample tested'] },
        { k: 'investigation', label: 'Investigation findings', type: 'textarea', full: true },
        { k: 'response', label: 'Response to complainant', type: 'textarea', full: true }
      ],
      states: ['Received', 'Triage', 'Investigation', 'Response', 'Closed'],
      transitions: [
        t('Received', 'Triage', 'Acknowledge', ['qa', 'rp', 'user', 'cs']),
        t('Triage', 'Investigation', 'Triage complete', ['qa', 'rp'], { sign: 'Reviewed', needs: ['ae'] }),
        t('Investigation', 'Response', 'Investigation complete', ['qa', 'sme'], { needs: ['investigation'] }),
        t('Response', 'Closed', 'Approve response and close', ['qa'], { sign: 'Approved', sod: true, needs: ['response'] })
      ]
    },

    audits: {
      name: 'Audits & inspections', group: 'Compliance', prefix: 'AUD',
      intro: 'Internal, supplier, customer-hosted and regulatory audits with findings and commitments.',
      list: ['number', 'title', 'auditType', 'startDate', 'leadAuditor', 'status'],
      fields: [
        { k: 'title', label: 'Audit title', type: 'text', req: true, full: true },
        { k: 'auditType', label: 'Audit type', type: 'select', req: true, options: ['Internal / self-inspection', 'Supplier / vendor', 'Customer-hosted', 'Regulatory inspection', 'CMO / CRO', 'Clinical depot / site', 'Mock inspection'] },
        { k: 'auditee', label: 'Auditee / authority', type: 'text', req: true },
        { k: 'startDate', label: 'Start date', type: 'date', req: true },
        { k: 'endDate', label: 'End date', type: 'date' },
        { k: 'leadAuditor', label: 'Lead auditor', type: 'user' },
        { k: 'scope', label: 'Scope and regulatory basis', type: 'textarea', full: true },
        { k: 'findings', label: 'Findings (one per line: Classification | Finding | Reference)', type: 'textarea', full: true, rows: 8 },
        { k: 'responseDue', label: 'Auditee response due', type: 'date' },
        { k: 'capaRefs', label: 'Linked CAPA nos.', type: 'text' },
        { k: 'outcome', label: 'Overall outcome', type: 'select', options: ['Pending', 'Acceptable', 'Acceptable with conditions', 'Not acceptable'] }
      ],
      states: ['Planned', 'In Progress', 'Report Issued', 'Follow-up', 'Closed'],
      transitions: [
        t('Planned', 'In Progress', 'Start audit', ['auditor', 'qa']),
        t('In Progress', 'Report Issued', 'Issue report', ['auditor', 'qa'], { sign: 'Authored', needs: ['findings'] }),
        t('Report Issued', 'Follow-up', 'Start CAPA follow-up', ['auditor', 'qa']),
        t('Follow-up', 'Closed', 'Close audit', ['qa'], { sign: 'Approved', needs: ['outcome'] })
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
      name: 'Risk assessments', group: 'Compliance', prefix: 'RSK',
      intro: 'ICH Q9(R1) FMEA risk assessments linked to changes, deviations and vendors.',
      list: ['number', 'title', 'process', 'rpn', 'status'],
      fields: [
        { k: 'title', label: 'Failure mode', type: 'text', req: true, full: true },
        { k: 'process', label: 'Process / system', type: 'text', req: true },
        { k: 'linked', label: 'Linked record no.', type: 'text' },
        { k: 'effect', label: 'Effect', type: 'textarea', full: true },
        { k: 'severity', label: 'Severity (1–10)', type: 'number', req: true },
        { k: 'occurrence', label: 'Occurrence (1–10)', type: 'number', req: true },
        { k: 'detection', label: 'Detection (1–10)', type: 'number', req: true },
        { k: 'rpn', label: 'RPN (computed)', type: 'computed' },
        { k: 'controls', label: 'Risk controls / mitigation', type: 'textarea', full: true },
        { k: 'reviewDate', label: 'Next risk review', type: 'date' }
      ],
      compute: { rpn: (d) => { const v = (+d.severity || 0) * (+d.occurrence || 0) * (+d.detection || 0); return v ? String(v) + (v >= 125 ? ' – High' : v >= 60 ? ' – Medium' : ' – Low') : ''; } },
      states: ['Draft', 'Approved', 'Under Review'],
      transitions: [
        t('Draft', 'Approved', 'Approve assessment', ['qa'], { sign: 'Approved', sod: true }),
        t('Approved', 'Under Review', 'Start periodic review', ['any']),
        t('Under Review', 'Approved', 'Re-approve', ['qa'], { sign: 'Approved' })
      ]
    }
  };

  // Enrich: every transition from any open state to "Reopened" is not allowed; closures are final.
  const api = { ROLES, MODULES, SITES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.QMS_CONFIG = api;
})(typeof window !== 'undefined' ? window : globalThis);
