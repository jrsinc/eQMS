/* Backup and restore API. */
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { CFG } = require('../../core/config.js');
const { db, now, sha256 } = require('../../core/db.js');
const { audit, verifyAudit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { sessions, verifySignature } = require('../../core/auth.js');
const { loadDepartments } = require('../../org/departments.js');

// ---------- backup and restore (administrators) ----------
// A backup is one file: a header line and the whole database (records, attachments, users, audit trail, controlled documents),
// compressed, with its SHA-256. Restoring checks that file, keeps a copy of the current database, and replaces the content.
const BK_MAGIC = 'JRS-EQMS-BACKUP 1\n';
const BK_COUNTS = ['users', 'records', 'attachments', 'audit', 'signatures', 'cforms', 'form_issues'];
const BK_DIR = path.join(CFG.dataDir, 'backup');
const needAdmin = (u) => { if (!u.roles.includes('admin')) fail(403, 'Only system administrators take backups and restore them.'); };
const bkCounts = (conn) => Object.fromEntries(BK_COUNTS.map(t => { try { return [t, conn.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]; } catch { return [t, null]; } }));
const bkStamp = (ts = now()) => ts.slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
const restoreTokens = new Map();
 // checked uploads waiting for confirmation: token -> { file, header, by, ts }
function dbSnapshot() { // the database file as it is now (WAL written back first)
  if (CFG.journal === 'WAL') db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  return fs.readFileSync(path.join(CFG.dataDir, 'qms.db'));
}
route('GET', '/api/admin/backup', (ctx) => {
  needAdmin(ctx.user);
  const raw = dbSnapshot(), ts = now(), counts = bkCounts(db), v = verifyAudit();
  const header = { app: 'JRS eQMS', org: CFG.orgName, createdAt: ts, createdBy: ctx.user.username, createdByName: ctx.user.fullname, size: raw.length, sha256: sha256(raw), counts, auditIntact: v.ok };
  const file = Buffer.concat([Buffer.from(BK_MAGIC + JSON.stringify(header) + '\n', 'utf8'), zlib.gzipSync(raw, { level: 6 })]);
  const name = `JRS-eQMS-backup-${bkStamp(ts)}.jrsbak`;
  audit(ctx.user, 'Backup downloaded', null, 'backup', null, `${name} (${(file.length / 1048576).toFixed(1)} MB; ${counts.records} records, ${counts.attachments} attachments, ${counts.users} users; SHA-256 ${header.sha256.slice(0, 16)}…)`, null, ctx.ip);
  return { __raw: file, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' } };
});
// step 1: upload the backup file; it is checked and summarised, nothing is changed yet
route('POST', '/api/admin/restore/check', (ctx) => {
  needAdmin(ctx.user);
  const buf = ctx.raw || Buffer.alloc(0), magic = Buffer.from(BK_MAGIC);
  if (buf.length < magic.length || !buf.subarray(0, magic.length).equals(magic)) fail(400, 'This is not a JRS eQMS backup file (.jrsbak).');
  const nl = buf.indexOf(10, magic.length); if (nl < 0) fail(400, 'The backup file is damaged (no header).');
  let header; try { header = JSON.parse(buf.subarray(magic.length, nl).toString('utf8')); } catch { fail(400, 'The backup file is damaged (header).'); }
  let raw; try { raw = zlib.gunzipSync(buf.subarray(nl + 1)); } catch { fail(400, 'The backup file is damaged or incomplete (data cannot be read).'); }
  if (raw.length !== header.size || sha256(raw) !== header.sha256) fail(400, 'The backup file is damaged: its checksum does not match. It may have been changed or only partly copied.');
  if (raw.subarray(0, 16).toString('latin1') !== 'SQLite format 3\0') fail(400, 'The backup does not contain an eQMS database.');
  fs.mkdirSync(BK_DIR, { recursive: true });
  const token = crypto.randomBytes(16).toString('hex'), file = path.join(BK_DIR, `rs-${token.slice(0, 8)}.db`);
  fs.writeFileSync(file, raw);
  let check;
  try {
    const conn = new DatabaseSync(file, { readOnly: true });
    try {
      const ok = conn.prepare('PRAGMA integrity_check').get();
      const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
      if (!['users', 'records', 'audit'].every(t => tables.includes(t))) throw new Error('tables');
      check = { integrity: Object.values(ok)[0] === 'ok', counts: bkCounts(conn), audit: verifyAudit(conn), admins: conn.prepare("SELECT COUNT(*) n FROM users WHERE active=1 AND roles LIKE '%\"admin\"%'").get().n };
    } finally { conn.close(); }
  } catch { fs.rmSync(file, { force: true }); fail(400, 'The backup does not contain a readable eQMS database.'); }
  if (!check.integrity) { fs.rmSync(file, { force: true }); fail(400, 'The database in the backup failed the integrity check.'); }
  for (const [t, x] of restoreTokens) if (Date.now() - x.at > 30 * 60000) { fs.rmSync(x.file, { force: true }); restoreTokens.delete(t); }
  restoreTokens.set(token, { file, header, by: ctx.user.username, at: Date.now() });
  audit(ctx.user, 'Backup checked for restore', null, 'backup', null, `Backup of ${header.createdAt} by ${header.createdByName || header.createdBy}: ${check.counts.records} records, ${check.counts.users} users; audit trail ${check.audit.ok ? 'intact' : 'BROKEN at ' + check.audit.brokenAt}`, null, ctx.ip);
  return { token, header, ...check, current: bkCounts(db) };
}, { rawBody: 2 * 1024 * 1024 * 1024 });
// step 2: confirm with the e-signature; the current database is kept in data/backup first, then replaced
route('POST', '/api/admin/restore', (ctx) => {
  needAdmin(ctx.user);
  const b = ctx.body, x = restoreTokens.get(String(b.token || ''));
  if (!x || x.by !== ctx.user.username || !fs.existsSync(x.file)) fail(409, 'Upload and check the backup file again.');
  if (String(b.confirm || '').trim() !== 'RESTORE') fail(400, 'Type RESTORE to confirm.');
  const reason = String(b.reason || '').trim(); if (!reason) fail(400, 'Enter the reason for the restore.');
  verifySignature(ctx.user, b);
  // keep the current database: it can be restored the same way if needed
  fs.mkdirSync(BK_DIR, { recursive: true });
  const before = dbSnapshot(), keepName = `pre-restore-${bkStamp()}.db`;
  fs.writeFileSync(path.join(BK_DIR, keepName), before);
  audit(ctx.user, 'Database restore started', null, 'backup', null, `From the backup of ${x.header.createdAt}; current database kept as data/backup/${keepName}`, reason, ctx.ip);
  const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL").all();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  db.exec(`ATTACH DATABASE '${x.file.replace(/'/g, "''")}' AS bk`);
  try {
    const bkTables = new Set(db.prepare("SELECT name FROM bk.sqlite_master WHERE type='table'").all().map(r => r.name));
    const cols = (schema, t) => db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all().map(c => c.name);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const t of triggers) db.exec(`DROP TRIGGER IF EXISTS main."${t.name}"`); // the read-only guards on audit / versions
      for (const t of tables) {
        db.exec(`DELETE FROM main."${t}"`);
        if (!bkTables.has(t)) continue; // a table newer than the backup stays empty
        const common = cols('bk', t).filter(c => cols('main', t).includes(c)).map(c => `"${c}"`).join(',');
        if (common) db.exec(`INSERT INTO main."${t}" (${common}) SELECT ${common} FROM bk."${t}"`);
      }
      if (bkTables.has('sqlite_sequence')) { db.exec('DELETE FROM main.sqlite_sequence'); db.exec('INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM bk.sqlite_sequence'); }
      for (const t of triggers) db.exec(t.sql);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  } finally { db.exec('DETACH DATABASE bk'); fs.rmSync(x.file, { force: true }); restoreTokens.delete(String(b.token)); }
  loadDepartments();
  sessions.clear(); // everyone signs in again against the restored users
  audit(ctx.user, 'Database restored from backup', null, 'backup', `Database before the restore kept as data/backup/${keepName}`,
    `Backup of ${x.header.createdAt} by ${x.header.createdByName || x.header.createdBy} (SHA-256 ${x.header.sha256.slice(0, 16)}…)`, reason, ctx.ip);
  ctx.setCookie = 'qms_sid=; Max-Age=0; Path=/';
  return { ok: true, kept: keepName, counts: bkCounts(db) };
});
route('GET', '/api/admin/backups/log', (ctx) => {
  needAdmin(ctx.user);
  return db.prepare("SELECT ts, fullname, action, old_value, new_value, reason FROM audit WHERE field='backup' ORDER BY id DESC LIMIT 50").all();
});

module.exports = { BK_MAGIC, BK_COUNTS, BK_DIR, needAdmin, bkCounts, bkStamp, restoreTokens, dbSnapshot };
