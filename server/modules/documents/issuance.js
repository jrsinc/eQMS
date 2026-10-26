/* Controlled document issuance and label printing. */
'use strict';
const { CFG } = require('../../core/config.js');
const { db, now, uid } = require('../../core/db.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { hasRole, verifySignature } = require('../../core/auth.js');
const { getRecord, rowToRecord, saveRecord, sign } = require('../../records/engine.js');

// ---------- controlled document issuance ----------
function effectiveDoc(number) {
  const r = rowToRecord(db.prepare("SELECT * FROM records WHERE type='documents' AND number=? AND status='Effective' AND deleted=0").get(String(number || '').trim().toUpperCase()));
  if (!r) fail(400, `No Effective version of document "${number}". Only the current Effective version can be issued.`);
  return r;
}
function paginate(text, perPage = 38, width = 95) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let l = raw; if (!l) { lines.push(''); continue; }
    while (l.length > width) { let cut = l.lastIndexOf(' ', width); if (cut < 20) cut = width; lines.push(l.slice(0, cut)); l = l.slice(cut).trimStart(); }
    lines.push(l);
  }
  const pages = []; for (let i = 0; i < Math.max(lines.length, 1); i += perPage) pages.push(lines.slice(i, i + perPage).join('\n'));
  return pages;
}
route('POST', '/api/records/:id/issue-print', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'issues') fail(400, 'Not an issue record.');
  if (!hasRole(ctx.user, ['qa'])) fail(403, 'Only QA Document Control can print issued copies.');
  const reprint = !!ctx.body.reprint;
  if (!reprint && rec.status !== 'Approved') fail(409, 'The issue must be Approved before copies are printed.');
  if (reprint && rec.status !== 'Issued') fail(409, 'Replacement copies can be printed only while the issue is Issued.');
  if (reprint && !String(ctx.body.reason || '').trim()) fail(400, 'A reason is required for a replacement copy.');
  const doc = effectiveDoc(rec.data.docNumber);
  if (doc.data.version !== rec.data.docVersion) fail(409, `Document is now at version ${doc.data.version}; this issue was approved for ${rec.data.docVersion}. Raise a new issue request.`);
  verifySignature(ctx.user, ctx.body);
  const pages = paginate(doc.data.content);
  const log = rec.data.printLog || [];
  let copies;
  if (reprint) {
    const replaces = +ctx.body.copyNo;
    const total = +rec.data.copies + log.filter(j => j.replacement).length;
    if (!(replaces >= 1 && replaces <= total) || log.some(j => j.voided === replaces)) fail(400, 'Enter a valid copy number that has not already been voided.');
    copies = [{ copyNo: total + 1, replacement: true, replaces }];
    log.push({ ts: now(), by: ctx.user.username, copyNo: total + 1, replacement: true, voided: replaces, reason: ctx.body.reason, pages: pages.length });
    audit(ctx.user, 'Replacement copy issued (e-signed: Replacement issued)', rec, 'copy', `Copy ${replaces} voided`, `Copy ${total + 1}`, ctx.body.reason, ctx.ip);
    sign(ctx.user, rec, 'Replacement issued', rec.status, rec.status);
  } else {
    copies = Array.from({ length: +rec.data.copies }, (_, i) => ({ copyNo: i + 1 }));
    for (const c of copies) log.push({ ts: now(), by: ctx.user.username, copyNo: c.copyNo, pages: pages.length });
    rec.status = 'Issued';
    audit(ctx.user, 'Controlled copies issued (e-signed: Issued)', rec, 'status', 'Approved', 'Issued', `${copies.length} copies of ${doc.number} v${doc.data.version}, ${pages.length} pages each`, ctx.ip);
  }
  rec.data.printLog = log; rec.data.pages = pages.length; saveRecord(rec);
  if (!reprint) sign(ctx.user, rec, 'Issued', 'Approved', 'Issued');
  return {
    issueNo: rec.number, totalCopies: +rec.data.copies, copies, pages,
    doc: { number: doc.number, version: doc.data.version, title: doc.data.title, effectiveDate: doc.data.effectiveDate },
    issuedTo: rec.data.issuedTo, issuedToName: (db.prepare('SELECT fullname FROM users WHERE username=?').get(rec.data.issuedTo) || {}).fullname || rec.data.issuedTo,
    issuedBy: ctx.user.fullname, issuedAt: now(), returnBy: rec.data.returnBy, purpose: rec.data.purpose, copyType: rec.data.copyType, org: CFG.orgName
  };
});

// label printing
route('POST', '/api/records/:id/print', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'labels' || rec.status !== 'Approved') fail(409, 'Only Approved labels can be printed.');
  if (!hasRole(ctx.user, ['cs', 'qa'])) fail(403, 'Clinical supply or QA role required.');
  const { firstKit, qty, batch, expiry, printer } = ctx.body;
  if (!(+qty > 0 && +qty <= 5000)) fail(400, 'Quantity must be 1–5000.');
  if (!batch || !expiry) fail(400, 'Batch and expiry are required.');
  verifySignature(ctx.user, ctx.body);
  const job = { id: uid().slice(0, 8), ts: now(), by: ctx.user.username, firstKit: +firstKit, qty: +qty, batch, expiry, printer: printer || 'Browser / PDF', version: rec.data.version };
  rec.data.printLog = [...(rec.data.printLog || []), job]; saveRecord(rec);
  audit(ctx.user, 'Label print job (e-signed: Printed)', rec, 'print', null, `${qty} labels, kits ${firstKit}–${+firstKit + +qty - 1}, batch ${batch}, exp ${expiry}`, null, ctx.ip);
  sign(ctx.user, rec, 'Printed', rec.status, rec.status);
  return job;
});

module.exports = { effectiveDoc, paginate };
