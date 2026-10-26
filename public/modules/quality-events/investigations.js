/* Module "Deviations & complaints" (Quality events). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, SITES, DEPTS, t, sec, plusDays, dayDiff, todayIso } = Q;
  MODULES.investigations = {
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
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
