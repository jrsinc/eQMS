/* Merged PDF report and exports. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
// pdf-lib 1.17.1 (MIT, vendor/pdf-lib.LICENSE.md), vendored so the app installs no npm packages
const PDFLib = require('../../../vendor/pdf-lib.min.js');
const { MODULES } = require('../../../public/modules.js');
const { CFG, PUBLIC } = require('../../core/config.js');
const { db, now } = require('../../core/db.js');
const { dmyText, kindOf, pdfText, safeName, tsText } = require('../../core/util.js');
const { audit } = require('../../core/audit.js');
const { route } = require('../../core/http.js');
const { userLabel } = require('../../core/auth.js');
const { LOCKED, canSee, canSeeAudit, contentHash, fmt, getRecord, linked, visibleRecord } = require('../../records/engine.js');
const { need } = require('../../records/rules.js');
const { reportZip } = require('./zip.js');

function plainValue(f, v) {
  if (v === '' || v == null || (Array.isArray(v) && !v.length)) return '—';
  if (f.type === 'table') return v.map((row, i) => `${i + 1}. ` + f.cols.map(c => `${c.label}: ${c.type === 'user' ? userLabel(row[c.k]) : row[c.k] || '–'}`).join('; ')).join('\n');
  if (f.type === 'checklist') return f.rows.map(r => `${r}: ${(v[r] || {}).v || '–'}${(v[r] || {}).r ? ' (' + v[r].r + ')' : ''}`).join('\n');
  if (f.type === 'user' || f.fmt === 'user') return userLabel(v);
  if (f.optionLabels && f.optionLabels[v]) return f.optionLabels[v];
  if ((f.type === 'date' || f.fmt === 'date') && /^\d{4}-\d{2}-\d{2}/.test(v)) return dmyText(v);
  return String(fmt(v));
}
async function reportPdf(user, rec) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const mod = MODULES[rec.type], withAudit = canSeeAudit(user), h = contentHash(rec), d = rec.data;
  const doc = await PDFDocument.create();
  doc.setTitle(`${rec.number} – ${pdfText(d.title || mod.name)}`); doc.setAuthor(CFG.orgName); doc.setCreator('JRS eQMS'); doc.setProducer('JRS eQMS (pdf-lib)');
  const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { logo = await doc.embedPng(fs.readFileSync(path.join(PUBLIC, 'logo.png'))); } catch { /* no logo */ }
  const W = 595.28, H = 841.89, M = 40, blue = rgb(0.10, 0.40, 0.69), grey = rgb(0.38, 0.40, 0.43), lineC = rgb(0.80, 0.83, 0.86), black = rgb(0, 0, 0);
  let page, y;
  const head = (p, label) => {
    if (logo) { const hh = 26; p.drawImage(logo, { x: M, y: H - M - hh + 10, width: logo.width * hh / logo.height, height: hh }); }
    const t = pdfText(label); p.drawText(t, { x: W - M - FB.widthOfTextAtSize(t, 9.5), y: H - M - 2, size: 9.5, font: FB, color: blue });
    p.drawLine({ start: { x: M, y: H - M - 22 }, end: { x: W - M, y: H - M - 22 }, thickness: 0.8, color: blue });
  };
  const own = new Set(), attPages = new Map(); // report pages carry the header; merged attachment pages get a numbered strip
  const newPage = (label = `${mod.name} – ${rec.number}`) => { page = doc.addPage([W, H]); own.add(page); head(page, label); y = H - M - 34; };
  const ensure = (need) => { if (y - need < M + 16) newPage(); };
  const wrap = (s, font, size, width) => {
    const out = [];
    for (const para of pdfText(s).split('\n')) {
      let cur = '';
      for (let w of para.split(/ +/)) {
        while (font.widthOfTextAtSize(w, size) > width) { let i = w.length; while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--; if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, i)); w = w.slice(i); }
        const t = cur ? cur + ' ' + w : w;
        if (cur && font.widthOfTextAtSize(t, size) > width) { out.push(cur); cur = w; } else cur = t;
      }
      out.push(cur);
    }
    return out;
  };
  const text = (s, o = {}) => { const { font = F, size = 9, color = black, x = M, width = W - 2 * M } = o; for (const l of wrap(s, font, size, width)) { ensure(size + 3); page.drawText(l, { x, y: y - size, size, font, color }); y -= size + 3; } };
  const heading = (s) => { ensure(44); y -= 8; page.drawRectangle({ x: M, y: y - 17, width: W - 2 * M, height: 19, color: rgb(0.92, 0.95, 0.99) }); page.drawText(pdfText(s).slice(0, 105), { x: M + 6, y: y - 12.5, size: 10, font: FB, color: blue }); y -= 26; };
  const table = (cols, rows, size = 7.8) => {
    const tw = cols.reduce((a, c) => a + c.w, 0);
    const row = (cells, font, bg) => {
      const lines = cells.map((c, i) => wrap(c, font, size, cols[i].w - 6).slice(0, 60));
      const hgt = Math.max(1, ...lines.map(l => l.length)) * (size + 2) + 5;
      if (y - hgt < M + 16) { newPage(); if (font !== FB) row(cols.map(c => c.label), FB, rgb(0.95, 0.96, 0.97)); }
      if (bg) page.drawRectangle({ x: M, y: y - hgt, width: tw, height: hgt, color: bg });
      let x = M;
      cells.forEach((c, i) => { lines[i].forEach((l, j) => page.drawText(l, { x: x + 3, y: y - 3 - size - j * (size + 2), size, font })); page.drawRectangle({ x, y: y - hgt, width: cols[i].w, height: hgt, borderColor: lineC, borderWidth: 0.5 }); x += cols[i].w; });
      y -= hgt;
    };
    row(cols.map(c => c.label), FB, rgb(0.95, 0.96, 0.97));
    for (const r of rows) row(r.map(v => String(v ?? '')), F);
    y -= 6;
  };
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=? ORDER BY id').all(rec.id);
  const atts = db.prepare('SELECT * FROM attachments WHERE record_id=? ORDER BY ts').all(rec.id);
  const links = linked(rec.id).filter(r => canSee(user, r));
  const final = LOCKED.has(rec.status) || rec.status.startsWith('Closed');

  // ----- report -----
  newPage();
  text(`${mod.name}`, { font: F, size: 10, color: grey });
  text(rec.number, { font: FB, size: 17, color: blue });
  text(d.title || '', { font: FB, size: 11 });
  y -= 2;
  text(`Status: ${rec.status}   ·   Created by ${userLabel(rec.created_by)} on ${tsText(rec.created_at)}   ·   Report by ${user.fullname} on ${tsText(now())}`, { size: 8.5, color: grey });
  if (!final) { ensure(22); y -= 4; page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 18, color: rgb(1, 0.97, 0.88), borderColor: rgb(0.82, 0.6, 0.13), borderWidth: 0.6 }); page.drawText(pdfText(`Interim report – the record is still in progress (stage "${rec.status}").`), { x: M + 6, y: y - 12, size: 8.5, font: FB, color: rgb(0.5, 0.35, 0) }); y -= 24; }
  const LW = 170; let skip = false;
  for (const f of mod.fields) {
    if (f.type === 'section') { skip = !!(f.showIf && !f.showIf(d, rec.status)); if (!skip) heading(f.label); continue; }
    if (!f.k || skip) continue; // sections that do not apply (e.g. evaluations the risk assessment does not require)
    const lab = wrap(f.label, F, 8, LW - 8), val = wrap(plainValue(f, d[f.k]), F, 8.8, W - 2 * M - LW).slice(0, 200);
    const hgt = Math.max(lab.length * 10, val.length * 11.2) + 4;
    if (hgt < 700) ensure(hgt);
    lab.forEach((l, i) => { if (y - 8 - i * 10 > M + 16) page.drawText(l, { x: M, y: y - 8 - i * 10, size: 8, font: F, color: grey }); });
    let yy = y;
    for (const l of val) { if (yy - 11 < M + 16) { newPage(); yy = y; } page.drawText(l, { x: M + LW, y: yy - 8.8, size: 8.8, font: F }); yy -= 11.2; }
    y = Math.min(yy, y - lab.length * 10) - 4;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.3, color: lineC });
  }
  // ----- signatures, with the signer's registered signature specimen -----
  heading('Electronic signatures');
  if (!sigs.length) text('No signatures yet.', { color: grey });
  const sigImg = {};
  for (const s of sigs) {
    ensure(44);
    if (!(s.username in sigImg)) { const u = db.prepare('SELECT signature FROM users WHERE username=?').get(s.username); try { sigImg[s.username] = u && u.signature ? await doc.embedPng(Buffer.from(u.signature.split(',')[1], 'base64')) : null; } catch { sigImg[s.username] = null; } }
    const im = sigImg[s.username];
    page.drawText(pdfText(s.meaning).slice(0, 95), { x: M, y: y - 10, size: 9, font: FB });
    page.drawText(pdfText(`${s.fullname} (${s.username}) · ${tsText(s.ts)} · ${s.from_state || ''} -> ${s.to_state || ''}${s.content_hash === h ? '' : ' · signed an earlier version'}`).slice(0, 120), { x: M, y: y - 22, size: 7.8, font: F, color: grey });
    if (im) { const ih = 30, iw = Math.min(120, im.width * ih / im.height); page.drawImage(im, { x: W - M - iw, y: y - 34, width: iw, height: ih }); }
    page.drawLine({ start: { x: M, y: y - 38 }, end: { x: W - M, y: y - 38 }, thickness: 0.3, color: lineC });
    y -= 42;
  }
  // ----- attachments list and linked records -----
  heading(`Attachments (${atts.length})`);
  const merged = atts.map(a => ['pdf', 'png', 'jpg'].includes(kindOf(Buffer.from(a.blob))));
  if (atts.length) table([{ label: 'No.', w: 62 }, { label: 'Stage', w: 70 }, { label: 'File', w: 140 }, { label: 'Added by', w: 100 }, { label: 'Added', w: 85 }, { label: 'In this PDF', w: 58 }],
    atts.map((a, i) => [`Attachment ${i + 1}`, a.stage || '', a.name, userLabel(a.uploaded_by), tsText(a.ts), merged[i] ? 'Yes' : 'No – open in eQMS']));
  else text('No attachments.', { color: grey });
  heading('Linked records');
  if (links.length) table([{ label: 'Number', w: 120 }, { label: 'Module', w: 110 }, { label: 'Title', w: 200 }, { label: 'Status', w: 85 }], links.map(l => [l.number, MODULES[l.type].name, l.data.title || '', l.status]));
  else text('None.', { color: grey });

  // ----- attachments: PDF pages and images merged in -----
  for (const [i, a] of atts.entries()) {
    const buf = Buffer.from(a.blob), kind = kindOf(buf), label = `Attachment ${i + 1} – ${a.name} (stage ${a.stage || '–'})`;
    try {
      if (kind === 'pdf') {
        const src = await PDFDocument.load(buf, { ignoreEncryption: true });
        if (src.isEncrypted) throw new Error('protected PDF');
        const pages = await doc.copyPages(src, src.getPageIndices());
        for (const p of pages) { doc.addPage(p); attPages.set(p, label); }
      } else if (kind === 'png' || kind === 'jpg') {
        const im = kind === 'png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
        newPage(label);
        const maxW = W - 2 * M, maxH = H - 2 * M - 50, sc = Math.min(maxW / im.width, maxH / im.height, 1);
        page.drawImage(im, { x: M + (maxW - im.width * sc) / 2, y: H - M - 40 - im.height * sc, width: im.width * sc, height: im.height * sc });
      }
    } catch (e) {
      newPage(label); text(label, { font: FB, size: 10 });
      text(`This file could not be added to the PDF (${e.message === 'protected PDF' ? 'it is a protected / encrypted PDF' : 'unreadable file'}). Open it from the record in the eQMS.`, { color: grey });
    }
  }
  // ----- audit trail (QA, administrators, management) -----
  newPage();
  heading('Audit trail');
  if (withAudit) {
    const trail = db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id').all(rec.id);
    const lbl = (k) => { const f = mod.fields.find(x => x.k === k); return f ? f.label.split(' (')[0] : k || ''; };
    table([{ label: 'Date / time', w: 72 }, { label: 'User', w: 78 }, { label: 'Action', w: 105 }, { label: 'Field', w: 70 }, { label: 'Change', w: 125 }, { label: 'Reason', w: 65.28 }],
      trail.map(a => [tsText(a.ts), a.fullname, a.action, lbl(a.field), a.old_value != null ? `${a.old_value} -> ${a.new_value ?? ''}` : a.new_value || '', a.reason || '']), 7);
  } else text('The audit trail is included in reports produced by QA, administrators and management.', { color: grey });
  // footer on every page
  const pages = doc.getPages(), stamp = `${rec.number} · ${CFG.orgName} · ${final ? 'Final report' : 'Interim report'} · ${tsText(now())}`;
  pages.forEach((p, i) => {
    const { width, height } = p.getSize(), pn = `Page ${i + 1} of ${pages.length}`;
    if (own.has(p)) p.drawText(pn, { x: width - M - F.widthOfTextAtSize(pn, 8), y: H - M - 16, size: 8, font: F, color: grey }); // header: logo, record, page number
    else { // merged attachment page: strip with the attachment number, logo and page number
      p.drawRectangle({ x: 0, y: height - 18, width, height: 18, color: rgb(1, 1, 1), opacity: 0.9 });
      let x = 6; if (logo) { const lw = logo.width * 12 / logo.height; p.drawImage(logo, { x, y: height - 15, width: lw, height: 12 }); x += lw + 8; }
      p.drawText(pdfText(`${rec.number} · ${attPages.get(p) || ''}`).slice(0, 110), { x, y: height - 12, size: 7, font: FB, color: blue });
      p.drawText(pn, { x: width - 6 - F.widthOfTextAtSize(pn, 7), y: height - 12, size: 7, font: F, color: grey });
    }
    p.drawText(pdfText(stamp), { x: 18, y: 10, size: 6.5, font: F, color: grey });
  });
  return Buffer.from(await doc.save());
}
route('GET', '/api/records/:id/report.pdf', async (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), inline = ctx.query.get('inline') === '1';
  const buf = await reportPdf(ctx.user, rec);
  audit(ctx.user, inline ? 'Report printed (PDF)' : 'Report downloaded (PDF)', rec, null, null, `Stage ${rec.status}`, null, ctx.ip);
  const name = safeName(rec.number) + ' report.pdf';
  return { __raw: buf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^ -~]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}` } };
});
route('GET', '/api/records/:id/report', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  const buf = reportZip(ctx.user, rec);
  audit(ctx.user, 'Report downloaded', rec, null, null, `ZIP at stage ${rec.status}`, null, ctx.ip);
  return { __raw: buf, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${safeName(rec.number).replace(/[^ -~]/g, '_')} report.zip"; filename*=UTF-8''${encodeURIComponent(safeName(rec.number) + ' report.zip')}` } };
});
route('GET', '/api/export/:id', (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id));
  audit(ctx.user, 'Record exported', rec, null, null, 'JSON', null, ctx.ip);
  const out = { record: rec, signatures: db.prepare('SELECT * FROM signatures WHERE record_id=?').all(rec.id), exportedBy: ctx.user.username, exportedAt: now() };
  if (canSeeAudit(ctx.user)) out.audit = db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id').all(rec.id);
  return out;
});

module.exports = { plainValue, reportPdf };
