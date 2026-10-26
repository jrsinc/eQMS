/* Audit trail: hash-chained, append-only. */
'use strict';
const { db, now, sha256 } = require('./db.js');

// ---------- audit trail (hash-chained, append-only) ----------
function audit(user, action, rec, field, oldV, newV, reason, ip) {
  const last = db.prepare('SELECT hash FROM audit ORDER BY id DESC LIMIT 1').get();
  const prev = last ? last.hash : 'GENESIS';
  const e = {
    ts: now(), username: user ? user.username : 'system', fullname: user ? user.fullname : 'System', action,
    record_id: rec ? rec.id : null, record_number: rec ? rec.number : null, field: field || null,
    old_value: oldV == null ? null : String(oldV), new_value: newV == null ? null : String(newV),
    reason: reason || null, ip: ip || null
  };
  const hash = sha256(prev + JSON.stringify(e));
  db.prepare(`INSERT INTO audit (ts,username,fullname,action,record_id,record_number,field,old_value,new_value,reason,ip,prev_hash,hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.ts, e.username, e.fullname, e.action, e.record_id, e.record_number,
    e.field, e.old_value, e.new_value, e.reason, e.ip, prev, hash);
}
function verifyAudit(conn = db) { // also used on a backup before it is restored
  let prev = 'GENESIS', n = 0;
  for (const r of conn.prepare('SELECT * FROM audit ORDER BY id').iterate()) {
    const e = { ts: r.ts, username: r.username, fullname: r.fullname, action: r.action, record_id: r.record_id,
      record_number: r.record_number, field: r.field, old_value: r.old_value, new_value: r.new_value, reason: r.reason, ip: r.ip };
    if (r.prev_hash !== prev || sha256(prev + JSON.stringify(e)) !== r.hash) return { ok: false, brokenAt: r.id, checked: n };
    prev = r.hash; n++;
  }
  return { ok: true, checked: n };
}

module.exports = { audit, verifyAudit };
