/* Inspection readiness. */
'use strict';
// ---------- readiness ----------
// quarterly audit trail review (QA and admin only): when the last approved review period ended
function atrTile() {
  if (!auditAccess()) return '';
  const last = ALL.filter(r => r.type === 'atreviews' && r.status === 'Approved').sort((a, b) => b.data.periodTo.localeCompare(a.data.periodTo))[0];
  const due = !last || last.data.periodTo < addDaysIso(today(), -92);
  return `<a class="kpi ${due ? 'alert' : 'ok'}" href="#/m/atreviews"><b>${last ? dmy(last.data.periodTo) : 'None'}</b>Audit trail reviewed up to (quarterly review${due ? ' overdue' : ''})</a>`;
}
// readiness items that belong to modules which can be switched off
const READINESS_OFF = { 'Self-inspection responses overdue': 'selfinspections', 'Self-inspection observations not yet complied': 'selfinspections', 'External audit findings past their due date': 'extaudits', 'Risk assessments past review date': 'risks', 'Documents past periodic review': 'documents', 'Overdue training assignments': 'training', 'Approved documents waiting for training past the effective date': 'documents', 'Failed training assessments awaiting retraining': 'training', 'Archived records not returned within 7 working days': 'archives' };
function readiness() {
  const in90 = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), t = today();
  const docsOverdue = ALL.filter(r => r.type === 'documents' && r.status === 'Effective' && r.data.nextReview && r.data.nextReview < t);
  const trn = ALL.filter(r => r.type === 'training' && r.status !== 'Cancelled');
  const compliance = trn.length ? Math.round(100 * trn.filter(r => r.status === 'Completed').length / trn.length) : 100;
  const licences = ALL.filter(r => (r.type === 'vendors' || r.type === 'customers') && !['Disqualified', 'Blocked'].includes(r.status) && r.data.licenceExpiry && r.data.licenceExpiry <= in90);
  const inv = ALL.filter(r => r.type === 'investigations' && !DONE.has(r.status)), ic = MODS.investigations.compute;
  const followUpDue = (r) => { const d = r.data; if (d.customerApproval !== 'Pending' || !d.reportSent) return false; const n = [d.followUp1, d.followUp2, d.followUp3].filter(Boolean).length; return n < 3 && addDaysIso(d.reportSent, 15 * (n + 1)) <= t; };
  const items = [
    ['Deviations and complaints past due date', inv.filter(isOverdue)],
    ['Customer / sponsor not notified within 3 days', inv.filter(r => /^(Overdue|Late)/.test(ic.notifyStatus(r.data)))],
    ['Customer follow-ups due', inv.filter(r => r.status === 'Customer Approval' && followUpDue(r))],
    ['Overdue CAPA (incl. effectiveness checks)', ALL.filter(r => r.type === 'capa' && isOverdue(r))],
    ['Change controls past due date (incl. effectiveness checks)', ALL.filter(r => r.type === 'changes' && isOverdue(r))],
    ['Temporary changes past their end date', ALL.filter(r => r.type === 'changes' && r.data.nature === 'Temporary' && r.data.tempEnd && r.data.tempEnd < t && !DONE.has(r.status) && !r.status.startsWith('Closed'))],
    ...[['Self-inspection responses overdue', ALL.filter(r => r.type === 'selfinspections' && r.status === 'Report Issued' && isOverdue(r))],
    ['Self-inspection observations not yet complied', ALL.filter(r => r.type === 'selfinspections' && !DONE.has(r.status) && (r.data.observations || []).some(o => o.status !== 'Complied'))],
    ['External audit findings past their due date', ALL.filter(r => r.type === 'extaudits' && !DONE.has(r.status) && (r.data.findings || []).some(f => f.status !== 'Closed' && f.due && f.due < t))],
    ['Risk assessments past review date', ALL.filter(r => r.type === 'risks' && r.data.reviewDate && r.data.reviewDate < t)],
    ['Documents past periodic review', docsOverdue], ['Overdue training assignments', trn.filter(isOverdue)],
    ['Approved documents waiting for training past the effective date', ALL.filter(r => r.type === 'documents' && r.status === 'Approved – Training' && isOverdue(r))],
    ['Failed training assessments awaiting retraining', ALL.filter(r => r.type === 'training' && r.status === 'Failed')],
    ['Archived records not returned within 7 working days', ALL.filter(r => r.type === 'archives' && isOverdue(r))]].filter(([l]) => !READINESS_OFF[l] || !isOff(READINESS_OFF[l])),    ['Vendor / customer licences expiring within 90 days', licences]
  ];
  shell('readiness', `<div class="spread"><div><h1>Inspection readiness</h1><p class="muted">Items an inspector is likely to ask about first. Each list links to the records.</p></div></div>
    <div class="kpis">${isOff('training') ? '' : `<div class="kpi ${compliance >= 95 ? 'ok' : 'alert'}"><b>${compliance}%</b>Training compliance (target 95%)</div>`}${isOff('atreviews') ? '' : atrTile()}${items.map(([l, list], i) => `<a class="kpi ${list.length ? 'alert' : 'ok'}" href="#/readiness" data-scroll="r${i}"><b>${list.length}</b>${esc(l)}</a>`).join('')}</div>
    <div class="panel no-print"><h2>Inspection pack</h2><p class="muted small">Export record lists for a period — for the front room / back room during an inspection.</p>
      <div class="row"><label>From <input type="date" id="pf" value="${new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)}"></label><label>To <input type="date" id="pt" value="${t}"></label>
      <select id="pm" style="max-width:240px">${Object.entries(MODS).filter(([, m]) => canSeeModule(m)).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('')}</select><button class="btn primary" id="pe">Export list</button></div></div>
    ${items.map(([l, list], i) => `<h2 id="r${i}" style="margin-top:1.5rem">${esc(l)}</h2>${table(list, ['number', 'module', 'title', 'status'], 'None.')}`).join('')}`);
  bindRows();
  $$('[data-scroll]').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(el.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); }));
  $('#pe').addEventListener('click', () => {
    const k = $('#pm').value, m = MODS[k], f = $('#pf').value, to = $('#pt').value + 'T23:59:59';
    const rows = ALL.filter(r => r.type === k && r.created_at >= f && r.created_at <= to);
    const fs = dataFields(m);
    download(`inspection_${k}_${f}_${$('#pt').value}.csv`, toCsv([['Number', 'Status', 'Created', ...fs.map(x => x.label)], ...rows.map(r => [r.number, r.status, r.created_at, ...fs.map(x => plain(x, r.data[x.k]))])]));
  });
}

