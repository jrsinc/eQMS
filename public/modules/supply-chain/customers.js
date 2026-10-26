/* Module "Customers" (Supply chain). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPTS, t, sec } = Q;
  MODULES.customers = {
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
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
