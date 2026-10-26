/* Record forms: fields, new record. */
'use strict';
// ---------- forms ----------
function fieldHtml(f, v, disabled) {
  const d = disabled ? 'disabled' : '', id = 'f_' + f.k, req = f.req ? ' <span class="req">*</span>' : '';
  const lab = `<label class="f" for="${id}">${esc(f.label)}${req}</label>`;
  let input;
  if (v === undefined || v === null) v = f.def !== undefined ? f.def : '';
  const optLabel = (o) => (f.optionLabels || {})[o] || CFG.ROLES[o] || o;
  switch (f.type) {
    case 'section': return `<h4 class="full form-section">${esc(f.label)}</h4>`;
    case 'docs': return `<div class="full docs-field" data-docs="${esc(f.docs.map(x => x.join(':')).join('|'))}"></div>`;
    case 'issue': return `<div class="full issue-field" data-issue></div>`;
    case 'guide': return `<details class="full guide"><summary>${esc(f.label)}</summary>${f.rows.map(([title, rows]) => `<p class="guide-title">${esc(title)}</p><table class="t"><tbody>${rows.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table>`).join('')}</details>`;
    case 'textarea': input = `<textarea id="${id}" name="${f.k}" rows="${f.rows || 4}" ${d}>${esc(v)}</textarea>`; break;
    case 'select': input = `<select id="${id}" name="${f.k}" ${d}><option value=""></option>${f.options.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(optLabel(o))}</option>`).join('')}</select>`; break;
    case 'user': input = `<select id="${id}" name="${f.k}" ${d}><option value=""></option>${USERS.filter(u => u.active || u.username === v).map(u => `<option value="${esc(u.username)}" ${u.username === v ? 'selected' : ''}>${esc(u.fullname)} (${esc(u.username)})${u.department ? ' – ' + esc(u.department) : ''}</option>`).join('')}</select>`; break;
    case 'checkbox': return `<div class="${f.full ? 'full' : ''}"><label class="f">&nbsp;</label><label class="row"><input type="checkbox" id="${id}" name="${f.k}" ${v ? 'checked' : ''} ${d}> ${esc(f.label)}</label></div>`;
    case 'multicheck': input = `<div class="checks" role="group" aria-label="${esc(f.label)}">${f.options.map(o => `<label><input type="checkbox" name="${f.k}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''} ${d}> ${esc(optLabel(o))}</label>`).join('')}</div>`; break;
    case 'computed': case 'readonly': input = `<div class="computed" id="${id}" data-computed="${f.k}">${f.fmt === 'date' ? dmy(v) : f.fmt === 'user' ? esc(userName(v)) : esc((f.optionLabels || {})[v] || v)}</div>`; break;
    case 'checklist': input = `<div class="table-wrap"><table class="t check-table" role="group" aria-label="${esc(f.label)}"><thead><tr><th>Area</th><th>Yes</th><th>No</th><th>Remarks</th></tr></thead><tbody>
      ${f.rows.map((row, i) => { const x = (v || {})[row] || {}; return `<tr><td>${esc(row)}</td>
        <td><input type="radio" name="${f.k}__${i}" value="Yes" ${x.v === 'Yes' ? 'checked' : ''} ${d} aria-label="${esc(row)}: yes"></td>
        <td><input type="radio" name="${f.k}__${i}" value="No" ${x.v === 'No' ? 'checked' : ''} ${d} aria-label="${esc(row)}: no"></td>
        <td><input type="text" name="${f.k}__${i}__r" value="${esc(x.r || '')}" ${d} aria-label="${esc(row)}: remarks"></td></tr>`; }).join('')}</tbody></table></div>`; break;
    case 'table': input = `<div class="table-wrap"><table class="t edit-table" data-table="${f.k}"><thead><tr>${f.cols.map(c => `<th>${esc(c.label)}</th>`).join('')}${d ? '' : '<th></th>'}</tr></thead>
      <tbody>${(Array.isArray(v) ? v : []).map(r => tableRow(f, r, d)).join('')}</tbody></table></div>${d ? '' : `<button type="button" class="btn" data-addrow="${f.k}" style="margin-top:.4rem">Add row</button>`}`; break;
    case 'recordref': {
      const hit = v && ALL.find(r => r.number === v && f.refTypes.includes(r.type));
      input = `<input id="${id}" type="text" name="${f.k}" value="${esc(v)}" list="dl_${f.k}" autocomplete="off" ${d}><datalist id="dl_${f.k}">${ALL.filter(r => f.refTypes.includes(r.type)).slice(0, 300).map(r => `<option value="${esc(r.number)}">${esc(r.data.title || '')}</option>`).join('')}</datalist>${hit ? ` <a class="small" href="#/r/${hit.id}">Open ${esc(hit.number)}</a>` : ''}`; break;
    }
    case 'phone': input = `<input id="${id}" type="tel" name="${f.k}" value="${esc(v)}" placeholder="+1 6315551234" pattern="\\+\\d{1,3}[ \\-]?\\d{10}" title="Country code and 10-digit number, e.g. +1 6315551234" ${d}>`; break;
    case 'email': input = `<input id="${id}" type="email" name="${f.k}" value="${esc(v)}" placeholder="name@company.com" ${d}>`; break;
    case 'url': input = `<input id="${id}" type="url" name="${f.k}" value="${esc(v)}" placeholder="https://" ${d}>${/^https?:\/\//i.test(v) ? ` <a class="small" href="${esc(v)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}`; break;
    default: input = `<input id="${id}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" name="${f.k}" value="${esc(v)}" ${d}>`;
  }
  return `<div class="${f.full || f.type === 'multicheck' ? 'full' : ''}">${lab}${input}</div>`;
}
function tableRow(f, r = {}, d = '') {
  const calc = f.rowCompute ? f.rowCompute(r) : {};
  const cell = (c) => {
    const v = r[c.k] || '', aria = `aria-label="${esc(c.label)}"`;
    if (c.computed) return `<span class="mono" data-calc="${c.k}">${esc(calc[c.k] || '')}</span>`;
    if (c.options) return `<select data-col="${c.k}" ${d} ${aria}><option value=""></option>${c.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    if (c.type === 'user') return `<select data-col="${c.k}" ${d} ${aria}><option value=""></option>${USERS.filter(u => u.active || u.username === v).map(u => `<option value="${esc(u.username)}" ${u.username === v ? 'selected' : ''}>${esc(u.fullname)}${u.department ? ' – ' + esc(u.department) : ''}</option>`).join('')}</select>`;
    if (c.type === 'dept') return `<select data-col="${c.k}" ${d} ${aria}><option value=""></option>${Object.entries(CFG.DEPTS).map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    if (c.type === 'score') return `<input type="number" min="1" max="5" step="1" class="score" data-col="${c.k}" value="${esc(v)}" ${d} ${aria}>`;
    return `<input type="${c.type === 'date' ? 'date' : 'text'}" data-col="${c.k}" value="${esc(v)}" ${d} ${aria}>`;
  };
  return `<tr>${f.cols.map(c => `<td>${cell(c)}</td>`).join('')}${d ? '' : '<td><button type="button" class="btn" data-delrow>Remove</button></td>'}</tr>`;
}
// highlight the fields the server reported as still empty
function markMissing(root, keys = []) {
  if (!root) return;
  $$('.field-missing', root).forEach(el => el.classList.remove('field-missing'));
  for (const k of keys) { const el = $(`[name="${k}"], [data-table="${k}"], [data-computed="${k}"]`, root); const box = el && el.closest('.grid > div'); if (box) box.classList.add('field-missing'); }
  $('.field-missing', root)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function readForm(root, m) {
  const out = {};
  for (const f of dataFields(m)) {
    if (f.type === 'computed' || f.type === 'readonly') continue;
    // fields not on the page (e.g. a hidden section) are not sent, so they keep their saved value
    if (!$(`[name="${f.k}"], [data-table="${f.k}"], [name^="${f.k}__"]`, root)) continue;
    if (f.type === 'multicheck') out[f.k] = $$(`input[name="${f.k}"]:checked`, root).map(x => x.value);
    else if (f.type === 'checkbox') out[f.k] = !!$(`[name="${f.k}"]`, root)?.checked;
    else if (f.type === 'checklist') out[f.k] = Object.fromEntries(f.rows.map((row, i) => [row, { v: $(`input[name="${f.k}__${i}"]:checked`, root)?.value || '', r: $(`[name="${f.k}__${i}__r"]`, root)?.value || '' }]));
    else if (f.type === 'table') out[f.k] = $$(`table[data-table="${f.k}"] tbody tr`, root).map(tr => Object.fromEntries(f.cols.filter(c => !c.computed).map(c => [c.k, $(`[data-col="${c.k}"]`, tr).value.trim()]))).filter(r => Object.values(r).some(Boolean));
    else out[f.k] = $(`[name="${f.k}"]`, root)?.value ?? '';
  }
  return out;
}
/** Wires up form behaviour: live computed fields (merged over the saved record) and add / remove rows in table fields. */
function liveCompute(root, m, base = {}) {
  root.addEventListener('click', (e) => {
    const add = e.target.closest('[data-addrow]');
    if (add) { const f = m.fields.find(x => x.k === add.dataset.addrow); $(`table[data-table="${f.k}"] tbody`, root).insertAdjacentHTML('beforeend', tableRow(f)); }
    const del = e.target.closest('[data-delrow]');
    if (del) del.closest('tr').remove();
  });
  // calculated table columns (e.g. FMEA RPN and risk level) follow the row as it is typed
  root.addEventListener('input', (e) => {
    const tr = e.target.closest('table[data-table] tbody tr'); if (!tr) return;
    const f = m.fields.find(x => x.k === tr.closest('table').dataset.table); if (!f || !f.rowCompute) return;
    const calc = f.rowCompute(Object.fromEntries($$('[data-col]', tr).map(i => [i.dataset.col, i.value])));
    $$('[data-calc]', tr).forEach(s => { s.textContent = calc[s.dataset.calc] || ''; });
  });
  if (!m.compute) return;
  const run = () => { const d = { ...base, ...readForm(root, m) }; for (const [k, fn] of Object.entries(m.compute)) { const el = $(`[data-computed="${k}"]`, root); if (el) el.textContent = fn(d); } };
  root.addEventListener('input', run); root.addEventListener('change', run); run();
}
function newView(type) {
  const m = MODS[type]; if (!m || !canSeeModule(m)) return dashboard();
  shell(type, `<div class="spread"><div><h1>${esc(m.createTitle || 'New ' + singular(m))}</h1><p class="muted">${m.createHelp ? esc(m.createHelp) : m.tempNumbering ? 'Your request goes to QA with a request number. When QA approves it the record number is assigned automatically; QA may also ask you to update the request, or reject it.' + (m.deptScoped ? ' The responsible department is the department of the responsible person.' : '') : 'The record number is assigned when you save.'} Fields marked * are required.</p></div></div>
   <form id="nf" class="panel"><div class="grid">${createFields(m).filter(f => f.type !== 'readonly').map(f => fieldHtml(f, undefined, false)).join('')}</div>
   ${m.tempNumbering || m.attachOnRequestOnly || m.attachOnCreate ? `<div style="margin-top:1rem"><label class="f" for="natt">Attachments${m.attachOnRequestOnly ? ' – ' + esc(m.attachHint || 'attach your documents now; after the request only QA can add documents') : ' (optional)'}</label><input type="file" id="natt" multiple></div>` : ''}
   <div class="error" style="margin-top:1rem"></div><div class="row"><button class="btn primary">${m.createLabel ? esc(m.createLabel) : m.tempNumbering ? 'Submit request to QA' : 'Save record'}</button><a class="btn" href="#/m/${type}">Cancel</a></div></form>`);
  const form = $('#nf');
  if (type === 'investigations') { const o = $('[name=dateIdentified]', form); if (o) o.value = today(); }
  liveCompute(form, m, type === 'investigations' ? { qaNotified: today() } : {});
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const files = [...($('#natt', form)?.files || [])]; if (files.some(f => f.size > 25 * 1024 * 1024)) throw new Error('Maximum file size is 25 MB in this build.');
      const attachments = await Promise.all(files.map(async f => ({ name: f.name, mime: f.type, base64: await fileB64(f) })));
      const rec = await api('POST', '/api/records', { type, data: readForm(form, m), attachments });
      toast(`${rec.number} created${files.length ? ` with ${files.length} attachment(s)` : ''}`); location.hash = '#/r/' + rec.id;
    }
    catch (x) { $('.error', form).textContent = x.message; markMissing(form, x.missing); }
  });
}

const fileB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
const uploadFile = async (id, file, category) => api('POST', `/api/records/${id}/attachments`, { name: file.name, mime: file.type, base64: await fileB64(file), category });
// attachments grouped by the workflow stage they were added at
function attachmentsTable(m, atts) {
  if (!atts.length) return '<p class="muted">No attachments. Files can be added at every stage; each is stored with a SHA-256 checksum that is verified on every download.</p>';
  const stages = [...new Set(atts.map(a => a.stage || ''))].sort((a, b) => m.states.indexOf(a) - m.states.indexOf(b));
  return `<div class="table-wrap"><table class="t"><thead><tr><th>File</th><th>Size</th><th>SHA-256</th><th>Added</th></tr></thead><tbody>${stages.map(st => `<tr class="group-row"><td colspan="4">Stage: ${esc(st || 'Not recorded')}</td></tr>${atts.filter(a => (a.stage || '') === st).map(a => `<tr><td><b>Attachment ${atts.indexOf(a) + 1}</b> – <a href="/api/attachments/${a.id}">${esc(a.name)}</a></td><td>${(a.size / 1024).toFixed(1)} KB</td><td class="mono small" title="${a.sha256}">${a.sha256.slice(0, 16)}…</td><td>${esc(userName(a.uploaded_by))}<br><span class="small muted">${dmyt(a.ts)}</span></td></tr>`).join('')}`).join('')}</tbody></table></div>`;
}

