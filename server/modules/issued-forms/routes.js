/* Issued copies of forms from records; issued forms register. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
// pdf-lib 1.17.1 (MIT, vendor/pdf-lib.LICENSE.md), vendored so the app installs no npm packages
const PDFLib = require('../../../vendor/pdf-lib.min.js');
const { MODULES, ROLES } = require('../../../public/modules.js');
const { ROOT } = require('../../core/config.js');
const { db, now } = require('../../core/db.js');
const { pdfText, tsText } = require('../../core/util.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { hasRole } = require('../../core/auth.js');
const { lockPdf, stampPages } = require('../../core/pdf.js');
const { getRecord, hiddenFor, needAudit, saveRecord, visibleRecord } = require('../../records/engine.js');

// Register of issued controlled forms (QA, administrators, management)
route('GET', '/api/form-issues', (ctx) => { needAudit(ctx.user); return db.prepare('SELECT no,form_code,form_title,record_id,record_number,record_title,issued_to,issued_name,dept,ts,purpose,form_version,copy_type,expiry FROM form_issues ORDER BY ts DESC').all(); });
const FORMS_DIR = path.join(ROOT, 'forms');
function nextIssueNo(prefix = 'FI') {
  const y = new Date().getFullYear(), key = (prefix === 'FI' ? 'formIssue:' : `issue${prefix}:`) + y, cur = +((db.prepare('SELECT value FROM settings WHERE key=?').get(key) || {}).value || 0) + 1;
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(cur));
  return `${prefix}-${y}-${String(cur).padStart(3, '0')}`;
}
route('GET', '/api/forms/:type', async (ctx) => {
  const mod = MODULES[ctx.params.type], cfg = mod && mod.issueForm; if (!cfg) fail(404, 'No controlled form for this module.');
  if (hiddenFor(ctx.user, ctx.params.type)) fail(404, 'Not found');
  const rec = ctx.query.get('record') ? visibleRecord(ctx.user, getRecord(ctx.query.get('record'))) : null;
  if (rec && rec.type !== ctx.params.type) fail(400, 'The record does not belong to this module.');
  if (cfg.roles && !hasRole(ctx.user, cfg.roles)) fail(403, `Only ${cfg.roles.map(r => ROLES[r].split(' (')[0]).join(' / ')} can issue ${cfg.code}.`);
  if (cfg.fromRecordOnly && !rec) fail(400, `${cfg.code} is issued from the record it is for.`);
  const issued = rec && cfg.oncePerCycle ? db.prepare('SELECT * FROM form_issues WHERE record_id=? AND form_code=? AND ts>=? AND pdf IS NOT NULL ORDER BY ts DESC LIMIT 1').get(rec.id, cfg.code, rec.data.cycleStartedAt || '') : null;
  if (issued) { // one issue per supplier and qualification cycle: the same file every time
    audit(ctx.user, `Controlled form downloaded again (${issued.no})`, rec, null, null, `${cfg.code} issued ${issued.ts.slice(0, 10)} to ${issued.issued_name}`, null, ctx.ip);
    return { __raw: Buffer.from(issued.pdf), headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${cfg.code.replace(/\//g, '-')} ${issued.no}.pdf"` } };
  }
  if (rec && cfg.when && !cfg.when(rec.data, rec.status)) fail(409, `${cfg.code} is not needed for ${rec.number} at stage "${rec.status}".`);
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.load(fs.readFileSync(path.join(FORMS_DIR, cfg.file)));
  if (rec) { const form = doc.getForm(); for (const [field, k] of Object.entries(cfg.prefill || {})) { try { form.getTextField(field).setText(pdfText(k === '#number' ? rec.number : rec.data[k] || '')); } catch { /* field not in this form version */ } } }
  const no = nextIssueNo(), who = `${ctx.user.fullname}${ctx.user.department ? ' (' + ctx.user.department + ')' : ''}`;
  const lines = [`ISSUED COPY – ${no}`, `Issued to ${who} on ${tsText(now())}`, rec ? `For ${rec.number} – ${rec.data.title || ''}` : 'Blank form – not valid without the issue number'];
  await stampPages(doc, lines, 'blue'); // left side of the footer, blue: issued copy
  doc.setTitle(`${cfg.code} – issued copy ${no}`);
  const buf = cfg.lockCopy ? await lockPdf(await doc.save({ useObjectStreams: false })) : Buffer.from(await doc.save());
  if (rec) { (rec.data.formIssues ||= []).push({ no, by: ctx.user.username, ts: now() }); saveRecord(rec); }
  db.prepare('INSERT INTO form_issues (no,form_code,form_title,record_id,record_number,record_title,issued_to,issued_name,dept,ts,pdf) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(no, cfg.code, cfg.label, rec ? rec.id : null, rec ? rec.number : null, rec ? rec.data.title || '' : null, ctx.user.username, ctx.user.fullname, ctx.user.department || '', now(), cfg.oncePerCycle ? buf : null);
  audit(ctx.user, `Controlled form issued (${no})`, rec, null, null, `${cfg.code} issued to ${who}`, null, ctx.ip);
  const name = `${cfg.code.replace(/\//g, '-')} ${no}.pdf`;
  return { __raw: buf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"` } };
});

module.exports = { FORMS_DIR, nextIssueNo };
