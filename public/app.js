/* QualiSuite eQMS — browser application (no framework, CSP-safe: no inline handlers). */
'use strict';
const CFG = window.QMS_CONFIG, MODS = CFG.MODULES;
let ME = null, USERS = [], HEALTH = {}, ALL = [], idleTimer = null, idleLeft = 0, QS = new URLSearchParams();

// ---------- utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const addWorkingDaysIso = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); while (n > 0) { x.setUTCDate(x.getUTCDate() + 1); if (x.getUTCDay() % 6) n--; } return x.toISOString().slice(0, 10); };
const addDaysIso = (d, n) => { const x = new Date(String(d).slice(0, 10) + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dmy(v) { if (!v) return ''; const d = new Date(v.length === 10 ? v + 'T00:00:00' : v); if (isNaN(d)) return esc(v); return `${String(d.getDate()).padStart(2, '0')}-${MON[d.getMonth()]}-${d.getFullYear()}`; }
function dmyt(v) { if (!v) return ''; const d = new Date(v); return `${dmy(v)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`; }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const userName = (u) => (USERS.find(x => x.username === u) || {}).fullname || u || '';
// admin and management have all access (the server applies the same rule)
const hasRole = (roles) => ME && (roles.includes('any') || ME.roles.some(r => roles.includes(r)) || (ME.allAccess && !roles.every(r => ['unblinded', 'extaud'].includes(r))));
const deptName = (c) => CFG.DEPTS[c] || c || '';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3200); }
function download(name, content, type = 'text/csv') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
const csvCell = (v) => { const s = Array.isArray(v) ? v.join('; ') : String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\n');

const DONE = new Set(['Effective', 'Superseded', 'Obsolete', 'Completed', 'Closed', 'Cancelled', 'Approved', 'Released', 'Rejected', 'QP Certified', 'Released to IRT', 'Withdrawn', 'Retired', 'Disqualified', 'Qualified', 'Blocked', 'Authorized', 'Certified', 'Archived', 'Destroyed']);
const GOOD = new Set(['Effective', 'Completed', 'Closed', 'Approved', 'Released', 'QP Certified', 'Qualified', 'Released to IRT', 'Authorized', 'Certified', 'Archived']);
const BAD = new Set(['Rejected', 'Failed', 'Blocked', 'Disqualified', 'Suspended']);
const GREY = new Set(['Superseded', 'Obsolete', 'Cancelled', 'Withdrawn', 'Retired', 'Draft']);
const pill = (s) => `<span class="pill ${GOOD.has(s) ? 'done' : BAD.has(s) ? 'bad' : GREY.has(s) ? 'grey' : ''}">${esc(s)}</span>`;
const EC_STATES = new Set(['Effectiveness Check', 'Closed – EC Pending']);
// The date a record is due by in its current status (approved extensions replace the original due date)
function dueOf(r) {
  const d = r.data;
  if (EC_STATES.has(r.status)) return d.ecDueDate;
  if (r.type === 'investigations' && r.status === 'Customer Approval') return '';
  if (['investigations', 'capa', 'changes'].includes(r.type)) return d.extendedDue || d.dueDate;
  if (r.type === 'selfinspections') return ['Planned', 'Notified'].includes(r.status) ? d.plannedDate : r.status === 'Report Issued' ? d.extendedDue || d.dueDate : '';
  if (r.type === 'extaudits') return ['Report Received', 'Response Prepared'].includes(r.status) ? d.responseDue : '';
  if (r.type === 'documents') return r.status === 'Approved – Training' ? d.effectiveDate : r.status === 'Effective' ? d.nextReview : '';
  if (r.type === 'archives' && r.status === 'Retrieved') { const x = (d.retrievals || []).slice(-1)[0]; return x && x.date ? addWorkingDaysIso(x.date, 7) : ''; }
  if (r.type === 'customers') return r.status === 'Qualified' ? d.reviewDate : '';
  if (r.type === 'vendors') return r.status === 'Approved' ? d.requalDate : r.status === 'Under Quality Review' && d.auditReportDate && !d.complianceReceived ? addDaysIso(d.auditReportDate, 30) : '';
  return { training: d.dueDate, comparators: d.neededBy, risks: d.reviewDate }[r.type];
}
const isOverdue = (r) => { const v = dueOf(r); return !!v && !DONE.has(r.status) && v < today(); };
const dataFields = (m) => m.fields.filter(f => f.k);
const singular = (m) => m.single || m.name.toLowerCase().replace(/s$/, '');
// The audit trail, record history and version history are for QA, administrators and management only (the server enforces it too)
const auditAccess = () => !!ME && (ME.roles.includes('qa') || ME.allAccess);
const canSeeModule = (m) => ME.allAccess || !(m.visibleTo && !ME.roles.some(r => m.visibleTo.includes(r))) && !(m.hideFrom && ME.roles.every(r => m.hideFrom.includes(r)));
const NO_AUDIT_ACCESS = '<div class="panel"><h2>Audit trail</h2><p>The audit trail and version history are visible to QA, administrators and management only.</p></div>';
// Readable audit entries: field labels instead of internal keys, names instead of user IDs, dates as DD-MMM-YYYY
function fieldLabel(type, key) {
  if (!key) return '';
  if (key === 'status') return 'Status';
  if (key === 'stateEnteredAt') return 'Stage entered at (system)';
  const f = MODS[type] && MODS[type].fields.find(x => x.k === key);
  return f ? f.label : key;
}
function auditValue(type, key, v) {
  if (v == null || v === '') return '';
  if (key === 'stateEnteredAt' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dmyt(v);
  const f = MODS[type] && MODS[type].fields.find(x => x.k === key);
  if (!f) return v;
  if (f.type === 'user' || f.fmt === 'user') return userName(v);
  if ((f.type === 'date' || f.fmt === 'date') && /^\d{4}-\d{2}-\d{2}/.test(v)) return dmy(v);
  if (f.type === 'checklist' || f.type === 'table') { try { return plain(f, JSON.parse(v)); } catch { return v; } }
  if (f.optionLabels && f.optionLabels[v]) return f.optionLabels[v];
  return v;
}
const recordLabel = (a) => a.record_type && MODS[a.record_type] ? MODS[a.record_type].name : a.record_id ? '' : 'System';
// Fields on the new-record form: only the request section(s) when the module has them, otherwise all fields
function createFields(m) {
  if (!m.fields.some(f => f.type === 'section' && f.create)) return m.fields;
  let on = false; return m.fields.filter(f => { if (f.type === 'section') on = !!f.create; return on; });
}
// Plain-text value for print and CSV
function plain(f, v) {
  if (f.type === 'checklist') return f.rows.map(row => { const x = (v || {})[row] || {}; return `${row}: ${x.v || '–'}${x.r ? ' (' + x.r + ')' : ''}`; }).join('\n');
  if (f.type === 'table') return (v || []).map(row => f.cols.map(c => `${c.label}: ${row[c.k] || '–'}`).join(' | ')).join('\n');
  return Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? 'No' : v ?? '';
}

// ---------- API ----------
async function api(method, url, body) {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(ME ? { 'X-CSRF-Token': ME.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  resetIdle();
  if (r.status === 401 && url !== '/api/login') { ME = null; renderLogin('Your session ended. Sign in again.'); throw new Error('Session expired'); }
  const ct = r.headers.get('content-type') || '';
  const out = ct.includes('json') ? await r.json() : await r.blob();
  if (!r.ok) { const e = new Error(out.error || 'Request failed (' + r.status + ')'); e.missing = out.missing || []; throw e; }
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
  toast('Register your signature before you sign for the first time.');
  return registerSignature();
}
// Signature registration by the signed-in employee: initials, handwritten specimen (drawn), statement, password
async function registerSignature() {
  const ok = await modal({
    title: 'Register my signature', ok: 'Register signature', wide: true,
    html: `<p class="muted small">Register of signatures (JRS/SOP/QAS/009). Only you can register your signature. It is renewed every 5 years.</p>
      <div class="grid"><div><label class="f">Name</label><input type="text" value="${esc(ME.fullname)}" readonly></div><div><label class="f">Initials <span class="req">*</span></label><input type="text" name="initials" maxlength="6" style="text-transform:uppercase" value="${esc((USERS.find(u => u.username === ME.username) || {}).initials || '')}"></div></div>
      <div><label class="f">Signature specimen – sign in the box with the mouse, pen or finger <span class="req">*</span></label><canvas id="sigpad" class="sigpad" width="560" height="160" aria-label="Signature pad"></canvas>
      <button type="button" class="btn" id="sigclear">Clear</button></div>
      <label class="row"><input type="checkbox" name="accept"> I certify that my electronic signature in this system is the legally binding equivalent of my handwritten signature (21 CFR 11.100). I will not share my password, and I am accountable for actions initiated under my electronic signature.</label>
      <div><label class="f">Password (confirms it is you) <span class="req">*</span></label><input type="password" name="password" autocomplete="current-password"></div>`,
    onMount: (f) => {
      const c = $('#sigpad', f), g = c.getContext('2d'); let down = false, drawn = false;
      g.lineWidth = 2.2; g.lineCap = 'round'; g.strokeStyle = '#0b2a6b';
      const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
      c.addEventListener('pointerdown', (e) => { down = true; c.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pos(e)); });
      c.addEventListener('pointermove', (e) => { if (!down) return; g.lineTo(...pos(e)); g.stroke(); drawn = true; });
      ['pointerup', 'pointerleave'].forEach(ev => c.addEventListener(ev, () => { down = false; }));
      $('#sigclear', f).addEventListener('click', () => { g.clearRect(0, 0, c.width, c.height); drawn = false; });
      f._drawn = () => drawn;
    },
    onOk: async (f) => {
      if (!f._drawn()) throw new Error('Draw your signature in the box.');
      await api('POST', '/api/signature/register', { initials: val(f, 'initials'), signature: $('#sigpad', f).toDataURL('image/png'), accept: f.accept.checked, password: f.password.value });
    }
  });
  if (ok) { ME.esigAccepted = true; toast('Signature registered'); }
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

// environment banner (APP_ENV_LABEL), e.g. on the shared test system
const envBanner = () => HEALTH.envLabel ? `<div class="env-banner" role="note">${esc(HEALTH.envLabel)}</div>` : '';

// ---------- auth screens ----------
function renderLogin(msg = '') {
  clearInterval(idleTimer);
  $('#app').innerHTML = `${envBanner()}<div class="login"><div class="side"><h1>Quality records you can stand behind in an inspection.</h1>
    <p>Documents, training, deviations and complaints, CAPA, change control, audits, suppliers and clinical supply — one validated system with a full audit trail and electronic signatures.</p></div>
    <form id="lf"><div class="brand login-brand"><img class="brand-logo" src="/logo.png" alt="Jupiter Research Services"></div><p class="muted small" style="margin:-.4rem 0 0">Electronic Quality Management System</p>
    <h2>Sign in</h2><div><label class="f" for="u">User ID or email</label><input id="u" type="text" autocomplete="username" required></div>
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
  CFG.setDepartments(await api('GET', '/api/departments'));
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
  for (const [k, m] of Object.entries(MODS)) if (canSeeModule(m)) (groups[m.group] ||= []).push([k, m]);
  const openCount = (k) => ALL.filter(r => r.type === k && !DONE.has(r.status)).length;
  const link = (href, label, key, count) => `<a href="#/${href}" class="${active === key ? 'active' : ''}">${esc(label)}${count ? `<span class="count">${count}</span>` : ''}</a>`;
  const isAdmin = ME.allAccess;
  $('#app').innerHTML = `<div class="shell"><nav class="nav" id="nav" aria-label="Main">
    <div class="brand"><div>JRS eQMS<small>Quality Management System</small></div></div>
    ${link('dashboard', 'Dashboard', 'dashboard')}${link('tasks', 'My tasks', 'tasks')}${link('readiness', 'Inspection readiness', 'readiness')}
    ${Object.entries(groups).map(([g, list]) => `<h4>${esc(g)}</h4>${list.map(([k, m]) => link('m/' + k, m.name, k, openCount(k))).join('')}${g === 'Documents & training' ? link('matrix', 'Training matrix', 'matrix') : ''}`).join('')}
    <h4>System</h4>${auditAccess() ? link('audit', 'Audit trail', 'audit') + link('issued', 'Issued forms', 'issued') : ''}${link('signatures', 'Signature register', 'signatures')}${link('sharepoint', 'SharePoint', 'sharepoint')}${link('departments', 'Departments', 'departments')}${ME.canEditOrg ? link('organogram', 'Organogram', 'organogram') : ''}${isAdmin ? link('users', 'Users and roles', 'users') : ''}${link('password', 'Change password', 'password')}
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

// ---------- router ----------
window.addEventListener('hashchange', route);
async function route() {
  if (!ME) return;
  const [path, query] = location.hash.slice(2).split('?');
  const [view, a] = path.split('/').map(decodeURIComponent);
  QS = new URLSearchParams(query || ''); // e.g. #/audit?from=2026-07-01&to=2026-09-30
  try {
    ALL = await api('GET', '/api/records');
    const views = { dashboard, tasks, readiness, matrix, audit: auditView, history: historyView, signatures: signatureRegister, users: usersView, notifications: notificationsView, issued: issuedFormsView, departments: departmentsView, organogram: organogramView, sharepoint: spView, password: () => renderPasswordChange(false), m: listView, new: newView, r: detailView, search: searchView, verify: verifyView };
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
    return `<td>${f && (f.type === 'date' || f.fmt === 'date') ? dmy(v) : f && (f.type === 'user' || f.fmt === 'user') ? esc(userName(v)) : f && f.optionLabels && f.optionLabels[v] ? esc(f.optionLabels[v]) : esc(Array.isArray(v) ? v.join(', ') : v)}</td>`;
  }).join('')}</tr>`;
}
function bindRows(root = document) { $$('[data-go]', root).forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.go; })); }
function myTasks() {
  return ALL.filter(r => {
    if (DONE.has(r.status)) return false;
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
   ${k('Extension requests pending', cnt('extensions', r => r.status !== 'Draft'), '#/m/extensions', '')}${k('Documents in workflow', cnt('documents'), '#/m/documents', '')}</div>
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

// ---------- module list ----------
function listView(type) {
  const m = MODS[type]; if (!m || !canSeeModule(m)) return dashboard();
  const rows = ALL.filter(r => r.type === type); if (m.listSort) rows.sort(m.listSort);
  const canCreate = !m.noCreate && (type !== 'randomization' || hasRole(['unblinded'])) && !ME.roles.every(r => r === 'extaud');
  shell(type, `<div class="spread"><div><h1>${esc(m.name)}</h1><p class="muted">${esc(m.intro)}</p></div>
    <div class="row">${canCreate ? `<a class="btn primary" href="#/new/${type}">${esc(m.createTitle || 'New ' + singular(m))}</a>` : ''}${m.issueForm && !m.issueForm.fromRecordOnly && (!m.issueForm.roles || hasRole(m.issueForm.roles)) ? `<a class="btn" href="/api/forms/${type}" download title="PDF with an issue stamp; every issue is numbered and logged">Download ${esc(m.issueForm.label)}</a>` : ''}<button class="btn" id="exp">Export CSV</button></div></div>
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
   ${m.tempNumbering || m.attachOnRequestOnly ? `<div style="margin-top:1rem"><label class="f" for="natt">Attachments${m.attachOnRequestOnly ? ' – ' + esc(m.attachHint || 'attach your documents now; after the request only QA can add documents') : ' (optional)'}</label><input type="file" id="natt" multiple></div>` : ''}
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

// ---------- extension requests (JRS/FRM/QAS/045), raised from the due date they extend ----------
const EXTENDABLE = { investigations: { dueDate: 'Overall due date' }, changes: { dueDate: 'Overall due date' }, selfinspections: { dueDate: 'Overall due date' },
  capa: { dueDate: 'Overall due date', corrDue: 'Correction (CAPA)', caDue: 'Corrective action (CAPA)', paDue: 'Preventive action (CAPA)' } };
const EXT_DONE = { dueDate: 'extendedDue', corrDue: 'corrExt', caDue: 'caExt', paDue: 'paExt' };
function extensionButtons(rec) {
  for (const [k, scope] of Object.entries(EXTENDABLE[rec.type] || {})) {
    const due = rec.data[k], el = $(`#rf [name="${k}"], #rf [data-computed="${k}"]`), box = el && el.closest('.grid > div');
    if (!due || !box) continue;
    const er = ALL.filter(x => x.type === 'extensions' && x.data.documentId === rec.number && (x.data.scope || 'Overall due date') === scope).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    let html = '';
    if (er && er.status !== 'Rejected') html = `<a class="ext-link" href="#/r/${er.id}">Extension ${esc(er.number)} – ${esc(er.status)}${er.data.requestedDate ? ' (to ' + dmy(er.data.requestedDate) + ')' : ''}</a>`;
    else if (!rec.data[EXT_DONE[k]] && today() <= due) html = `<button type="button" class="btn ext-btn" data-ext="${k}">Request extension</button>`;
    if (html) box.insertAdjacentHTML('beforeend', `<div class="ext-row">${html}</div>`);
  }
  $$('[data-ext]').forEach(b => b.addEventListener('click', () => extensionDialog(rec, b.dataset.ext, EXTENDABLE[rec.type][b.dataset.ext])));
}
async function extensionDialog(rec, k, scope) {
  if (!(await ensureEsigAccepted())) return;
  let created = null;
  const ok = await modal({
    title: 'Request extension – ' + rec.number, ok: 'Sign and submit', okClass: 'primary sign', wide: true,
    html: `<p class="muted small">Extension request (JRS/FRM/QAS/045). It goes to the Head of the record's department, then to the Head of Quality. Only one extension is allowed per due date, and it must be approved before ${dmy(rec.data[k])}.</p>
      <div class="grid"><div><label class="f">Record</label><input type="text" value="${esc(rec.number)} – ${esc(MODS[rec.type].name)}" readonly></div><div><label class="f">Due date to extend</label><input type="text" value="${esc(scope)}: ${dmy(rec.data[k])}" readonly></div>
      <div><label class="f">Requested extension date <span class="req">*</span></label><input type="date" name="requestedDate" min="${addDaysIso(rec.data[k], 1)}"></div><div><label class="f">Requester</label><input type="text" value="${esc(ME.fullname)}${ME.department ? ' – ' + esc(deptName(ME.department)) : ''}" readonly></div></div>
      <div><label class="f">Justification of extension / delay <span class="req">*</span></label><textarea name="justification" rows="4"></textarea></div>
      <div><label class="f">Interim update <span class="req">*</span></label><textarea name="interimUpdate" rows="3"></textarea></div>
      <div><label class="f">Impact assessment (product quality, patient safety, regulatory compliance, business operations) <span class="req">*</span></label><textarea name="impactAssessment" rows="3"></textarea></div>
      <div class="sig-statement">By signing you apply your electronic signature with the meaning <b>Requested</b>. Date and time are recorded by the server (${esc(tz)}).</div>
      <div class="grid"><div><label class="f">User ID</label><input type="text" name="sigUsername" value="${esc(ME.username)}" autocomplete="username"></div><div><label class="f">Password</label><input type="password" name="password" autocomplete="current-password"></div></div>`,
    onOk: async (f) => {
      if (!f.password.value) throw new Error('Enter your password to sign.');
      if (!created) created = await api('POST', '/api/records', { type: 'extensions', linkFrom: rec.id, data: { documentId: rec.number, scope, requestedDate: val(f, 'requestedDate'), justification: val(f, 'justification'), interimUpdate: val(f, 'interimUpdate'), impactAssessment: val(f, 'impactAssessment') } });
      else await api('PUT', '/api/records/' + created.id, { data: { requestedDate: val(f, 'requestedDate'), justification: val(f, 'justification'), interimUpdate: val(f, 'interimUpdate'), impactAssessment: val(f, 'impactAssessment') }, reason: 'Corrected before submission' });
      await api('POST', `/api/records/${created.id}/transition`, { to: 'HOD Review', sigUsername: val(f, 'sigUsername'), password: f.password.value });
      return created;
    }
  });
  if (ok) { toast(`${ok.number} submitted to the Head of Department`); route(); }
  else if (created) { toast(`${created.number} saved as a draft – open it to submit`); route(); }
}
function extensionKpis(rows) {
  const n = (f) => rows.filter(f).length, k = (label, v, st, cls = '') => `<a class="kpi ${cls}" href="#" data-st="${esc(st)}"><b>${v}</b>${esc(label)}</a>`;
  return `<div class="kpis">${k('All extension requests', rows.length, '')}${k('Waiting for Head of Department', n(r => r.status === 'HOD Review'), 'HOD Review', n(r => r.status === 'HOD Review') ? 'warn' : 'ok')}
    ${k('Waiting for Head of Quality', n(r => r.status === 'Head of Quality Approval'), 'Head of Quality Approval', n(r => r.status === 'Head of Quality Approval') ? 'warn' : 'ok')}${k('Approved', n(r => r.status === 'Approved'), 'Approved', 'ok')}${k('Rejected', n(r => r.status === 'Rejected'), 'Rejected')}${k('Drafts not submitted', n(r => r.status === 'Draft'), 'Draft')}</div>`;
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
  const open = !DONE.has(rec.status) && !rec.status.startsWith('Closed');
  const canWrite = !ME.roles.every(r => r === 'extaud');
  const isRequest = (rec.type === 'investigations' && ['Requested', 'Request Update', 'Rejected'].includes(rec.status)) || (rec.type === 'changes' && ['Draft', 'QA Review', 'Rejected', 'Cancelled'].includes(rec.status));
  if (canWrite && !isRequest) {
    if (['investigations', 'selfinspections', 'extaudits'].includes(rec.type)) extraBtns.push(`<button class="btn" data-act="spawn" data-to="capa">Raise CAPA</button>`);
    if (['investigations', 'capa', 'extaudits'].includes(rec.type)) extraBtns.push(`<button class="btn" data-act="spawn" data-to="changes">Raise change control</button>`);
    if (['changes', 'investigations', 'capa'].includes(rec.type)) extraBtns.push(`<button class="btn" data-act="spawn" data-to="risks">Start risk assessment</button>`);
    if (rec.type === 'capa') extraBtns.push(`<button class="btn" data-act="spawn" data-to="training">Assign retraining</button>`);
    if (rec.type === 'mgmtreviews' && ['Planned', 'Data Compiled', 'Meeting Held'].includes(rec.status) && hasRole(['qa'])) extraBtns.push(`<button class="btn primary" data-act="compile">${d.metrics ? 'Re-compile QMR data' : 'Compile QMR data'}</button>`);
  }

  shell(rec.type, `<div class="spread"><div><p class="muted small"><a href="#/m/${rec.type}">${esc(m.name)}</a></p>
    <h1><span class="mono">${esc(rec.number)}</span>${rec.type === 'documents' ? ' <span class="muted">v' + esc(d.version) + '</span>' : ''}</h1>
    <p style="margin:0">${esc(d.title || '')}</p><p class="muted small">Created by ${esc(userName(rec.created_by))} on ${dmyt(rec.created_at)} · Last change ${dmyt(rec.updated_at)}</p></div>
    <div class="row no-print">${pill(rec.status)}${isOverdue(rec) ? '<span class="pill bad">Overdue</span>' : ''}</div></div>
    <div class="record"><div>
      <div class="panel no-print"><h3>Next steps</h3><div class="row">
        ${trans.length ? trans.map((t, i) => `<button class="btn ${t.sign ? 'primary sign' : ''}" data-act="tr" data-i="${i}" ${t.allowed ? '' : 'disabled title="Your roles do not permit this step"'}>${esc(t.label)}</button>`).join('') : extraBtns.length ? '' : '<span class="muted">No workflow steps available from this status.</span>'}
        ${extraBtns.join('')}${m.issueForm && !m.issueForm.inSection && (!m.issueForm.roles || hasRole(m.issueForm.roles)) && (!m.issueForm.when || m.issueForm.when(d, rec.status)) ? `<a class="btn" href="/api/forms/${rec.type}?record=${rec.id}" download title="Controlled form with a numbered issue stamp">Issue ${esc(m.issueForm.label)}</a>` : ''}${rec.type === 'vendors' && d.auditDate && (d.agenda || []).length ? `<a class="btn" href="/api/records/${rec.id}/agenda.pdf" download>Audit agenda (JRS/FRM/QAS/021)</a>` : ''}<a class="btn" href="/api/records/${rec.id}/report.pdf" download title="One PDF: every part, signatures, all PDF and image attachments${det.auditAccess ? ', audit trail' : ''}">Download report (PDF)</a><a class="btn" href="/api/records/${rec.id}/report.pdf?inline=1" target="_blank" rel="noopener">Print report</a><a class="btn" href="/api/records/${rec.id}/report" download title="Original attachment files in a ZIP">Files (ZIP)</a></div></div>
      <form class="panel" id="rf"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Record details</h3>${det.editable ? '<span class="small muted">Changes need a reason and are recorded in the audit trail.</span>' : '<span class="pill grey">Read-only in this status</span>'}</div>
        <div class="grid">${(() => { let s = null; return m.fields.map(f => {
          if (f.type === 'section') { s = f; if (f.showIf && !f.showIf(d, rec.status)) return ''; return fieldHtml(f) + sectionSignatures(m, f, det.signatures); }
          if (s && s.showIf && !s.showIf(d, rec.status)) return '';
          return fieldHtml(f, d[f.k], !det.editable || !!f.lock || !canEditSection(s, rec));
        }).join(''); })()}</div>
        ${det.editable ? '<div class="error" style="margin-top:.8rem"></div><button class="btn primary">Save changes</button>' : ''}</form>
      <div id="special"></div>
      <div class="panel"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Linked records</h3>
        <form id="lk" class="row no-print"><input type="text" name="number" placeholder="Record number, e.g. CAPA/QAS/001/26" list="dl_links" style="max-width:260px" aria-label="Record number to link">
        <datalist id="dl_links">${ALL.filter(r => r.id !== rec.id).slice(0, 300).map(r => `<option value="${esc(r.number)}">${esc(r.data.title || '')}</option>`).join('')}</datalist><button class="btn">Link</button></form></div>
        ${det.links.length ? table(det.links.map(l => ALL.find(r => r.id === l.id) || { ...l, data: { title: l.title } }), ['number', 'module', 'title', 'status']) : '<p class="muted small">No linked records. CAPA, RCA, change controls and extension requests raised from this record are linked automatically.</p>'}</div>
      <div class="panel"><div class="spread" style="margin-bottom:.5rem"><h3 style="margin:0">Attachments</h3>${canWrite && (open || hasRole(['qa'])) && (!m.attachOnRequestOnly || hasRole(['qa'])) ? `<label class="btn no-print">Add file (stage: ${esc(rec.status)})<input type="file" id="att" hidden></label>` : m.attachOnRequestOnly ? '<span class="small muted">Documents can be added by QA only.</span>' : ''}</div>
        ${attachmentsTable(m, det.attachments)}</div>
    </div><aside class="rail">
      <div class="panel"><h3>Lifecycle</h3><ol class="lifecycle">${m.states.map((s, i) => `<li class="${s === rec.status ? 'now' : i < idx ? 'past' : ''}">${esc(s)}</li>`).join('')}</ol></div>
      <div class="panel"><h3>Electronic signatures</h3>${det.signatures.length ? det.signatures.map(s => `<div class="stamp ${s.current ? '' : 'stale'}"><div class="meaning">${esc(s.meaning)}</div><div class="name">${esc(s.fullname)}</div><div class="when">${dmyt(s.ts)} ${esc(tz)}</div><div class="small muted">${esc(s.from_state || '')} → ${esc(s.to_state || '')}</div>${s.current ? '' : '<div class="note">Signed an earlier version of this record; later changes are in the audit trail.</div>'}</div>`).join('') : '<p class="muted small">No signatures yet.</p>'}</div>
      ${det.auditAccess ? `<div class="panel"><div class="spread" style="margin-bottom:.4rem"><h3 style="margin:0">Audit trail</h3><a class="btn" href="#/history/${rec.id}">Full history · ${det.versionCount} version${det.versionCount === 1 ? '' : 's'}</a></div>
        <div class="trail">${det.audit.slice(0, 60).map(a => `<div><div class="t">${dmyt(a.ts)} · ${esc(a.fullname || a.username)}</div><b>${esc(a.action)}</b>${a.field ? ` <span class="muted">${esc(fieldLabel(rec.type, a.field))}</span>` : ''}
        ${a.old_value != null || a.new_value != null ? `<div class="diff">${a.old_value != null ? `<del>${esc(String(auditValue(rec.type, a.field, a.old_value)).slice(0, 160))}</del> ` : ''}<ins>${esc(String(auditValue(rec.type, a.field, a.new_value ?? '')).slice(0, 160))}</ins></div>` : ''}${a.reason ? `<div class="muted">Reason: ${esc(a.reason)}</div>` : ''}</div>`).join('')}</div></div>` : ''}
    </aside></div>`);

  const form = $('#rf'); liveCompute(form, m, d);
  bindRows();
  $('#lk').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', `/api/records/${id}/links`, { number: e.target.number.value }); toast('Record linked'); route(); } catch (x) { toast(x.message); }
  });
  if (det.editable) form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm(form, m);
    await stepDialog({ title: 'Save changes', reason: true, perform: async (v) => { const r = await api('PUT', '/api/records/' + id, { data, reason: v.reason }); toast(r.changes ? `${r.changes} field(s) changed` : 'No changes to save'); } }) && route();
  });
  $$('[data-act="tr"]').forEach(b => b.addEventListener('click', async () => {
    const t = trans[+b.dataset.i];
    const ok = await stepDialog({ title: t.label, meaning: t.sign, reason: t.reason, perform: (v) => api('POST', `/api/records/${id}/transition`, { to: t.to, label: t.label, ...v }).catch(x => { markMissing($('#rf'), x.missing); throw x; }) });
    if (ok) { toast(ok.pending && ok.pending.length ? `Signed – still needed: ${ok.pending.join(', ')}` : `${rec.number}: ${ok.status || t.to}`); route(); }
  }));
  const act = (name, fn) => $$(`[data-act="${name}"]`).forEach(b => b.addEventListener('click', () => fn(b)));
  act('revise', async () => {
    const r = await stepDialog({ title: 'Start revision', reason: true,
      extra: `<div><label class="f">Revision type</label><select name="revisionType"><option>Revision – technical / procedural change</option><option>Periodic review – no change</option></select></div>
        <div><label class="f">Approved change control no. (for a revision with changes)</label><input type="text" name="changeControl" list="dl_cc"><datalist id="dl_cc">${ALL.filter(x => x.type === 'changes').map(x => `<option value="${esc(x.number)}">${esc(x.data.title || '')}</option>`).join('')}</datalist></div>`,
      perform: (v) => api('POST', `/api/records/${id}/revise`, v) });
    if (r) { toast('Revision draft created'); location.hash = '#/r/' + r.id; }
  });
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
  $('#att')?.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 25 * 1024 * 1024) return toast('Maximum file size is 25 MB in this build.');
    try { await uploadFile(id, file); toast('Attachment added'); route(); } catch (x) { toast(x.message); }
  });
  if (canWrite && open) extensionButtons(rec);
  // required documents by type (e.g. licence copy, filled questionnaire, audit certificate) for the current qualification cycle
  const sectionOpen = (el) => { let s = null; for (const f of m.fields) { if (f.type === 'section') s = f; if (f === el) return canEditSection(s, rec); } return false; };
  $$('[data-docs]').forEach(box => {
    const f = m.fields.find(x => x.type === 'docs' && x.docs.map(y => y.join(':')).join('|') === box.dataset.docs), canAdd = canWrite && sectionOpen(f);
    box.innerHTML = f.docs.map(([cat, label]) => { const files = det.attachments.filter(a => a.category === cat && a.ts >= (d.cycleStartedAt || ''));
      return `<div class="doc-req"><span class="doc-label">${esc(label)}</span>${files.length ? files.map(a => `<a class="pill done" href="/api/attachments/${a.id}">${esc(a.name)}</a>`).join(' ') : '<span class="pill warn">Not attached</span>'}
        ${canAdd ? `<label class="btn small-btn">Attach ${esc(label.toLowerCase())}<input type="file" hidden data-cat="${esc(cat)}"></label>` : ''}</div>`; }).join('');
  });
  $$('[data-cat]').forEach(inp => inp.addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { await uploadFile(id, file, inp.dataset.cat); toast('Document attached'); route(); } catch (x) { toast(x.message); } }));
  // controlled form issued once per qualification cycle; later downloads give the same file
  $$('[data-issue]').forEach(box => {
    const cfg = m.issueForm, done = (d.formIssues || []).filter(x => x.ts >= (d.cycleStartedAt || '')).pop(), allowed = cfg && (!cfg.roles || hasRole(cfg.roles));
    box.innerHTML = done ? `<div class="doc-req"><span class="doc-label">${esc(cfg.label)}</span><span class="pill done">Issued ${esc(done.no)} – ${dmy(done.ts)} to ${esc(userName(done.by))}</span>${allowed ? ` <a class="btn small-btn" href="/api/forms/${rec.type}?record=${rec.id}" download>Download issued copy</a>` : ''}</div>`
      : allowed && cfg.when(d, rec.status) ? `<div class="doc-req"><span class="doc-label">${esc(cfg.label)}</span><span class="pill warn">Not issued</span> <a class="btn primary small-btn" href="/api/forms/${rec.type}?record=${rec.id}" download id="issueBtn">Issue questionnaire</a></div>`
      : `<div class="doc-req"><span class="doc-label">${esc(cfg.label)}</span><span class="pill warn">Not issued</span> <span class="small muted">QA issues it during the quality review.</span></div>`;
  });
  $('#issueBtn')?.addEventListener('click', () => setTimeout(route, 1500));
  if (rec.type === 'labels') labelPanel(rec);
  if (rec.type === 'randomization' && det.randList) randPanel(rec, det.randList);
  if (m.deptApproval && (d[m.deptApproval.field] || []).length) optionalApprovalsPanel(rec);
  if (rec.type === 'mgmtreviews') qmrPanel(rec);
  if (rec.type === 'atreviews') atrPanel(rec);
  act('compile', async () => { try { await api('POST', `/api/records/${id}/compile`); toast('QMR data compiled'); route(); } catch (x) { toast(x.message); } });
}

// JRS/SOP/QAS/019 – data for the 13 agenda topics and the KPIs, compiled from the eQMS
function qmrPanel(rec) {
  const m = rec.data.metrics;
  if (!m) { $('#special').innerHTML = `<div class="panel"><h3>QMR data</h3><p class="muted">Not compiled yet. QA compiles the data for all agenda topics and KPIs before the meeting.</p></div>`; return; }
  const tbl = (head, rows) => `<div class="table-wrap" style="margin-bottom:.8rem"><table class="t"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  $('#special').innerHTML = `<div class="panel"><h3>QMR data – ${esc(m.period.quarter)}</h3><p class="muted small">Compiled ${dmyt(m.generatedAt)} from the eQMS. Re-compile before the minutes are compiled to refresh.</p>
    <h4>Key performance indicators (JRS/SOP/QAS/019 §5.17)</h4>${tbl(['KPI', 'Value', 'Basis'], m.kpis)}
    ${m.sections.map(s => `<h4>${esc(s.title)}</h4>${tbl(m.columns, s.rows)}`).join('')}</div>`;
}

// Who may change a form section at the record's current stage (section opts.edit in modules.js)
// pseudo-roles: initiator, responsible (person), respdept (member of the responsible department), depthead (approving Head)
const canEditSection = (s, rec) => !s || !s.edit || (ME.allAccess && (s.edit[rec.status] || []).length > 0) || (s.edit[rec.status] || []).some(r =>
  r === 'initiator' ? rec.created_by === ME.username : r === 'responsible' ? rec.data.respPerson === ME.username
    : r === 'respdept' ? !!ME.department && ME.department === rec.data.respDept : r === 'depthead' ? rec.data.hodApprover === ME.username : ME.roles.includes(r));
const WHO_BY_CHECK = { isRespPerson: 'Responsible person', isCcDept: 'Responsible person / department', isInitiator: 'Initiator', isResponsible: 'Initiator / responsible person', isPartAOwner: 'Initiator / responsible person / department', isPartCOwner: 'Responsible person / department', isHodApprover: 'Head of Department (organogram)' };
// Sign-offs expected for a section, taken from the workflow (transitions with the same "part"), each with the
// latest signature: name and date, or pending. Changing the workflow in modules.js changes these blocks automatically.
function expectedSignoffs(m, s) {
  const seen = new Set();
  return m.transitions.filter(t => s.part && t.part === s.part && t.sign && !seen.has(t.sign) && seen.add(t.sign))
    .map(t => ({ meaning: t.sign, alt: ['Rejected', 'Cancelled'].includes(t.to) || /^Rejected/.test(t.sign) || !!t.optional, who: t.roles.includes('any') ? WHO_BY_CHECK[(t.checks || []).find(c => WHO_BY_CHECK[c])] || 'Any user' : t.roles.map(r => CFG.ROLES[r] || r).join(' / ') }));
}
// rejection, cancellation and resubmission sign-offs are shown only when they happened
const signoffRows = (m, s, sigs) => expectedSignoffs(m, s).map(x => ({ ...x, sig: sigs.filter(z => z.meaning === x.meaning).pop() })).filter(x => !x.alt || x.sig);
function sectionSignatures(m, s, sigs) {
  const rows = signoffRows(m, s, sigs); if (!rows.length) return '';
  return `<div class="full sig-block"><table class="t"><thead><tr><th>Sign-off</th><th>By (role)</th><th>Signed by</th><th>Date / time</th></tr></thead><tbody>${rows.map(x => {
    const g = x.sig;
    return `<tr><td>${esc(x.meaning)}</td><td class="small muted">${esc(x.who)}</td><td>${g ? esc(g.fullname) : '<span class="pill warn">Pending</span>'}</td><td class="small">${g ? `${dmyt(g.ts)}${g.current ? '' : ' <span class="pill grey" title="Record changed after this signature">earlier version</span>'}` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// Departmental approvals: change control optional approvals 1–4 (JRS/SOP/QAS/007 Part C), cross-functional document review (JRS/SOP/QAS/021)
function optionalApprovalsPanel(rec) {
  const cfg = MODS[rec.type].deptApproval, d = rec.data, done = d.deptApprovals || [], canSign = rec.status === cfg.state;
  const meaningFor = (dept) => rec.type === 'changes' ? `Approved – optional approval (${dept})` : `Reviewed – cross-functional (${dept})`;
  $('#special').innerHTML = `<div class="panel"><h3>${esc(cfg.label)}</h3><p class="muted small">Heads of the named departments sign at stage "${esc(cfg.state)}".</p>
    <div class="table-wrap"><table class="t"><thead><tr><th>Department</th><th>Signed by</th><th>Date</th><th>Comment</th><th></th></tr></thead><tbody>
    ${d[cfg.field].map(code => { const a = done.find(x => x.dept === code); return `<tr><td>${esc(CFG.DEPTS[code] || code)}</td><td>${a ? esc(a.name) : '<span class="pill warn">Pending</span>'}</td><td>${a ? dmyt(a.ts) : ''}</td><td>${a ? esc(a.comment) : ''}</td>
      <td>${!a && canSign && (ME.allAccess || (ME.deptsUnder || []).includes(code)) ? `<button class="btn primary sign" data-dept="${esc(code)}">Sign</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
  $$('[data-dept]').forEach(b => b.addEventListener('click', async () => {
    const dept = b.dataset.dept;
    const ok = await stepDialog({ title: `${cfg.label} – ${CFG.DEPTS[dept] || dept}`, meaning: meaningFor(dept),
      extra: `<div><label class="f">Comment</label><textarea name="comment" rows="3"></textarea></div>`,
      perform: (v) => api('POST', `/api/records/${rec.id}/dept-approve`, { ...v, dept }) });
    if (ok) { toast(`${dept} approval recorded`); route(); }
  }));
}

async function spawn(src, to) {
  const m = MODS[to], s = src.data;
  const capaSource = src.type === 'investigations' ? s.invType : src.type === 'selfinspections' ? 'Internal audit / self-inspection'
    : src.type === 'extaudits' ? (s.auditType === 'Regulatory inspection' ? 'Regulatory inspection / compliance' : 'External audit') : 'Other';
  const pre = { capa: { title: 'CAPA for ' + src.number + ': ' + (s.title || ''), source: capaSource, sourceRecord: src.number, nonconformance: s.description || s.title || '', respDept: s.respDept || s.auditeeDept || '', respPerson: s.respPerson || s.auditee || '' },
    changes: { title: 'Change arising from ' + src.number, justification: 'See ' + src.number, respDept: s.respDept || '' },
    risks: { title: 'Risk assessment for ' + src.number + ': ' + (s.title || ''), referenceDoc: src.number, site: s.site || '' },
    extensions: { documentId: src.number, scope: 'Overall due date' },
    training: { title: 'Retraining – ' + (s.title || ''), sourceRecord: src.number, trainingType: 'Read & Understand' } }[to] || {};
  shell(to, `<div class="spread"><div><h1>New ${esc(singular(m))}</h1><p class="muted">Linked to <span class="mono">${esc(src.number)}</span>.</p></div></div>
   <form id="nf" class="panel"><div class="grid">${m.fields.filter(f => f.type !== 'readonly').map(f => fieldHtml(f, pre[f.k], false)).join('')}</div><div class="error" style="margin-top:1rem"></div>
   <div class="row"><button class="btn primary">Save record</button><a class="btn" href="#/r/${src.id}">Cancel</a></div></form>`);
  const form = $('#nf'); liveCompute(form, m);
  form.addEventListener('submit', async (e) => { e.preventDefault(); try { const r = await api('POST', '/api/records', { type: to, data: readForm(form, m), linkFrom: src.id }); toast(r.number + ' created'); location.hash = '#/r/' + r.id; } catch (x) { $('.error', form).textContent = x.message; } });
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
// quarterly audit trail review (QA and admin only): when the last approved review period ended
function atrTile() {
  if (!auditAccess()) return '';
  const last = ALL.filter(r => r.type === 'atreviews' && r.status === 'Approved').sort((a, b) => b.data.periodTo.localeCompare(a.data.periodTo))[0];
  const due = !last || last.data.periodTo < addDaysIso(today(), -92);
  return `<a class="kpi ${due ? 'alert' : 'ok'}" href="#/m/atreviews"><b>${last ? dmy(last.data.periodTo) : 'None'}</b>Audit trail reviewed up to (quarterly review${due ? ' overdue' : ''})</a>`;
}
function readiness() {
  const in90 = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), t = today();
  const docsOverdue = ALL.filter(r => r.type === 'documents' && r.status === 'Effective' && r.data.nextReview && r.data.nextReview < t);
  const trn = ALL.filter(r => r.type === 'training' && r.status !== 'Cancelled');
  const compliance = trn.length ? Math.round(100 * trn.filter(r => r.status === 'Completed').length / trn.length) : 100;
  const licences = ALL.filter(r => (r.type === 'vendors' || r.type === 'customers') && !['Disqualified', 'Blocked'].includes(r.status) && r.data.licenceExpiry && r.data.licenceExpiry <= in90);
  const inv = ALL.filter(r => r.type === 'investigations' && !DONE.has(r.status)), ic = MODS.investigations.compute;
  const followUpDue = (r) => { const d = r.data; if (d.customerApproval !== 'Pending' || !d.reportSent) return false; const n = [d.followUp1, d.followUp2, d.followUp3].filter(Boolean).length; return n < 3 && addDaysIso(d.reportSent, 15 * (n + 1)) <= t; };
  const items = [
    ['Deviations and complaints past due date', inv.filter(isOverdue)],
    ['Customer / sponsor not notified within 3 days', inv.filter(r => /^(Overdue|Late)/.test(ic.notifyStatus(r.data)))],
    ['Customer follow-ups due', inv.filter(r => r.status === 'Customer Approval' && followUpDue(r))],
    ['Overdue CAPA (incl. effectiveness checks)', ALL.filter(r => r.type === 'capa' && isOverdue(r))],
    ['Change controls past due date (incl. effectiveness checks)', ALL.filter(r => r.type === 'changes' && isOverdue(r))],
    ['Temporary changes past their end date', ALL.filter(r => r.type === 'changes' && r.data.nature === 'Temporary' && r.data.tempEnd && r.data.tempEnd < t && !DONE.has(r.status) && !r.status.startsWith('Closed'))],
    ['Self-inspection responses overdue', ALL.filter(r => r.type === 'selfinspections' && r.status === 'Report Issued' && isOverdue(r))],
    ['Self-inspection observations not yet complied', ALL.filter(r => r.type === 'selfinspections' && !DONE.has(r.status) && (r.data.observations || []).some(o => o.status !== 'Complied'))],
    ['External audit findings past their due date', ALL.filter(r => r.type === 'extaudits' && !DONE.has(r.status) && (r.data.findings || []).some(f => f.status !== 'Closed' && f.due && f.due < t))],
    ['Risk assessments past review date', ALL.filter(r => r.type === 'risks' && r.data.reviewDate && r.data.reviewDate < t)],
    ['Documents past periodic review', docsOverdue], ['Overdue training assignments', trn.filter(isOverdue)],
    ['Approved documents waiting for training past the effective date', ALL.filter(r => r.type === 'documents' && r.status === 'Approved – Training' && isOverdue(r))],
    ['Failed training assessments awaiting retraining', ALL.filter(r => r.type === 'training' && r.status === 'Failed')],
    ['Archived records not returned within 7 working days', ALL.filter(r => r.type === 'archives' && isOverdue(r))],    ['Vendor / customer licences expiring within 90 days', licences]
  ];
  shell('readiness', `<div class="spread"><div><h1>Inspection readiness</h1><p class="muted">Items an inspector is likely to ask about first. Each list links to the records.</p></div></div>
    <div class="kpis"><div class="kpi ${compliance >= 95 ? 'ok' : 'alert'}"><b>${compliance}%</b>Training compliance (target 95%)</div>${atrTile()}${items.map(([l, list], i) => `<a class="kpi ${list.length ? 'alert' : 'ok'}" href="#/readiness" data-scroll="r${i}"><b>${list.length}</b>${esc(l)}</a>`).join('')}</div>
    <div class="panel no-print"><h2>Inspection pack</h2><p class="muted small">Export record lists for a period — for the front room / back room during an inspection.</p>
      <div class="row"><label>From <input type="date" id="pf" value="${new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)}"></label><label>To <input type="date" id="pt" value="${t}"></label>
      <select id="pm" style="max-width:240px">${Object.entries(MODS).filter(([, m]) => canSeeModule(m)).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('')}</select><button class="btn primary" id="pe">Export list</button></div></div>
    ${items.map(([l, list], i) => `<h2 id="r${i}" style="margin-top:1.5rem">${esc(l)}</h2>${table(list, ['number', 'module', 'title', 'status'], 'None.')}`).join('')}`);
  bindRows();
  $$('[data-scroll]').forEach(el => el.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(el.dataset.scroll).scrollIntoView({ behavior: 'smooth' }); }));
  $('#pe').addEventListener('click', () => {
    const k = $('#pm').value, m = MODS[k], f = $('#pf').value, to = $('#pt').value + 'T23:59:59';
    const rows = ALL.filter(r => r.type === k && r.created_at >= f && r.created_at <= to);
    const fs = dataFields(m);
    download(`inspection_${k}_${f}_${$('#pt').value}.csv`, toCsv([['Number', 'Status', 'Created', ...fs.map(x => x.label)], ...rows.map(r => [r.number, r.status, r.created_at, ...fs.map(x => plain(x, r.data[x.k]))])]));
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

// ---------- register of signatures (JRS/SOP/QAS/009) ----------
async function signatureRegister() {
  USERS = await api('GET', '/api/users');
  const status = (u) => !u.active ? `<span class="pill grey">Inactive${u.inactive_date ? ' from ' + dmy(u.inactive_date) : ''}</span>` : !u.esig_accepted ? '<span class="pill warn">Not registered</span>'
    : u.esigCurrent ? '<span class="pill done">Registered</span>' : '<span class="pill bad">Re-registration due</span>';
  const me = USERS.find(u => u.username === ME.username) || {};
  shell('signatures', `<div class="spread"><div><h1>Signature register</h1><p class="muted">Electronic register of signatures (replaces FRM/QAS/008). A user registers by accepting the electronic signature statement at first signing; registration is renewed every 5 years. Superseded entries stay in the audit trail.</p></div><div class="row"><button class="btn primary" id="sr">${me.hasSignature && me.esigCurrent ? 'Re-register my signature' : 'Register my signature'}</button><button class="btn" id="sx">Export CSV</button></div></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Name</th><th>User ID</th><th>Designation</th><th>Department</th><th>Initials</th><th>Signature</th><th>Registered on</th><th>Re-register by</th><th>Status</th></tr></thead><tbody>
    ${USERS.map(u => `<tr><td>${esc(u.fullname)}</td><td class="mono">${esc(u.username)}</td><td>${esc(u.designation || '')}</td><td>${esc(CFG.DEPTS[u.department] || u.department || '')}</td><td class="mono">${esc(u.initials || '')}</td><td>${u.hasSignature ? `<img class="sig-thumb" alt="Signature of ${esc(u.fullname)}" src="/api/users/${encodeURIComponent(u.username)}/signature?v=${encodeURIComponent(u.esig_accepted || '')}">` : ''}</td><td>${dmy(u.esig_accepted)}</td><td>${dmy(u.reregisterBy)}</td><td>${status(u)}</td></tr>`).join('')}</tbody></table></div>`);
  $('#sr').addEventListener('click', async () => { if (await registerSignature()) signatureRegister(); });
  $('#sx').addEventListener('click', () => download(`signature_register_${today()}.csv`, toCsv([['Name', 'User ID', 'Designation', 'Department', 'Initials', 'Registered on', 'Re-register by', 'Active', 'Inactive from'], ...USERS.map(u => [u.fullname, u.username, u.designation, u.department, u.initials, u.esig_accepted, u.reregisterBy, u.active ? 'Yes' : 'No', u.inactive_date])])));
}

// ---------- users ----------
const f_pwNote = (ok, u) => ok.mailConfigured === false ? 'User updated. E-mail is not set up – if you reset the password, give it to the user yourself.' : !u.email ? 'User updated. The user has no e-mail address – give a reset password to them yourself.' : 'User updated';
async function usersView() {
  if (!ME.allAccess) return dashboard();
  USERS = await api('GET', '/api/users');
  // Heads of Department come from the organogram and every QA user assigns numbers, so those two roles are not ticked here
  const roleBox = (sel) => ([k, v]) => `<label><input type="checkbox" name="roles" value="${k}" ${sel.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`;
  const roleChecks = (sel = []) => `<p class="small muted" style="margin:.2rem 0">Main role</p><div class="checks">${CFG.MAIN_ROLES.map(k => [k, CFG.ROLES[k]]).map(roleBox(sel)).join('')}</div>
    <p class="small muted" style="margin:.6rem 0 .2rem">Additional permissions for specific modules</p><div class="checks">${Object.entries(CFG.ROLES).filter(([k]) => !CFG.MAIN_ROLES.includes(k) && !CFG.DERIVED_ROLES.includes(k)).map(roleBox(sel)).join('')}</div>
    <p class="small muted">Head of Department is set in the organogram; all QA users assign record numbers.</p>`;
  // register-of-signatures details (JRS/SOP/QAS/009)
  const regFields = (u = {}) => `<div class="grid"><div><label class="f">Designation</label><input type="text" name="designation" value="${esc(u.designation || '')}"></div>
    <div><label class="f">Department</label><select name="department"><option value=""></option>${Object.entries(CFG.DEPTS).map(([k, v]) => `<option value="${k}" ${u.department === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
    <div><label class="f">Reports to (line manager)</label><select name="reportsTo"><option value=""></option>${USERS.filter(x => x.active && x.username !== u.username).map(x => `<option value="${esc(x.username)}" ${u.reports_to === x.username ? 'selected' : ''}>${esc(x.fullname)}</option>`).join('')}</select></div>
    </div>`;
  const regVals = (f) => ({ designation: val(f, 'designation'), department: val(f, 'department'), reportsTo: val(f, 'reportsTo') });
  shell('users', `<div class="spread"><div><h1>Users and roles</h1><p class="muted">User IDs are unique and never reused. Deactivate instead of deleting. Administrators and management have all access; department users raise deviations and complaints and write reports for their department.</p></div><div class="row"><button class="btn primary" id="nu">New user</button><button class="btn" id="ux">Access review CSV</button></div></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>User ID</th><th>Name</th><th>Department</th><th>Reports to</th><th>Roles</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>
    ${USERS.map(u => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.fullname)}</td><td>${esc(deptName(u.department))}</td><td>${esc(userName(u.reports_to))}</td><td class="small">${esc(u.roles.map(r => CFG.ROLES[r]).join(', '))}</td><td>${u.locked ? '<span class="pill bad">Locked</span>' : u.active ? '<span class="pill done">Active</span>' : '<span class="pill grey">Inactive</span>'}</td><td class="small">${dmyt(u.last_login)}</td><td><button class="btn" data-edit="${esc(u.username)}">Edit</button></td></tr>`).join('')}</tbody></table></div>`);
  $('#nu').addEventListener('click', async () => {
    const ok = await modal({ title: 'New user', ok: 'Create user', html: `<div class="grid"><div><label class="f">User ID</label><input type="text" name="username"></div><div><label class="f">Full name</label><input type="text" name="fullname"></div>
      <div><label class="f">Email</label><input type="text" name="email"></div><div><label class="f">Initial password</label><input type="password" name="password" autocomplete="new-password"></div></div>
      ${regFields()}<div><label class="f">Roles</label>${roleChecks()}</div><div><label class="f">Reason / access request reference</label><input type="text" name="reason"></div>`,
      onOk: (f) => api('POST', '/api/users', { username: val(f, 'username'), fullname: val(f, 'fullname'), email: val(f, 'email'), password: f.password.value, reason: val(f, 'reason'), roles: $$('input[name=roles]:checked', f).map(x => x.value), ...regVals(f) }) });
    if (ok) { toast(ok.emailed ? 'User created – the temporary password was e-mailed to them' : 'User created – e-mail is not set up, so give them the temporary password yourself; they must change it at first sign-in'); usersView(); }
  });
  $$('[data-edit]').forEach(b => b.addEventListener('click', async () => {
    const u = USERS.find(x => x.username === b.dataset.edit);
    const ok = await modal({ title: 'Edit ' + u.username, ok: 'Save', html: `<div><label class="f">E-mail</label><input type="text" name="email" value="${esc(u.email || '')}"></div>${regFields(u)}<div><label class="f">Roles</label>${roleChecks(u.roles)}</div>
      <div class="row"><label><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Active</label>${u.locked ? '<label><input type="checkbox" name="unlock"> Unlock account</label>' : ''}</div>
      <div><label class="f">Reset password (optional)</label><input type="password" name="password" autocomplete="new-password"></div><div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/users/' + u.username, { roles: $$('input[name=roles]:checked', f).map(x => x.value), active: f.active.checked, unlock: f.unlock ? f.unlock.checked : false, password: f.password.value || undefined, reason: val(f, 'reason'), email: val(f, 'email'), ...regVals(f) }) });
    if (ok) { toast(ok.emailed ? `User updated – new password e-mailed to ${u.email}` : f_pwNote(ok, u)); usersView(); }
  }));
  $('#ux').addEventListener('click', () => download(`user_access_review_${today()}.csv`, toCsv([['User ID', 'Name', 'Department', 'Reports to', 'Roles', 'Active', 'Locked', 'Last login', 'Created'], ...USERS.map(u => [u.username, u.fullname, u.department, u.reports_to, u.roles.join('; '), u.active ? 'Yes' : 'No', u.locked ? 'Yes' : 'No', u.last_login, u.created_at])])));
}

// ---------- register of issued controlled forms (QA, administrators, management) ----------
async function issuedFormsView() {
  if (!auditAccess()) return dashboard();
  const rows = await api('GET', '/api/form-issues');
  shell('issued', `<div class="spread"><div><h1>Issued forms</h1><p class="muted">Every controlled form issued from the eQMS with its issue number (FI-YYYY-NNN), who it was issued to and for which record. Visible to QA, administrators and management.</p></div><button class="btn" id="fx">Export CSV</button></div>
    <div class="row no-print" style="margin-bottom:.8rem"><input type="search" id="ff" placeholder="Filter" style="max-width:280px"></div><div id="fl"></div>`);
  const draw = () => {
    const q = $('#ff').value.toLowerCase(), list = rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    $('#fl').innerHTML = list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Issue no.</th><th>Form</th><th>Record</th><th>Issued to</th><th>Department</th><th>Issued on</th></tr></thead><tbody>${list.map(r => `<tr><td class="mono">${esc(r.no)}</td><td>${esc(r.form_code)}<br><span class="small muted">${esc(r.form_title || '')}</span></td>
      <td>${r.record_id ? `<a class="mono" href="#/r/${r.record_id}">${esc(r.record_number)}</a><br><span class="small muted">${esc(r.record_title || '')}</span>` : '<span class="muted">Blank form</span>'}</td><td>${esc(r.issued_name || r.issued_to)}</td><td>${esc(deptName(r.dept))}</td><td class="small">${dmyt(r.ts)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-wrap"><div class="empty">No forms issued yet.</div></div>';
  };
  $('#ff').addEventListener('input', draw); draw();
  $('#fx').addEventListener('click', () => download(`issued_forms_${today()}.csv`, toCsv([['Issue no.', 'Form', 'Title', 'Record', 'Record title', 'Issued to', 'Department', 'Issued on (UTC)'], ...rows.map(r => [r.no, r.form_code, r.form_title, r.record_number, r.record_title, r.issued_name || r.issued_to, r.dept, r.ts])])));
}

// ---------- notifications (also sent by e-mail when the server has e-mail set up) ----------
async function notificationsView() {
  const r = await api('GET', '/api/notifications');
  shell('notifications', `<h1>Notifications</h1><p class="muted">Status changes of records you are involved in and steps waiting for you. The same messages are e-mailed to you when e-mail is set up on the server.</p>
    ${r.items.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date / time</th><th>Record</th><th>Message</th><th>E-mail</th></tr></thead><tbody>${r.items.map(n => `<tr class="${n.read ? '' : 'unread'}"><td class="small mono">${dmyt(n.ts)}</td>
      <td>${n.record_id ? `<a class="mono" href="#/r/${n.record_id}">${esc(n.record_number)}</a>` : ''}</td><td>${n.action ? '<span class="pill warn">Action needed</span> ' : ''}<b>${esc(n.subject)}</b><div class="small muted" style="white-space:pre-line">${esc(n.body)}</div></td><td class="small muted">${esc(n.email || 'Queued')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-wrap"><div class="empty">No notifications yet.</div></div>'}`);
  if (r.unread) api('POST', '/api/notifications/read').catch(() => {});
}

// ---------- departments (admin and management create them) ----------
async function departmentsView() {
  const deps = await api('GET', '/api/departments'); CFG.setDepartments(deps); USERS = await api('GET', '/api/users');
  const members = (c) => USERS.filter(u => u.active && u.department === c).length;
  shell('departments', `<div class="spread"><div><h1>Departments</h1><p class="muted">Department codes form CAPA and document numbers and are never reused. Administrators and management create and rename departments; the Head of each department and the hierarchy are kept in the organogram.</p></div>
    <div class="row">${ME.allAccess ? '<button class="btn primary" id="nd">New department</button>' : ''}${ME.canEditOrg ? '<a class="btn" href="#/organogram">Open organogram</a>' : ''}</div></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Code</th><th>Name</th><th>Part of</th><th>Head of Department</th><th>Head's email</th><th>Members</th><th>Status</th><th></th></tr></thead><tbody>
    ${deps.map(d => `<tr><td class="mono">${esc(d.code)}</td><td>${esc(d.name)}</td><td>${esc(d.parent ? deptName(d.parent) : '')}</td><td>${d.hod ? esc(userName(d.hod)) : '<span class="pill warn">Not set</span>'}</td><td>${(() => { const e = (USERS.find(u => u.username === d.hod) || {}).email; return e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : ''; })()}</td><td>${members(d.code)}</td>
      <td>${d.active ? '<span class="pill done">Active</span>' : '<span class="pill grey">Inactive</span>'}</td><td>${ME.allAccess ? `<button class="btn" data-ed="${esc(d.code)}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`);
  const parentSel = (cur, self) => `<select name="parent"><option value="">– none (top level) –</option>${deps.filter(d => d.code !== self).map(d => `<option value="${esc(d.code)}" ${cur === d.code ? 'selected' : ''}>${esc(deptName(d.code))}</option>`).join('')}</select>`;
  $('#nd')?.addEventListener('click', async () => {
    const ok = await modal({ title: 'New department', ok: 'Create department', html: `<div class="grid"><div><label class="f">Code (2–6 capital letters) <span class="req">*</span></label><input type="text" name="code" maxlength="6" style="text-transform:uppercase"></div>
      <div><label class="f">Name <span class="req">*</span></label><input type="text" name="name"></div><div><label class="f">Part of (parent department)</label>${parentSel('', '')}</div></div>
      <div><label class="f">Reason</label><input type="text" name="reason"></div>`,
      onOk: (f) => api('POST', '/api/departments', { code: val(f, 'code').toUpperCase(), name: val(f, 'name'), parent: val(f, 'parent'), reason: val(f, 'reason') }) });
    if (ok) { toast('Department created'); departmentsView(); }
  });
  $$('[data-ed]').forEach(b => b.addEventListener('click', async () => {
    const d = deps.find(x => x.code === b.dataset.ed);
    const ok = await modal({ title: 'Edit ' + d.code, ok: 'Save', html: `<div class="grid"><div><label class="f">Name</label><input type="text" name="name" value="${esc(d.name)}"></div><div><label class="f">Part of (parent department)</label>${parentSel(d.parent, d.code)}</div></div>
      <label class="row"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Active</label><div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/departments/' + d.code, { name: val(f, 'name'), parent: val(f, 'parent'), active: f.active.checked, reason: val(f, 'reason') }) });
    if (ok) { toast('Department updated'); departmentsView(); }
  }));
}

// ---------- organogram (management, the Head of QA and administrators) ----------
// Each department shows its Head and members by reporting line. Approvals follow it: the Head of the responsible
// department approves; without a Head (or when the Head is the person approved) the Head of the parent department does.
async function organogramView() {
  if (!ME.canEditOrg) return dashboard();
  const og = await api('GET', '/api/organogram'); CFG.setDepartments(og.departments);
  const deps = og.departments, users = og.users.filter(u => u.active), byCode = Object.fromEntries(deps.map(d => [d.code, d]));
  const kids = (code) => code ? deps.filter(d => d.parent === code) : deps.filter(d => !d.parent || !byCode[d.parent]);
  const person = (u, all) => { const reports = all.filter(x => x.reports_to === u.username);
    return `<li><button class="link" data-person="${esc(u.username)}">${esc(u.fullname)}</button> <span class="small muted">${esc(u.designation || u.roles.map(r => CFG.ROLES[r]).filter(Boolean)[0] || '')}</span>${reports.length ? `<ul>${reports.map(x => person(x, all)).join('')}</ul>` : ''}</li>`; };
  const node = (d) => {
    const mem = users.filter(u => u.department === d.code), top = mem.filter(u => !mem.some(x => x.username === u.reports_to));
    const head = d.hod ? users.find(u => u.username === d.hod) : null;
    return `<li><div class="org-node ${d.active ? '' : 'inactive'}"><div class="spread"><b>${esc(d.name)}</b> <span class="mono small">${esc(d.code)}</span></div>
      <div class="small">Head: ${head ? esc(head.fullname) : '<span class="pill warn">Not set – the Head of the parent department approves</span>'}</div>
      <button class="btn small-btn" data-dept="${esc(d.code)}">Set Head / position</button>
      ${mem.length ? `<ul class="org-people">${top.map(u => person(u, mem)).join('')}</ul>` : '<p class="small muted">No members yet.</p>'}</div>
      ${kids(d.code).length ? `<ul>${kids(d.code).map(node).join('')}</ul>` : ''}</li>`;
  };
  const noDept = users.filter(u => !u.department || !byCode[u.department]);
  shell('organogram', `<div class="spread"><div><h1>Organogram</h1><p class="muted">Departments, their Heads and reporting lines. Approvals follow this hierarchy: the Head of the responsible department approves; if a department has no Head, or the Head is the person whose work is approved, the Head of the department above approves (then the line manager). Every change is recorded in the audit trail.</p></div>
    <a class="btn" href="#/departments">Departments list</a></div>
    <div class="panel"><ul class="org-tree">${kids('').map(node).join('')}</ul></div>
    ${noDept.length ? `<div class="panel"><h3>Not assigned to a department</h3><ul class="org-people">${noDept.map(u => `<li><button class="link" data-person="${esc(u.username)}">${esc(u.fullname)}</button> <span class="small muted">${esc(u.roles.map(r => CFG.ROLES[r]).join(', '))}</span></li>`).join('')}</ul></div>` : ''}`);
  const userSel = (name, cur, skip) => `<select name="${name}"><option value="">– none –</option>${users.filter(u => u.username !== skip).map(u => `<option value="${esc(u.username)}" ${cur === u.username ? 'selected' : ''}>${esc(u.fullname)}${u.department ? ' – ' + esc(u.department) : ''}</option>`).join('')}</select>`;
  $$('[data-dept]').forEach(b => b.addEventListener('click', async () => {
    const d = byCode[b.dataset.dept];
    const ok = await modal({ title: d.name, ok: 'Save', html: `<div class="grid"><div><label class="f">Head of Department</label>${userSel('hod', d.hod)}</div>
      <div><label class="f">Part of (parent department)</label><select name="parent"><option value="">– none (top level) –</option>${deps.filter(x => x.code !== d.code).map(x => `<option value="${esc(x.code)}" ${d.parent === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>
      <div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/departments/' + d.code, { hod: val(f, 'hod'), parent: val(f, 'parent'), reason: val(f, 'reason') }) });
    if (ok) { toast('Organogram updated'); organogramView(); }
  }));
  $$('[data-person]').forEach(b => b.addEventListener('click', async () => {
    const u = og.users.find(x => x.username === b.dataset.person);
    const ok = await modal({ title: u.fullname, ok: 'Save', html: `<div class="grid"><div><label class="f">Department</label><select name="department"><option value=""></option>${deps.map(x => `<option value="${esc(x.code)}" ${u.department === x.code ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div><label class="f">Reports to</label>${userSel('reportsTo', u.reports_to, u.username)}</div></div><div><label class="f">Reason <span class="req">*</span></label><input type="text" name="reason"></div>`,
      onOk: (f) => api('PUT', '/api/organogram/users/' + u.username, { department: val(f, 'department'), reportsTo: val(f, 'reportsTo'), reason: val(f, 'reason') }) });
    if (ok) { toast('Organogram updated'); USERS = await api('GET', '/api/users'); organogramView(); }
  }));
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
