/* Module "Help desk" (Help). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t, sec } = Q;
  MODULES.helpdesk = {
    name: 'Help desk', single: 'help ticket', group: 'Help', prefix: 'HLP',
    intro: 'Report an error or a problem with the eQMS. Every employee can raise a ticket; it goes to the system administrators, who are notified by e-mail. You see your own tickets; administrators see all of them.',
    numbering: (d, y) => ({ pre: `HLP-${y}-`, pad: 3 }),
    numberLabel: 'Ticket no.',
    // employees see the tickets they raised; administrators (and management) see all
    ownOnly: true,
    attachOnCreate: true, // screenshots with the ticket
    createTitle: 'Raise a ticket', createLabel: 'Send to the administrators',
    createHelp: 'Describe what you were doing, what happened and what you expected. Add a screenshot if you can.',
    list: ['number', 'title', 'category', 'priority', 'area', 'assignedTo', 'status'],
    fields: [
      sec('Ticket', { create: true, edit: { Open: ['initiator'] } }),
      { k: 'title', label: 'Short summary', type: 'text', req: true, full: true },
      { k: 'category', label: 'Category', type: 'select', req: true, def: 'Error / something does not work', options: ['Error / something does not work', 'Cannot sign in / access or permission', 'Question / how do I…', 'Change or improvement request', 'Other'] },
      { k: 'priority', label: 'Priority', type: 'select', req: true, def: 'Medium', options: ['High – I cannot work', 'Medium', 'Low'] },
      { k: 'area', label: 'Where in the system (module or page)', type: 'text' },
      { k: 'description', label: 'What happened (steps, error message, what you expected)', type: 'textarea', req: true, full: true },
      sec('Administrator', { edit: { Open: ['admin'], 'In Progress': ['admin'] } }),
      { k: 'assignedTo', label: 'Assigned to (administrator)', type: 'readonly', fmt: 'user' },
      { k: 'adminNotes', label: 'Notes / reply to the employee', type: 'textarea', full: true },
      { k: 'resolution', label: 'Resolution (what was done)', type: 'textarea', full: true }
    ],
    states: ['Open', 'In Progress', 'Resolved', 'Closed', 'Cancelled'],
    transitions: [
      t('Open', 'In Progress', 'Take the ticket', ['admin']),
      t('Open', 'Resolved', 'Resolve', ['admin'], { needs: ['resolution'] }),
      t('In Progress', 'Resolved', 'Resolve', ['admin'], { needs: ['resolution'] }),
      t('Resolved', 'Closed', 'Confirm it is fixed', ['any'], { checks: ['isInitiator'] }),
      t('Resolved', 'In Progress', 'Not fixed – reopen', ['any'], { checks: ['isInitiator'], reason: true }),
      t('Open', 'Cancelled', 'Cancel ticket', ['any'], { checks: ['isInitiator'], reason: true })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
