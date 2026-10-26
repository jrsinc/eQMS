/* Audit trail. */
'use strict';
// ---------- audit trail ----------
const AUDIT_FILTERS = [['from', 'From'], ['to', 'To'], ['user', 'User'], ['type', 'Module'], ['record', 'Record no.'], ['action', 'Action'], ['q', 'Text']];
const filterText = (f) => AUDIT_FILTERS.filter(([k]) => f[k]).map(([k, l]) => `${l}: ${k === 'user' ? userName(f[k]) : k === 'type' ? (MODS[f[k]] ? MODS[f[k]].name : 'System events') : k === 'from' || k === 'to' ? dmy(f[k]) : f[k]}`).join(' · ') || 'No filters (latest entries)';
async function auditView() {
  if (!auditAccess()) return shell('audit', NO_AUDIT_ACCESS);
  const f = Object.fromEntries(AUDIT_FILTERS.map(([k]) => [k, QS.get(k) || '']));
  shell('audit', `<div class="spread"><div><h1>Audit trail</h1><p class="muted">System-wide, append-only and hash-chained: entries cannot be edited or deleted. Times in ${esc(tz)}. Visible to QA and administrators only.</p></div>
    <div class="row no-print"><button class="btn" id="av">Verify integrity</button><button class="btn" id="ax">Export CSV</button><button class="btn" id="ap">Print report</button></div></div>
    <form id="aq" class="panel no-print" style="margin-bottom:.8rem"><div class="grid audit-filters">
      <div><label class="f">From</label><input type="date" name="from" value="${esc(f.from)}"></div>
      <div><label class="f">To</label><input type="date" name="to" value="${esc(f.to)}"></div>
      <div><label class="f">User</label><select name="user"><option value="">All users</option>${USERS.map(u => `<option value="${esc(u.username)}" ${u.username === f.user ? 'selected' : ''}>${esc(u.fullname)}</option>`).join('')}</select></div>
      <div><label class="f">Module</label><select name="type"><option value="">All modules</option>${Object.entries(MODS).filter(([, m]) => canSeeModule(m)).map(([k, m]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="system" ${f.type === 'system' ? 'selected' : ''}>System events (sign-ins, users)</option></select></div>
      <div><label class="f">Record no.</label><input type="text" name="record" value="${esc(f.record)}" placeholder="e.g. JRS-DEVN-2026-001"></div>
      <div><label class="f">Action</label><input type="text" name="action" value="${esc(f.action)}" placeholder="e.g. Field changed, Login failed"></div>
      <div class="full"><label class="f">Text anywhere (user, value, reason)</label><input type="search" name="q" value="${esc(f.q)}"></div></div>
      <div class="row" style="margin-top:.6rem"><button class="btn primary">Apply filters</button><a class="btn" href="#/audit">Clear</a></div></form>
    <div id="al"></div>`);
  const rows = await api('GET', '/api/audit?limit=2000&' + new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString());
  const view = rows.map(a => ({ ...a, module: recordLabel(a), fieldName: fieldLabel(a.record_type, a.field), oldV: String(auditValue(a.record_type, a.field, a.old_value) ?? ''), newV: String(auditValue(a.record_type, a.field, a.new_value) ?? '') }));
  // which modules changed in this selection – click one to filter
  const byMod = Object.entries(view.reduce((o, a) => { const k = a.record_type || (a.record_id ? '' : 'system'); (o[k] ||= { label: a.module || 'System', n: 0 }).n++; return o; }, {})).sort((x, y) => y[1].n - x[1].n);
  $('#al').innerHTML = `${byMod.length ? `<div class="panel" style="margin-bottom:.8rem"><h3 style="margin-top:0">Changes by module</h3><div class="row">${byMod.map(([k, x]) => k ? `<a class="btn" href="#/audit?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), type: k })}">${esc(x.label)} <span class="count">${x.n}</span></a>` : `<span class="btn">${esc(x.label)} <span class="count">${x.n}</span></span>`).join('')}</div></div>` : ''}<p class="small muted">${view.length} entr${view.length === 1 ? 'y' : 'ies'}${view.length === 2000 ? ' (latest 2,000 – narrow the filters to see older entries)' : ''} · ${esc(filterText(f))}</p>
    <div class="table-wrap"><table class="t audit-table"><thead><tr><th>#</th><th>Date / time</th><th>User</th><th>Module</th><th>Action</th><th>Record</th><th>Field</th><th>Old value</th><th>New value</th><th>Reason</th></tr></thead><tbody>
    ${view.map(a => `<tr><td class="mono small">${a.id}</td><td class="mono small">${dmyt(a.ts)}</td><td>${esc(a.fullname || a.username)}<br><span class="small muted mono">${esc(a.username || '')}</span></td><td>${esc(a.module || 'System')}</td><td>${esc(a.action)}</td>
      <td>${a.record_id ? `<a class="mono small" href="#/r/${a.record_id}">${esc(a.record_number)}</a>` : '<span class="small muted">–</span>'}</td>
      <td>${esc(a.fieldName)}</td><td class="small">${esc(a.oldV.slice(0, 160))}</td><td class="small">${esc(a.newV.slice(0, 160))}</td><td class="small">${esc(a.reason || '')}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No entries match.</td></tr>'}</tbody></table></div>`;
  $('#aq').addEventListener('submit', (e) => { e.preventDefault(); const p = new URLSearchParams([...new FormData(e.target)].filter(([, v]) => v)); location.hash = '#/audit' + (p.toString() ? '?' + p : ''); });
  $('#av').addEventListener('click', async () => { const r = await api('GET', '/api/audit/verify'); modal({ title: 'Audit trail integrity', cancel: '', ok: 'Close', html: r.ok ? `<p><span class="pill done">Intact</span> ${r.checked} entries verified. The hash chain is unbroken.</p>` : `<p><span class="pill bad">Broken</span> Chain fails at entry #${r.brokenAt}. Escalate to QA and IT as a data-integrity incident.</p>` }); });
  $('#ax').addEventListener('click', () => {
    api('POST', '/api/audit/report', { kind: 'csv', filters: filterText(f) }).catch(() => {});
    download(`audit_trail_${today()}.csv`, toCsv([['ID', 'Date / time (UTC)', 'User ID', 'Name', 'Action', 'Record', 'Module', 'Field', 'Old value', 'New value', 'Reason', 'IP', 'Hash'],
      ...view.map(a => [a.id, a.ts, a.username, a.fullname, a.action, a.record_number, a.module, a.fieldName, a.oldV, a.newV, a.reason, a.ip, a.hash])]));
  });
  $('#ap').addEventListener('click', async () => {
    const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.');
    const chain = await api('GET', '/api/audit/verify');
    api('POST', '/api/audit/report', { kind: 'print', filters: filterText(f) }).catch(() => {});
    w.document.write(`<!doctype html><title>Audit trail report</title><style>body{font:9.5pt Arial,sans-serif;margin:12mm}h1{font-size:14pt;margin:0}table{border-collapse:collapse;width:100%;margin-top:4mm}td,th{border:1px solid #999;padding:2px 4px;text-align:left;vertical-align:top}th{background:#eee}thead{display:table-header-group}.meta{margin:2mm 0;color:#333}</style>
      <h1>Audit trail report – ${esc(HEALTH.org || '')}</h1>
      <div class="meta">Filters: ${esc(filterText(f))}<br>Entries: ${view.length} · Integrity: ${chain.ok ? `intact (${chain.checked} entries verified)` : `BROKEN at entry #${chain.brokenAt}`}<br>Printed ${dmyt(new Date().toISOString())} ${esc(tz)} by ${esc(ME.fullname)}</div>
      <table><thead><tr><th>#</th><th>Date / time</th><th>User</th><th>Module</th><th>Action</th><th>Record</th><th>Field</th><th>Old</th><th>New</th><th>Reason</th></tr></thead><tbody>
      ${view.map(a => `<tr><td>${a.id}</td><td>${dmyt(a.ts)}</td><td>${esc(a.fullname || a.username)}</td><td>${esc(a.module || 'System')}</td><td>${esc(a.action)}</td><td>${esc(a.record_number || '–')}</td><td>${esc(a.fieldName)}</td><td>${esc(a.oldV)}</td><td>${esc(a.newV)}</td><td>${esc(a.reason || '')}</td></tr>`).join('')}</tbody></table>`);
    w.document.close(); w.focus(); w.print();
  });
}

