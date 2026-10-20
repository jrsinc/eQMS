/* QualiSuite eQMS — browser application (no framework, CSP-safe: no inline handlers). */
'use strict';
const CFG = window.QMS_CONFIG, MODS = CFG.MODULES;
let ME = null, USERS = [], HEALTH = {}, ALL = [], idleTimer = null, idleLeft = 0;

// ---------- utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dmy(v) { if (!v) return ''; const d = new Date(v.length === 10 ? v + 'T00:00:00' : v); if (isNaN(d)) return esc(v); return `${String(d.getDate()).padStart(2, '0')}-${MON[d.getMonth()]}-${d.getFullYear()}`; }
function dmyt(v) { if (!v) return ''; const d = new Date(v); return `${dmy(v)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const userName = (u) => (USERS.find(x => x.username === u) || {}).fullname || u || '';
const hasRole = (roles) => ME && (roles.includes('any') || ME.roles.some(r => roles.includes(r)));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
function download(name, content, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const csvCell = (v) => { const s = Array.isArray(v) ? v.join('; ') : String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\n');

const DONE = new Set(['Effective', 'Superseded', 'Obsolete', 'Completed', 'Closed', 'Cancelled', 'Approved', 'Released', 'Rejected', 'QP Certified', 'Released to IRT', 'Withdrawn', 'Retired', 'Disqualified', 'Qualified', 'Blocked', 'Failed']);
const GOOD = new Set(['Effective', 'Completed', 'Closed', 'Approved', 'Released', 'QP Certified', 'Qualified', 'Released to IRT']);
const BAD = new Set(['Rejected', 'Failed', 'Blocked', 'Disqualified', 'Suspended']);
const GREY = new Set(['Superseded', 'Obsolete', 'Cancelled', 'Withdrawn', 'Retired', 'Draft']);
const pill = (s) => `<span class="pill ${GOOD.has(s) ? 'done' : BAD.has(s) ? 'bad' : GREY.has(s) ? 'grey' : ''}">${esc(s)}</span>`;
const DUE = { deviations: 'dueDate', capa: 'dueDate', training: 'dueDate', changes: 'targetDate', comparators: 'neededBy', audits: 'responseDue', risks: 'reviewDate' };
const isOverdue = (r) => { const k = DUE[r.type]; return k && !DONE.has(r.status) && r.data[k] && r.data[k] < today(); };

// ---------- API ----------
async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(ME ? { 'X-CSRF-Token': ME.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  resetIdle();
  if (r.status === 401 && url !== '/api/login') { ME = null; renderLogin('Your session ended. Sign in again.'); throw new Error('Session expired'); }
  const ct = r.headers.get('content-type') || '';
  const out = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) throw new Error(out.error || 'Request failed (' + r.status + ')');
  return out;
}

// ---------- modal ----------
function modal({ title, html, ok = 'OK', okClass = 'primary', wide = false, cancel = 'Cancel', onOk, onMount }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="mt"><h2 id="mt">${esc(title)}</h2>
      <form class="stack" novalidate>${html}<div class="error" role="alert"></div>
      <div class="actions">${cancel ? `<button type="button" class="btn" data-x>${esc(cancel)}</button>` : ''}${ok ? `<button class="btn ${okClass}">${esc(ok)}</button>` : ''}</div></form></div></div>`;
    const form = $('form', root), err = $('.error', root);
    const close = (v) => { root.innerHTML = ''; resolve(v); };
    $('[data-x]', root)?.addEventListener('click', () => close(null));
    root.querySelector('.backdrop').addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = ''; const btn = form.querySelector('.actions .btn:last-child'); btn.disabled = true;
      try { const v = onOk ? await onOk(form) : true; close(v === undefined ? true : v); } catch (x) { err.textContent = x.message; btn.disabled = false; }
    });
    onMount && onMount(form);
    (form.querySelector('input:not([readonly]),select,textarea') || form.querySelector('.btn'))?.focus();
  });
}
const val = (form, name) => (form.elements[name] ? form.elements[name].value : '').trim();

async function ensureEsigAccepted() {
  if (ME.esigAccepted) return true;
  const ok = await modal({
    title: 'Electronic signature statement', ok: 'I accept', html: `<p class="sig-statement">I certify that my electronic signature in this system is the legally binding equivalent of my handwritten signature (21 CFR 11.100). I will not share my password, and I am accountable for actions initiated under my electronic signature.</p>`,
    onOk: () => api('POST', '/api/esig-accept')
  });
  if (ok) ME.esigAccepted = true;
  return !!ok;
}
/** Dialog for a workflow step. Collects reason, extra fields and the e-signature, then calls perform(values). */
async function stepDialog({ title, meaning, reason, extra = '', perform }) {
  if (meaning && !(await ensureEsigAccepted())) return null;
  return modal({
    title, ok: meaning ? 'Sign' : 'Confirm', okClass: meaning ? 'primary sign' : 'primary',
    html: `${extra}${reason ? `<div><label class="f">Reason / comment <span class="req">*</span></label><textarea name="reason" rows="3" required></textarea></div>` : ''}
      ${meaning ? `<div class="sig-statement">By signing you apply your electronic signature with the meaning <b>${esc(meaning)}</b>. Date and time are recorded by the server (${esc(tz)}).</div>
      <div class="grid"><div><label class="f">User ID</label><input type="text" name="sigUsername" value="${esc(ME.username)}" autocomplete="username"></div>
      <div><label class="f">Password</label><input type="password" name="password" autocomplete="current-password" required></div></div>` : ''}`,
    onOk: async (f) => {
      const v = Object.fromEntries(new FormData(f));
      if (reason && !String(v.reason || '').trim()) throw new Error('Enter a reason.');
      if (meaning && !v.password) throw new Error('Enter your password to sign.');
      return perform(v);
    }
  });
}

// ---------- auth screens ----------
function renderLogin(msg = '') {
  clearInterval(idleTimer);
  $('#app').innerHTML = `<div class="login"><div class="side"><h1>Quality records you can stand behind in an inspection.</h1>
    <p>Documents, training, deviations, CAPA, change control, complaints, audits, suppliers and clinical supply — one validated system with a full audit trail and electronic signatures.</p></div>
    <form id="lf"><div class="brand" style="color:var(--ink);padding:0">${logo()}<div>QualiSuite eQMS<small class="muted">${esc(HEALTH.org || '')}</small></div></div>
    <h2>Sign in</h2><div><label class="f" for="u">User ID</label><input id="u" type="text" autocomplete="username" required></div>
    <div><label class="f" for="p">Password</label><input id="p" type="password" autocomplete="current-password" required></div>
    <div class="error" role="alert">${esc(msg)}</div><button class="btn primary">Sign in</button>
    <p class="small muted">Authorised users only. All activity is recorded in the audit trail.</p></form></div>`;
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { ME = await api('POST', '/api/login', { username: $('#u').value, password: $('#p').value }); await afterLogin(); }
    catch (x) { $('.error').textContent = x.message; }
  });
  $('#u').focus();
}
async function afterLogin() {
  if (ME.mustChange) return renderPasswordChange(true);
  USERS = await api('GET', '/api/users');
  startIdle(); if (!location.hash) location.hash = '#/dashboard'; route();
}
function renderPasswordChange(forced) {
  const html = `<div class="panel" style="max-width:480px"><h2>${forced ? 'Set a new password' : 'Change password'}</h2>
   ${forced ? '<p class="muted">Your password was set by an administrator. Choose a new one to continue.</p>' : ''}
   <form id="pf" class="stack"><div><label class="f">Current password</label><input type="password" name="current" autocomplete="current-password"></div>
   <div><label class="f">New password (min. 10 characters, upper, lower, number)</label><input type="password" name="next" autocomplete="new-password"></div>
   <div><label class="f">Repeat new password</label><input type="password" name="again" autocomplete="new-password"></div><div class="error"></div><button class="btn primary">Save password</button></form></div>`;
  if (forced) $('#app').innerHTML = `<div class="content">${html}</div>`; else shell('password', html);
  $('#pf').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      if (f.next.value !== f.again.value) throw new Error('New passwords do not match.');
      await api('POST', '/api/password', { current: f.current.value, next: f.next.value });
      ME.mustChange = false; toast('Password changed'); if (forced) afterLogin(); else location.hash = '#/dashboard';
    } catch (x) { $('.error', f).textContent = x.message; }
  });
}
function startIdle() {
  clearInterval(idleTimer); idleLeft = (ME.idleMinutes || 15) * 60;
  idleTimer = setInterval(async () => {
    idleLeft--; const el = $('#idle'); if (el) el.textContent = `${Math.floor(idleLeft / 60)}:${String(idleLeft % 60).padStart(2, '0')}`;
    if (idleLeft <= 0) { clearInterval(idleTimer); ME = null; renderLogin('Locked after inactivity. Sign in again.'); }
  }, 1000);
}
function resetIdle() { if (ME) idleLeft = (ME.idleMinutes || 15) * 60; }
['click', 'keydown'].forEach(ev => document.addEventListener(ev, resetIdle));

// ---------- shell ----------
const logo = () => `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#1E6B52"/><path d="M9 16.5l4.5 4.5L23 11" stroke="#fff" stroke-width="3" fill="none"/></svg>`;
function shell(active, html) {
  const groups = {};
  for (const [k, m] of Object.entries(MODS)) (groups[m.group] ||= []).push([k, m]);
  const openCount = (k) => ALL.filter(r => r.type === k && !DONE.has(r.status)).length;
  const link = (href, label, key, count) => `<a href="#/${href}" class="${active === key ? 'active' : ''}">${esc(label)}${count ? `<span class="count">${count}</span>` : ''}</a>`;
  const isAdmin = ME.roles.includes('admin');
  $('#app').innerHTML = `<div class="shell"><nav class="nav" id="nav" aria-label="Main">
    <div class="brand">${logo()}<div>QualiSuite eQMS<small>${esc(HEALTH.org || '')}</small></div></div>
    ${link('dashboard', 'Dashboard', 'dashboard')}${link('tasks', 'My tasks', 'tasks')}${link('readiness', 'Inspection readiness', 'readiness')}
    ${Object.entries(groups).map(([g, list]) => `<h4>${esc(g)}</h4>${list.map(([k, m]) => link('m/' + k, m.name, k, openCount(k))).join('')}${g === 'Documents & training' ? link('matrix', 'Training matrix', 'matrix') : ''}`).join('')}
    <h4>System</h4>${link('audit', 'Audit trail', 'audit')}${link('sharepoint', 'SharePoint', 'sharepoint')}${isAdmin ? link('users', 'Users and roles', 'users') : ''}${link('password', 'Change password', 'password')}
    </nav><div class="main"><header class="topbar"><button class="btn menu-btn" id="menu" aria-label="Menu">Menu</button>
    <form id="gs" role="search" style="flex:1;max-width:420px"><input type="search" name="q" placeholder="Search records by number or title"></form>
    <div class="who"><span title="Automatic lock after inactivity">Lock in <span id="idle" class="mono">${Math.floor(idleLeft / 60)}:${String(idleLeft % 60).padStart(2, '0')}</span></span>
    <span><b>${esc(ME.fullname)}</b><br><span class="small muted">${esc(ME.roles.map(r => CFG.ROLES[r]).join(', '))}</span></span>
    <button class="btn" id="logout">Sign out</button></div></header><main class="content" id="content">${html}</main></div></div>`;
  $('#logout').addEventListener('click', async () => { await api('POST', '/api/logout'); ME = null; location.hash = ''; renderLogin(); });
  $('#menu').addEventListener('click', () => $('#nav').classList.toggle('open'));
  $('#gs').addEventListener('submit', (e) => { e.preventDefault(); location.hash = '#/search/' + encodeURIComponent(e.target.q.value); });
}

// ---------- router ----------
window.addEventListener('hashchange', route);
async function route() {
  if (!ME) return;
  const [view, a] = location.hash.slice(2).split('/').map(decodeURIComponent);
  try {
    ALL = await api('GET', '/api/records');
    const views = { dashboard, tasks, readiness, matrix, audit: auditView, users: usersView, sharepoint: spView, password: () => renderPasswordChange(false), m: listView, new: newView, r: detailView, search: searchView, verify: verifyView };
    await (views[view] || dashboard)(a);
    window.scrollTo(0, 0);
  } catch (x) { if (ME) { shell('', `<div class="panel"><h2>Something went wrong</h2><p>${esc(x.message)}</p></div>`); } }
}

// ---------- dashboard / tasks / search ----------
function recRow(r, cols) {
  const m = MODS[r.type];
  return `<tr class="click" data-go="#/r/${r.id}">${cols.map(c => {
    if (c === 'number') return `<td class="mono">${esc(r.number)}${r.type === 'documents' ? ' v' + esc(r.data.version) : ''}</td>`;
    if (c === 'status') return `<td>${pill(r.status)}${isOverdue(r) ? ' <span class="pill bad">Overdue</span>' : ''}</td>`;
    if (c === 'module') return `<td>${esc(m.name)}</td>`;
    const f = m.fields.find(x => x.k === c); const v = r.data[c];
    return `<td>${f && f.type === 'date' ? dmy(v) : f && f.type === 'user' ? esc(userName(v)) : esc(Array.isArray(v) ? v.join(', ') : v)}</td>`;
  }).join('')}</tr>`;
}
function bindRows(root = document) { $$('[data-go]', root).forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.go; })); }
function myTasks() {
  return ALL.filter(r => {
    if (DONE.has(r.status)) return false;
    if (r.type === 'training') return r.data.trainee === ME.username;
    if (r.type === 'capa' && r.data.owner === ME.username) return true;
    return MODS[r.type].transitions.some(t => t.from === r.status && !t.roles.includes('any') && hasRole(t.roles));
  });
}
function dashboard() {
  const open = ALL.filter(r => !DONE.has(r.status)), over = open.filter(isOverdue), mine = myTasks();
  const k = (label, n, href, cls) => `<a class="kpi ${cls}" href="${href}"><b>${n}</b>${esc(label)}</a>`;
  const cnt = (t, f = () => true) => ALL.filter(r => r.type === t && !DONE.has(r.status) && f(r)).length;
  shell('dashboard', `<div class="spread"><div><h1>Dashboard</h1><p class="muted">Live status across all quality processes · ${dmy(today())}</p></div></div>
   <div class="kpis">${k('My open tasks', mine.length, '#/tasks', mine.length ? 'warn' : 'ok')}${k('Overdue records', over.length, '#/readiness', over.length ? 'alert' : 'ok')}
   ${k('Open deviations', cnt('deviations'), '#/m/deviations', '')}${k('Critical deviations open', cnt('deviations', r => r.data.classification === 'Critical'), '#/m/deviations', cnt('deviations', r => r.data.classification === 'Critical') ? 'alert' : 'ok')}
   ${k('Open CAPA', cnt('capa'), '#/m/capa', '')}${k('Change controls in progress', cnt('changes'), '#/m/changes', '')}
   ${k('Open complaints', cnt('complaints'), '#/m/complaints', '')}${k('Documents in workflow', cnt('documents'), '#/m/documents', '')}</div>
   <div class="two"><div><h2>My tasks</h2>${table(mine.slice(0, 12), ['number', 'module', 'title', 'status'])}</div>
   <div><h2>Overdue</h2>${table(over.slice(0, 12), ['number', 'module', 'title', 'status'])}</div></div>`);
  bindRows();
}
function table(rows, cols, empty = 'Nothing here.') {
  if (!rows.length) return `<div class="table-wrap"><div class="empty">${esc(empty)}</div></div>`;
  const head = cols.map(c => c === 'module' ? 'Module' : c === 'number' ? 'Number' : c === 'status' ? 'Status' : (Object.values(MODS).flatMap(m => m.fields).find(f => f.k === c) || { label: c }).label);
  return `<div class="table-wrap"><table class="t"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => recRow(r, cols)).join('')}</tbody></table></div>`;
}
function tasks() { shell('tasks', `<h1>My tasks</h1><p class="muted">Records waiting for an action your roles allow, your training and CAPA actions you own.</p>${table(myTasks(), ['number', 'module', 'title', 'status'], 'No open tasks.')}`); bindRows(); }
function searchView(q = '') {
  const s = q.toLowerCase(); const hits = ALL.filter(r => (r.number + ' ' + (r.data.title || '') + ' ' + JSON.stringify(r.data)).toLowerCase().includes(s));
  shell('', `<h1>Search: “${esc(q)}”</h1><p class="muted">${hits.length} records</p>${table(hits, ['number', 'module', 'title', 'status'], 'No records match.')}`); bindRows();
}

// ---------- module list ----------
function listView(type) {
  const m = MODS[type]; if (!m) return dashboard();
  const rows = ALL.filter(r => r.type === type);
  const canCreate = type !== 'randomization' || hasRole(['unblinded']);
  shell(type, `<div class="spread"><div><h1>${esc(m.name)}</h1><p class="muted">${esc(m.intro)}</p></div>
    <div class="row">${canCreate ? `<a class="btn primary" href="#/new/${type}">New ${esc(m.name.toLowerCase().replace(/s$/, ''))}</a>` : ''}<button class="btn" id="exp">Export CSV</button></div></div>
    <div class="row no-print" style="margin-bottom:.8rem"><input type="search" id="flt" placeholder="Filter" style="max-width:280px">
    <select id="st" style="max-width:220px"><option value="">All statuses</option>${m.states.map(s => `<option>${esc(s)}</option>`).join('')}</select>
    <label class="small"><input type="checkbox" id="od"> Overdue only</label></div><div id="lt"></div>`);
  const draw = () => {
    const q = $('#flt').value.toLowerCase(), st = $('#st').value, od = $('#od').checked;
    const list = rows.filter(r => (!st || r.status === st) && (!od || isOverdue(r)) && (!q || (r.number + JSON.stringify(r.data)).toLowerCase().includes(q)));
    $('#lt').innerHTML = table(list, m.list, rows.length ? 'No records match the filter.' : `No ${m.name.toLowerCase()} yet.`); bindRows($('#lt'));
  };
  ['input', 'change'].forEach(ev => ['#flt', '#st', '#od'].forEach(s => $(s).addEventListener(ev, draw))); draw();
  $('#exp').addEventListener('click', () => {
    const cols = m.fields.map(f => f.k);
    download(`${type}_${today()}.csv`, toCsv([['Number', 'Status', 'Created by', 'Created', ...m.fields.map(f => f.label)], ...rows.map(r => [r.number, r.status, r.created_by, r.created_at, ...cols.map(c => r.data[c])])]));
  });
}

// ---------- forms ----------
function fieldHtml(f, v, disabled) {
  const d = disabled ? 'disabled' : '', id = 'f_' + f.k, req = f.req ? ' <span class="req">*</span>' : '';
  const lab = `<label class="f" for="${id}">${esc(f.label)}${req}</label>`;
  let input;
  if (v === undefined || v === null) v = f.def !== undefined ? f.def : '';
  switch (f.type) {
    case 'textarea': input = `<textarea id="${id}" name="${f.k}" rows="${f.rows || 4}" ${d}>${esc(v)}</textarea>`; break;
    case 'select': input = `<select id="${id}" name="${f.k}" ${d}><option value=""></option>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
    case 'user': input = `<select id="${id}" name="${f.k}" ${d}><option value=""></option>${USERS.filter(u => u.active || u.username === v).map(u => `<option value="${esc(u.username)}" ${u.username === v ? 'selected' : ''}>${esc(u.fullname)} (${esc(u.username)})</option>`).join('')}</select>`; break;
    case 'checkbox': return `<div class="${f.full ? 'full' : ''}"><label class="f">&nbsp;</label><label class="row"><input type="checkbox" id="${id}" name="${f.k}" ${v ? 'checked' : ''} ${d}> ${esc(f.label)}</label></div>`;
    case 'multicheck': input = `<div class="checks" role="group" aria-label="${esc(f.label)}">${f.options.map(o => `<label><input type="checkbox" name="${f.k}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''} ${d}> ${esc(CFG.ROLES[o] || o)}</label>`).join('')}</div>`; break;
    case 'computed': case 'readonly': input = `<div class="computed" id="${id}" data-computed="${f.k}">${esc(v)}</div>`; break;
    default: input = `<input id="${id}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" name="${f.k}" value="${esc(v)}" ${d}>`;
  }
  return `<div class="${f.full || f.type === 'multicheck' ? 'full' : ''}">${lab}${input}</div>`;
}
function readForm(root, m) {
  const out = {};
  for (const f of m.fields) {
    if (f.type === 'computed' || f.type === 'readonly') continue;
    if (f.type === 'multicheck') out[f.k] = $$(`input[name="${f.k}"]:checked`, root).map(x => x.value);
    else if (f.type === 'checkbox') out[f.k] = !!$(`[name="${f.k}"]`, root)?.checked;
    else out[f.k] = $(`[name="${f.k}"]`, root)?.value ?? '';
  }
  return out;
}
function liveCompute(root, m) {
  if (!m.compute) return;
  const run = () => { const d = readForm(root, m); for (const [k, fn] of Object.entries(m.compute)) { const el = $(`[data-computed="${k}"]`, root); if (el) el.textContent = fn(d); } };
  root.addEventListener('input', run); run();
}
function newView(type) {
  const m = MODS[type]; if (!m) return dashboard();
  shell(type, `<div class="spread"><div><h1>New ${esc(m.name.toLowerCase().replace(/s$/, ''))}</h1><p class="muted">The record number is assigned when you save. Fields marked * are required.</p></div></div>
   <form id="nf" class="panel"><div class="grid">${m.fields.filter(f => f.type !== 'readonly').map(f => fieldHtml(f, undefined, false)).join('')}</div>
   <div class="error" style="margin-top:1rem"></div><div class="row"><button class="btn primary">Save record</button><a class="btn" href="#/m/${type}">Cancel</a></div></form>`);
  const form = $('#nf'); liveCompute(form, m);
  if (type === 'deviations') { const o = $('[name=occurred]', form); if (o) o.value = today(); }
  if (type === 'complaints') { const o = $('[name=received]', form); if (o) o.value = today(); }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const rec = await api('POST', '/api/records', { type, data: readForm(form, m) }); toast(`${rec.number} created`); location.hash = '#/r/' + rec.id; }
    catch (x) { $('.error', form).textContent = x.message; }
  });
}

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
  if (rec.type === 'deviations' || rec.type === 'complaints' || rec.type === 'audits') extraBtns.push(`<button class="btn" data-act="spawn" data-to="capa">Raise CAPA</button>`, `<button class="btn" data-act="spawn" data-to="rca">Start RCA</button>`);
  if (rec.type === 'deviations' || rec.type === 'capa') extraBtns.push(`<button class="btn" data-act="spawn" data-to="changes">Raise change control</button>`);
  if (rec.type === 'capa') extraBtns.push(`<button class="btn" data-act="spawn" data-to="training">Assign retraining</button>`);

  shell(rec.type, `<div class="spread"><div><p class="muted small"><a href="#/m/${rec.type}">${esc(m.name)}</a></p>
    <h1><span class="mono">${esc(rec.number)}</span>${rec.type === 'documents' ? ' <span class="muted">v' + esc(d.version) + '</span>' : ''}</h1>
    <p style="margin:0">${esc(d.title || '')}</p><p class="muted small">Created by ${esc(userName(rec.created_by))} on ${dmyt(rec.created_at)} · Last change ${dmyt(rec.updated_at)}</p></div>
    <div class="row no-print">${pill(rec.status)}${isOverdue(rec) ? '<span class="pill bad">Overdue</span>' : ''}</div></div>
    <div class="record"><div>
      <div class="panel no-print"><h3>Next steps</h3><div class="row">
        ${trans.length ? trans.map(t => `<button class="btn ${t.sign ? 'primary sign' : ''}" data-act="tr" data-to="${esc(t.to)}" ${t.allowed ? '' : 'disabled title="Your roles do not permit this step"'}>${esc(t.label)}</button>`).join('') : extraBtns.length ? '' : '<span class="muted">No workflow steps available from this status.</span>'}
        ${extraBtns.join('')}<button class="btn" data-act="print">Print record</button><button class="btn" data-act="export">Export JSON</button></div></div>
      <form class="panel" id="rf"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Record details</h3>${det.editable ? '<span class="small muted">Changes need a reason and are recorded in the audit trail.</span>' : '<span class="pill grey">Read-only in this status</span>'}</div>
        <div class="grid">${m.fields.map(f => fieldHtml(f, d[f.k], !det.editable)).join('')}</div>
        ${det.editable ? '<div class="error" style="margin-top:.8rem"></div><button class="btn primary">Save changes</button>' : ''}</form>
      <div id="special"></div>
      <div class="panel"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Attachments</h3><label class="btn no-print">Add file<input type="file" id="att" hidden></label></div>
        ${det.attachments.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>File</th><th>Size</th><th>SHA-256</th><th>Added</th></tr></thead><tbody>${det.attachments.map(a => `<tr><td><a href="/api/attachments/${a.id}">${esc(a.name)}</a></td><td>${(a.size / 1024).toFixed(1)} KB</td><td class="mono small" title="${a.sha256}">${a.sha256.slice(0, 16)}…</td><td>${esc(userName(a.uploaded_by))}<br><span class="small muted">${dmyt(a.ts)}</span></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No attachments. Files are stored with a SHA-256 checksum that is verified on every download.</p>'}</div>
    </div><aside class="rail">
      <div class="panel"><h3>Lifecycle</h3><ol class="lifecycle">${m.states.map((s, i) => `<li class="${s === rec.status ? 'now' : i < idx ? 'past' : ''}">${esc(s)}</li>`).join('')}</ol></div>
      <div class="panel"><h3>Electronic signatures</h3>${det.signatures.length ? det.signatures.map(s => `<div class="stamp ${s.current ? '' : 'stale'}"><div class="meaning">${esc(s.meaning)}</div><div class="name">${esc(s.fullname)}</div><div class="when">${dmyt(s.ts)} ${esc(tz)}</div><div class="small muted">${esc(s.from_state || '')} → ${esc(s.to_state || '')}</div>${s.current ? '' : '<div class="note">Signed an earlier version of this record; later changes are in the audit trail.</div>'}</div>`).join('') : '<p class="muted small">No signatures yet.</p>'}</div>
      <div class="panel"><h3>Audit trail</h3><div class="trail">${det.audit.slice(0, 80).map(a => `<div><div class="t">${dmyt(a.ts)} · ${esc(a.username)}</div><b>${esc(a.action)}</b>${a.field ? ` <span class="muted">${esc(a.field)}</span>` : ''}
        ${a.old_value != null || a.new_value != null ? `<div class="diff">${a.old_value != null ? `<del>${esc(a.old_value).slice(0, 160)}</del> ` : ''}<ins>${esc(a.new_value ?? '').slice(0, 160)}</ins></div>` : ''}${a.reason ? `<div class="muted">Reason: ${esc(a.reason)}</div>` : ''}</div>`).join('')}</div></div>
    </aside></div>`);

  const form = $('#rf'); liveCompute(form, m);
  if (det.editable) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(form, m);
    await stepDialog({ title: 'Save changes', reason: true, perform: async (v) => { const r = await api('PUT', '/api/records/' + id, { data, reason: v.reason }); toast(r.changes ? `${r.changes} field(s) changed` : 'No changes to save'); } }) && route();
  });
  $$('[data-act="tr"]').forEach(b => b.addEventListener('click', async () => {
    const t = trans.find(x => x.to === b.dataset.to);
    const ok = await stepDialog({ title: t.label, meaning: t.sign, reason: t.reason, perform: (v) => api('POST', `/api/records/${id}/transition`, { to: t.to, ...v }) });
    if (ok) { toast(`${rec.number}: ${t.to}`); route(); }
  }));
  const act = (name, fn) => $$(`[data-act="${name}"]`).forEach(b => b.addEventListener('click', () => fn(b)));
  act('print', () => printRecord(rec));
  act('export', async () => download(`${rec.number}.json`, JSON.stringify(await api('GET', '/api/export/' + id), null, 2), 'application/json'));
  act('revise', async () => { const r = await stepDialog({ title: 'Start revision', reason: true, perform: (v) => api('POST', `/api/records/${id}/revise`, { reason: v.reason }) }); if (r) { toast('Revision draft created'); location.hash = '#/r/' + r.id; } });
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
  $('#att').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 25 * 1024 * 1024) return toast('Maximum file size is 25 MB in this build.');
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file); });
    await api('POST', `/api/records/${id}/attachments`, { name: file.name, mime: file.type, base64: b64 }); toast('Attachment added'); route();
  });
  if (rec.type === 'labels') labelPanel(rec);
  if (rec.type === 'randomization' && det.randList) randPanel(rec, det.randList);
}

async function spawn(src, to) {
  const m = MODS[to];
  const pre = { capa: { title: 'CAPA for ' + src.number + ': ' + (src.data.title || ''), source: { deviations: 'Deviation', complaints: 'Complaint', audits: 'Internal audit' }[src.type] || 'Self-identified', sourceRecord: src.number, rootCause: src.data.rootCause || '' },
    rca: { title: src.data.title || '', sourceRecord: src.number }, changes: { title: 'Change arising from ' + src.number, justification: 'See ' + src.number },
    training: { title: 'Retraining – ' + (src.data.title || ''), sourceRecord: src.number, trainingType: 'Read & Understand' } }[to] || {};
  shell(to, `<div class="spread"><div><h1>New ${esc(m.name.toLowerCase().replace(/s$/, ''))}</h1><p class="muted">Linked to <span class="mono">${esc(src.number)}</span>.</p></div></div>
   <form id="nf" class="panel"><div class="grid">${m.fields.filter(f => f.type !== 'readonly').map(f => fieldHtml(f, pre[f.k], false)).join('')}</div><div class="error" style="margin-top:1rem"></div>
   <div class="row"><button class="btn primary">Save record</button><a class="btn" href="#/r/${src.id}">Cancel</a></div></form>`);
  const form = $('#nf'); liveCompute(form, m);
  form.addEventListener('submit', async (e) => { e.preventDefault(); try { const r = await api('POST', '/api/records', { type: to, data: readForm(form, m) }); toast(r.number + ' created'); location.hash = '#/r/' + r.id; } catch (x) { $('.error', form).textContent = x.message; } });
}

function printRecord(rec) {
  const m = MODS[rec.type];
  api('POST', `/api/records/${rec.id}/printed`, {}).catch(() => {});
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.');
  w.document.write(`<!doctype html><title>${esc(rec.number)}</title><style>body{font:11pt Arial,sans-serif;margin:15mm}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:4px 6px;text-align:left;vertical-align:top}th{width:30%;background:#eee}.wm{position:fixed;top:40%;left:5%;font-size:44pt;color:rgba(0,0,0,.08);transform:rotate(-30deg)}</style>
   <div class="wm">UNCONTROLLED COPY</div><h2>${esc(rec.number)} – ${esc(m.name)}</h2><p>Status: ${esc(rec.status)} · Printed ${dmyt(new Date().toISOString())} by ${esc(ME.fullname)} · Valid on date of print only</p>
   <table>${m.fields.map(f => `<tr><th>${esc(f.label)}</th><td style="white-space:pre-wrap">${esc(Array.isArray(rec.data[f.k]) ? rec.data[f.k].join(', ') : rec.data[f.k] === true ? 'Yes' : rec.data[f.k] === false ? 'No' : rec.data[f.k])}</td></tr>`).join('')}</table>`);
  w.document.close(); w.focus(); w.print();
}

// ---------- issued copies with stamp ----------
function printIssued(r) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the issued copies.');
  const verify = `${location.origin}/#/verify/${encodeURIComponent(r.issueNo)}`;
  const stamp = (c, p) => `<div class="stamp"><div class="row1"><b>${c.replacement ? 'REPLACEMENT COPY – ISSUED' : 'CONTROLLED COPY – ISSUED'}</b><span>${esc(r.org)}</span></div>
    <div>Doc: <b>${esc(r.doc.number)} v${esc(r.doc.version)}</b> &nbsp; Issue: <b>${esc(r.issueNo)}</b> &nbsp; Copy <b>${c.copyNo}</b>${c.replacement ? ` (replaces voided copy ${c.replaces})` : ` of ${r.totalCopies}`}</div>
    <div>Issued to: ${esc(r.issuedToName)} &nbsp; By: ${esc(r.issuedBy)} &nbsp; Issued: ${dmyt(r.issuedAt)} ${esc(tz)} &nbsp; Return by: ${dmy(r.returnBy)}</div>
    <div>Purpose / batch: ${esc(r.purpose)}<span class="pg">Page ${p + 1} of ${r.pages.length}</span></div>
    <div class="ver">Verify: ${esc(verify)}</div></div>`;
  const pages = r.copies.map(c => r.pages.map((txt, p) => `<section class="page">${stamp(c, p)}<h1>${esc(r.doc.title)}</h1><pre>${esc(txt)}</pre>
    <footer>${esc(r.doc.number)} v${esc(r.doc.version)} · ${esc(r.issueNo)} copy ${c.copyNo} · Page ${p + 1} of ${r.pages.length} · Not valid without issue stamp</footer></section>`).join('')).join('');
  w.document.write(`<!doctype html><title>${esc(r.issueNo)}</title><style>
    @page{size:A4;margin:12mm} body{margin:0;font:10.5pt Arial,sans-serif;color:#000}
    .page{page-break-after:always;min-height:270mm;position:relative} .page:last-child{page-break-after:auto}
    .stamp{border:2.5px double #b00020;color:#b00020;padding:2mm 3mm;font-size:9pt;line-height:1.45;margin-bottom:5mm}
    .stamp .row1{display:flex;justify-content:space-between;font-size:11pt} .stamp .pg{float:right;font-weight:bold} .stamp .ver{font-size:8pt;color:#555}
    h1{font-size:13pt;margin:0 0 3mm} pre{white-space:pre-wrap;font:10.5pt/1.45 Arial,sans-serif;margin:0}
    footer{position:absolute;bottom:0;left:0;right:0;font-size:8pt;color:#444;border-top:1px solid #999;padding-top:1mm}</style>${pages}`);
  w.document.close(); w.focus(); w.print();
}
function verifyView(no) {
  const r = ALL.find(x => x.type === 'issues' && x.number === no);
  if (!r) return shell('', `<h1>Issue ${esc(no)}</h1><div class="panel"><span class="pill bad">Not found</span><p>No issue record with this number exists. Treat the copy as uncontrolled and inform QA.</p></div>`);
  const doc = ALL.filter(x => x.type === 'documents' && x.number === r.data.docNumber && x.status === 'Effective')[0];
  const current = doc && doc.data.version === r.data.docVersion;
  shell('issues', `<h1>Issue ${esc(no)}</h1><div class="panel"><p>${pill(r.status)} ${current ? '<span class="pill done">Version is current</span>' : '<span class="pill bad">Version superseded – return this copy</span>'}</p>
    <p><b>${esc(r.data.docNumber)} v${esc(r.data.docVersion)}</b> – ${esc(r.data.title)}<br>Issued to ${esc(userName(r.data.issuedTo))} for ${esc(r.data.purpose)} · Return by ${dmy(r.data.returnBy)}</p>
    <p class="small muted">Voided copies: ${esc((r.data.printLog || []).filter(j => j.voided).map(j => j.voided).join(', ') || 'none')}</p><a class="btn" href="#/r/${r.id}">Open issue record</a></div>`);
}

// ---------- labels ----------
function fillLabel(d, v) { return String(d.template || '').replace(/\{KIT\}/g, v.kit).replace(/\{BATCH\}/g, v.batch).replace(/\{EXPIRY\}/g, v.expiry).replace(/\{PROTOCOL\}/g, d.study || '').replace(/\{SPONSOR\}/g, (d.sponsor || '').replace(/\n/g, ', ')); }
function labelBox(d, v) { return `<div class="label" style="width:${+d.width || 90}mm;height:${+d.height || 50}mm">${esc(fillLabel(d, v))}</div>`; }
function zpl(d, v) {
  const dots = (mm) => Math.round(mm * 8), W = dots(+d.width || 90), H = dots(+d.height || 50);
  const txt = fillLabel(d, v).replace(/[\^~]/g, ' ').split('\n').join('\\&');
  return `^XA^CI28^PW${W}^LL${H}^FO20,20^A0N,22,22^FB${W - 40},14,2,L^FD${txt}^FS^FO${W - 300},${H - 110}^BCN,70,Y,N,N^FD${v.kit}^FS^XZ`;
}
function labelPanel(rec) {
  const d = rec.data, log = d.printLog || [];
  $('#special').innerHTML = `<div class="panel"><h3>Label preview</h3><p class="muted small">Sample values. Variable fields are filled at print time. Text must match the approved country text exactly.</p>
    ${labelBox(d, { kit: '1001', batch: 'B-SAMPLE', expiry: 'MMM-YYYY' })}
    <div class="row" style="margin-top:1rem">${rec.status === 'Approved' && hasRole(['cs', 'qa']) ? '<button class="btn primary sign" id="lp">Print labels</button>' : '<span class="muted small">Printing is available once the label is Approved, for clinical supply and QA roles.</span>'}</div></div>
    <div class="panel"><h3>Print log</h3>${log.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Job</th><th>Date</th><th>By</th><th>Kits</th><th>Qty</th><th>Batch</th><th>Expiry</th><th>Label version</th></tr></thead><tbody>${log.slice().reverse().map(j => `<tr><td class="mono">${esc(j.id)}</td><td>${dmyt(j.ts)}</td><td>${esc(userName(j.by))}</td><td class="mono">${j.firstKit}–${j.firstKit + j.qty - 1}</td><td>${j.qty}</td><td>${esc(j.batch)}</td><td>${esc(j.expiry)}</td><td>${esc(j.version)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No print jobs yet.</p>'}</div>`;
  $('#lp')?.addEventListener('click', async () => {
    const job = await stepDialog({
      title: 'Print labels', meaning: 'Printed',
      extra: `<div class="grid"><div><label class="f">First kit number</label><input type="number" name="firstKit" value="1001"></div><div><label class="f">Quantity</label><input type="number" name="qty" value="10"></div>
       <div><label class="f">Batch</label><input type="text" name="batch"></div><div><label class="f">Use-by / expiry (as printed)</label><input type="text" name="expiry" placeholder="e.g. 31-Dec-2027"></div>
       <div class="full"><label class="f">Output</label><select name="printer"><option>Browser / PDF</option><option>Zebra ZPL file</option></select></div></div>`,
      perform: (v) => api('POST', `/api/records/${rec.id}/print`, v)
    });
    if (!job) return;
    const vals = Array.from({ length: job.qty }, (_, i) => ({ kit: String(job.firstKit + i), batch: job.batch, expiry: job.expiry }));
    if (job.printer === 'Zebra ZPL file') download(`${rec.number}_job_${job.id}.zpl`, vals.map(v => zpl(d, v)).join('\n'), 'text/plain');
    else { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.'); w.document.write(`<!doctype html><title>${esc(rec.number)} job ${esc(job.id)}</title><style>@page{margin:8mm}body{margin:0;font:9pt Arial,sans-serif}.label{border:1px dashed #999;padding:2.5mm 3mm;white-space:pre-wrap;overflow:hidden;display:inline-block;margin:0 4mm 4mm 0;vertical-align:top}</style>${vals.map(v => labelBox(d, v)).join('')}`); w.document.close(); w.print(); }
    route();
  });
}

// ---------- randomization ----------
function randPanel(rec, meta) {
  $('#special').innerHTML = `<div class="panel"><h3>Kit list</h3><p class="muted small">Generated by ${esc(userName(meta.generated_by))} on ${dmyt(meta.ts)}. Checksum <span class="mono">${esc((rec.data.checksum || '').slice(0, 24))}…</span></p>
    <div class="row"><button class="btn" id="kb">Blinded kit list</button>${hasRole(['unblinded']) ? '<button class="btn danger" id="ku">Unblinded list and balance</button>' : ''}</div><div id="kl" style="margin-top:1rem"></div></div>`;
  $('#kb').addEventListener('click', async () => {
    const r = await api('GET', `/api/records/${rec.id}/kits?view=blinded`);
    $('#kl').innerHTML = `<p class="small muted">${r.list.length} kit numbers — no treatment information.</p><div class="mono small" style="columns:6 6rem">${r.list.map(k => k.kit).join('<br>')}</div><button class="btn" id="kbx" style="margin-top:.8rem">Download blinded CSV</button>`;
    $('#kbx').addEventListener('click', () => download(`${rec.number}_blinded.csv`, 'kit\n' + r.list.map(k => k.kit).join('\n')));
  });
  $('#ku')?.addEventListener('click', async () => {
    const ok = await modal({ title: 'Open unblinded list', ok: 'Open list', okClass: 'danger', html: '<p>Viewing treatment allocation is recorded in the audit trail. Do not share with blinded personnel.</p>' });
    if (!ok) return;
    const r = await api('GET', `/api/records/${rec.id}/kits?view=unblinded`);
    const arms = Object.keys(r.balance);
    $('#kl').innerHTML = `<p>Checksum ${r.checksumValid ? '<span class="pill done">verified</span>' : '<span class="pill bad">does not match</span>'} · Seed <span class="mono">${esc(r.seed)}</span></p>
      <h3>Treatment balance</h3><div class="table-wrap" style="margin-bottom:1rem"><table class="t"><thead><tr><th>Treatment</th><th>Kits</th><th>Share</th></tr></thead><tbody>${arms.map(a => `<tr><td>${esc(a)}</td><td>${r.balance[a]}</td><td>${(100 * r.balance[a] / r.list.length).toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>
      <h3>Per block</h3><div class="table-wrap" style="max-height:300px;margin-bottom:1rem"><table class="t"><thead><tr><th>Block</th>${arms.map(a => `<th>${esc(a)}</th>`).join('')}</tr></thead><tbody>${Object.entries(r.blocks).map(([b, c]) => `<tr><td>${b}</td>${arms.map(a => `<td>${c[a] || 0}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <button class="btn" id="kux">Download unblinded CSV</button>`;
    $('#kux').addEventListener('click', () => download(`${rec.number}_UNBLINDED.csv`, 'kit,block,treatment\n' + r.list.map(x => `${x.kit},${x.block},${x.arm}`).join('\n')));
  });
}

// ---------- readiness ----------
function readiness() {
  const in90 = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), t = today();
  const docsOverdue = ALL.filter(r => r.type === 'documents' && r.status === 'Effective' && r.data.nextReview && r.data.nextReview < t);
  const trn = ALL.filter(r => r.type === 'training' && r.status !== 'Cancelled');
  const compliance = trn.length ? Math.round(100 * trn.filter(r => r.status === 'Completed').length / trn.length) : 100;
  const licences = ALL.filter(r => (r.type === 'vendors' || r.type === 'customers') && !['Disqualified', 'Blocked'].includes(r.status) && r.data.licenceExpiry && r.data.licenceExpiry <= in90);
  const oldDev = ALL.filter(r => r.type === 'deviations' && !DONE.has(r.status) && r.data.occurred && (Date.now() - new Date(r.data.occurred)) > 30 * 864e5);
  const items = [
    ['Overdue CAPA', ALL.filter(r => r.type === 'capa' && isOverdue(r))], ['Deviations open more than 30 days', oldDev],
    ['Documents past periodic review', docsOverdue], ['Overdue training assignments', trn.filter(isOverdue)],
    ['Change controls past target date', ALL.filter(r => r.type === 'changes' && isOverdue(r))],
    ['Vendor / customer licences expiring within 90 days', licences],
    ['Complaints with adverse event status unknown', ALL.filter(r => r.type === 'complaints' && r.data.ae === 'Unknown' && !DONE.has(r.status))]
  ];
  shell('readiness', `<div class="spread"><div><h1>Inspection readiness</h1><p class="muted">Items an inspector is likely to ask about first. Each list links to the records.</p></div></div>
    <div class="kpis"><div class="kpi ${compliance >= 95 ? 'ok' : 'alert'}"><b>${compliance}%</b>Training compliance (target 95%)</div>${items.map(([l, list], i) => `<a class="kpi ${list.length ? 'alert' : 'ok'}" href="#/readiness" data-scroll="r${i}"><b>${list.length}</b>${esc(l)}</a>`).join('')}</div>
    <div class="panel no-print"><h2>Inspection pack</h2><p class="muted small">Export record lists for a period — for the front room / back room during an inspection.</p>
      <div class="row"><label>From <input type="date" id="pf" value="${new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)}"></label><label>To <input type="date" id="pt" value="${t}"></label>
      <select id="pm" style="max-width:240px">${Object.entries(MODS).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('')}</select><button class="btn primary" id="pe">Export list</button></div></div>
    ${items.map(([l, list], i) => `<h2 id="r${i}" style="margin-top:1.5rem">${esc(l)}</h2>${table(list, ['number', 'module', 'title', 'status'], 'None.')}`).join('')}`);
  bindRows();
  $$('[data-scroll]').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(el.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); }));
  $('#pe').addEventListener('click', () => {
    const k = $('#pm').value, m = MODS[k], f = $('#pf').value, to = $('#pt').value + 'T23:59:59';
    const rows = ALL.filter(r => r.type === k && r.created_at >= f && r.created_at <= to);
    download(`inspection_${k}_${f}_${$('#pt').value}.csv`, toCsv([['Number', 'Status', 'Created', ...m.fields.map(x => x.label)], ...rows.map(r => [r.number, r.status, r.created_at, ...m.fields.map(x => r.data[x.k])])]));
  });
}

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

// ---------- audit trail ----------
async function auditView() {
  shell('audit', `<div class="spread"><div><h1>Audit trail</h1><p class="muted">System-wide, append-only and hash-chained. Entries cannot be edited or deleted.</p></div>
    <div class="row"><button class="btn" id="av">Verify integrity</button><button class="btn" id="ax">Export CSV</button></div></div>
    <form id="aq" class="row" style="margin-bottom:.8rem"><input type="search" name="q" placeholder="User, action, record number or field" style="max-width:360px"><button class="btn">Search</button></form><div id="al"></div>`);
  let rows = [];
  const load = async (q = '') => {
    rows = await api('GET', '/api/audit?limit=1000' + (q ? '&q=' + encodeURIComponent(q) : ''));
    $('#al').innerHTML = `<div class="table-wrap"><table class="t"><thead><tr><th>#</th><th>Date / time</th><th>User</th><th>Action</th><th>Record</th><th>Field</th><th>Old</th><th>New</th><th>Reason</th></tr></thead><tbody>
      ${rows.map(a => `<tr><td class="mono small">${a.id}</td><td class="mono small">${dmyt(a.ts)}</td><td>${esc(a.username)}</td><td>${esc(a.action)}</td><td class="mono small">${a.record_id ? `<a href="#/r/${a.record_id}">${esc(a.record_number)}</a>` : ''}</td><td>${esc(a.field || '')}</td><td>${esc((a.old_value || '').slice(0, 80))}</td><td>${esc((a.new_value || '').slice(0, 80))}</td><td>${esc(a.reason || '')}</td></tr>`).join('')}</tbody></table></div>`;
  };
  $('#aq').addEventListener('submit', (e) => { e.preventDefault(); load(e.target.q.value); });
  $('#av').addEventListener('click', async () => { const r = await api('GET', '/api/audit/verify'); modal({ title: 'Audit trail integrity', cancel: '', ok: 'Close', html: r.ok ? `<p><span class="pill done">Intact</span> ${r.checked} entries verified. The hash chain is unbroken.</p>` : `<p><span class="pill bad">Broken</span> Chain fails at entry #${r.brokenAt}. Escalate to QA and IT as a data-integrity incident.</p>` }); });
  $('#ax').addEventListener('click', () => download(`audit_trail_${today()}.csv`, toCsv([['ID', 'Timestamp (UTC)', 'User', 'Name', 'Action', 'Record', 'Field', 'Old value', 'New value', 'Reason', 'IP', 'Hash'], ...rows.map(a => [a.id, a.ts, a.username, a.fullname, a.action, a.record_number, a.field, a.old_value, a.new_value, a.reason, a.ip, a.hash])])));
  await load();
}

// ---------- users ----------
async function usersView() {
  if (!ME.roles.includes('admin')) return dashboard();
  USERS = await api('GET', '/api/users');
  const roleChecks = (sel = []) => `<div class="checks">${Object.entries(CFG.ROLES).map(([k, v]) => `<label><input type="checkbox" name="roles" value="${k}" ${sel.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div>`;
  shell('users', `<div class="spread"><div><h1>Users and roles</h1><p class="muted">User IDs are unique and never reused. Deactivate instead of deleting. Administrators cannot approve GxP records unless also given a QA role (avoid this).</p></div><div class="row"><button class="btn primary" id="nu">New user</button><button class="btn" id="ux">Access review CSV</button></div></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>User ID</th><th>Name</th><th>Roles</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
    ${USERS.map(u => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.fullname)}</td><td class="small">${esc(u.roles.map(r => CFG.ROLES[r]).join(', '))}</td><td>${u.locked ? '<span class="pill bad">Locked</span>' : u.active ? '<span class="pill done">Active</span>' : '<span class="pill grey">Inactive</span>'}</td><td class="small">${dmyt(u.last_login)}</td><td><button class="btn" data-edit="${esc(u.username)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`);
  $('#nu').addEventListener('click', async () => {
    const ok = await modal({ title: 'New user', ok: 'Create user', html: `<div class="grid"><div><label class="f">User ID</label><input type="text" name="username"></div><div><label class="f">Full name</label><input type="text" name="fullname"></div>
      <div><label class="f">Email</label><input type="text" name="email"></div><div><label class="f">Initial password</label><input type="password" name="password" autocomplete="new-password"></div></div>
      <div><label class="f">Roles</label>${roleChecks()}</div><div><label class="f">Reason / access request reference</label><input type="text" name="reason"></div>`,
      onOk: (f) => api('POST', '/api/users', { username: val(f, 'username'), fullname: val(f, 'fullname'), email: val(f, 'email'), password: f.password.value, reason: val(f, 'reason'), roles: $$('input[name=roles]:checked', f).map(x => x.value) }) });
    if (ok) { toast('User created – they must change the password at first sign-in'); usersView(); }
  });
  $$('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const u = USERS.find(x => x.username === b.dataset.edit);
    const ok = await modal({ title: 'Edit ' + u.username, ok: 'Save', html: `<div><label class="f">Roles</label>${roleChecks(u.roles)}</div>
      <div class="row"><label><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>${u.locked ? '<label><input type="checkbox" name="unlock"> Unlock account</label>' : ''}</div>
      <div><label class="f">Reset password (optional)</label><input type="password" name="password" autocomplete="new-password"></div><div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/users/' + u.username, { roles: $$('input[name=roles]:checked', f).map(x => x.value), active: f.active.checked, unlock: f.unlock ? f.unlock.checked : false, password: f.password.value || undefined, reason: val(f, 'reason') }) });
    if (ok) { toast('User updated'); usersView(); }
  }));
  $('#ux').addEventListener('click', () => download(`user_access_review_${today()}.csv`, toCsv([['User ID', 'Name', 'Roles', 'Active', 'Locked', 'Last login', 'Created'], ...USERS.map(u => [u.username, u.fullname, u.roles.join('; '), u.active ? 'Yes' : 'No', u.locked ? 'Yes' : 'No', u.last_login, u.created_at])])));
}

// ---------- SharePoint ----------
function spView() {
  const docs = ALL.filter(r => r.type === 'documents' && r.status === 'Effective');
  shell('sharepoint', `<h1>SharePoint integration</h1>
    <div class="panel"><p>Status: ${HEALTH.sharepoint ? '<span class="pill done">Configured</span>' : '<span class="pill warn">Not configured</span>'}</p>
    <p class="muted">Effective documents are published as read-only HTML renditions, with their signatures, to the configured SharePoint library through Microsoft Graph. The eQMS stays the system of record: status, approvals and audit trail live here.</p>
    ${HEALTH.sharepoint ? '' : `<h3>Set-up</h3><ol class="small"><li>In Microsoft Entra ID, register an application and add the Microsoft Graph application permission <b>Sites.Selected</b>; grant admin consent.</li>
    <li>Grant the app write access to your QMS site only (Graph: POST /sites/{site-id}/permissions with role “write”).</li>
    <li>Find the site ID: GET https://graph.microsoft.com/v1.0/sites/{tenant}.sharepoint.com:/sites/{site-name}</li>
    <li>Set SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET, SP_SITE_ID and SP_FOLDER in the server's .env file and restart.</li></ol>`}</div>
    <h2 style="margin-top:1.5rem">Effective documents</h2>${table(docs, ['number', 'title', 'version', 'sharepointUrl', 'status'], 'No effective documents.')}`);
  bindRows();
}

// ---------- boot ----------
(async function boot() {
  try { HEALTH = await api('GET', '/api/health'); } catch { HEALTH = {}; }
  try { ME = await api('GET', '/api/me'); await afterLogin(); } catch { renderLogin(); }
})();
