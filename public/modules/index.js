/* QualiSuite eQMS — module definitions, put together (browser + Node).
 * Every module is defined in its own file: fields, workflow states, transitions, which roles may perform them and
 * which require an e-signature. Edit those files to configure the system; both server and UI read them.
 * The browser loads the same files with script tags in index.html, in the order below (the order of the menu). */
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const ORDER = [
    'documents-training/documents.js',
    'documents-training/training.js',
    'documents-training/tni.js',
    'documents-training/trainers.js',
    'documents-training/issues.js',
    'documents-training/archives.js',
    'quality-events/investigations.js',
    'quality-events/capa.js',
    'quality-events/changes.js',
    'quality-events/actionitems.js',
    'quality-events/extensions.js',
    'compliance/selfinspections.js',
    'compliance/sischedule.js',
    'compliance/auditors.js',
    'compliance/extaudits.js',
    'supply-chain/vendors.js',
    'supply-chain/customers.js',
    'help/helpdesk.js',
    'clinical-supply/comparators.js',
    'clinical-supply/packaging.js',
    'clinical-supply/labels.js',
    'clinical-supply/randomization.js',
    'compliance/risks.js',
    'compliance/mgmtreviews.js',
    'compliance/atreviews.js'
  ];
  if (node) for (const f of ORDER) require('./' + f);
  const Q = node ? require('./_shared.js') : root.QMS_SHARED;
  const { ROLES, MAIN_ROLES, DERIVED_ROLES, SITES, DEPTS, DEPT_CODES, setDepartments, rpnLevel, fmeaRow, PASS_MARK, trainingScore, TRAINER_PARAMS, TRAINER_PASS, RETENTION, supRisk, MODULES } = Q;
  // audit trail review scope: every module plus system events (sign-ins, users, settings)
  MODULES.atreviews.fields.find(f => f.k === 'scope').options = [...Object.keys(MODULES).filter(k => k !== 'atreviews'), 'system'];
  MODULES.atreviews.fields.find(f => f.k === 'scope').optionLabels = Object.fromEntries([...Object.entries(MODULES).map(([k, m]) => [k, m.name]), ['system', 'System events (sign-ins, users, settings)']]);

  // Enrich: every transition from any open state to "Reopened" is not allowed; closures are final.
  // phone: country code and a 10-digit number (+1 6315551234, +91-9876543210); e-mail: name@domain.tld
  const PHONE_RE = /^\+\d{1,3}[ -]?\d{10}$/, EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
  // module groups switched off for now: nobody sees them, administrators included (MODULE_GROUPS_OFF in .env overrides the list)
  const GROUPS_OFF = ['Compliance', 'Clinical supply', 'Documents & training'];
  const api = { GROUPS_OFF, PHONE_RE, EMAIL_RE, supRisk, ROLES, MAIN_ROLES, DERIVED_ROLES, MODULES, SITES, DEPTS, DEPT_CODES, setDepartments, rpnLevel, fmeaRow, trainingScore, PASS_MARK, TRAINER_PARAMS, TRAINER_PASS, RETENTION };
  if (node) module.exports = api; else root.QMS_CONFIG = api;
})(typeof window !== 'undefined' ? window : globalThis);
