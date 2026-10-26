/* Notifications. */
'use strict';
// ---------- notifications (also sent by e-mail when the server has e-mail set up) ----------
async function notificationsView() {
  const r = await api('GET', '/api/notifications');
  shell('notifications', `<h1>Notifications</h1><p class="muted">Status changes of records you are involved in and steps waiting for you. The same messages are e-mailed to you when e-mail is set up on the server.</p>
    ${r.items.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date / time</th><th>Record</th><th>Message</th><th>E-mail</th></tr></thead><tbody>${r.items.map(n => `<tr class="${n.read ? '' : 'unread'}"><td class="small mono">${dmyt(n.ts)}</td>
      <td>${n.record_id ? `<a class="mono" href="#/r/${n.record_id}">${esc(n.record_number)}</a>` : ''}</td><td>${n.action ? '<span class="pill warn">Action needed</span> ' : ''}<b>${esc(n.subject)}</b><div class="small muted" style="white-space:pre-line">${esc(n.body)}</div></td><td class="small muted">${esc(n.email || 'Queued')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="table-wrap"><div class="empty">No notifications yet.</div></div>'}`);
  if (r.unread) api('POST', '/api/notifications/read').catch(() => {});
}

