/* Router: which page to show for the address. */
'use strict';
// ---------- router ----------
window.addEventListener('hashchange', route);
async function route() {
  if (!ME) return;
  const [path, query] = location.hash.slice(2).split('?');
  const [view, a] = path.split('/').map(decodeURIComponent);
  QS = new URLSearchParams(query || ''); // e.g. #/audit?from=2026-07-01&to=2026-09-30
  try {
    ALL = await api('GET', '/api/records');
    const views = { dashboard, tasks, readiness, matrix, audit: auditView, history: historyView, signatures: signatureRegister, users: usersView, notifications: notificationsView, issued: issuedFormsView, backup: backupView, forms: formsView, form: formView, sops: sopsView, sop: sopView, departments: departmentsView, organogram: organogramView, sharepoint: spView, password: () => renderPasswordChange(false), m: listView, new: newView, r: detailView, search: searchView, verify: verifyView };
    const offView = (['m', 'new'].includes(view) && isOff(a)) || (view === 'matrix' && isOff('training'));
    await (offView ? dashboard : views[view] || dashboard)(a);
    window.scrollTo(0, 0);
  } catch (x) { if (ME) { shell('', `<div class="panel"><h2>Something went wrong</h2><p>${esc(x.message)}</p></div>`); } }
}

