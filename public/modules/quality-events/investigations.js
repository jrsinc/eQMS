/* Module "Deviations & complaints" (Quality events). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, SITES, DEPTS, t, sec, plusDays, dayDiff, todayIso } = Q;
  const YES_NO = ['Yes', 'No'];
  const site = { k: 'site', label: 'Site', options: SITES };
  // owner-side edit rights (Part A) and the investigation stage
  const OWNERS = ['initiator', 'responsible', 'respdept'];
  const isComplaint = (d) => d.invType === 'Complaint';
  MODULES.investigations = {
    name: 'Deviations & complaints', single: 'deviation or complaint', group: 'Quality events', prefix: 'INV',
    intro: 'Quality event investigations per JRS/SOP/QAS/022 (form JRS/FRM/QAS/054, register JRS/FRM/QAS/055). Deviation = event while the item is in JRS custody; complaint = event outside JRS custody reported by a customer, sponsor or other external party. A record is visible to its initiator, the responsible department and its Head, QA and management.',
    numbering: (d, y) => ({ pre: `JRS-${d.invType === 'Complaint' ? 'COM' : 'DEVN'}-${y}-`, pad: 3 }),
    list: ['number', 'invType', 'title', 'site', 'respDept', 'criticality', 'dueDate', 'status'],
    // only the people involved see a record: initiator, responsible person, responsible department and its Head (plus QA, admin, management)
    deptScoped: true,
    fields: [
      // ===== tab: Request =====
      sec('Request to QA', { part: 'R', tab: 'Request', create: true, edit: { Requested: ['initiator', 'qa'], 'Request Update': ['initiator'] } }),
      { k: 'invType', label: 'Investigation type', type: 'select', req: true, lock: true, options: ['Deviation', 'Complaint'] },
      { k: 'site', label: 'Applicable JRS site', type: 'select', req: true, options: SITES },
      { k: 'title', label: 'Short description (what happened + product information, e.g. "1 broken vial of product X lot Y")', type: 'text', req: true, full: true },
      { k: 'dateIdentified', label: 'Date identified / received', type: 'date', req: true },
      { k: 'respPerson', label: 'Responsible person (sets the responsible department)', type: 'user' },
      { k: 'respDept', label: 'Responsible department (department of the responsible person)', type: 'readonly', optionLabels: DEPTS },
      { k: 'qaNotified', label: 'Date reported to QA (request date)', type: 'readonly', fmt: 'date' },
      { k: 'reporting', label: '24-hour reporting to QA', type: 'computed' },
      { k: 'requestDetails', label: 'What happened – request details for QA', type: 'textarea', req: true, full: true },
      { k: 'requestNo', label: 'Request no.', type: 'readonly' },
      { k: 'qaReviewer', label: 'Quality approver notification – initial quality reviewer (notified at the QA request and review; all QA users if empty)', type: 'user' },
      { k: 'qaApprover', label: 'Quality approver (notified at QA evaluation; all QA users if empty)', type: 'user' },

      // ===== tab: Event =====
      sec('Part A – Initiation: general information and event (initiator / responsible department)', { part: 'A', tab: 'Event', edit: { Initiation: OWNERS, 'Part A Update': OWNERS } }),
      { k: 'dateOpened', label: 'Date opened (number assigned)', type: 'readonly', fmt: 'date' },
      { k: 'dueDate', label: 'Date due (30 calendar days; Critical: 10 working days)', type: 'readonly', fmt: 'date' },
      { k: 'originalDue', label: 'Original date due', type: 'readonly', fmt: 'date' },
      { k: 'extendedDue', label: 'Extended due date (approved extension request)', type: 'readonly', fmt: 'date' },
      { k: 'assignedTo', label: 'Assigned to (deviation owner; the responsible person if empty)', type: 'user' },
      { k: 'dvCategory', label: 'Category', type: 'select', options: ['Product complaint', 'Process / procedure', 'Equipment / facility', 'Material', 'Documentation', 'Storage / temperature excursion', 'Distribution / shipment', 'Computerized system', 'Personnel', 'Other'] },
      { k: 'dvSubCategory', label: 'Sub-category', type: 'text' },
      { k: 'refRecord', label: 'Reference record (other deviation, CAPA, change control …)', type: 'recordref', refTypes: ['investigations', 'capa', 'changes', 'extaudits', 'selfinspections', 'vendors', 'customers'] },
      { k: 'otherSites', label: 'Other sites impacted', type: 'multicheck', options: SITES },
      { k: 'division1', label: 'Division type level 1', type: 'select', options: ['Clinical Trial Division (CTD)', 'Commercial', 'Corporate', 'Other'], def: 'Clinical Trial Division (CTD)' },
      { k: 'division2', label: 'Division type level 2', type: 'select', options: ['Clinical', 'Commercial', 'Other'], def: 'Clinical' },
      { k: 'division3', label: 'Division type level 3', type: 'select', options: ['Clinical', 'Commercial', 'Other'], def: 'Clinical' },
      { k: 'eventOrigin', label: 'Event origin (area / process / party)', type: 'text', req: true },
      { k: 'receivedVia', label: 'Received via (if complaint)', type: 'select', options: ['Email', 'Phone', 'Fax', 'Customer portal', 'Letter', 'Other'] },
      { k: 'clientComplaintNo', label: 'Client complaint no. (if applicable)', type: 'text' },
      { k: 'reportingIndividual', label: 'Name of reporting individual', type: 'text' },
      { k: 'receivedBy', label: 'Complaint received by', type: 'user' },
      { k: 'customer', label: 'Customer / sponsor name', type: 'text' },
      { k: 'customerNotified', label: 'Customer / sponsor notified on', type: 'date' },
      { k: 'notifyStatus', label: 'Customer notification (3 calendar days)', type: 'computed' },
      { type: 'guide', label: 'What to write in the detailed description and the immediate action', rows: [
        ['Detailed description – a factual problem statement', [['What', 'Which product or material (name, strength, pack, lot / batch, expiry); if the lot is unknown, say why'], ['Problem', 'What happened compared with what should have happened'], ['When / where', 'Date and time; location, area or line where it happened or where the defect is'], ['Who', 'People involved by title, role or initials (not names); how the issue was discovered'], ['Requirement', 'Number, title and version of the document that was not met, if any']]],
        ['Immediate action – what limited the risk', [['Notifications', 'How and to whom the event was escalated (management, QA, client) and when'], ['Scoping', 'Initial scope and how it was set'], ['Containment', 'What was done to contain the event (e.g. other batches on hold), or why not needed'], ['Corrections', 'Immediate corrections with evidence attached, or why none are needed']]]] },
      { k: 'description', label: 'Detailed description', type: 'textarea', full: true },
      { k: 'immNotifications', label: 'Immediate action – notifications / escalation', type: 'textarea', full: true },
      { k: 'immScoping', label: 'Immediate action – scoping / bracketing', type: 'textarea', full: true },
      { k: 'immContainment', label: 'Immediate action – containment (or why not required)', type: 'textarea', full: true },
      { k: 'immCorrections', label: 'Immediate action – corrections (or why not required)', type: 'textarea', full: true },
      { k: 'immediate', label: 'Immediate action taken – summary (containment, segregation, data and evidence preserved)', type: 'textarea', full: true },
      { k: 'lateOpenReason', label: 'Reason the event was not reported within 1 business day of being identified (if late)', type: 'textarea', full: true },
      sec('Product complaint information', { tab: 'Event', showIf: isComplaint, edit: { Initiation: OWNERS, 'Part A Update': OWNERS, 'QA Review': ['qa'], Investigation: ['responsible', 'respdept'] } }),
      { k: 'complaintOrigin', label: 'Complaint origin', type: 'select', options: ['Client / sponsor', 'Investigator site / pharmacy', 'Patient', 'Depot / distributor', 'Regulatory authority', 'Internal', 'Other'] },
      { k: 'complaintReceivedOn', label: 'Complaint received on', type: 'date' },
      { k: 'clientSeverity', label: 'Client severity', type: 'select', options: ['Low', 'Medium', 'High', 'Not stated'] },
      { k: 'qualityType', label: 'Quality type', type: 'select', options: ['Product quality', 'Packaging / labelling', 'Temperature / cold chain', 'Shipment / delivery', 'Documentation', 'Service', 'Other'] },
      { k: 'qualitySubClass', label: 'Quality type sub-class', type: 'text' },
      { k: 'qualityOtherSubType', label: 'Other quality sub-type', type: 'text' },
      { k: 'sampleRequested', label: 'Sample requested?', type: 'select', options: YES_NO },
      { k: 'sampleReceived', label: 'Sample received?', type: 'select', options: YES_NO },
      { k: 'sampleCount', label: 'Number of samples received', type: 'text' },
      { k: 'sampleHandling', label: 'Sample special handling', type: 'text' },
      { k: 'returnedInspection', label: 'Returned sample inspection (is the defect present as reported? attach photos); if no sample, the effort to obtain it and the review of photos sent', type: 'textarea', full: true },
      { k: 'retentionInspection', label: 'Retain sample inspection (similar defect present? attach photos)', type: 'textarea', full: true },
      { k: 'retentionJustification', label: 'Justification if no retain sample inspection is done', type: 'textarea', full: true },
      { k: 'sampleDisposition', label: 'Disposition of sample', type: 'select', options: ['Retained', 'Returned to client', 'Destroyed', 'Sent for testing', 'Not received'] },
      { type: 'docs', label: 'Complaint attachments', docs: [['complaint', 'Complaint document'], ['returnedSample', 'Returned sample photo'], ['retainSample', 'Retain sample photo']] },

      // ===== tab: Initial quality review =====
      sec('Part B – Initial quality review (locked once QA submits it)', { part: 'B', tab: 'Initial quality review', edit: { 'QA Review': ['qa'] } }),
      { k: 'criticality', label: 'Criticality (if unclear between two, assign the higher)', type: 'select', options: ['Minor', 'Major', 'Critical'] },
      { k: 'criticalityStatement', label: 'Initial criticality statement (impact to patient / product, quality / compliance)', type: 'textarea', full: true },
      { k: 'significantEvent', label: 'Significant event?', type: 'select', options: YES_NO },
      { k: 'fieldAlert', label: 'Field alert report (if complaint)', type: 'select', options: ['No', 'Yes'] },
      { k: 'bioProductDr', label: 'Biological product deviation report?', type: 'select', options: YES_NO },
      { k: 'recall', label: 'Product recall', type: 'select', options: ['No', 'Yes – per JRS/SOP/OPS/013'] },
      { k: 'otherRegNotification', label: 'Other regulatory notification?', type: 'select', options: YES_NO },
      { k: 'escalation', label: 'Assessment / escalation – the decision on recall or regulatory notification, with references (required if any of the above is Yes)', type: 'textarea', full: true },
      { type: 'docs', label: 'Escalation attachments', docs: [['significantEvent', 'Significant event'], ['far', 'Field alert report'], ['bpdr', 'Bio product DR'], ['recall', 'Product recall'], ['otherReg', 'Other regulatory notification']] },
      { k: 'complaintValidity', label: 'Complaint validity (complaints)', type: 'select', options: ['Valid', 'Not valid', 'Undetermined'] },
      { k: 'complaintClassification', label: 'Complaint classification (complaints)', type: 'select', options: ['Confirmed', 'Not confirmed', 'Unable to confirm'] },
      { k: 'processStep', label: 'Process step', type: 'text' },
      { k: 'materialStatus', label: 'Current status of material', type: 'select', options: ['Quarantined / on hold', 'Available / released', 'Distributed', 'At investigator site', 'Returned', 'Destroyed', 'Not applicable'] },
      { k: 'impactedAreas', label: 'Impacted area(s) / function(s)', type: 'multicheck', options: ['Comparator sourcing', 'Clinical trial ancillary management', 'Warehousing', 'Receipt', 'Storage', 'Distribution', 'Packaging (kitting & assembly)', 'Returns management', 'Destruction'] },
      { k: 'impactedProducts', label: 'Impacted product(s)', type: 'multicheck', options: ['Blinded', 'Unblinded / open label', 'Randomized', 'Non-randomized', 'Shipper boxes', 'Ancillary supply', 'Bulk drug', 'Finished kit(s)', 'Comparator drug / NIMP', 'Labels', 'TempTale(s)', 'Other'] },
      { k: 'productDetails', label: 'Product / material details (name, lot, kit nos.)', type: 'text', full: true },
      { k: 'tempRange', label: 'Temperature range', type: 'select', options: ['Not applicable', 'Controlled ambient (+15 to +25 °C)', 'Cold chain / refrigerated (+2 to +8 °C)', 'Frozen (-25 to -15 °C)', 'Uncontrolled'] },
      { k: 'qaReviewComment', label: 'QA review comment', type: 'textarea', full: true },
      sec('Product information – materials, products, equipment, rooms, systems', { tab: 'Initial quality review', edit: { Initiation: OWNERS, 'Part A Update': OWNERS, 'QA Review': ['qa'], Investigation: ['responsible', 'respdept'] } }),
      { k: 'materialImpacted', label: 'Is material impacted?', type: 'select', options: YES_NO },
      { k: 'materials', label: 'Material grid', type: 'table', full: true, cols: [site, { k: 'code', label: 'Material code' }, { k: 'desc', label: 'Material description' }, { k: 'lot', label: 'Local material lot' }] },
      { k: 'productImpacted', label: 'Is product impacted?', type: 'select', options: YES_NO },
      { k: 'products', label: 'Product grid', type: 'table', full: true, cols: [site, { k: 'code', label: 'Product code' }, { k: 'desc', label: 'Product description' }, { k: 'lot', label: 'Local product lot' }, { k: 'qty', label: 'Qty under investigation' }, { k: 'rejected', label: 'Recommend batch rejected?', options: YES_NO }, { k: 'comment', label: 'Comment' }] },
      { k: 'equipmentInvolved', label: 'Equipment operation involved?', type: 'select', options: YES_NO },
      { k: 'calibrationInvolved', label: 'Calibration involved?', type: 'select', options: YES_NO },
      { k: 'equipment', label: 'Equipment grid', type: 'table', full: true, cols: [site, { k: 'asset', label: 'Asset ID' }, { k: 'desc', label: 'Equipment description' }] },
      { k: 'rooms', label: 'Room grid', type: 'table', full: true, cols: [site, { k: 'room', label: 'Room no.' }, { k: 'desc', label: 'Room description' }] },
      { k: 'processInvolved', label: 'Process / product validation involved?', type: 'select', options: YES_NO },
      { k: 'validationId', label: 'Validation ID', type: 'text' },
      { k: 'computerInvolved', label: 'Computer system involved?', type: 'select', options: YES_NO },
      { k: 'otherId', label: 'System / other ID and description', type: 'text' },
      { k: 'masterDocInvolved', label: 'Master document involved?', type: 'select', options: YES_NO },
      { k: 'approvedDocId', label: 'Approved document ID', type: 'text' },
      sec('Internal approvers and notification', { tab: 'Initial quality review', edit: { 'QA Review': ['qa'], Investigation: ['qa'] } }),
      { k: 'approvers', label: 'Internal approvers (up to 5) – they sign at the Head of Department approval; the responsible person and the deviation owner cannot be approvers', type: 'table', full: true, cols: [{ k: 'user', label: 'Approver', type: 'user' }, { k: 'type', label: 'Type of approver', options: ['Functional area approver', 'Subject matter expert', 'Engineering / facilities', 'IT / computerized systems', 'Regulatory', 'Other'] }] },
      { k: 'internalNotify', label: 'Internal notification – people informed of every status change', type: 'table', full: true, cols: [{ k: 'user', label: 'Person', type: 'user' }, { k: 'note', label: 'Reason' }] },
      sec('Client communication', { tab: 'Initial quality review', edit: { Initiation: OWNERS, 'Part A Update': OWNERS, 'QA Review': ['qa'], Investigation: ['responsible', 'respdept', 'pm'] } }),
      { k: 'clientsImpacted', label: 'All clients impacted', type: 'table', full: true, cols: [{ k: 'client', label: 'Client' }, { k: 'study', label: 'Study / protocol' }, { k: 'note', label: 'Note' }] },
      { k: 'clientLiaison', label: 'Client contact liaison', type: 'text' },
      { k: 'emailClientLiaison', label: 'E-mail the client liaison?', type: 'select', options: YES_NO },
      { k: 'clientCommRequired', label: 'Client communication required?', type: 'select', options: YES_NO },
      { k: 'clientCommResp', label: 'Responsible for client communication', type: 'user' },
      { k: 'clientCommComments', label: 'Client communication comments', type: 'textarea', full: true },

      // ===== tab: Investigation =====
      sec('Part C – Investigation and root cause analysis (responsible person / department)', { part: 'C', tab: 'Investigation', edit: { Investigation: ['responsible', 'respdept'] } }),
      { k: 'invActions', label: 'Investigation plan – actions (each action with a person and target date becomes an action item once the record number is assigned)', type: 'table', full: true, cols: [{ k: 'action', label: 'Action' }, { k: 'person', label: 'Assigned to', type: 'user' }, { k: 'due', label: 'Target date', type: 'date' }, { k: 'actionItem', label: 'Action item no. (created automatically)', ref: ['actionitems'] }, { k: 'closed', label: 'Closed on (set when the action item is closed)', type: 'date' }] },
      { k: 'invPlan', label: 'Investigation plan – approach, team and techniques / tools', type: 'textarea', full: true },
      { type: 'docs', label: 'Investigation attachments', docs: [['invPlan', 'Investigation plan attachment'], ['evidence', 'Evidence (records, photos, data)']] },
      { k: 'invLog', label: 'Investigation log – add an entry each time the investigation is updated', type: 'table', full: true, cols: [{ k: 'date', label: 'Date', type: 'date' }, { k: 'entry', label: 'Investigation update / finding' }] },
      { type: 'guide', label: 'How to structure the investigation', rows: [
        ['Sections', [['Sequence of events', 'Timeline before and after the event or complaint (manufacturing, packaging, testing, shipment)'], ['Background', 'Process, equipment or information from the complainant needed to understand the event – not the analysis itself'], ['Data and evidence', 'Physical data (samples), position data, records / video, people data (interviews, training); for complaints at least retain sample, batch record and release results'], ['Causal factors and root cause', 'Each causal factor, its root cause and the evidence; how other possible causes were tested and eliminated']]],
        ['Impact and remediation', [['Criticality / impact', 'How patient, product, quality and compliance impact was evaluated; update the criticality if it changed'], ['Product / material disposition', 'Clear batch disposition and the justification'], ['Expanded impact', 'Single event or wider? Other materials, batches (including distributed), equipment or processes; add impacted products to the grid'], ['Remediation', 'Corrections; risk assessment for CAPA per root cause; corrective actions as linked CAPA records']]],
        ['Historical review and conclusion', [['Historical review', 'At least the last 3 years of similar events: source, search criteria, period; same lot, other lots, same process or equipment; annual product review and stability data where relevant'], ['Conclusion', 'In order: what happened, why (root cause), impact assessed, product disposition, corrections, corrective actions or why none are needed (list the CAPA records)']]]] },
      { k: 'seqEvents', label: 'Sequence of events', type: 'textarea', full: true },
      { k: 'background', label: 'Background', type: 'textarea', full: true },
      { k: 'investigation', label: 'Investigation and analysis – data and evidence collection (process records, equipment, data-logger data, training of personnel involved, recall assessment)', type: 'textarea', full: true },
      { k: 'causalFactors', label: 'Causal factor identification and root cause analysis', type: 'textarea', full: true },
      { k: 'rootCauseGrid', label: 'Root cause grid', type: 'table', full: true, cols: [{ k: 'type', label: 'Root cause type', options: ['Human error', 'Method / procedure', 'Equipment / facility', 'Material', 'Environment', 'Measurement', 'Management / system', 'Supplier', 'Undetermined'] }, { k: 'category', label: 'Drill-down category' }, { k: 'level1', label: 'Drill-down level 1' }, { k: 'level2', label: 'Drill-down level 2' }, { k: 'comment', label: 'Comment (associated causal factor)' }] },
      { k: 'rcaTools', label: 'Root cause analysis tools', type: 'multicheck', options: ['Fishbone (6M)', '5 Whys', 'Fault tree analysis', 'TapRooT', 'Process mapping', 'RCA not performed – justified'] },
      { k: 'rootCause', label: 'Root cause / probable root cause (or why it is acceptable to close with the root cause undetermined)', type: 'textarea', full: true },
      { k: 'impactCriticality', label: 'Impact assessment – criticality / impact to patient, product, quality, compliance', type: 'textarea', full: true },
      { k: 'riskAssessment', label: 'Risk / impact assessment (patient safety, quality, identity, packaging & labelling, storage, distribution, other lots, GxP, customer requirements, recurrence)', type: 'textarea', full: true },
      { k: 'productImpact', label: 'Product / material impact and disposition', type: 'textarea', full: true },
      { k: 'expandedImpact', label: 'Expanded impact (other materials, batches, equipment, processes)', type: 'textarea', full: true },
      { k: 'corrections', label: 'Remediation – corrections', type: 'textarea', full: true },
      { k: 'correctiveActions', label: 'Remediation – risk assessment for CAPA and corrective actions (link the CAPA records)', type: 'textarea', full: true },
      { k: 'historicalReview', label: 'Historical review (at least 3 years: prior deviations, complaints, CAPA, recurring failure modes)', type: 'textarea', full: true },
      { k: 'repeatedIncident', label: 'Is this a repeated incident?', type: 'select', options: YES_NO },
      { k: 'repeatedRefs', label: 'Repeated incidents – record numbers with similar causal factors / root cause', type: 'text', full: true },
      { k: 'healthHazardReq', label: 'Health hazard assessment required?', type: 'select', options: YES_NO },
      { k: 'healthHazardSummary', label: 'Health hazard summary (toxicology findings or N/A)', type: 'textarea', full: true },
      { k: 'riskAssessmentAvailable', label: 'Risk assessment available for the product / process?', type: 'select', options: YES_NO },
      { k: 'controlStrategy', label: 'Control strategy in place?', type: 'select', options: YES_NO },
      { k: 'conclusion', label: 'Conclusion', type: 'textarea', full: true },
      { k: 'capaRequired', label: 'CAPA required?', type: 'select', options: ['Yes', 'No'] },
      { k: 'capaJustification', label: 'Justification if no CAPA is required', type: 'textarea', full: true },

      // ===== tab: Approval and closure =====
      sec('Part D – Head of Department approval', { part: 'D', tab: 'Approval and closure', edit: { 'HOD Approval': ['depthead'] } }),
      { k: 'hodApprover', label: 'Approving Head of Department (from the organogram)', type: 'readonly', fmt: 'user' },
      { k: 'hodComment', label: 'Head of Department comment', type: 'textarea', full: true },
      sec('Part E – QA evaluation and closure (final report)', { part: 'E', tab: 'Approval and closure', edit: { 'QA Evaluation': ['qa'], 'Customer Approval': ['qa', 'pm'] } }),
      { k: 'finalDisposition', label: 'Final disposition', type: 'select', options: ['Not applicable', 'Release / use as is', 'Reject', 'Return to sponsor / supplier', 'Destroy', 'Hold pending customer decision'] },
      { k: 'qaEvalComment', label: 'QA evaluation comment (brief; no new information)', type: 'textarea', full: true },
      { k: 'customerApproval', label: 'Customer approval (per QTA)', type: 'select', options: ['Pending', 'Approved by customer', 'Deemed closed – no response after 3 follow-ups', 'Not applicable (no customer impact)'] },
      { k: 'reportSent', label: 'QA-approved report shared with customer on', type: 'date' },
      { k: 'followUp1', label: 'Customer follow-up 1', type: 'date' },
      { k: 'followUp2', label: 'Customer follow-up 2', type: 'date' },
      { k: 'followUp3', label: 'Customer follow-up 3', type: 'date' },
      { k: 'nextFollowUp', label: 'Customer follow-up reminder', type: 'computed' }
    ],
    compute: {
      reporting: (d) => !d.dateIdentified || !d.qaNotified ? '' : dayDiff(d.dateIdentified, d.qaNotified) <= 1 ? 'Met (within 24 hours)' : 'Late (more than 24 hours) – give the reason in Part A',
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
    // → Part B (QA; may return Part A for update; A and B lock when QA submits) → Part C investigation → Head of Department (+ internal approvers)
    // → QA evaluation and closure
    tempNumbering: (d, y) => ({ pre: `REQ-${y}-`, pad: 4 }),
    states: ['Requested', 'Request Update', 'Initiation', 'QA Review', 'Part A Update', 'Investigation', 'HOD Approval', 'QA Evaluation', 'Customer Approval', 'Closed', 'Rejected', 'Cancelled'],
    transitions: [
      t('Requested', 'Initiation', 'Approve request – assign number', ['qa'], { part: 'R', sign: 'Request approved – QA (number assigned)', sod: true, needs: ['respPerson'] }),
      t('Requested', 'Request Update', 'Need to update – return to initiator', ['qa'], { part: 'R', reason: true }),
      t('Requested', 'Rejected', 'Reject request', ['qa'], { part: 'R', sign: 'Request rejected – QA', reason: true }),
      t('Request Update', 'Requested', 'Resubmit request to QA', ['any'], { part: 'R', checks: ['isInitiator'] }),
      t('Initiation', 'QA Review', 'Submit Part A to QA', ['any'], { part: 'A', sign: 'Part A submitted – initiator / responsible person', needs: ['eventOrigin', 'description', 'immediate'], checks: ['isPartAOwner', 'invLateReason'] }),
      t('Initiation', 'Cancelled', 'Cancel (raised in error)', ['qa'], { reason: true, sign: 'Cancelled – QA' }),
      t('QA Review', 'Part A Update', 'Need to update – return Part A', ['qa'], { reason: true }),
      t('Part A Update', 'QA Review', 'Resubmit Part A to QA', ['any'], { part: 'A', optional: true, sign: 'Part A updated – initiator / responsible person', needs: ['eventOrigin', 'description', 'immediate'], checks: ['isPartAOwner', 'invLateReason'] }),
      t('QA Review', 'Investigation', 'Submit Part B – start investigation', ['qa'], { part: 'B', sign: 'Part B approved – QA', sod: true, needs: ['respPerson', 'criticality', 'impactedAreas'], checks: ['invEscalation', 'invApproverList'] }),
      t('Investigation', 'HOD Approval', 'Submit investigation (Part C) to Head of Department', ['any'], { part: 'C', sign: 'Investigation completed – responsible person', needs: ['investigation', 'rootCause', 'riskAssessment', 'conclusion', 'capaRequired'], checks: ['isPartCOwner', 'capaDecision', 'invDetails', 'invActionsClosed', 'invApproverList', 'hodAvailable'] }),
      t('HOD Approval', 'QA Evaluation', 'Approve – Head of Department', ['any'], { part: 'D', sign: 'Approved – Head of Department', checks: ['isHodApprover', 'invApprovals'] }),
      t('HOD Approval', 'Investigation', 'Reject – return to responsible person', ['any'], { part: 'D', sign: 'Rejected – Head of Department', reason: true, checks: ['isHodApprover'] }),
      t('QA Evaluation', 'Closed', 'Approve and close – QA', ['qa'], { part: 'E', sign: 'Approved and closed – QA', sod: true, needs: ['finalDisposition', 'customerApproval', 'qaEvalComment'], checks: ['capaDecision', 'capaLinked', 'customerNotInvolved'] }),
      t('QA Evaluation', 'Customer Approval', 'Approve – send report to customer', ['qa'], { part: 'E', sign: 'Approved – QA (report to customer)', sod: true, needs: ['finalDisposition', 'customerApproval', 'qaEvalComment'], checks: ['capaDecision', 'capaLinked', 'customerInvolved'] }),
      t('QA Evaluation', 'Investigation', 'Reject – return for further investigation', ['qa'], { part: 'E', sign: 'Rejected – QA evaluation', reason: true, needs: ['qaEvalComment'] }),
      t('Customer Approval', 'Closed', 'Close – customer approved or deemed closed', ['qa', 'pm'], { part: 'E', sign: 'Closed – customer approval recorded', checks: ['customerClosure'] })
    ],
    // named internal approvers sign while the Head of Department approves
    deptApproval: { state: 'HOD Approval', field: 'approvalDepts', label: 'Internal approvals', persons: 'approvers' },
    // record page: fields the user can edit now are entered one below the other; the rest show only what is filled in
    reviewView: true
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
