/* Record lists of a module. */
'use strict';
// ---------- module list ----------
function listView(type) {
  const m = MODS[type]; if (!m || !canSeeModule(m)) return dashboard();
  const rows = ALL.filter(r => r.type === type); if (m.listSort) rows.sort(m.listSort);
  const canCreate = !m.noCreate && (type !== 'randomization' || hasRole(['unblinded'])) && !ME.roles.every(r => r === 'extaud');
  shell(type, `<div class="spread"><div><h1>${esc(m.name)}</h1><p class="muted">${esc(m.intro)}</p></div>
    <div class="row">${canCreate ? `<a class="btn primary" href="#/new/${type}">${esc(m.createTitle || 'New ' + singular(m))}</a>` : ''}${m.issueForm && !m.issueForm.fromRecordOnly && (!m.issueForm.roles || hasRole(m.issueForm.roles)) ? `<a class="btn" href="/api/forms/${type}" download title="PDF with an issue stamp; every issue is numbered and logged">Download ${esc(m.issueForm.label)}</a>` : ''}${m.masterList ? `<a class="btn" href="/api/master-list/${type}" download title="${esc(m.masterList.title)}">${esc(m.masterList.title.split(' –')[0])} (PDF)</a><a class="btn" href="/api/master-list/${type}?format=csv" download>${esc(m.masterList.title.split(' –')[0])} (CSV)</a>` : ''}<button class="btn" id="exp">Export CSV</button></div></div>
    ${type === 'extensions' ? extensionKpis(rows) : ''}<div class="row no-print" style="margin-bottom:.8rem"><input type="search" id="flt" placeholder="Filter" style="max-width:280px">
    <select id="st" style="max-width:220px"><option value="">All statuses</option>${m.states.map(s => `<option>${esc(s)}</option>`).join('')}</select>
    <label class="small"><input type="checkbox" id="od"> Overdue only</label></div><div id="lt"></div>`);
  const draw = () => {
    const q = $('#flt').value.toLowerCase(), st = $('#st').value, od = $('#od').checked;
    const list = rows.filter(r => (!st || r.status === st) && (!od || isOverdue(r)) && (!q || (r.number + JSON.stringify(r.data)).toLowerCase().includes(q)));
    $('#lt').innerHTML = table(list, m.list, rows.length ? 'No records match the filter.' : `No ${m.name.toLowerCase()} yet.`); bindRows($('#lt'));
  };
  ['input', 'change'].forEach(ev => ['#flt', '#st', '#od'].forEach(s => $(s).addEventListener(ev, draw))); draw();
  $$('[data-st]').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); $('#st').value = a.dataset.st; draw(); }));
  $('#exp').addEventListener('click', () => {
    const fs = dataFields(m);
    download(`${type}_${today()}.csv`, toCsv([['Number', 'Status', 'Created by', 'Created', ...fs.map(f => f.label)], ...rows.map(r => [r.number, r.status, r.created_by, r.created_at, ...fs.map(f => plain(f, r.data[f.k]))])]));
  });
}

