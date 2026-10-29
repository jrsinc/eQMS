/* Record page: fields, workflow, attachments, signatures. */
'use strict';
// ---------- record detail ----------
async function detailView(id) {
  const det = await api('GET', '/api/records/' + id), rec = det.record, m = MODS[rec.type], d = rec.data;
  const idx = m.states.indexOf(rec.status);
  const trans = det.transitions;
  const extraBtns = [];
  if (rec.type === 'documents' && rec.status === 'Effective') {
    if (hasRole(['author', 'qa'])) extraBtns.push(`<button class="btn" data-act="revise">Start revision</button>`);
    if (hasRole(['qa', 'admin'])) extraBtns.push(`<button class="btn" data-act="sp">Publish to SharePoint</button>`);
  }
  if (rec.type === 'randomization' && rec.status === 'Draft' && hasRole(['unblinded'])) extraBtns.push(`<button class="btn primary sign" data-act="gen">Generate list</button>`);
  if (rec.type === 'issues' && hasRole(['qa'])) {
    if (rec.status === 'Approved') extraBtns.push(`<button class="btn primary sign" data-act="issue">Print issued copies</button>`);
    if (rec.status === 'Issued') extraBtns.push(`<button class="btn sign" data-act="reissue">Print replacement copy</button>`);
  }
  const open = !DONE.has(rec.status) && !rec.status.startsWith('Closed');
  const canWrite = !ME.roles.every(r => r === 'extaud');
  const isRequest = (rec.type === 'investigations' && ['Requested', 'Request Update', 'Rejected'].includes(rec.status)) || (rec.type === 'changes' && ['Draft', 'QA Review', 'Rejected', 'Cancelled'].includes(rec.status));
  if (canWrite && !isRequest) {
    if (['investigations', 'selfinspections', 'extaudits'].includes(rec.type)) extraBtns.push(`<button class="btn" data-act="spawn" data-to="capa">Raise CAPA</button>`);
    if (['investigations', 'capa', 'extaudits'].includes(rec.type)) extraBtns.push(`<button class="btn" data-act="spawn" data-to="changes">Raise change control</button>`);
    if (['changes', 'investigations', 'capa'].includes(rec.type)) extraBtns.push(`<button class="btn" data-act="spawn" data-to="risks">Start risk assessment</button>`);
    if (['changes', 'investigations', 'capa'].includes(rec.type) && open) extraBtns.push(`<button class="btn" data-act="spawn" data-to="actionitems">Add action item</button>`);
    if (rec.type === 'capa') extraBtns.push(`<button class="btn" data-act="spawn" data-to="training">Assign retraining</button>`);
    if (rec.type === 'mgmtreviews' && ['Planned', 'Data Compiled', 'Meeting Held'].includes(rec.status) && hasRole(['qa'])) extraBtns.push(`<button class="btn primary" data-act="compile">${d.metrics ? 'Re-compile QMR data' : 'Compile QMR data'}</button>`);
  }

  shell(rec.type, `<div class="spread"><div><p class="muted small"><a href="#/m/${rec.type}">${esc(m.name)}</a></p>
    <h1><span class="mono">${esc(rec.number)}</span>${rec.type === 'documents' ? ' <span class="muted">v' + esc(d.version) + '</span>' : ''}</h1>
    <p style="margin:0">${esc(d.title || '')}</p><p class="muted small">Created by ${esc(userName(rec.created_by))} on ${dmyt(rec.created_at)} · Last change ${dmyt(rec.updated_at)}</p></div>
    <div class="row no-print">${pill(rec.status)}${isOverdue(rec) ? '<span class="pill bad">Overdue</span>' : ''}${!det.editable && !open ? '<span class="pill grey" title="The record is closed: no editing">&#128274; Locked</span>' : ''}</div></div>
    ${workflowBar(rec)}
    <div class="record"><div>
      <div class="panel no-print"><h3>Next steps</h3><div class="row">
        ${trans.length ? trans.map((t, i) => `<button class="btn ${t.sign ? 'primary sign' : ''}" data-act="tr" data-i="${i}" ${t.allowed ? '' : 'disabled title="Your roles do not permit this step"'}>${esc(t.label)}</button>`).join('') : extraBtns.length ? '' : '<span class="muted">No workflow steps available from this status.</span>'}
        ${extraBtns.join('')}${m.issueForm && !m.issueForm.inSection && (!m.issueForm.roles || hasRole(m.issueForm.roles)) && (!m.issueForm.when || m.issueForm.when(d, rec.status)) ? `<a class="btn" href="/api/forms/${rec.type}?record=${rec.id}" download title="Controlled form with a numbered issue stamp">Issue ${esc(m.issueForm.label)}</a>` : ''}${rec.type === 'vendors' && d.auditDate && (d.agenda || []).length ? `<a class="btn" href="/api/records/${rec.id}/agenda.pdf" download>Audit agenda (JRS/FRM/QAS/021)</a>` : ''}<a class="btn" href="/api/records/${rec.id}/report.pdf" download title="One PDF: every part, signatures, all PDF and image attachments${det.auditAccess ? ', audit trail' : ''}">Download report (PDF)</a><a class="btn" href="/api/records/${rec.id}/report.pdf?inline=1" target="_blank" rel="noopener">Print report</a><a class="btn" href="/api/records/${rec.id}/report" download title="Original attachment files in a ZIP">Files (ZIP)</a></div></div>
      <form class="panel" id="rf"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Record details</h3>${det.editable ? '<span class="small muted">Changes need a reason and are recorded in the audit trail.</span>' : '<span class="pill grey">Read-only in this status</span>'}</div>
        <div class="grid">${(() => { let s = null; return m.fields.map(f => {
          if (f.type === 'section') { s = f; if (f.showIf && !f.showIf(d, rec.status)) return ''; return fieldHtml(f) + sectionSignatures(m, f, det.signatures); }
          if (s && s.showIf && !s.showIf(d, rec.status)) return '';
          return fieldHtml(f, d[f.k], !det.editable || !!f.lock || !canEditSection(s, rec));
        }).join(''); })()}</div>
        ${det.editable ? '<div class="error" style="margin-top:.8rem"></div><button class="btn primary">Save changes</button>' : ''}</form>
      <div id="special"></div>
      <div class="panel"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Linked records</h3>
        <form id="lk" class="row no-print"><input type="text" name="number" placeholder="Record number, e.g. CAPA/QAS/001/26" list="dl_links" style="max-width:260px" aria-label="Record number to link">
        <datalist id="dl_links">${ALL.filter(r => r.id !== rec.id).slice(0, 300).map(r => `<option value="${esc(r.number)}">${esc(r.data.title || '')}</option>`).join('')}</datalist><button class="btn">Link</button></form></div>
        ${det.links.length ? table(det.links.map(l => ALL.find(r => r.id === l.id) || { ...l, data: { title: l.title } }), ['number', 'module', 'title', 'status']) : '<p class="muted small">No linked records. CAPA, RCA, change controls and extension requests raised from this record are linked automatically.</p>'}</div>
      <div class="panel"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Attachments</h3>${canWrite && (open || hasRole(['qa'])) && (!m.attachOnRequestOnly || hasRole(['qa'])) ? `<label class="btn no-print">Add file (stage: ${esc(rec.status)})<input type="file" id="att" hidden></label>` : m.attachOnRequestOnly ? '<span class="small muted">Documents can be added by QA only.</span>' : ''}</div>
        ${attachmentsTable(m, det.attachments)}</div>
    </div><aside class="rail">
      <div class="panel"><h3>Lifecycle</h3><ol class="lifecycle">${m.states.map((s, i) => `<li class="${s === rec.status ? 'now' : i < idx ? 'past' : ''}">${esc(s)}</li>`).join('')}</ol></div>
      <div class="panel"><h3>Electronic signatures</h3>${det.signatures.length ? det.signatures.map(s => `<div class="stamp ${s.current ? '' : 'stale'}"><div class="meaning">${esc(s.meaning)}</div><div class="name">${esc(s.fullname)}</div><div class="when">${dmyt(s.ts)} ${esc(tz)}</div><div class="small muted">${esc(s.from_state || '')} → ${esc(s.to_state || '')}</div>${s.current ? '' : '<div class="note">Signed an earlier version of this record; later changes are in the audit trail.</div>'}</div>`).join('') : '<p class="muted small">No signatures yet.</p>'}</div>
      ${det.auditAccess ? `<div class="panel"><div class="spread" style="margin-bottom:.4rem"><h3 style="margin:0">Audit trail</h3><a class="btn" href="#/history/${rec.id}">Full history · ${det.versionCount} version${det.versionCount === 1 ? '' : 's'}</a></div>
        <div class="trail">${det.audit.slice(0, 60).map(a => `<div><div class="t">${dmyt(a.ts)} · ${esc(a.fullname || a.username)}</div><b>${esc(a.action)}</b>${a.field ? ` <span class="muted">${esc(fieldLabel(rec.type, a.field))}</span>` : ''}
        ${a.old_value != null || a.new_value != null ? `<div class="diff">${a.old_value != null ? `<del>${esc(String(auditValue(rec.type, a.field, a.old_value)).slice(0, 160))}</del> ` : ''}<ins>${esc(String(auditValue(rec.type, a.field, a.new_value ?? '')).slice(0, 160))}</ins></div>` : ''}${a.reason ? `<div class="muted">Reason: ${esc(a.reason)}</div>` : ''}</div>`).join('')}</div></div>` : ''}
    </aside></div>`);

  const form = $('#rf'); liveCompute(form, m, d); setupTabs(form, m, rec);
  bindRows();
  $('#lk').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/api/records/${id}/links`, { number: e.target.number.value }); toast('Record linked'); route(); } catch (x) { toast(x.message); }
  });
  if (det.editable) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(form, m);
    await stepDialog({ title: 'Save changes', reason: true, perform: async (v) => { const r = await api('PUT', '/api/records/' + id, { data, reason: v.reason }); toast(r.changes ? `${r.changes} field(s) changed` : 'No changes to save'); } }) && route();
  });
  $$('[data-act="tr"]').forEach(b => b.addEventListener('click', async () => {
    const t = trans[+b.dataset.i];
    const ok = await stepDialog({ title: t.label, meaning: t.sign, reason: t.reason, perform: (v) => api('POST', `/api/records/${id}/transition`, { to: t.to, label: t.label, ...v }).catch(x => { markMissing($('#rf'), x.missing); throw x; }) });
    if (ok) { toast(ok.pending && ok.pending.length ? `Signed – still needed: ${ok.pending.join(', ')}` : `${rec.number}: ${ok.status || t.to}`); route(); }
  }));
  const act = (name, fn) => $$(`[data-act="${name}"]`).forEach(b => b.addEventListener('click', () => fn(b)));
  act('revise', async () => {
    const r = await stepDialog({ title: 'Start revision', reason: true,
      extra: `<div><label class="f">Revision type</label><select name="revisionType"><option>Revision – technical / procedural change</option><option>Periodic review – no change</option></select></div>
        <div><label class="f">Approved change control no. (for a revision with changes)</label><input type="text" name="changeControl" list="dl_cc"><datalist id="dl_cc">${ALL.filter(x => x.type === 'changes').map(x => `<option value="${esc(x.number)}">${esc(x.data.title || '')}</option>`).join('')}</datalist></div>`,
      perform: (v) => api('POST', `/api/records/${id}/revise`, v) });
    if (r) { toast('Revision draft created'); location.hash = '#/r/' + r.id; }
  });
  act('sp', async () => { try { const r = await api('POST', '/api/sharepoint/publish/' + id); toast('Published to SharePoint'); window.open(r.webUrl, '_blank', 'noopener'); route(); } catch (x) { modal({ title: 'SharePoint publish failed', html: `<p>${esc(x.message)}</p>`, cancel: '', ok: 'Close' }); } });
  act('gen', async () => { const ok = await stepDialog({ title: 'Generate randomization list', meaning: 'Generated', perform: (v) => api('POST', `/api/records/${id}/randomize`, v) }); if (ok) { toast(`List generated: ${ok.kits} kits`); route(); } });
  act('spawn', (b) => spawn(rec, b.dataset.to));
  act('issue', async () => { const r = await stepDialog({ title: 'Print issued copies', meaning: 'Issued', perform: (v) => api('POST', `/api/records/${id}/issue-print`, v) }); if (r) { printIssued(r); toast(`${r.copies.length} controlled copies issued`); route(); } });
  act('reissue', async () => {
    const r = await stepDialog({ title: 'Print replacement copy', meaning: 'Replacement issued', reason: true,
      extra: `<div><label class="f">Copy number being replaced (it will be voided)</label><input type="number" name="copyNo" min="1"></div>`,
      perform: (v) => api('POST', `/api/records/${id}/issue-print`, { ...v, reprint: true }) });
    if (r) { printIssued(r); toast('Replacement copy issued'); route(); }
  });
  $('#att')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 25 * 1024 * 1024) return toast('Maximum file size is 25 MB in this build.');
    try { await uploadFile(id, file); toast('Attachment added'); route(); } catch (x) { toast(x.message); }
  });
  if (canWrite && open) extensionButtons(rec);
  // required documents by type (e.g. licence copy, filled questionnaire, audit certificate) for the current qualification cycle
  const sectionOpen = (el) => { let s = null; for (const f of m.fields) { if (f.type === 'section') s = f; if (f === el) return canEditSection(s, rec); } return false; };
  $$('[data-docs]').forEach(box => {
    const f = m.fields.find(x => x.type === 'docs' && x.docs.map(y => y.join(':')).join('|') === box.dataset.docs), canAdd = canWrite && sectionOpen(f);
    box.innerHTML = f.docs.map(([cat, label]) => { const files = det.attachments.filter(a => a.category === cat && a.ts >= (d.cycleStartedAt || ''));
      return `<div class="doc-req"><span class="doc-label">${esc(label)}</span>${files.length ? files.map(a => `<a class="pill done" href="/api/attachments/${a.id}">${esc(a.name)}</a>`).join(' ') : '<span class="pill warn">Not attached</span>'}
        ${canAdd ? `<label class="btn small-btn">Attach ${esc(label.toLowerCase())}<input type="file" hidden data-cat="${esc(cat)}"></label>` : ''}</div>`; }).join('');
  });
  $$('[data-cat]').forEach(inp => inp.addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { await uploadFile(id, file, inp.dataset.cat); toast('Document attached'); route(); } catch (x) { toast(x.message); } }));
  // controlled form issued once per qualification cycle; later downloads give the same file
  $$('[data-issue]').forEach(box => {
    const cfg = m.issueForm, done = (d.formIssues || []).filter(x => x.ts >= (d.cycleStartedAt || '')).pop(), allowed = cfg && (!cfg.roles || hasRole(cfg.roles));
    box.innerHTML = done ? `<div class="doc-req"><span class="doc-label">${esc(cfg.label)}</span><span class="pill done">Issued ${esc(done.no)} – ${dmy(done.ts)} to ${esc(userName(done.by))}</span>${allowed ? ` <a class="btn small-btn" href="/api/forms/${rec.type}?record=${rec.id}" download>Download issued copy</a>` : ''}</div>`
      : allowed && cfg.when(d, rec.status) ? `<div class="doc-req"><span class="doc-label">${esc(cfg.label)}</span><span class="pill warn">Not issued</span> <a class="btn primary small-btn" href="/api/forms/${rec.type}?record=${rec.id}" download id="issueBtn">${esc(cfg.issueText || 'Issue form')}</a></div>`
      : `<div class="doc-req"><span class="doc-label">${esc(cfg.label)}</span><span class="pill warn">Not issued</span> <span class="small muted">${esc(cfg.notIssuedText || '')}</span></div>`;
  });
  $('#issueBtn')?.addEventListener('click', () => setTimeout(route, 1500));
  if (rec.type === 'labels') labelPanel(rec);
  if (rec.type === 'randomization' && det.randList) randPanel(rec, det.randList);
  if (m.deptApproval && ((d[m.deptApproval.field] || []).length || (m.deptApproval.persons && (d[m.deptApproval.persons] || []).some(a => a.user)))) optionalApprovalsPanel(rec);
  if (rec.type === 'mgmtreviews') qmrPanel(rec);
  if (rec.type === 'atreviews') atrPanel(rec);
  act('compile', async () => { try { await api('POST', `/api/records/${id}/compile`); toast('QMR data compiled'); route(); } catch (x) { toast(x.message); } });
}

// JRS/SOP/QAS/019 – data for the 13 agenda topics and the KPIs, compiled from the eQMS
function qmrPanel(rec) {
  const m = rec.data.metrics;
  if (!m) { $('#special').innerHTML = `<div class="panel"><h3>QMR data</h3><p class="muted">Not compiled yet. QA compiles the data for all agenda topics and KPIs before the meeting.</p></div>`; return; }
  const tbl = (head, rows) => `<div class="table-wrap" style="margin-bottom:.8rem"><table class="t"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  $('#special').innerHTML = `<div class="panel"><h3>QMR data – ${esc(m.period.quarter)}</h3><p class="muted small">Compiled ${dmyt(m.generatedAt)} from the eQMS. Re-compile before the minutes are compiled to refresh.</p>
    <h4>Key performance indicators (JRS/SOP/QAS/019 §5.17)</h4>${tbl(['KPI', 'Value', 'Basis'], m.kpis)}
    ${m.sections.map(s => `<h4>${esc(s.title)}</h4>${tbl(m.columns, s.rows)}`).join('')}</div>`;
}

// Who may change a form section at the record's current stage (section opts.edit in modules.js)
// pseudo-roles: initiator, responsible (person), respdept (member of the responsible department), depthead (approving Head)
const canEditSection = (s, rec) => !s || !s.edit || (ME.allAccess && (s.edit[rec.status] || []).length > 0) || (s.edit[rec.status] || []).some(r =>
  r === 'initiator' ? rec.created_by === ME.username : r === 'responsible' ? rec.data.respPerson === ME.username
    : r === 'respdept' ? !!ME.department && ME.department === rec.data.respDept : r === 'depthead' ? rec.data.hodApprover === ME.username : ME.roles.includes(r));
const WHO_BY_CHECK = { isRespPerson: 'Responsible person', isCcDept: 'Responsible person / department', isInitiator: 'Initiator', isResponsible: 'Initiator / responsible person', isPartAOwner: 'Initiator / responsible person / department', isPartCOwner: 'Responsible person / department', isHodApprover: 'Head of Department (organogram)' };
// Sign-offs expected for a section, taken from the workflow (transitions with the same "part"), each with the
// latest signature: name and date, or pending. Changing the workflow in modules.js changes these blocks automatically.
function expectedSignoffs(m, s) {
  const seen = new Set();
  return m.transitions.filter(t => s.part && t.part === s.part && t.sign && !seen.has(t.sign) && seen.add(t.sign))
    .map(t => ({ meaning: t.sign, alt: ['Rejected', 'Cancelled'].includes(t.to) || /^Rejected/.test(t.sign) || !!t.optional, who: t.roles.includes('any') ? WHO_BY_CHECK[(t.checks || []).find(c => WHO_BY_CHECK[c])] || 'Any user' : t.roles.map(r => CFG.ROLES[r] || r).join(' / ') }));
}
// rejection, cancellation and resubmission sign-offs are shown only when they happened
const signoffRows = (m, s, sigs) => expectedSignoffs(m, s).map(x => ({ ...x, sig: sigs.filter(z => z.meaning === x.meaning).pop() })).filter(x => !x.alt || x.sig);
function sectionSignatures(m, s, sigs) {
  const rows = signoffRows(m, s, sigs); if (!rows.length) return '';
  return `<div class="full sig-block"><table class="t"><thead><tr><th>Sign-off</th><th>By (role)</th><th>Signed by</th><th>Date / time</th></tr></thead><tbody>${rows.map(x => {
    const g = x.sig;
    return `<tr><td>${esc(x.meaning)}</td><td class="small muted">${esc(x.who)}</td><td>${g ? esc(g.fullname) : '<span class="pill warn">Pending</span>'}</td><td class="small">${g ? `${dmyt(g.ts)}${g.current ? '' : ' <span class="pill grey" title="Record changed after this signature">earlier version</span>'}` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// Departmental approvals: change control optional approvals 1–4 (JRS/SOP/QAS/007 Part C), cross-functional document review (JRS/SOP/QAS/021)
function optionalApprovalsPanel(rec) {
  const cfg = MODS[rec.type].deptApproval, d = rec.data, done = d.deptApprovals || [], canSign = rec.status === cfg.state;
  const meaningFor = (dept) => rec.type === 'changes' ? `Approved – optional approval (${dept})` : `Reviewed – cross-functional (${dept})`;
  $('#special').innerHTML = `<div class="panel"><h3>${esc(cfg.label)}</h3><p class="muted small">Heads of the named departments${cfg.persons ? ' and the named optional approvers' : ''} sign at stage "${esc(cfg.state)}".</p>
    <div class="table-wrap"><table class="t"><thead><tr><th>Department</th><th>Signed by</th><th>Date</th><th>Comment</th><th></th></tr></thead><tbody>
    ${(d[cfg.field] || []).map(code => { const a = done.find(x => x.dept === code); return `<tr><td>${esc(CFG.DEPTS[code] || code)}</td><td>${a ? esc(a.name) : '<span class="pill warn">Pending</span>'}</td><td>${a ? dmyt(a.ts) : ''}</td><td>${a ? esc(a.comment) : ''}</td>
      <td>${!a && canSign && (ME.allAccess || (ME.deptsUnder || []).includes(code)) ? `<button class="btn primary sign" data-dept="${esc(code)}">Sign</button>` : ''}</td></tr>`; }).join('')}
    ${(cfg.persons ? d[cfg.persons] || [] : []).filter(x => x.user).map(x => { const a = done.find(y => y.person === x.user); return `<tr><td>${esc(userName(x.user))}<br><span class="small muted">${esc(x.type || 'Optional approver')}</span></td><td>${a ? esc(a.name) : '<span class="pill warn">Pending</span>'}</td><td>${a ? dmyt(a.ts) : ''}</td><td>${a ? esc(a.comment) : ''}</td>
      <td>${!a && canSign && x.user === ME.username ? `<button class="btn primary sign" data-person="1">Sign</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  $$('[data-dept]').forEach(b => b.addEventListener('click', async () => {
    const dept = b.dataset.dept;
    const ok = await stepDialog({ title: `${cfg.label} – ${CFG.DEPTS[dept] || dept}`, meaning: meaningFor(dept),
      extra: `<div><label class="f">Comment</label><textarea name="comment" rows="3"></textarea></div>`,
      perform: (v) => api('POST', `/api/records/${rec.id}/dept-approve`, { ...v, dept }) });
    if (ok) { toast(`${dept} approval recorded`); route(); }
  }));
  $$('[data-person]').forEach(b => b.addEventListener('click', async () => {
    const row = (d[cfg.persons] || []).find(x => x.user === ME.username) || {};
    const ok = await stepDialog({ title: `${cfg.label} – ${ME.fullname}`, meaning: `Approved – optional approver (${row.type || 'approver'})`,
      extra: `<div><label class="f">Comment</label><textarea name="comment" rows="3"></textarea></div>`,
      perform: (v) => api('POST', `/api/records/${rec.id}/dept-approve`, { ...v, person: true }) });
    if (ok) { toast('Approval recorded'); route(); }
  }));
}

async function spawn(src, to) {
  const m = MODS[to], s = src.data;
  const capaSource = src.type === 'investigations' ? s.invType : src.type === 'selfinspections' ? 'Internal audit / self-inspection'
    : src.type === 'extaudits' ? (s.auditType === 'Regulatory inspection' ? 'Regulatory inspection / compliance' : 'External audit') : 'Other';
  const pre = { capa: { title: 'CAPA for ' + src.number + ': ' + (s.title || ''), source: capaSource, sourceRecord: src.number, nonconformance: s.description || s.title || '', respDept: s.respDept || s.auditeeDept || '', respPerson: s.respPerson || s.auditee || '' },
    changes: { title: 'Change arising from ' + src.number, justification: 'See ' + src.number, respDept: s.respDept || '' },
    risks: { title: 'Risk assessment for ' + src.number + ': ' + (s.title || ''), referenceDoc: src.number, site: s.site || '' },
    extensions: { documentId: src.number, scope: 'Overall due date' },
    training: { title: 'Retraining – ' + (s.title || ''), sourceRecord: src.number, trainingType: 'Read & Understand' },
    actionitems: { parentRef: src.number, respPerson: s.respPerson || '' } }[to] || {};
  shell(to, `<div class="spread"><div><h1>New ${esc(singular(m))}</h1><p class="muted">Linked to <span class="mono">${esc(src.number)}</span>.</p></div></div>
   <form id="nf" class="panel"><div class="grid">${(to === 'actionitems' ? createFields(m) : m.fields).filter(f => f.type !== 'readonly').map(f => fieldHtml(f, pre[f.k], false)).join('')}</div><div class="error" style="margin-top:1rem"></div>
   <div class="row"><button class="btn primary">Save record</button><a class="btn" href="#/r/${src.id}">Cancel</a></div></form>`);
  const form = $('#nf'); liveCompute(form, m);
  form.addEventListener('submit', async (e) => { e.preventDefault(); try { const r = await api('POST', '/api/records', { type: to, data: readForm(form, m), linkFrom: src.id }); toast(r.number + ' created'); location.hash = '#/r/' + r.id; } catch (x) { $('.error', form).textContent = x.message; } });
}



// Workflow bar: previous and current state and how long the record has been in it
function workflowBar(rec) {
  const d = rec.data, since = d.stateEnteredAt || rec.updated_at, days = since ? Math.floor((Date.now() - new Date(since)) / 864e5) : null;
  const age = days == null ? '' : days > 365 ? 'In state for longer than one year' : days < 1 ? 'In state since today' : `In state for ${days} day${days === 1 ? '' : 's'}`;
  return `<div class="workflow-bar"><span class="wf-label">Workflow</span>${d.prevStatus ? `<span class="wf-step">${esc(d.prevStatus)}</span><span class="wf-arrow">&rarr;</span>` : ''}<span class="wf-step now">${esc(rec.status)}</span><span class="small muted wf-age" title="${since ? dmyt(since) : ''}">${age}</span></div>`;
}
// Tabs: sections with a "tab" are shown one tab at a time (e.g. change control: request, level 1, approval, closure)
function setupTabs(form, m, rec) {
  const tabs = [...new Set(m.fields.filter(f => f.type === 'section' && f.tab).map(f => f.tab))];
  if (tabs.length < 2) return;
  const grid = $('.grid', form); let cur = tabs[0];
  for (const el of [...grid.children]) {
    if (el.matches('h4.form-section')) { const s = m.fields.find(f => f.type === 'section' && f.label === el.textContent); if (s && s.tab) cur = s.tab; }
    el.dataset.tab = cur;
  }
  const bar = document.createElement('div'); bar.className = 'tabs no-print'; bar.setAttribute('role', 'tablist');
  bar.innerHTML = tabs.map(t => `<button type="button" class="tab" role="tab" data-t="${esc(t)}">${esc(t)}<span class="tab-count"></span></button>`).join('');
  grid.before(bar);
  const show = (t) => {
    $$('.tab', bar).forEach(b => { b.classList.toggle('active', b.dataset.t === t); b.setAttribute('aria-selected', b.dataset.t === t); });
    for (const el of grid.children) el.classList.toggle('tab-hidden', el.dataset.tab !== t);
    try { sessionStorage.setItem('tab:' + rec.id, t); } catch { /* storage unavailable */ }
  };
  bar.addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.t); });
  // open the tab last used on this record, else the tab with the section that can be edited at the current stage
  let start = null; try { start = sessionStorage.getItem('tab:' + rec.id); } catch { /* storage unavailable */ }
  const editable = m.fields.find(f => f.type === 'section' && f.tab && f.edit && f.edit[rec.status]);
  show(tabs.includes(start) ? start : editable ? editable.tab : tabs[0]);
}
