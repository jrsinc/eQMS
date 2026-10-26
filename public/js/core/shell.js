/* Page frame: menu and top bar. */
'use strict';
// ---------- shell ----------
const logo = () => `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#1E6B52"/><path d="M9 16.5l4.5 4.5L23 11" stroke="#fff" stroke-width="3" fill="none"/></svg>`;
function shell(active, html) {
  const groups = {};
  for (const [k, m] of Object.entries(MODS)) if (canSeeModule(m)) (groups[m.group] ||= []).push([k, m]);
  const openCount = (k) => ALL.filter(r => r.type === k && !DONE.has(r.status)).length;
  const link = (href, label, key, count) => `<a href="#/${href}" class="${active === key ? 'active' : ''}">${esc(label)}${count ? `<span class="count">${count}</span>` : ''}</a>`;
  const isAdmin = ME.allAccess;
  $('#app').innerHTML = `<div class="shell"><nav class="nav" id="nav" aria-label="Main">
    <div class="brand"><div>JRS eQMS<small>Quality Management System</small></div></div>
    ${link('dashboard', 'Dashboard', 'dashboard')}${link('tasks', 'My tasks', 'tasks')}${link('readiness', 'Inspection readiness', 'readiness')}
    ${Object.entries(groups).map(([g, list]) => `<h4>${esc(g)}</h4>${list.map(([k, m]) => link('m/' + k, m.name, k, openCount(k))).join('')}${g === 'Documents & training' ? link('matrix', 'Training matrix', 'matrix') : ''}`).join('')}
    <h4>Controlled documents</h4>${link('forms', 'Controlled forms', 'forms')}${link('sops', 'Controlled SOPs', 'sops')}
    <h4>System</h4>${auditAccess() ? link('audit', 'Audit trail', 'audit') + link('issued', 'Issued forms', 'issued') : ''}${link('signatures', 'Signature register', 'signatures')}${link('sharepoint', 'SharePoint', 'sharepoint')}${link('departments', 'Departments', 'departments')}${ME.canEditOrg ? link('organogram', 'Organogram', 'organogram') : ''}${isAdmin ? link('users', 'Users and roles', 'users') : ''}${ME.roles.includes('admin') ? link('backup', 'Backup and restore', 'backup') : ''}${link('password', 'Change password', 'password')}
    </nav><div class="main">${envBanner()}<header class="topbar"><button class="btn menu-btn" id="menu" aria-label="Menu">Menu</button><a class="topbar-logo" href="#/dashboard" title="Dashboard"><img src="/logo.png" alt="Jupiter Research Services"></a>
    <form id="gs" role="search" style="flex:1;max-width:420px"><input type="search" name="q" placeholder="Search records by number or title"></form>
    <div class="who"><a class="btn bell" href="#/notifications" title="Notifications">Notifications<span class="count" id="ncount" hidden></span></a><span title="Automatic lock after inactivity">Lock in <span id="idle" class="mono">${Math.floor(idleLeft / 60)}:${String(idleLeft % 60).padStart(2, '0')}</span></span>
    <span><b>${esc(ME.fullname)}</b><br><span class="small muted">${esc([ME.department ? deptName(ME.department) : '', ...ME.roles.filter(r => r !== 'numgen').map(r => r === 'hod' ? 'Head of ' + ME.hodOf.join(', ') : CFG.ROLES[r].split(' (')[0])].filter(Boolean).join(' · '))}</span></span>
    <button class="btn" id="logout">Sign out</button></div></header><main class="content" id="content">${html}</main></div></div>`;
  api('GET', '/api/notifications?count=1').then(r => { const c = $('#ncount'); if (c && r.unread) { c.textContent = r.unread; c.hidden = false; } }).catch(() => {});
  $('#logout').addEventListener('click', async () => { await api('POST', '/api/logout'); ME = null; location.hash = ''; renderLogin(); });
  $('#menu').addEventListener('click', () => $('#nav').classList.toggle('open'));
  $('#gs').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/search/' + encodeURIComponent(e.target.q.value); });
}

