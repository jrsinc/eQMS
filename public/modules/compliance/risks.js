/* Module "Risk assessments" (Compliance). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, SITES, t, rpnLevel, fmeaRow } = Q;
  MODULES.risks = {
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
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
