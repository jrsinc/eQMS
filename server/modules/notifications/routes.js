/* Notifications API. */
'use strict';
const { db } = require('../../core/db.js');
const { route } = require('../../core/http.js');

route('GET', '/api/notifications', (ctx) => {
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE username=? AND read=0').get(ctx.user.username).n;
  if (ctx.query.get('count')) return { unread };
  return { unread, items: db.prepare('SELECT id, record_id, record_number, subject, body, action, ts, read, email FROM notifications WHERE username=? ORDER BY id DESC LIMIT 200').all(ctx.user.username) };
});
route('POST', '/api/notifications/read', (ctx) => { db.prepare('UPDATE notifications SET read=1 WHERE username=? AND read=0').run(ctx.user.username); return { ok: true }; });

module.exports = {  };
