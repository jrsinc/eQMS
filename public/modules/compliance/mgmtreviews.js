/* Module "Management reviews" (Compliance). Shared by the browser and the server. */
(function (Q) {
  const { MODULES, t } = Q;
  MODULES.mgmtreviews = {
    name: 'Management reviews', single: 'management review', group: 'Compliance', prefix: 'QMR', hideFrom: ['extaud'],
    intro: 'Quarterly quality management review per JRS/SOP/QAS/019 (minutes on form JRS/FRM/QAS/035). Data for all agenda topics and KPIs is compiled from the eQMS. Internal only – not shared with customers or external auditors.',
    numbering: (d) => ({ fixed: `QMR-${d.year}-${d.quarter}` }),
    list: ['number', 'meetingDate', 'nextMeeting', 'status'],
    fields: [
      { k: 'quarter', label: 'Target quarter', type: 'select', req: true, lock: true, options: ['Q1', 'Q2', 'Q3', 'Q4'] },
      { k: 'year', label: 'Year', type: 'number', req: true, lock: true },
      { k: 'meetingDate', label: 'Date of QMR meeting', type: 'date' },
      { k: 'nextMeeting', label: 'Next QMR meeting (planned date)', type: 'date' },
      { k: 'attendees', label: 'Attendance – mandatory attendees must be present', type: 'table', full: true,
        def: [{ name: '', designation: 'Manager Quality Assurance', mandatory: 'Yes', attendance: '' }, { name: '', designation: 'Director International Business', mandatory: 'Yes', attendance: '' }],
        cols: [{ k: 'name', label: 'Name' }, { k: 'designation', label: 'Designation' }, { k: 'mandatory', label: 'Mandatory', options: ['Yes', 'No'] }, { k: 'attendance', label: 'Attendance', options: ['Present', 'Absent'] }] },
      { k: 'prevActions', label: 'Status of actions from the previous QMR', type: 'table', full: true, cols: [{ k: 'from', label: 'From QMR' }, { k: 'recommendation', label: 'Recommendation' }, { k: 'responsibility', label: 'Responsibility' }, { k: 'target', label: 'Target date', type: 'date' }, { k: 'update', label: 'Update' }, { k: 'status', label: 'Status', options: ['Open', 'Closed'] }] },
      { k: 'discussion', label: 'Discussion of the agenda topics (compiled data shown below)', type: 'textarea', full: true, rows: 8 },
      { k: 'actions', label: 'Action plan', type: 'table', full: true, cols: [{ k: 'recommendation', label: 'Recommendation' }, { k: 'responsibility', label: 'Responsibility' }, { k: 'target', label: 'Target completion date', type: 'date' }, { k: 'capa', label: 'CAPA no. (if any)', ref: ['capa'] }, { k: 'remarks', label: 'Remarks' }] },
      { k: 'conclusion', label: 'Conclusion', type: 'textarea', full: true }
    ],
    states: ['Planned', 'Data Compiled', 'Meeting Held', 'Minutes Compiled', 'Authorized'],
    transitions: [
      t('Data Compiled', 'Meeting Held', 'Record meeting held', ['qa'], { needs: ['meetingDate'], checks: ['qmrAttendance'] }),
      t('Meeting Held', 'Minutes Compiled', 'Compile minutes', ['qa'], { sign: 'Compiled – Manager QA', needs: ['discussion', 'conclusion', 'nextMeeting'], checks: ['qmrMinutes'] }),
      t('Minutes Compiled', 'Meeting Held', 'Return minutes for correction', ['mgmt', 'qa'], { reason: true }),
      t('Minutes Compiled', 'Authorized', 'Authorize minutes', ['mgmt'], { sign: 'Authorized – Director / Management Representative', sodWith: 'Compiled' })
    ]
  };
})(typeof module !== 'undefined' && module.exports ? require('../_shared.js') : window.QMS_SHARED);
