/* Customer / supplier master lists and audit agenda. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
// pdf-lib 1.17.1 (MIT, vendor/pdf-lib.LICENSE.md), vendored so the app installs no npm packages
const PDFLib = require('../../../vendor/pdf-lib.min.js');
const { MODULES } = require('../../../public/modules.js');
const { CFG, PUBLIC } = require('../../core/config.js');
const { db, now } = require('../../core/db.js');
const { csvCell, dmyText, pdfText, safeName, today, tsText } = require('../../core/util.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { userLabel } = require('../../core/auth.js');
const { canSee, getRecord, hiddenFor, rowToRecord, visibleRecord } = require('../../records/engine.js');

// Master lists (qualified customers, approved supplier list JRS/FRM/QAS/005): PDF with the company header, or CSV for Excel
route('GET', '/api/master-list/:type', async (ctx) => {
  const mod = MODULES[ctx.params.type], cfg = mod && mod.masterList; if (!cfg) fail(404, 'No master list for this module.');
  if (hiddenFor(ctx.user, ctx.params.type)) fail(404, 'Not found');
  const rows = db.prepare('SELECT * FROM records WHERE type=? AND status=? AND deleted=0').all(ctx.params.type, cfg.status).map(rowToRecord)
    .filter(r => canSee(ctx.user, r)).sort((a, b) => String(a.data.title || '').localeCompare(String(b.data.title || '')));
  const val = (r, k) => k === 'number' ? r.number : /Date$/.test(k) && r.data[k] ? dmyText(r.data[k]) : String(r.data[k] ?? '');
  const stamp = now(), name = `${cfg.title.split(' –')[0]} ${stamp.slice(0, 10)}`;
  audit(ctx.user, 'Master list downloaded', null, ctx.params.type, null, `${cfg.title} (${ctx.query.get('format') === 'csv' ? 'CSV' : 'PDF'}, ${rows.length} entries)`, null, ctx.ip);
  if (ctx.query.get('format') === 'csv') {
    const csv = '\ufeff' + [['Sr. no.', ...cfg.cols.map(c => c[1])], ...rows.map((r, i) => [i + 1, ...cfg.cols.map(c => val(r, c[0]))])].map(l => l.map(csvCell).join(',')).join('\r\n');
    return { __raw: Buffer.from(csv, 'utf8'), headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}.csv"` } };
  }
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create(), F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { logo = await doc.embedPng(fs.readFileSync(path.join(PUBLIC, 'logo.png'))); } catch { /* no logo */ }
  const W = 841.89, H = 595.28, M = 36, cols = [['#', 'Sr. no.', 36], ...cfg.cols], tw = cols.reduce((a, c) => a + c[2], 0), sc = (W - 2 * M) / tw;
  const line = rgb(0.75, 0.78, 0.82), blue = rgb(0.10, 0.40, 0.69), grey = rgb(0.38, 0.40, 0.43);
  let page, y;
  const wrap = (s, w, size) => { const out = []; let cur = ''; for (const word of pdfText(s).split(/ +/)) { const t = cur ? cur + ' ' + word : word; if (cur && F.widthOfTextAtSize(t, size) > w) { out.push(cur); cur = word; } else cur = t; } out.push(cur); return out.slice(0, 6); };
  const header = () => { let x = M; page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: rgb(0.92, 0.95, 0.99) }); cols.forEach(c => { page.drawText(c[1], { x: x + 4, y: y - 12, size: 8, font: FB }); x += c[2] * sc; }); y -= 18; };
  const newPage = () => {
    page = doc.addPage([W, H]); y = H - M;
    if (logo) page.drawImage(logo, { x: M, y: y - 30, width: logo.width * 30 / logo.height, height: 30 });
    const t = pdfText(cfg.title); page.drawText(t, { x: W - M - FB.widthOfTextAtSize(t, 13), y: y - 14, size: 13, font: FB, color: blue });
    const sub = pdfText(`${cfg.code ? cfg.code + ' · ' : ''}${rows.length} ${ctx.params.type === 'vendors' ? 'approved suppliers' : 'qualified customers'} · generated ${tsText(stamp)} by ${ctx.user.fullname}`);
    page.drawText(sub, { x: W - M - F.widthOfTextAtSize(sub, 8), y: y - 28, size: 8, font: F, color: grey });
    y -= 44; header();
  };
  newPage();
  if (!rows.length) { page.drawText('No entries.', { x: M + 4, y: y - 14, size: 9, font: F, color: grey }); }
  rows.forEach((r, i) => {
    const cells = [String(i + 1), ...cfg.cols.map(c => val(r, c[0]))], lines = cells.map((v, j) => wrap(v, cols[j][2] * sc - 8, 8.5)), h = Math.max(...lines.map(l => l.length)) * 11 + 6;
    if (y - h < M + 20) newPage();
    let x = M; cells.forEach((v, j) => { lines[j].forEach((l, k) => page.drawText(l, { x: x + 4, y: y - 11 - k * 11, size: 8.5, font: F })); x += cols[j][2] * sc; });
    page.drawLine({ start: { x: M, y: y - h }, end: { x: W - M, y: y - h }, thickness: 0.4, color: line }); y -= h;
  });
  const pages = doc.getPages(); pages.forEach((p, i) => { const s = `${CFG.orgName} · ${cfg.title} · Page ${i + 1} of ${pages.length}`; p.drawText(pdfText(s), { x: M, y: 18, size: 7, font: F, color: grey }); });
  doc.setTitle(`${cfg.title} – ${stamp.slice(0, 10)}`);
  return { __raw: Buffer.from(await doc.save()), headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"` } };
});
// Audit agenda JRS/FRM/QAS/021 from the supplier record (shared with the supplier before the audit)
route('GET', '/api/records/:id/agenda.pdf', async (ctx) => {
  const rec = visibleRecord(ctx.user, getRecord(ctx.params.id)), d = rec.data;
  if (rec.type !== 'vendors') fail(400, 'Audit agendas are prepared for supplier site audits.');
  if (!d.auditDate || !(d.agenda || []).length) fail(400, 'Enter the audit date and the audit schedule first.');
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create(), F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo = null; try { logo = await doc.embedPng(fs.readFileSync(path.join(PUBLIC, 'logo.png'))); } catch { /* no logo */ }
  const W = 595.28, H = 841.89, M = 50, page = doc.addPage([W, H]); let y = H - M;
  if (logo) page.drawImage(logo, { x: M, y: y - 30, width: logo.width * 30 / logo.height, height: 30 });
  [['FORM NUMBER', 'JRS/FRM/QAS/021'], ['FORM VERSION', '1.0'], ['FORM TITLE', 'AUDIT AGENDA'], ['RELATED SOP', 'JRS/SOP/QAS/005']].forEach(([k, v], i) => { page.drawText(k, { x: 320, y: y - 6 - i * 12, size: 7.5, font: FB }); page.drawText(v, { x: 410, y: y - 6 - i * 12, size: 7.5, font: F }); });
  y -= 70;
  const line = (s, o = {}) => { page.drawText(pdfText(s).slice(0, 110), { x: o.x || M, y, size: o.size || 9.5, font: o.font || F }); y -= o.gap || 15; };
  line(`Date: ${dmyText(today())}`); line('Dear Team,'); line(`This is the audit agenda for the ${(d.auditCategory || 'supplier audit').toLowerCase()} on ${dmyText(d.auditDate)}.`, { gap: 22 });
  for (const [k, v] of [['Auditee company', rec.data.title], ['Auditee representative', d.auditeeRep], ['Purpose', d.auditPurpose], ['Audit method / location', [d.auditMethod, d.auditLocation].filter(Boolean).join(' – ')], ['Date of audit', dmyText(d.auditDate)], ['Auditors', [userLabel(d.leadAuditor) + ' (lead auditor)', d.auditTeam].filter(Boolean).join(', ')]]) {
    page.drawText(k + ':', { x: M, y, size: 9.5, font: FB }); page.drawText(pdfText(v || '–').slice(0, 85), { x: M + 140, y, size: 9.5, font: F }); y -= 16;
  }
  y -= 8; line('Audit schedule:', { font: FB });
  const cols = [['Date', 70], ['Time', 70], ['Activity / area', 230], ['Participants', 125]];
  let x = M; cols.forEach(([c, w]) => { page.drawRectangle({ x, y: y - 14, width: w, height: 16, color: rgb(0.93, 0.95, 0.98), borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 }); page.drawText(c, { x: x + 3, y: y - 9, size: 8, font: FB }); x += w; }); y -= 16;
  for (const r of d.agenda || []) { x = M; [r.date ? dmyText(r.date) : '', r.time, r.activity, r.participants].forEach((v, i) => { page.drawRectangle({ x, y: y - 14, width: cols[i][1], height: 16, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 }); page.drawText(pdfText(v || '').slice(0, i === 2 ? 50 : 26), { x: x + 3, y: y - 9, size: 8, font: F }); x += cols[i][1]; }); y -= 16; if (y < 120) break; }
  y -= 12; line('*This audit agenda can be updated as per the requirement.', { size: 8 });
  page.drawText(`${rec.number} · prepared by ${ctx.user.fullname} on ${tsText(now())}`, { x: M, y: 30, size: 7, font: F, color: rgb(0.35, 0.35, 0.35) });
  audit(ctx.user, 'Audit agenda downloaded', rec, null, null, `JRS/FRM/QAS/021 for ${dmyText(d.auditDate)}`, null, ctx.ip);
  return { __raw: Buffer.from(await doc.save()), headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${safeName(rec.number)} audit agenda.pdf"` } };
});

module.exports = {  };
