/* QualiSuite eQMS — shared configuration (browser + Node).
 * Roles, departments and the helpers every module definition uses. Each module is defined in its own file
 * (public/modules/<group>/<module>.js); index.js puts them together. Both the server and the browser read them. */
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

  const MODULES = {}; // filled by the module files, in the order of the menu
  const shared = { ROLES, MAIN_ROLES, DERIVED_ROLES, CLASS, SITES, DEPTS, DEPT_CODES, setDepartments, EC_DUE, t, sec, iso, plusDays, dayDiff, todayIso, MONTHS, rpnLevel, score, fmeaRow, DOC_CODES, TRAINING_TYPES, PASS_MARK, trainingScore, TRAINER_PARAMS, TRAINER_PASS, RETENTION, SUP_SEVERITY, SUP_OCCURRENCE, SUP_DETECTION, SUP_GUIDE, supRisk, RISK_STAGES, MODULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = shared; else root.QMS_SHARED = shared;
})(typeof window !== 'undefined' ? window : globalThis);
