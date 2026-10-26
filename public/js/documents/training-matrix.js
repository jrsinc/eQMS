/* Training matrix. */
'use strict';
// ---------- training matrix ----------
function matrix() {
  const docs = ALL.filter(r => r.type === 'documents' && r.status === 'Effective' && r.data.trainingImpact && r.data.trainingImpact !== 'None');
  const trn = ALL.filter(r => r.type === 'training');
  const users = USERS.filter(u => u.active);
  const cell = (u, d) => {
    if (!(d.data.trainingRoles || []).some(r => u.roles.includes(r))) return '<td class="muted">–</td>';
    const t = trn.filter(x => x.data.trainee === u.username && x.data.docRef === d.number && String(x.data.title).includes('v' + d.data.version)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!t) return '<td><span class="pill warn">Not assigned</span></td>';
    return `<td><a href="#/r/${t.id}">${t.status === 'Completed' ? '<span class="pill done">Trained</span>' : isOverdue(t) ? '<span class="pill bad">Overdue</span>' : pill(t.status)}</a></td>`;
  };
  shell('matrix', `<div class="spread"><div><h1>Training matrix</h1><p class="muted">Effective documents with training impact × active users. “–” means the user's roles do not require it.</p></div><button class="btn" id="mx">Export CSV</button></div>
    ${docs.length ? `<div class="table-wrap"><table class="t matrix"><thead><tr><th>User</th>${docs.map(d => `<th title="${esc(d.data.title)}"><span class="mono">${esc(d.number)}</span><br><span class="small muted">v${esc(d.data.version)}</span></th>`).join('')}</tr></thead>
    <tbody>${users.map(u => `<tr><td>${esc(u.fullname)}<br><span class="small muted">${esc(u.roles.join(', '))}</span></td>${docs.map(d => cell(u, d)).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="panel empty">No effective documents with training impact yet. Training is assigned automatically when such a document becomes effective.</div>'}`);
  $('#mx')?.addEventListener('click', () => download(`training_matrix_${today()}.csv`, toCsv([['User', ...docs.map(d => d.number + ' v' + d.data.version)], ...users.map(u => [u.fullname, ...docs.map(d => { const c = cell(u, d); return c.replace(/<[^>]+>/g, ''); })])])));
}

