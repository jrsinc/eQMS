/* Register of issued controlled forms. */
'use strict';
// ---------- register of issued controlled forms (QA, administrators, management) ----------
async function issuedFormsView() {
  if (!auditAccess()) return dashboard();
  const rows = await api('GET', '/api/form-issues');
  shell('issued', `<div class="spread"><div><h1>Issued forms</h1><p class="muted">Every controlled form issued from the eQMS with its issue number (FI-YYYY-NNN), who it was issued to and for which record. Visible to QA, administrators and management.</p></div><button class="btn" id="fx">Export CSV</button></div>
    <div class="row no-print" style="margin-bottom:.8rem"><input type="search" id="ff" placeholder="Filter" style="max-width:280px"></div><div id="fl"></div>`);
  const draw = () => {
    const q = $('#ff').value.toLowerCase(), list = rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    $('#fl').innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Issue no.</th><th>Form / SOP</th><th>Record / purpose</th><th>Issued to</th><th>Department</th><th>Issued on</th></tr></thead><tbody>${list.map(r => `<tr><td class="mono">${esc(r.no)}${r.copy_type ? `<br><span class="small muted">${esc(r.copy_type)} copy · valid till ${dmy(r.expiry)}</span>` : ''}</td><td>${esc(r.form_code)}${r.form_version ? ' v' + esc(r.form_version) : ''}<br><span class="small muted">${esc(r.form_title || '')}</span></td>
      <td>${r.record_id ? `<a class="mono" href="#/r/${r.record_id}">${esc(r.record_number)}</a><br><span class="small muted">${esc(r.record_title || '')}</span>` : r.purpose ? esc(r.purpose) : '<span class="muted">Blank form</span>'}</td><td>${esc(r.issued_name || r.issued_to)}</td><td>${esc(deptName(r.dept))}</td><td class="small">${dmyt(r.ts)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-wrap"><div class="empty">No forms issued yet.</div></div>';
  };
  $('#ff').addEventListener('input', draw); draw();
  $('#fx').addEventListener('click', () => download(`issued_forms_${today()}.csv`, toCsv([['Issue no.', 'Form / SOP', 'Version', 'Title', 'Record', 'Record title', 'Purpose', 'Copy type', 'Valid till', 'Issued to', 'Department', 'Issued on (UTC)'], ...rows.map(r => [r.no, r.form_code, r.form_version, r.form_title, r.record_number, r.record_title, r.purpose, r.copy_type, r.expiry, r.issued_name || r.issued_to, r.dept, r.ts])])));
}

