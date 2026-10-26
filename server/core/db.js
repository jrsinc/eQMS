/* SQLite database: schema and column migrations. */
'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CFG } = require('./config.js');

// ---------- database ----------
const db = new DatabaseSync(path.join(CFG.dataDir, 'qms.db'));
db.exec(`PRAGMA journal_mode = ${CFG.journal};`);
db.exec(`
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY, fullname TEXT NOT NULL, email TEXT, roles TEXT NOT NULL,
  pw_hash TEXT NOT NULL, failed INTEGER DEFAULT 0, locked INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  must_change INTEGER DEFAULT 1, esig_accepted TEXT, last_login TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, number TEXT NOT NULL, title TEXT, status TEXT NOT NULL,
  data TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_rec_type ON records(type);
CREATE TABLE IF NOT EXISTS signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL, username TEXT NOT NULL, fullname TEXT NOT NULL,
  meaning TEXT NOT NULL, from_state TEXT, to_state TEXT, ts TEXT NOT NULL, content_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, record_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT, size INTEGER,
  sha256 TEXT NOT NULL, blob BLOB NOT NULL, uploaded_by TEXT NOT NULL, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rand_lists (
  record_id TEXT PRIMARY KEY, list TEXT NOT NULL, seed TEXT NOT NULL, generated_by TEXT NOT NULL, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, username TEXT, fullname TEXT, action TEXT NOT NULL,
  record_id TEXT, record_number TEXT, field TEXT, old_value TEXT, new_value TEXT, reason TEXT,
  ip TEXT, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit trail is read-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit trail is read-only'); END;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS links (a TEXT NOT NULL, b TEXT NOT NULL, created_by TEXT NOT NULL, ts TEXT NOT NULL, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS versions (record_id TEXT NOT NULL, no INTEGER NOT NULL, ts TEXT NOT NULL, username TEXT, fullname TEXT,
  status TEXT NOT NULL, number TEXT, data TEXT NOT NULL, reason TEXT, PRIMARY KEY (record_id, no));
CREATE TRIGGER IF NOT EXISTS versions_no_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT, 'version history is read-only'); END;
CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT, 'version history is read-only'); END;
CREATE TABLE IF NOT EXISTS form_issues (no TEXT PRIMARY KEY, form_code TEXT NOT NULL, form_title TEXT, record_id TEXT, record_number TEXT, record_title TEXT,
  issued_to TEXT NOT NULL, issued_name TEXT, dept TEXT, ts TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, record_id TEXT, record_number TEXT,
  subject TEXT NOT NULL, body TEXT NOT NULL, action TEXT, ts TEXT NOT NULL, read INTEGER DEFAULT 0, email TEXT);
CREATE TABLE IF NOT EXISTS departments (code TEXT PRIMARY KEY, name TEXT NOT NULL, parent TEXT, hod TEXT, active INTEGER DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL);
`);
// register of signatures (JRS/SOP/QAS/009) – columns added to existing databases
for (const col of ['designation', 'department', 'initials', 'inactive_date', 'reports_to', 'signature']) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`); } catch { /* already present */ } }
try { db.exec('ALTER TABLE attachments ADD COLUMN stage TEXT'); } catch { /* already present */ }
 // workflow stage the file was added at
try { db.exec('ALTER TABLE attachments ADD COLUMN category TEXT'); } catch { /* already present */ }
 // document type, e.g. licence copy
try { db.exec('ALTER TABLE form_issues ADD COLUMN pdf BLOB'); } catch { /* already present or created below */ }
 // the issued file, returned again on every download

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const uid = () => crypto.randomUUID();

module.exports = { db, now, sha256, uid };
