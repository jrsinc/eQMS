/* Module "Record archive" (Documents & training). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t, sec, plusDays, RETENTION } = Q;
  MODULES.archives = {
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
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
