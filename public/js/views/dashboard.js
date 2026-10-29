/* Dashboard, my tasks and search. */
'use strict';
// ---------- dashboard / tasks / search ----------
function recRow(r, cols) {
  const m = MODS[r.type];
  return `<tr class="click" data-go="#/r/${r.id}">${cols.map(c => {
    if (c === 'number') return `<td class="mono">${esc(r.number)}${r.type === 'documents' ? ' v' + esc(r.data.version) : ''}</td>`;
    if (c === 'status') return `<td>${pill(r.status)}${isOverdue(r) ? ' <span class="pill bad">Overdue</span>' : ''}</td>`;
    if (c === 'module') return `<td>${esc(m.name)}</td>`;
    const f = m.fields.find(x => x.k === c); const v = r.data[c];
    return `<td>${f && (f.type === 'date' || f.fmt === 'date') ? dmy(v) : f && (f.type === 'user' || f.fmt === 'user') ? esc(userName(v)) : f && f.optionLabels && f.optionLabels[v] ? esc(f.optionLabels[v]) : esc(Array.isArray(v) ? v.join(', ') : v)}</td>`;
  }).join('')}</tr>`;
}
function bindRows(root = document) { $$('[data-go]', root).forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.go; })); }
function myTasks() {
  return ALL.filter(r => {
    if (DONE.has(r.status)) return false;
    if (r.type === 'actionitems') return r.status === 'Open' ? r.data.respPerson === ME.username : false;
    if (r.type === 'changes' && r.status === 'Optional Approvals' && (r.data.approvers || []).some(a => a.user === ME.username) && !(r.data.deptApprovals || []).some(a => a.person === ME.username)) return true;
    if (r.type === 'training') return ['Trainer Evaluation', 'Failed'].includes(r.status) ? r.data.trainer === ME.username : r.data.trainee === ME.username;
    if (r.type === 'documents' && r.status === 'In Review' && r.data.reviewer === ME.username) return true;
    if (r.type === 'documents' && r.status === 'Draft' && r.created_by === ME.username) return true;
    if (['extensions', 'vendors'].includes(r.type) && r.status === 'HOD Review' && r.data.hodApprover === ME.username) return true;
    if (r.type === 'extensions' && r.status === 'Draft' && r.created_by === ME.username) return true;
    if (r.type === 'capa') {
      const d = r.data;
      if (r.status === 'Initiated' && r.created_by === ME.username) return true;
      if (['HOD Pre-Approval', 'HOD Verification'].includes(r.status) && d.hodApprover === ME.username) return true;
      if (r.status === 'Implementation' && (d.respPerson === ME.username || (!!ME.department && ME.department === d.respDept))) return true;
    }
    if (r.type === 'investigations') {
      const d = r.data, mine = d.respPerson === ME.username || (!!ME.department && ME.department === d.respDept);
      if (['Initiation', 'Part A Update'].includes(r.status) && (r.created_by === ME.username || mine)) return true;
      if (r.status === 'Request Update' && r.created_by === ME.username) return true;
      if (r.status === 'Investigation' && mine) return true;
      if (r.status === 'HOD Approval' && d.hodApprover === ME.username) return true;
    }
    if (r.type === 'changes') {
      const d = r.data;
      if (r.status === 'Draft' && r.created_by === ME.username) return true;
      if (r.status === 'RP Review' && d.respPerson === ME.username) return true;
      if (r.status === 'HOD Approval' && d.hodApprover === ME.username) return true;
      if (r.status === 'Implementation' && ([r.created_by, d.respPerson].includes(ME.username) || (!!ME.department && ME.department === d.respDept))) return true;
      if (r.status === 'Closed – EC Pending' && d.respPerson === ME.username) return true;
    }
    if (r.type === 'changes' && r.status === 'Optional Approvals') return (r.data.optionalDepts || []).some(x => (ME.deptsUnder || []).includes(x) && !(r.data.deptApprovals || []).some(a => a.dept === x));
    if (r.type === 'selfinspections') {
      const d = r.data, auditor = [d.leadAuditor, d.coAuditor].includes(ME.username);
      if (r.status === 'Report Issued' && d.auditee === ME.username) return true;
      if (['Notified', 'In Progress', 'Auditor Review'].includes(r.status) && auditor) return true;
    }
    // steps held through a role (all-access users are not given every step as a task)
    return MODS[r.type].transitions.some(t => t.from === r.status && !t.roles.includes('any') && ME.roles.some(x => t.roles.includes(x)));
  });
}
function dashboard() {
  const open = ALL.filter(r => !DONE.has(r.status)), over = open.filter(isOverdue), mine = myTasks();
  const k = (label, n, href, cls) => `<a class="kpi ${cls}" href="${href}"><b>${n}</b>${esc(label)}</a>`;
  const cnt = (t, f = () => true) => ALL.filter(r => r.type === t && !DONE.has(r.status) && f(r)).length;
  shell('dashboard', `<div class="spread"><div><h1>Dashboard</h1><p class="muted">Live status across all quality processes · ${dmy(today())}</p></div></div>
   <div class="kpis">${k('My open tasks', mine.length, '#/tasks', mine.length ? 'warn' : 'ok')}${k('Overdue records', over.length, '#/readiness', over.length ? 'alert' : 'ok')}
   ${k('Open deviations', cnt('investigations', r => r.data.invType === 'Deviation'), '#/m/investigations', '')}${k('Open complaints', cnt('investigations', r => r.data.invType === 'Complaint'), '#/m/investigations', '')}
   ${k('Critical events open', cnt('investigations', r => r.data.criticality === 'Critical'), '#/m/investigations', cnt('investigations', r => r.data.criticality === 'Critical') ? 'alert' : 'ok')}
   ${k('Open CAPA', cnt('capa'), '#/m/capa', '')}${k('Change controls in progress', cnt('changes'), '#/m/changes', '')}
   ${k('Extension requests pending', cnt('extensions', r => r.status !== 'Draft'), '#/m/extensions', '')}${isOff('documents') ? '' : k('Documents in workflow', cnt('documents'), '#/m/documents', '')}</div>
   <div class="two"><div><h2>My tasks</h2>${table(mine.slice(0, 12), ['number', 'module', 'title', 'status'])}</div>
   <div><h2>Overdue</h2>${table(over.slice(0, 12), ['number', 'module', 'title', 'status'])}</div></div>`);
  bindRows();
}
function table(rows, cols, empty = 'Nothing here.') {
  if (!rows.length) return `<div class="table-wrap"><div class="empty">${esc(empty)}</div></div>`;
  // column headings from the rows' own module when they share one; the short form of the label (before any explanation in brackets)
  const types = [...new Set(rows.map(r => r.type))], pool = types.length === 1 && MODS[types[0]] ? [...MODS[types[0]].fields, ...Object.values(MODS).flatMap(m => m.fields)] : Object.values(MODS).flatMap(m => m.fields);
  const head = cols.map(c => c === 'module' ? 'Module' : c === 'number' ? (types.length === 1 && MODS[types[0]] && MODS[types[0]].numberLabel) || 'Number' : c === 'status' ? 'Status' : (pool.find(f => f.k === c) || { label: c }).label.split(' (')[0]);
  return `<div class="table-wrap"><table class="t"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => recRow(r, cols)).join('')}</tbody></table></div>`;
}
function tasks() { shell('tasks', `<h1>My tasks</h1><p class="muted">Records waiting for an action your roles allow, your training and CAPA actions you own.</p>${table(myTasks(), ['number', 'module', 'title', 'status'], 'No open tasks.')}`); bindRows(); }
function searchView(q = '') {
  const s = q.toLowerCase(); const hits = ALL.filter(r => (r.number + ' ' + (r.data.title || '') + ' ' + JSON.stringify(r.data)).toLowerCase().includes(s));
  shell('', `<h1>Search: “${esc(q)}”</h1><p class="muted">${hits.length} records</p>${table(hits, ['number', 'module', 'title', 'status'], 'No records match.')}`); bindRows();
}

