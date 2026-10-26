/* Controlled forms and SOPs (JRS/FRM/QAS/048). */
'use strict';
// ---------- controlled documents: forms and SOPs (List of Controlled Documents JRS/FRM/QAS/048) ----------
// QA maintains them and signs every change and issue; everyone views the form list; SOPs are shown to the roles QA chose.
const CDK = {
  form: { api: '/api/cforms', list: 'forms', item: 'form', title: 'Controlled forms', noun: 'form', Noun: 'Form', example: 'JRS/FRM/QAS/056', inuse: 'In-use form (blank PDF – used for issued copies)',
    intro: 'List of controlled documents – forms (JRS/FRM/QAS/048, JRS/SOP/QAS/021).',
    sections: ['Annexure of Operations SOP', 'Annexure Packaging SOP', 'Annexure Human Resource Management SOP', 'Annexure of Quality Assurance SOP'] },
  sop: { api: '/api/csops', list: 'sops', item: 'sop', title: 'Controlled SOPs', noun: 'SOP', Noun: 'SOP', example: 'JRS/SOP/QAS/023', inuse: 'SOP (PDF – used for issued copies and on-screen reading)',
    intro: 'List of controlled documents – SOPs and policies (JRS/FRM/QAS/048, JRS/SOP/QAS/021).',
    sections: ['Administrations SOP', 'Operations SOP', 'Packaging SOP', 'Human Resource Management SOP', 'Quality Assurance SOP', 'Policies'] }
};
const isQaUser = () => hasRole(['qa']);
// e-signature fields for QA steps on controlled documents
const cdSigHtml = (meaning) => `<div class="sig-statement">By signing you apply your electronic signature with the meaning <b>${esc(meaning)}</b>. Date and time are recorded by the server (${esc(tz)}).</div>
  <div class="grid"><div><label class="f">User ID</label><input type="text" name="sigUsername" value="${esc(ME.username)}" autocomplete="username"></div><div><label class="f">Password</label><input type="password" name="password" autocomplete="current-password"></div></div>`;
const cdSig = (f) => { if (!f.password.value) throw new Error('Enter your password to sign.'); return { sigUsername: val(f, 'sigUsername'), password: f.password.value }; };
const cdRoleOpts = (sel = ['all']) => `<div><label class="f">Who can see this SOP <span class="req">*</span></label><div class="role-pick">
  <label class="row"><input type="checkbox" name="role" value="all" ${sel.includes('all') ? 'checked' : ''}> <b>Everyone</b></label>
  ${Object.entries(CFG.ROLES).filter(([k]) => k !== 'numgen').map(([k, l]) => `<label class="row"><input type="checkbox" name="role" value="${k}" ${sel.includes(k) && !sel.includes('all') ? 'checked' : ''}> ${esc(l.split(' (')[0])}</label>`).join('')}</div>
  <p class="small muted">QA always sees every SOP. Administrators and management see all SOPs.</p></div>`;
const cdRolesOf = (f) => $$('input[name=role]:checked', f).map(x => x.value);
const cdRoleText = (r) => !r ? '' : r.includes('all') ? 'Everyone' : r.map(k => (CFG.ROLES[k] || k).split(' (')[0]).join(', ');
const cfPick = async (inp) => { const file = inp.files[0]; return file ? { name: file.name, base64: await fileB64(file) } : null; };
// POST returning a PDF: download it, return the issue numbers
async function cdPostPdf(url, body) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': ME.csrf }, body: JSON.stringify(body) });
  resetIdle();
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Request failed (' + r.status + ')');
  const name = decodeURIComponent((/filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '') || [])[1] || 'issued.pdf');
  download(name, await r.blob(), 'application/pdf');
  return (r.headers.get('x-issue-numbers') || '').split(',');
}

const formsView = () => cdListView('form');
const sopsView = () => cdListView('sop');
const formView = (id) => cdItemView('form', id);
const sopView = (id) => cdItemView('sop', id);
async function cdListView(kind) {
  const K = CDK[kind], rows = await api('GET', K.api), qa = isQaUser();
  const sections = [...new Set([...K.sections, ...rows.map(r => r.section).filter(Boolean)])];
  shell(K.list, `<div class="spread"><div><h1>${K.title}</h1><p class="muted">${K.intro} ${qa ? `QA adds ${K.noun}s, keeps the signed master and the in-use file of each version, issues new versions and copies, and signs each step.${kind === 'sop' ? ' QA chooses by role who can see each SOP.' : ''}` : kind === 'sop' ? 'The SOPs you have access to. Ask QA for a controlled or uncontrolled copy.' : 'Maintained by QA. Ask QA for an issued copy of a form.'}</p></div>
    <div class="row" style="flex-wrap:wrap">${qa ? `<button class="btn primary" id="cfn">New ${K.noun}</button><button class="btn" id="cfml">Issue master list</button>` : ''}<button class="btn" id="cfx">Export CSV</button></div></div>
    <div class="row no-print" style="margin-bottom:.8rem;gap:.5rem;flex-wrap:wrap"><input type="search" id="cfq" placeholder="Filter by number or title" style="max-width:280px">
    <select id="cfs" style="max-width:300px"><option value="">All sections</option>${sections.map(s => `<option>${esc(s)}</option>`).join('')}</select>
    ${qa ? '<select id="cft" style="max-width:180px"><option value="Effective">Effective</option><option value="Obsolete">Obsolete</option><option value="">All</option></select>' : ''}</div><div id="cfl"></div>`);
  const filtered = () => { const q = $('#cfq').value.toLowerCase(), s = $('#cfs').value, t = qa ? $('#cft').value : 'Effective'; return rows.filter(r => (!q || (r.number + ' ' + r.title).toLowerCase().includes(q)) && (!s || r.section === s) && (!t || r.status === t)); };
  const span = qa ? (kind === 'sop' ? 10 : 9) : 6;
  const draw = () => {
    const list = filtered(); let sec = null;
    $('#cfl').innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Sr. no.</th><th>${K.Noun} number</th><th>${K.Noun} title</th><th>Version</th><th>Effective date</th><th>Status</th>${qa ? `${kind === 'sop' ? '<th>Access</th>' : ''}<th>Signed master</th><th>In-use file</th><th>Issued</th>` : ''}</tr></thead><tbody>
      ${list.map((r, i) => { const head = r.section !== sec ? `<tr class="group-row"><td colspan="${span}"><b>${esc(r.section || 'Other')}</b></td></tr>` : ''; sec = r.section;
        return `${head}<tr class="click" data-go="#/${K.item}/${r.id}"><td>${i + 1}</td><td class="mono">${esc(r.number)}</td><td>${esc(r.title)}</td><td>${esc(r.version)}</td><td>${dmy(r.effectiveDate)}</td><td>${pill(r.status)}</td>
        ${qa ? `${kind === 'sop' ? `<td class="small">${esc(cdRoleText(r.roles))}</td>` : ''}<td>${r.hasMaster ? '<span class="pill done">Attached</span>' : '<span class="pill warn">Missing</span>'}</td><td>${r.hasInuse ? '<span class="pill done">Attached</span>' : '<span class="pill warn">Missing</span>'}</td><td>${r.issued || ''}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`
      : `<div class="table-wrap"><div class="empty">No ${K.noun}s match.</div></div>`;
    bindRows($('#cfl'));
  };
  ['#cfq', '#cfs', '#cft'].forEach(s => $(s)?.addEventListener('input', draw)); draw();
  $('#cfx').addEventListener('click', () => download(`controlled_${K.list}_${today()}.csv`, toCsv([['Sr. no.', `${K.Noun} number`, `${K.Noun} title`, 'Version', 'Effective date', 'Section', 'Status'], ...filtered().map((r, i) => [i + 1, r.number, r.title, r.version, r.effectiveDate, r.section, r.status])])));
  $('#cfml')?.addEventListener('click', async () => {
    if (!(await ensureEsigAccepted())) return;
    const issues = await api('GET', `${K.api}/master-list/issues`);
    await modal({ title: 'Issue the master list', ok: 'Sign and issue', okClass: 'primary sign', html: `<p class="muted small">List of Controlled Documents (JRS/FRM/QAS/048) with every effective ${K.noun} and its current version. The PDF gets an issue number (FI-YYYY-NNN) and a blue issue stamp; the issue is recorded in the issued forms register and the audit trail.</p>
      <div><label class="f">Purpose of the issue <span class="req">*</span></label><textarea name="purpose" rows="2" placeholder="e.g. Monthly update for the document control file"></textarea></div>${cdSigHtml(`List of Controlled Documents issued – QA`)}
      ${issues.length ? `<p class="small muted">Last issued: ${issues.slice(0, 3).map(i => `${esc(i.no)} on ${dmy(i.ts)} by ${esc(i.issued_by)}`).join('; ')}</p>` : ''}`,
      onOk: async (fm) => { const nos = await cdPostPdf(`${K.api}/master-list`, { purpose: val(fm, 'purpose'), ...cdSig(fm) }); toast(`Master list issued: ${nos.join(', ')}`); } });
  });
  $('#cfn')?.addEventListener('click', async () => {
    if (!(await ensureEsigAccepted())) return;
    const r = await modal({ title: `New controlled ${K.noun}`, ok: 'Sign and add', okClass: 'primary sign', wide: true, html: `<div class="grid"><div><label class="f">${K.Noun} number <span class="req">*</span></label><input type="text" name="number" placeholder="${K.example}"></div>
      <div><label class="f">Version <span class="req">*</span></label><input type="text" name="version" value="1.0"></div>
      <div style="grid-column:1/-1"><label class="f">${K.Noun} title <span class="req">*</span></label><input type="text" name="title"></div>
      <div><label class="f">Section</label><select name="section">${sections.map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
      <div><label class="f">Related SOP</label><input type="text" name="sop" placeholder="JRS/SOP/QAS/021"></div>
      <div><label class="f">Effective date <span class="req">*</span></label><input type="date" name="effectiveDate" value="${today()}"></div><div></div>
      <div><label class="f">Signed master (scan)</label><input type="file" name="master" accept=".pdf,image/*,application/pdf"></div>
      <div><label class="f">${K.inuse}</label><input type="file" name="inuse" accept=".pdf,application/pdf"></div></div>
      ${kind === 'sop' ? cdRoleOpts() : ''}${cdSigHtml(`Controlled ${K.noun} added – QA`)}`,
      onOk: async (f) => api('POST', K.api, { number: val(f, 'number'), version: val(f, 'version'), title: val(f, 'title'), section: f.section.value, sop: val(f, 'sop'), effectiveDate: f.effectiveDate.value, roles: kind === 'sop' ? cdRolesOf(f) : undefined, master: await cfPick(f.master), inuse: await cfPick(f.inuse), ...cdSig(f) }) });
    if (r) { toast(`${r.number} added and signed`); location.hash = `#/${K.item}/${r.id}`; }
  });
}
async function cdItemView(kind, id) {
  const K = CDK[kind], f = await api('GET', `${K.api}/${id}`), qa = f.canEdit, v = f.current, live = f.status === 'Effective';
  const fileLink = (ver, k) => ver[k] ? `<a href="${K.api}/${f.id}/versions/${ver.id}/${k}" download>${esc(ver[k].name)}</a>` : '<span class="muted">Not attached</span>';
  shell(K.list, `<div class="spread"><div><p class="small"><a href="#/${K.list}">${K.title}</a></p><h1><span class="mono">${esc(f.number)}</span> ${esc(f.title)}</h1>
    <p>${pill(f.status)} Version ${esc(v.version)} · effective ${dmy(v.effectiveDate)} · ${esc(f.section || '')}${f.sop ? ' · related SOP ' + esc(f.sop) : ''}</p></div>
    <div class="row" style="flex-wrap:wrap">${f.canView ? `<a class="btn" href="${K.api}/${f.id}/view" target="_blank" rel="noopener">Read SOP</a>` : ''}${qa && live ? `<button class="btn primary" id="cfi">Issue copies</button><button class="btn" id="cfe">Edit</button>${f.pending ? '' : '<button class="btn" id="cfv">New version</button>'}<button class="btn danger" id="cfo">Make obsolete</button>` : ''}</div></div>
    <div class="panel"><h2>Current version ${esc(v.version)}</h2><table class="kv"><tbody>
      <tr><th>Status</th><td>${pill(v.status)}</td></tr><tr><th>Effective date</th><td>${dmy(v.effectiveDate)}</td></tr><tr><th>Change / reason</th><td>${esc(v.changeNote || '')}</td></tr>
      ${kind === 'sop' && qa ? `<tr><th>Who can see this SOP</th><td>${esc(cdRoleText(f.roles))}</td></tr>` : ''}
      ${qa ? `<tr><th>Signed master</th><td>${fileLink(v, 'master')}${live ? ` <label class="btn small-btn">${v.master ? 'Replace' : 'Attach'}<input type="file" hidden data-cff="master" accept=".pdf,image/*,application/pdf"></label>` : ''}</td></tr>
      <tr><th>${kind === 'sop' ? 'SOP (PDF)' : 'In-use form (PDF)'}</th><td>${fileLink(v, 'inuse')}${live ? ` <label class="btn small-btn">${v.inuse ? 'Replace' : 'Attach'}<input type="file" hidden data-cff="inuse" accept=".pdf,application/pdf"></label>` : ''}</td></tr>`
      : `<tr><th>Copies</th><td>${kind === 'sop' ? 'Controlled and uncontrolled copies are issued by QA. Use "Read SOP" to read it on screen.' : 'Issued by QA from the current version only. Ask QA for an issued copy.'}</td></tr>`}
    </tbody></table>${f.pending ? `<p class="pill warn" style="margin-top:.6rem">Version ${esc(f.pending.version)} is approved and becomes effective on ${dmy(f.pending.effectiveDate)}; until then version ${esc(v.version)} is issued.</p>` : ''}</div>
    ${qa ? `<div class="panel"><h2>Version history</h2><p class="small muted">Files of superseded and obsolete versions download with a red stamp.</p><div class="table-wrap"><table class="t"><thead><tr><th>Version</th><th>Status</th><th>Effective date</th><th>Change / reason</th><th>Signed master</th><th>In-use file</th><th>Added</th><th>Ended</th></tr></thead><tbody>
      ${f.versions.map(x => `<tr><td>${esc(x.version)}</td><td>${pill(x.status)}</td><td>${dmy(x.effectiveDate)}</td><td>${esc(x.changeNote || '')}</td><td>${fileLink(x, 'master')}</td><td>${fileLink(x, 'inuse')}</td><td class="small">${esc(x.createdBy)}<br>${dmyt(x.createdAt)}</td><td class="small">${x.endedAt ? `${esc(x.endedBy)}<br>${dmyt(x.endedAt)}<br>${esc(x.endReason || '')}` : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><h2>Electronic signatures (${f.signatures.length})</h2>${f.signatures.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Meaning</th><th>Name</th><th>User ID</th><th>Date / time</th></tr></thead><tbody>${f.signatures.map(s => `<tr><td>${esc(s.meaning)}</td><td>${esc(s.fullname)}</td><td class="mono">${esc(s.username)}</td><td class="small">${dmyt(s.ts)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No signatures yet.</p>'}</div>
    <div class="panel"><h2>Issued copies (${f.issues.length})</h2>${f.issues.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Issue no.</th><th>Version</th>${kind === 'sop' ? '<th>Copy type</th><th>Valid till</th>' : ''}<th>Copy</th><th>Issued to</th><th>Department</th><th>Purpose</th><th>Issued by</th><th>Issued on</th></tr></thead><tbody>
      ${f.issues.map(r => `<tr><td class="mono">${esc(r.no)}</td><td>${esc(r.form_version || '')}</td>${kind === 'sop' ? `<td>${esc(r.copy_type || '')}</td><td>${dmy(r.expiry)}</td>` : ''}<td>${esc(r.copy_label || '')}</td><td>${esc(r.issued_name || r.issued_to)}</td><td>${esc(deptName(r.dept))}</td><td>${esc(r.purpose || '')}</td><td>${esc(r.issued_by || '')}</td><td class="small">${dmyt(r.ts)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No copies issued yet.</p>'}</div>` : ''}`);
  if (!qa) return;
  $$('[data-cff]').forEach(inp => inp.addEventListener('change', async () => {
    const k = inp.dataset.cff, file = inp.files[0]; if (!file) return;
    if (!(await ensureEsigAccepted())) return;
    const had = v[k], label = k === 'master' ? 'signed master' : kind === 'sop' ? 'SOP file' : 'in-use form', base64 = await fileB64(file);
    const ok = await modal({ title: `${had ? 'Replace' : 'Attach'} the ${label}`, ok: 'Sign', okClass: 'primary sign', html: `<p>${had ? `${esc(had.name)} will be replaced by ` : ''}<b>${esc(file.name)}</b> for version ${esc(v.version)}.</p>
      ${had ? '<div><label class="f">Reason <span class="req">*</span></label><textarea name="reason" rows="2"></textarea></div>' : ''}${cdSigHtml(`${label.charAt(0).toUpperCase() + label.slice(1)} ${had ? 'replaced' : 'attached'} – QA`)}`,
      onOk: (fm) => api('POST', `${K.api}/${f.id}/files`, { kind: k, name: file.name, base64, reason: had ? val(fm, 'reason') : undefined, ...cdSig(fm) }) });
    inp.value = '';
    if (ok) { toast('File attached and signed'); route(); }
  }));
  $('#cfi')?.addEventListener('click', async () => {
    if (!(await ensureEsigAccepted())) return;
    const people = USERS.filter(u => u.active).sort((a, b) => a.fullname.localeCompare(b.fullname));
    await modal({ title: `Issue ${f.number} v${v.version}`, ok: 'Sign and issue', okClass: 'primary sign', wide: kind === 'sop', html: `<p class="muted small">Copies are made from the current version ${esc(v.version)} (effective ${dmy(v.effectiveDate)}). Each copy gets its own number, stamped on every page at the left of the footer${kind === 'sop' ? ' in green' : ' in blue'}.</p>
      ${kind === 'sop' ? `<div><label class="f">Copy type <span class="req">*</span></label><div class="row" style="gap:1.2rem"><label class="row"><input type="radio" name="copyType" value="controlled" checked> Controlled copy (CC-…)</label><label class="row"><input type="radio" name="copyType" value="uncontrolled"> Uncontrolled copy (UC-…)</label></div></div>` : ''}
      <div class="grid"><div><label class="f">Issued to <span class="req">*</span></label><select name="issuedTo"><option value="">Choose…</option>${people.map(u => `<option value="${esc(u.username)}">${esc(u.fullname)}${u.department ? ' – ' + esc(deptName(u.department)) : ''}</option>`).join('')}</select></div>
      <div><label class="f">Number of copies <span class="req">*</span></label><input type="number" name="copies" min="1" max="50" value="1"></div>
      ${kind === 'sop' ? `<div><label class="f">Expiry of the copy (valid till) <span class="req">*</span></label><input type="date" name="expiry" min="${today()}" value="${addDaysIso(today(), 365)}"></div>` : ''}</div>
      <div><label class="f">Purpose of the issue <span class="req">*</span></label><textarea name="purpose" rows="2" placeholder="${kind === 'sop' ? 'e.g. Copy for the packaging hall notice board' : 'e.g. Batch PO-2026-114 line clearance'}"></textarea></div>
      ${cdSigHtml(kind === 'sop' ? 'Controlled / uncontrolled copy issued – QA' : 'Form copies issued – QA')}`,
      onOk: async (fm) => {
        const nos = await cdPostPdf(`${K.api}/${f.id}/issue`, { issuedTo: fm.issuedTo.value, purpose: val(fm, 'purpose'), copies: +fm.copies.value, version: v.version, copyType: kind === 'sop' ? fm.copyType.value : undefined, expiry: kind === 'sop' ? fm.expiry.value : undefined, ...cdSig(fm) });
        toast(`Issued: ${nos.join(', ')}`);
      } }) && route();
  });
  $('#cfe')?.addEventListener('click', async () => {
    if (!(await ensureEsigAccepted())) return;
    const ok = await modal({ title: `Edit ${f.number}`, ok: 'Sign and save', okClass: 'primary sign', wide: kind === 'sop', html: `<div><label class="f">${K.Noun} title</label><input type="text" name="title" value="${esc(f.title)}"></div>
      <div class="grid"><div><label class="f">Section</label><select name="section">${[...new Set([...K.sections, f.section].filter(Boolean))].map(s => `<option ${s === f.section ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div><label class="f">Related SOP</label><input type="text" name="sop" value="${esc(f.sop || '')}"></div><div><label class="f">Effective date (v${esc(v.version)})</label><input type="date" name="effectiveDate" value="${esc(v.effectiveDate || '')}"></div></div>
      ${kind === 'sop' ? cdRoleOpts(f.roles) : ''}
      <div><label class="f">Reason for the change <span class="req">*</span></label><textarea name="reason" rows="2"></textarea></div>${cdSigHtml(`Controlled ${K.noun} changed – QA`)}`,
      onOk: (fm) => api('PUT', `${K.api}/${f.id}`, { title: val(fm, 'title'), section: fm.section.value, sop: val(fm, 'sop'), effectiveDate: fm.effectiveDate.value, roles: kind === 'sop' ? cdRolesOf(fm) : undefined, reason: val(fm, 'reason'), ...cdSig(fm) }) });
    if (ok) { toast(ok.changes ? `${ok.changes} change(s) saved and signed` : 'No changes'); route(); }
  });
  $('#cfv')?.addEventListener('click', async () => {
    if (!(await ensureEsigAccepted())) return;
    const next = (Math.floor(+v.version) + 1).toFixed(1);
    const ok = await modal({ title: `New version of ${f.number}`, ok: 'Sign and approve', okClass: 'primary sign', wide: true, html: `<p class="muted small">Version ${esc(v.version)} becomes <b>Superseded</b> on the effective date of the new version. From then on only the new version can be issued.</p>
      <div class="grid"><div><label class="f">New version <span class="req">*</span></label><input type="text" name="version" value="${next}"></div><div><label class="f">Effective date <span class="req">*</span></label><input type="date" name="effectiveDate" value="${today()}"></div>
      <div style="grid-column:1/-1"><label class="f">${K.Noun} title</label><input type="text" name="title" value="${esc(f.title)}"></div>
      <div style="grid-column:1/-1"><label class="f">Change / reason <span class="req">*</span></label><textarea name="changeNote" rows="2"></textarea></div>
      <div><label class="f">Signed master (scan) <span class="req">*</span></label><input type="file" name="master" accept=".pdf,image/*,application/pdf"></div><div><label class="f">${kind === 'sop' ? 'SOP (PDF)' : 'In-use form (blank PDF)'} <span class="req">*</span></label><input type="file" name="inuse" accept=".pdf,application/pdf"></div></div>
      ${cdSigHtml(`Controlled ${K.noun} new version approved – QA`)}`,
      onOk: async (fm) => api('POST', `${K.api}/${f.id}/versions`, { version: val(fm, 'version'), effectiveDate: fm.effectiveDate.value, title: val(fm, 'title'), changeNote: val(fm, 'changeNote'), master: await cfPick(fm.master), inuse: await cfPick(fm.inuse), ...cdSig(fm) }) });
    if (ok) { toast(ok.status === 'Approved' ? `${f.number} v${ok.version} approved – effective on its date` : `${f.number} v${ok.version} effective`); route(); }
  });
  $('#cfo')?.addEventListener('click', async () => {
    if (!(await ensureEsigAccepted())) return;
    const ok = await modal({ title: `Make ${f.number} obsolete`, ok: 'Sign – make obsolete', okClass: 'danger', html: `<p>Version ${esc(v.version)} becomes <b>Obsolete</b>. The ${K.noun} can no longer be issued and its number is not reused.</p><div><label class="f">Reason <span class="req">*</span></label><textarea name="reason" rows="2"></textarea></div>${cdSigHtml(`Controlled ${K.noun} made obsolete – QA`)}`,
      onOk: (fm) => api('POST', `${K.api}/${f.id}/obsolete`, { reason: val(fm, 'reason'), ...cdSig(fm) }) });
    if (ok) { toast(`${f.number} obsolete`); route(); }
  });
}

