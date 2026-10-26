/* Extension requests raised from the due date (JRS/FRM/QAS/045). */
'use strict';
// ---------- extension requests (JRS/FRM/QAS/045), raised from the due date they extend ----------
const EXTENDABLE = { investigations: { dueDate: 'Overall due date' }, changes: { dueDate: 'Overall due date' }, selfinspections: { dueDate: 'Overall due date' },
  capa: { dueDate: 'Overall due date', corrDue: 'Correction (CAPA)', caDue: 'Corrective action (CAPA)', paDue: 'Preventive action (CAPA)' } };
const EXT_DONE = { dueDate: 'extendedDue', corrDue: 'corrExt', caDue: 'caExt', paDue: 'paExt' };
function extensionButtons(rec) {
  for (const [k, scope] of Object.entries(EXTENDABLE[rec.type] || {})) {
    const due = rec.data[k], el = $(`#rf [name="${k}"], #rf [data-computed="${k}"]`), box = el && el.closest('.grid > div');
    if (!due || !box) continue;
    const er = ALL.filter(x => x.type === 'extensions' && x.data.documentId === rec.number && (x.data.scope || 'Overall due date') === scope).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    let html = '';
    if (er && er.status !== 'Rejected') html = `<a class="ext-link" href="#/r/${er.id}">Extension ${esc(er.number)} – ${esc(er.status)}${er.data.requestedDate ? ' (to ' + dmy(er.data.requestedDate) + ')' : ''}</a>`;
    else if (!rec.data[EXT_DONE[k]] && today() <= due) html = `<button type="button" class="btn ext-btn" data-ext="${k}">Request extension</button>`;
    if (html) box.insertAdjacentHTML('beforeend', `<div class="ext-row">${html}</div>`);
  }
  $$('[data-ext]').forEach(b => b.addEventListener('click', () => extensionDialog(rec, b.dataset.ext, EXTENDABLE[rec.type][b.dataset.ext])));
}
async function extensionDialog(rec, k, scope) {
  if (!(await ensureEsigAccepted())) return;
  let created = null;
  const ok = await modal({
    title: 'Request extension – ' + rec.number, ok: 'Sign and submit', okClass: 'primary sign', wide: true,
    html: `<p class="muted small">Extension request (JRS/FRM/QAS/045). It goes to the Head of the record's department, then to the Head of Quality. Only one extension is allowed per due date, and it must be approved before ${dmy(rec.data[k])}.</p>
      <div class="grid"><div><label class="f">Record</label><input type="text" value="${esc(rec.number)} – ${esc(MODS[rec.type].name)}" readonly></div><div><label class="f">Due date to extend</label><input type="text" value="${esc(scope)}: ${dmy(rec.data[k])}" readonly></div>
      <div><label class="f">Requested extension date <span class="req">*</span></label><input type="date" name="requestedDate" min="${addDaysIso(rec.data[k], 1)}"></div><div><label class="f">Requester</label><input type="text" value="${esc(ME.fullname)}${ME.department ? ' – ' + esc(deptName(ME.department)) : ''}" readonly></div></div>
      <div><label class="f">Justification of extension / delay <span class="req">*</span></label><textarea name="justification" rows="4"></textarea></div>
      <div><label class="f">Interim update <span class="req">*</span></label><textarea name="interimUpdate" rows="3"></textarea></div>
      <div><label class="f">Impact assessment (product quality, patient safety, regulatory compliance, business operations) <span class="req">*</span></label><textarea name="impactAssessment" rows="3"></textarea></div>
      <div class="sig-statement">By signing you apply your electronic signature with the meaning <b>Requested</b>. Date and time are recorded by the server (${esc(tz)}).</div>
      <div class="grid"><div><label class="f">User ID</label><input type="text" name="sigUsername" value="${esc(ME.username)}" autocomplete="username"></div><div><label class="f">Password</label><input type="password" name="password" autocomplete="current-password"></div></div>`,
    onOk: async (f) => {
      if (!f.password.value) throw new Error('Enter your password to sign.');
      if (!created) created = await api('POST', '/api/records', { type: 'extensions', linkFrom: rec.id, data: { documentId: rec.number, scope, requestedDate: val(f, 'requestedDate'), justification: val(f, 'justification'), interimUpdate: val(f, 'interimUpdate'), impactAssessment: val(f, 'impactAssessment') } });
      else await api('PUT', '/api/records/' + created.id, { data: { requestedDate: val(f, 'requestedDate'), justification: val(f, 'justification'), interimUpdate: val(f, 'interimUpdate'), impactAssessment: val(f, 'impactAssessment') }, reason: 'Corrected before submission' });
      await api('POST', `/api/records/${created.id}/transition`, { to: 'HOD Review', sigUsername: val(f, 'sigUsername'), password: f.password.value });
      return created;
    }
  });
  if (ok) { toast(`${ok.number} submitted to the Head of Department`); route(); }
  else if (created) { toast(`${created.number} saved as a draft – open it to submit`); route(); }
}
function extensionKpis(rows) {
  const n = (f) => rows.filter(f).length, k = (label, v, st, cls = '') => `<a class="kpi ${cls}" href="#" data-st="${esc(st)}"><b>${v}</b>${esc(label)}</a>`;
  return `<div class="kpis">${k('All extension requests', rows.length, '')}${k('Waiting for Head of Department', n(r => r.status === 'HOD Review'), 'HOD Review', n(r => r.status === 'HOD Review') ? 'warn' : 'ok')}
    ${k('Waiting for Head of Quality', n(r => r.status === 'Head of Quality Approval'), 'Head of Quality Approval', n(r => r.status === 'Head of Quality Approval') ? 'warn' : 'ok')}${k('Approved', n(r => r.status === 'Approved'), 'Approved', 'ok')}${k('Rejected', n(r => r.status === 'Rejected'), 'Rejected')}${k('Drafts not submitted', n(r => r.status === 'Draft'), 'Draft')}</div>`;
}

