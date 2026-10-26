/* Controlled forms and SOPs: tables, list, versions, access. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { ROLES } = require('../../../public/modules.js');
const { ROOT } = require('../../core/config.js');
const { db, now, sha256, uid } = require('../../core/db.js');
const { kindOf, today } = require('../../core/util.js');
const { audit } = require('../../core/audit.js');
const { fail } = require('../../core/http.js');
const { allAccess, hasRole, userLabel, userRow, verifySignature } = require('../../core/auth.js');
const { queueMail } = require('../../core/mail.js');

// ---------- controlled documents: forms and SOPs (List of Controlled Documents JRS/FRM/QAS/048, JRS/SOP/QAS/021) ----------
// QA adds and changes entries and signs every change; each version keeps its signed master and the in-use file. A new version
// supersedes the previous one (on its effective date); QA can make an entry obsolete. Copies are issued and signed by QA from
// the current version only. Forms: everyone views the list. SOPs: QA decides by role who can see each SOP.
db.exec(`CREATE TABLE IF NOT EXISTS cforms (id TEXT PRIMARY KEY, number TEXT UNIQUE NOT NULL, title TEXT NOT NULL, section TEXT, sop TEXT,
  status TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS cform_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, form_id TEXT NOT NULL, version TEXT NOT NULL, effective_date TEXT,
  status TEXT NOT NULL, change_note TEXT, master_name TEXT, master BLOB, master_sha TEXT, inuse_name TEXT, inuse BLOB, inuse_sha TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, ended_at TEXT, ended_by TEXT, end_reason TEXT);`);
try { db.exec("ALTER TABLE cforms ADD COLUMN kind TEXT DEFAULT 'form'"); } catch { /* already present */ }
 // form | sop
try { db.exec('ALTER TABLE cforms ADD COLUMN roles TEXT'); } catch { /* already present */ }
 // SOP: JSON list of roles that can see it, ["all"] = everyone
for (const col of ['purpose', 'form_version', 'issued_by', 'copy_label', 'copy_type', 'expiry']) { try { db.exec(`ALTER TABLE form_issues ADD COLUMN ${col} TEXT`); } catch { /* already present */ } }
const CD_VERSION = /^\d{1,2}\.\d$/;
const CD = {
  form: { kind: 'form', base: '/api/cforms', noun: 'form', Noun: 'Form', label: 'Controlled form', list: 'frm-qas-048.txt', listTitle: 'List of Controlled Documents – Forms',
    number: /^JRS\/FRM\/[A-Z]{2,4}\/\d{3}$/, example: 'JRS/FRM/QAS/056', inuse: 'in-use form',
    sections: ['Annexure of Operations SOP', 'Annexure Packaging SOP', 'Annexure Human Resource Management SOP', 'Annexure of Quality Assurance SOP'],
    // in-use files already kept in forms/ for the forms the eQMS issues from records
    files: { 'JRS/FRM/QAS/004': 'JRS-FRM-QAS-004 v3.0 Vendor qualification checklist.pdf', 'JRS/FRM/QAS/010': 'JRS-FRM-QAS-010 v2.0 New customer creation form.pdf' } },
  sop: { kind: 'sop', base: '/api/csops', noun: 'SOP', Noun: 'SOP', label: 'Controlled SOP', list: 'frm-qas-048-sop.txt', listTitle: 'List of Controlled Documents – SOP',
    number: /^JRS\/(SOP|POL)\/[A-Z]{2,4}\/\d{3}$/, example: 'JRS/SOP/QAS/023', inuse: 'SOP (PDF)',
    sections: ['Administrations SOP', 'Operations SOP', 'Packaging SOP', 'Human Resource Management SOP', 'Quality Assurance SOP', 'Policies'], files: {} }
};
(function seedControlledDocuments() {
  for (const K of Object.values(CD)) {
    if (db.prepare('SELECT COUNT(*) n FROM cforms WHERE kind=?').get(K.kind).n) continue;
    const src = path.join(ROOT, 'forms', K.list); if (!fs.existsSync(src)) continue;
    let section = '', n = 0; const ts = now();
    const addDoc = db.prepare('INSERT INTO cforms (id,number,title,section,sop,status,created_by,created_at,kind,roles) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const addVer = db.prepare('INSERT INTO cform_versions (form_id,version,effective_date,status,change_note,inuse_name,inuse,inuse_sha,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const line of fs.readFileSync(src, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('## ')) { section = line.slice(3).trim(); continue; }
      if (!line.trim() || line.startsWith('#')) continue;
      const [number, title, version, eff] = line.split('|').map(s => s.trim()), id = uid();
      const f = K.files[number] && path.join(ROOT, 'forms', K.files[number]), buf = f && fs.existsSync(f) ? fs.readFileSync(f) : null;
      addDoc.run(id, number, title, section, K.kind === 'form' ? 'JRS/SOP/QAS/021' : '', 'Effective', 'system', ts, K.kind, K.kind === 'sop' ? '["all"]' : null);
      addVer.run(id, version, eff, 'Effective', 'From the List of Controlled Documents JRS/FRM/QAS/048 v1.0 (05-Oct-2026)', buf ? K.files[number] : null, buf, buf ? sha256(buf) : null, 'system', ts);
      n++;
    }
    audit(null, `${K.label}s loaded`, null, 'cforms', null, `${n} ${K.noun}s from JRS/FRM/QAS/048 v1.0`, `Initial list of controlled ${K.noun}s`);
  }
})();
const isQa = (u) => hasRole(u, ['qa']);
const needQa = (u, what) => { if (!isQa(u)) fail(403, `Only QA ${what}.`); };
const cdRoles = (f) => { try { return JSON.parse(f.roles || '["all"]'); } catch { return ['all']; } };
// who can see an entry: QA all of them; others the effective forms, and the effective SOPs their role was given access to
const cdCanSee = (u, f) => isQa(u) || (f.status === 'Effective' && (f.kind !== 'sop' || allAccess(u) || cdRoles(f).includes('all') || u.roles.some(r => cdRoles(f).includes(r))));
// a new version with a later effective date waits as Approved; on its effective date it supersedes the version in use
const cfPending = (id) => db.prepare("SELECT * FROM cform_versions WHERE form_id=? AND status='Approved' ORDER BY id DESC LIMIT 1").get(id);
function cfCurrent(id) {
  const p = cfPending(id);
  if (p && p.effective_date <= today()) {
    const old = db.prepare("SELECT * FROM cform_versions WHERE form_id=? AND status='Effective' ORDER BY id DESC LIMIT 1").get(id), num = (db.prepare('SELECT number FROM cforms WHERE id=?').get(id) || {}).number;
    if (old) db.prepare("UPDATE cform_versions SET status='Superseded', ended_at=?, ended_by=?, end_reason=? WHERE id=?").run(now(), p.created_by, `Superseded by v${p.version}`, old.id);
    db.prepare("UPDATE cform_versions SET status='Effective' WHERE id=?").run(p.id);
    audit(null, 'Controlled document version effective', null, 'version', old ? `v${old.version} (now Superseded)` : null, `${num} v${p.version} effective ${p.effective_date}`, 'Effective date reached');
  }
  return db.prepare("SELECT * FROM cform_versions WHERE form_id=? AND status<>'Approved' ORDER BY id DESC LIMIT 1").get(id);
}
const cfVersionRow = (v, qa) => v && { id: v.id, version: v.version, effectiveDate: v.effective_date, status: v.status, changeNote: v.change_note,
  master: v.master_name ? { name: v.master_name, sha256: qa ? v.master_sha : undefined } : null, inuse: v.inuse_name ? { name: v.inuse_name, sha256: qa ? v.inuse_sha : undefined } : null,
  createdBy: userLabel(v.created_by), createdAt: v.created_at, endedAt: v.ended_at, endedBy: v.ended_by ? userLabel(v.ended_by) : null, endReason: v.end_reason };
// a file sent from the browser as { name, base64 }; the in-use file must be a PDF so issued copies can be stamped
function cfFile(file, kind, K) {
  if (!file || !file.base64) return null;
  const buf = Buffer.from(String(file.base64), 'base64'); if (!buf.length) fail(400, 'Empty file');
  if (buf.length > 25 * 1024 * 1024) fail(413, 'Maximum file size is 25 MB.');
  if (kind === 'inuse' && kindOf(buf) !== 'pdf') fail(400, `The ${K.inuse} must be a PDF: issued copies are stamped on every page.`);
  return { name: String(file.name || kind + '.pdf').slice(0, 200), buf, sha: sha256(buf) };
}
const cfNeedReason = (r) => { const s = String(r || '').trim(); if (!s) fail(400, 'Enter a reason.'); return s; };
// every change and issue is e-signed (password); the signature is kept against the entry and its current files
function cdSign(ctx, f, meaning, toState) { verifySignature(ctx.user, ctx.body); cdRecordSig(ctx, f, meaning, toState); }
function cdRecordSig(ctx, f, meaning, toState) {
  const v = db.prepare('SELECT * FROM cform_versions WHERE form_id=? ORDER BY id DESC LIMIT 1').get(f.id) || {};
  db.prepare('INSERT INTO signatures (record_id,username,fullname,meaning,from_state,to_state,ts,content_hash) VALUES (?,?,?,?,?,?,?,?)')
    .run('cd:' + f.id, ctx.user.username, ctx.user.fullname, meaning, f.status, toState || f.status, now(), sha256([f.number, f.title, v.version, v.effective_date, v.master_sha, v.inuse_sha].join('|')));
}
function cdNotify(username, subject, body) {
  const nid = db.prepare('INSERT INTO notifications (username,record_id,record_number,subject,body,action,ts) VALUES (?,?,?,?,?,?,?)').run(username, null, null, subject, body + '\n\nJRS eQMS – automatic notification. Do not reply.', null, now()).lastInsertRowid;
  queueMail((userRow(username) || {}).email, subject, body, nid);
}
const ROLE_KEYS = Object.keys(ROLES).filter(r => r !== 'numgen');

module.exports = { CD_VERSION, CD, isQa, needQa, cdRoles, cdCanSee, cfPending, cfCurrent, cfVersionRow, cfFile, cfNeedReason, cdSign, cdRecordSig, cdNotify, ROLE_KEYS };
