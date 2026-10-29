/* Module "Action items" (Quality events). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, DEPTS, t, sec } = Q;
  MODULES.actionitems = {
    name: 'Action items', single: 'action item', group: 'Quality events', prefix: 'AI',
    intro: 'Actions arising from a change control, deviation or CAPA (risk assessment, implementation step, qualification, training, document update …). Each action item has an owner and a due date; the owner completes it and QA verifies and closes it. A change control is closed only when all its action items are closed.',
    numbering: (d, y) => ({ pre: `AI-${y}-`, pad: 4 }),
    numberLabel: 'Action item no.',
    createHelp: 'Raise the action item from the change control, deviation or CAPA it belongs to ("Add action item"), or enter the parent record number here.',
    list: ['number', 'title', 'parentRef', 'actionType', 'respPerson', 'dueDate', 'status'],
    fields: [
      sec('Action item', { create: true, edit: { Open: ['initiator', 'qa'] } }),
      { k: 'parentRef', label: 'Parent record (change control, deviation or CAPA)', type: 'recordref', refTypes: ['changes', 'investigations', 'capa'], req: true, lock: true },
      { k: 'title', label: 'Action', type: 'text', req: true, full: true },
      { k: 'actionType', label: 'Type of action', type: 'select', req: true, options: ['Risk assessment', 'Implementation', 'Qualification (IQ / OQ / PQ)', 'Validation', 'Training', 'Document update', 'Client communication', 'Material / product disposition', 'Other'] },
      { k: 'respPerson', label: 'Action owner', type: 'user', req: true },
      { k: 'respDept', label: 'Owner department', type: 'readonly', optionLabels: DEPTS },
      { k: 'dueDate', label: 'Due date', type: 'date', req: true },
      { k: 'description', label: 'What has to be done', type: 'textarea', req: true, full: true },
      sec('Completion (action owner)', { edit: { Open: ['responsible'] } }),
      { k: 'completion', label: 'What was done (evidence, references)', type: 'textarea', full: true },
      { k: 'completedOn', label: 'Completed on', type: 'readonly', fmt: 'date' },
      sec('QA verification', { edit: { Completed: ['qa'] } }),
      { k: 'qaComment', label: 'QA comment', type: 'textarea', full: true }
    ],
    states: ['Open', 'Completed', 'Closed', 'Cancelled'],
    transitions: [
      t('Open', 'Completed', 'Complete action', ['any'], { sign: 'Action completed – owner', needs: ['completion'], checks: ['isRespPerson'] }),
      t('Completed', 'Closed', 'Verify and close', ['qa'], { sign: 'Action verified – QA' }),
      t('Completed', 'Open', 'Return to the owner', ['qa'], { reason: true }),
      t('Open', 'Cancelled', 'Cancel action item', ['qa'], { reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
