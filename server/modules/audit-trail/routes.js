/* Audit trail API. */
'use strict';
const { db } = require('../../core/db.js');
const { addDays } = require('../../core/util.js');
const { audit, verifyAudit } = require('../../core/audit.js');
const { route } = require('../../core/http.js');
const { HIDEABLE, hiddenFor, needAudit } = require('../../records/engine.js');

// audit trail
// Audit trail (QA and admin). Filters: from / to (dates), user, type (module), record (number), action, q (any text), limit.
function auditQuery(user, f) {
  const where = [], args = [];
  const hidden = HIDEABLE.filter(t => hiddenFor(user, t));
  if (hidden.length) { where.push(`(r.type IS NULL OR r.type NOT IN (${hidden.map(() => '?').join(',')}))`); args.push(...hidden); }
  if (f.from) { where.push('a.ts >= ?'); args.push(String(f.from).slice(0, 10)); }
  if (f.to) { where.push('a.ts < ?'); args.push(addDays(String(f.to).slice(0, 10), 1)); }
  if (f.user) { where.push('a.username = ?'); args.push(f.user); }
  if (f.type === 'system') where.push('a.record_id IS NULL');
  else if (f.type) { where.push('r.type = ?'); args.push(f.type); }
  if (f.record) { where.push('(a.record_number LIKE ? OR r.number LIKE ?)'); args.push(`%${f.record}%`, `%${f.record}%`); }
  if (f.action) { where.push('a.action LIKE ?'); args.push(`%${f.action}%`); }
  if (f.q) { where.push('(a.username LIKE ? OR a.fullname LIKE ? OR a.action LIKE ? OR a.record_number LIKE ? OR a.field LIKE ? OR a.new_value LIKE ? OR a.reason LIKE ?)'); args.push(...Array(7).fill(`%${f.q}%`)); }
  const lim = Math.min(+f.limit || 1000, 10000);
  return db.prepare(`SELECT a.*, r.type AS record_type FROM audit a LEFT JOIN records r ON r.id = a.record_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`).all(...args, lim);
}
route('GET', '/api/audit', (ctx) => {
  needAudit(ctx.user);
  return auditQuery(ctx.user, Object.fromEntries(['from', 'to', 'user', 'type', 'record', 'action', 'q', 'limit'].map(k => [k, ctx.query.get(k) || ''])));
});
route('GET', '/api/audit/verify', (ctx) => { needAudit(ctx.user); const r = verifyAudit(); audit(ctx.user, 'Audit trail integrity verified', null, null, null, r.ok ? 'Intact' : 'BROKEN at ' + r.brokenAt, null, ctx.ip); return r; });
route('POST', '/api/audit/report', (ctx) => { // logs that a filtered audit trail was exported or printed
  needAudit(ctx.user);
  audit(ctx.user, 'Audit trail ' + (ctx.body.kind === 'print' ? 'report printed' : 'exported'), null, 'filters', null, String(ctx.body.filters || 'none').slice(0, 500), null, ctx.ip);
  return { ok: true };
});

module.exports = { auditQuery };
