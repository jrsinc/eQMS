/* Record history and version comparison. */
'use strict';
// ---------- record history: every change grouped by save, saved versions and comparison (QA and admin) ----------
async function historyView(id) {
  if (!auditAccess()) return shell('', NO_AUDIT_ACCESS);
  const [det, vh] = await Promise.all([api('GET', '/api/records/' + id), api('GET', `/api/records/${id}/versions`)]);
  const rec = det.record, m = MODS[rec.type];
  const groups = [];
  for (const a of det.audit.slice().reverse()) { // oldest first, then shown newest first
    const key = `${a.username}|${a.ts.slice(0, 19)}|${a.reason || ''}`, last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(a); else groups.push({ key, ts: a.ts, user: a.fullname || a.username, reason: a.reason, items: [a] });
  }
  groups.reverse();
  shell(rec.type, `<div class="spread"><div><p class="muted small"><a href="#/r/${rec.id}">${esc(rec.number)}</a> · ${esc(m.name)}</p><h1>History of <span class="mono">${esc(rec.number)}</span></h1>
    <p class="muted">${esc(rec.data.title || '')} · Times in ${esc(tz)} · Visible to QA and administrators only.</p></div><a class="btn" href="#/r/${rec.id}">Back to record</a></div>
    ${vh.docVersions.length ? `<div class="panel"><h3>Document versions</h3><div class="table-wrap"><table class="t"><thead><tr><th>Version</th><th>Status</th><th>Revision type</th><th>Change control</th><th>Approved</th><th>Effective</th><th>Superseded</th><th>Reason / summary</th></tr></thead><tbody>
      ${vh.docVersions.map(v => `<tr class="click" data-go="#/history/${v.id}"><td class="mono">${esc(v.version)}</td><td>${pill(v.status)}</td><td>${esc(v.revisionType || '')}</td><td class="mono small">${esc(v.changeControl || '')}</td><td>${dmy(v.approvedOn)}</td><td>${dmy(v.effectiveDate)}</td><td>${dmy(v.supersededOn)}</td><td class="small">${esc(v.summary || '')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <div class="panel"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Saved versions</h3><button class="btn" id="cmp">Compare selected</button></div>
      <p class="small muted">A read-only copy of the record is kept each time its content, status or number changes. Tick two versions to compare them.</p>
      <div class="table-wrap"><table class="t"><thead><tr><th></th><th>Version</th><th>Saved</th><th>By</th><th>Status</th><th>Number</th><th>Reason</th><th></th></tr></thead><tbody>
      ${vh.versions.map(v => `<tr><td><input type="checkbox" data-v="${v.no}" aria-label="Select version ${v.no}"></td><td class="mono">${v.no}</td><td class="small">${dmyt(v.ts)}</td><td>${esc(v.fullname || v.username)}</td><td>${pill(v.status)}</td><td class="mono small">${esc(v.number || '')}</td><td class="small">${esc(v.reason || '')}</td><td><button class="btn" data-view="${v.no}">View</button></td></tr>`).join('')}</tbody></table></div>
      <div id="vcmp"></div></div>
    <div class="panel"><h3>Change history</h3><p class="small muted">${det.audit.length} audit trail entries, grouped by save.</p>
      ${groups.map(g => `<div class="hist-group"><div class="hist-head"><b>${dmyt(g.ts)}</b> · ${esc(g.user)}${g.reason ? ` · <span class="muted">Reason: ${esc(g.reason)}</span>` : ''}</div>
        <table class="t"><tbody>${g.items.map(a => `<tr><td style="width:24%">${esc(a.action)}</td><td style="width:22%">${esc(fieldLabel(rec.type, a.field))}</td><td class="small"><del>${esc(String(auditValue(rec.type, a.field, a.old_value) ?? '').slice(0, 300))}</del></td><td class="small"><ins>${esc(String(auditValue(rec.type, a.field, a.new_value) ?? '').slice(0, 300))}</ins></td></tr>`).join('')}</tbody></table></div>`).join('')}</div>`);
  bindRows();
  const getV = (no) => api('GET', `/api/records/${id}/versions/${no}`);
  const shown = (f, v) => f.type === 'user' ? userName(v) : f.fmt === 'date' || f.type === 'date' ? dmy(v) : String(plain(f, v) ?? '');
  $$('[data-view]').forEach(b => b.addEventListener('click', async () => {
    const v = await getV(b.dataset.view);
    modal({ title: `${rec.number} – version ${v.no}`, wide: true, cancel: '', ok: 'Close', html: `<p class="small muted">Saved ${dmyt(v.ts)} by ${esc(v.fullname || v.username)} · Status ${esc(v.status)}</p>
      <div class="table-wrap" style="max-height:60vh"><table class="t"><tbody>${dataFields(m).map(f => `<tr><th style="width:35%">${esc(f.label)}</th><td style="white-space:pre-wrap">${esc(shown(f, v.data[f.k]))}</td></tr>`).join('')}</tbody></table></div>` });
  }));
  $('#cmp').addEventListener('click', async () => {
    const sel = $$('[data-v]:checked').map(x => +x.dataset.v).sort((x, y) => x - y);
    if (sel.length !== 2) return toast('Tick exactly two versions to compare.');
    const [a, b] = await Promise.all(sel.map(getV));
    const rows = [['Status', a.status, b.status], ['Number', a.number, b.number], ...dataFields(m).map(f => [f.label, shown(f, a.data[f.k]), shown(f, b.data[f.k])])].filter(([, x, y]) => String(x ?? '') !== String(y ?? ''));
    $('#vcmp').innerHTML = `<h4 style="margin-top:1rem">Version ${a.no} → version ${b.no}: ${rows.length} difference${rows.length === 1 ? '' : 's'}</h4>
      <div class="table-wrap"><table class="t"><thead><tr><th>Field</th><th>Version ${a.no} (${dmyt(a.ts)})</th><th>Version ${b.no} (${dmyt(b.ts)})</th></tr></thead><tbody>
      ${rows.map(([l, x, y]) => `<tr><td>${esc(l)}</td><td class="small" style="white-space:pre-wrap"><del>${esc(String(x ?? ''))}</del></td><td class="small" style="white-space:pre-wrap"><ins>${esc(String(y ?? ''))}</ins></td></tr>`).join('') || '<tr><td colspan="3" class="muted">No differences.</td></tr>'}</tbody></table></div>`;
  });
}

// audit trail review: the summary compiled from the audit trail when the review started
function atrPanel(rec) {
  const s = rec.data.summary;
  if (!s) { $('#special').innerHTML = '<div class="panel"><h3>Audit trail summary</h3><p class="muted">Compiled when the review starts.</p></div>'; return; }
  const tbl = (head, rows) => `<div class="table-wrap" style="margin-bottom:.8rem"><table class="t"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const link = `#/audit?from=${s.period.from}&to=${s.period.to}`;
  $('#special').innerHTML = `<div class="panel"><div class="spread"><h3 style="margin:0">Audit trail summary ${dmy(s.period.from)} – ${dmy(s.period.to)}</h3><a class="btn" href="${link}">Open the audit trail for this period</a></div>
    <p class="small muted">Compiled ${dmyt(s.generatedAt)} · Scope: ${esc(s.scope.map(k => MODS[k] ? MODS[k].name : k === 'system' ? 'System events' : k).join(', '))}</p>
    <div class="kpis"><div class="kpi"><b>${s.total}</b>Audit trail entries</div><div class="kpi"><b>${s.records}</b>Records touched</div><div class="kpi ${s.chain.ok ? 'ok' : 'alert'}"><b>${s.chain.ok ? 'Intact' : 'BROKEN'}</b>Hash chain (${s.chain.checked} entries)</div></div>
    <h4>Events to look at first</h4>${tbl(['Event', 'Count'], s.flags)}
    <div class="two"><div><h4>By user</h4>${tbl(['User', 'Entries'], s.byUser)}</div><div><h4>By action</h4>${tbl(['Action', 'Entries'], s.byAction)}</div></div></div>`;
}

