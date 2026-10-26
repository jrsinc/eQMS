/* Controlled forms and SOPs API. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
// pdf-lib 1.17.1 (MIT, vendor/pdf-lib.LICENSE.md), vendored so the app installs no npm packages
const PDFLib = require('../../../vendor/pdf-lib.min.js');
const { ROLES } = require('../../../public/modules.js');
const { CFG, PUBLIC } = require('../../core/config.js');
const { db, now, sha256, uid } = require('../../core/db.js');
const { dmyText, kindOf, pdfText, today, tsText } = require('../../core/util.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { userLabel, verifySignature } = require('../../core/auth.js');
const { PDF_VIEW_ONLY, lockPdf, stampPages } = require('../../core/pdf.js');
const { nextIssueNo } = require('../issued-forms/routes.js');
const { CD, CD_VERSION, ROLE_KEYS, cdCanSee, cdNotify, cdRecordSig, cdRoles, cdSign, cfCurrent, cfFile, cfNeedReason, cfPending, cfVersionRow, isQa, needQa } = require('./store.js');

for (const K of Object.values(CD)) {
  const get = (id) => { const f = db.prepare('SELECT * FROM cforms WHERE id=? AND kind=?').get(id, K.kind); if (!f) fail(404, `${K.Noun} not found`); return f; };
  const sec = (s) => { const i = K.sections.indexOf(s); return i < 0 ? 99 : i; }; // sections in the order of JRS/FRM/QAS/048
  const effectiveList = () => db.prepare('SELECT * FROM cforms WHERE kind=?').all(K.kind).sort((a, b) => sec(a.section) - sec(b.section) || a.number.localeCompare(b.number));

  route('GET', K.base, (ctx) => {
    const qa = isQa(ctx.user), rows = effectiveList().filter(f => cdCanSee(ctx.user, f));
    const issued = qa ? Object.fromEntries(db.prepare('SELECT form_code, COUNT(*) n FROM form_issues GROUP BY form_code').all().map(r => [r.form_code, r.n])) : {};
    return rows.map(f => { const v = cfCurrent(f.id); return { id: f.id, number: f.number, title: f.title, section: f.section, sop: f.sop, status: f.status,
      version: v.version, effectiveDate: v.effective_date, hasMaster: !!v.master_name, hasInuse: !!v.inuse_name, issued: issued[f.number] || 0, roles: qa && K.kind === 'sop' ? cdRoles(f) : undefined }; });
  });
  // master list (List of Controlled Documents): issued by QA with the e-signature and a purpose; numbered, blue issue stamp,
  // recorded in the issued forms register and the audit trail
  route('GET', K.base + '/master-list/issues', (ctx) => {
    needQa(ctx.user, `sees the issues of the list of controlled ${K.noun}s`);
    return db.prepare('SELECT no, issued_name, issued_by, purpose, ts FROM form_issues WHERE form_code=? AND form_title=? ORDER BY ts DESC, no DESC').all('JRS/FRM/QAS/048', K.listTitle).map(r => ({ ...r, issued_by: userLabel(r.issued_by) }));
  });
  route('POST', K.base + '/master-list', async (ctx) => {
    needQa(ctx.user, `issues the list of controlled ${K.noun}s`);
    const purpose = String(ctx.body.purpose || '').trim(); if (!purpose) fail(400, 'Enter the purpose of the issue.');
    verifySignature(ctx.user, ctx.body);
    const rows = effectiveList().filter(f => f.status === 'Effective').map(f => ({ ...f, v: cfCurrent(f.id) })), stamp = now(), no = nextIssueNo(), name = `${K.listTitle.replace(' – ', ' - ')} ${no}`; // header-safe file name
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create(), F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
    let logo = null; try { logo = await doc.embedPng(fs.readFileSync(path.join(PUBLIC, 'logo.png'))); } catch { /* no logo */ }
    const W = 612, H = 792, M = 40, cols = [['Sr. no.', 40], ['Document number', 120], ['Document title', 242], ['Version', 60], ['Effective date', 70]];
    const grid = rgb(0.6, 0.63, 0.67), shade = rgb(0.92, 0.94, 0.97), grey = rgb(0.38, 0.40, 0.43);
    let page, y;
    const wrap = (s, w) => { const out = []; let cur = ''; for (const word of pdfText(s).split(/ +/)) { const t = cur ? cur + ' ' + word : word; if (cur && F.widthOfTextAtSize(t, 8.5) > w) { out.push(cur); cur = word; } else cur = t; } out.push(cur); return out; };
    const row = (cells, o = {}) => {
      const lines = cells.map((c, j) => o.span ? [pdfText(c)] : wrap(c, cols[j][1] - 8)), h = Math.max(...lines.map(l => l.length)) * 11 + 5;
      if (y - h < M + 24) newPage();
      if (o.span) { page.drawRectangle({ x: M, y: y - h, width: W - 2 * M, height: h, color: shade, borderColor: grid, borderWidth: 0.5 }); const t = pdfText(cells[0]).toUpperCase(); page.drawText(t, { x: (W - FB.widthOfTextAtSize(t, 8.5)) / 2, y: y - 11, size: 8.5, font: FB }); y -= h; return; }
      let x = M; cols.forEach(([, w], j) => { page.drawRectangle({ x, y: y - h, width: w, height: h, color: o.head ? shade : undefined, borderColor: grid, borderWidth: 0.5 }); lines[j].forEach((l, k) => page.drawText(l, { x: x + 4, y: y - 11 - k * 11, size: 8.5, font: o.head ? FB : F })); x += w; });
      y -= h;
    };
    const newPage = () => {
      page = doc.addPage([W, H]); y = H - M;
      if (logo) page.drawImage(logo, { x: M, y: y - 34, width: logo.width * 34 / logo.height, height: 34 });
      [['FORM NUMBER', 'JRS/FRM/QAS/048'], ['FORM TITLE', 'List of Controlled documents'], ['RELATED SOP', 'JRS/SOP/QAS/021']].forEach(([k, v], i) => { page.drawText(k, { x: 330, y: y - 8 - i * 11, size: 7.5, font: FB }); page.drawText(v, { x: 420, y: y - 8 - i * 11, size: 7.5, font: F }); });
      y -= 48; const t = pdfText(K.listTitle).toUpperCase(); page.drawText(t, { x: (W - FB.widthOfTextAtSize(t, 11)) / 2, y: y - 4, size: 11, font: FB }); y -= 14;
      page.drawText(pdfText(`Applicable site: ${CFG.orgName} · issued copy ${no} · ${tsText(stamp)} by ${ctx.user.fullname} · ${rows.length} effective ${K.noun}s`), { x: M, y: y - 4, size: 7.5, font: F, color: grey }); y -= 12;
      row(['Sr. no.', 'Document number', 'Document title', 'Version number', 'Effective date'], { head: true });
    };
    newPage(); let section = null;
    rows.forEach((r, i) => { if (r.section !== section) { section = r.section; row([section || 'Other'], { span: true }); } row([`${i + 1}.`, r.number, r.title, 'Version ' + r.v.version, dmyText(r.v.effective_date)]); });
    const pages = doc.getPages(); pages.forEach((p, i) => { const s = `CONFIDENTIAL · Page ${i + 1} of ${pages.length}`; p.drawText(s, { x: (W - F.widthOfTextAtSize(s, 7.5)) / 2, y: 20, size: 7.5, font: F, color: grey }); });
    await stampPages(doc, [`ISSUED COPY – ${no}`, `JRS/FRM/QAS/048 · ${rows.length} effective ${K.noun}s · ${dmyText(stamp)}`, `Issued by ${ctx.user.fullname} · ${purpose}`], 'blue');
    doc.setTitle(`${K.listTitle} – issued copy ${no}`);
    db.prepare('INSERT INTO form_issues (no,form_code,form_title,record_id,record_number,record_title,issued_to,issued_name,dept,ts,pdf,purpose,form_version,issued_by,copy_label) VALUES (?,?,?,NULL,NULL,NULL,?,?,?,?,NULL,?,?,?,?)')
      .run(no, 'JRS/FRM/QAS/048', K.listTitle, ctx.user.username, ctx.user.fullname, ctx.user.department || '', stamp, purpose, '1.0', ctx.user.username, `${rows.length} entries`);
    db.prepare('INSERT INTO signatures (record_id,username,fullname,meaning,from_state,to_state,ts,content_hash) VALUES (?,?,?,?,?,?,?,?)')
      .run('cd:masterlist:' + K.kind, ctx.user.username, ctx.user.fullname, `${K.listTitle} issued – QA`, null, no, stamp, sha256(rows.map(r => `${r.number}|${r.v.version}|${r.v.effective_date}`).join('|')));
    audit(ctx.user, `Master list issued (${no})`, null, 'cforms', null, `${K.listTitle}: ${rows.length} effective ${K.noun}s, e-signed`, purpose, ctx.ip);
    return { __raw: Buffer.from(await doc.save()), headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'X-Issue-Numbers': no } };
  });
  route('GET', K.base + '/:id', (ctx) => {
    const f = get(ctx.params.id), qa = isQa(ctx.user);
    if (!cdCanSee(ctx.user, f)) fail(404, `${K.Noun} not found`);
    const cur = cfCurrent(f.id), versions = db.prepare('SELECT * FROM cform_versions WHERE form_id=? ORDER BY id DESC').all(f.id);
    return { id: f.id, kind: f.kind, number: f.number, title: f.title, section: f.section, sop: f.sop, status: f.status, createdAt: f.created_at, updatedAt: f.updated_at, canEdit: qa,
      roles: K.kind === 'sop' ? cdRoles(f) : undefined, canView: K.kind === 'sop' && !!cur.inuse_name && f.status === 'Effective',
      current: cfVersionRow(cur, qa), pending: qa ? cfVersionRow(cfPending(f.id), true) || null : undefined,
      // version history, signatures and issue record: QA only
      versions: qa ? versions.map(v => cfVersionRow(v, true)) : undefined,
      signatures: qa ? db.prepare('SELECT username,fullname,meaning,ts FROM signatures WHERE record_id=? ORDER BY id DESC').all('cd:' + f.id) : undefined,
      issues: qa ? db.prepare('SELECT no,form_version,issued_to,issued_name,dept,issued_by,purpose,copy_label,copy_type,expiry,ts FROM form_issues WHERE form_code=? ORDER BY ts DESC, no DESC').all(f.number)
        .map(r => ({ ...r, issued_by: r.issued_by ? userLabel(r.issued_by) : '' })) : undefined };
  });
  route('POST', K.base, (ctx) => {
    needQa(ctx.user, `adds ${K.noun}s to the list of controlled ${K.noun}s`);
    const b = ctx.body, number = String(b.number || '').trim().toUpperCase(), title = String(b.title || '').trim(), version = String(b.version || '').trim();
    if (!K.number.test(number)) fail(400, `${K.Noun} number: use the format ${K.example}.`);
    if (!title) fail(400, `Enter the ${K.noun} title.`);
    if (!CD_VERSION.test(version)) fail(400, 'Version: use the format 1.0.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveDate || '')) fail(400, 'Enter the effective date.');
    if (db.prepare('SELECT 1 FROM cforms WHERE number=?').get(number)) fail(409, `${number} is already in the list. Numbers of obsolete documents are not reused.`);
    const roles = K.kind === 'sop' ? cdRoleList(b.roles) : null;
    const master = cfFile(b.master, 'master', K), inuse = cfFile(b.inuse, 'inuse', K), id = uid(), ts = now();
    verifySignature(ctx.user, b);
    db.prepare('INSERT INTO cforms (id,number,title,section,sop,status,created_by,created_at,updated_at,kind,roles) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, number, title, String(b.section || '').slice(0, 120), String(b.sop || '').trim().slice(0, 60), 'Effective', ctx.user.username, ts, ts, K.kind, roles ? JSON.stringify(roles) : null);
    db.prepare('INSERT INTO cform_versions (form_id,version,effective_date,status,change_note,master_name,master,master_sha,inuse_name,inuse,inuse_sha,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, version, b.effectiveDate, 'Effective', String(b.changeNote || `New ${K.noun}`).slice(0, 500), master?.name ?? null, master?.buf ?? null, master?.sha ?? null, inuse?.name ?? null, inuse?.buf ?? null, inuse?.sha ?? null, ctx.user.username, ts);
    cdRecordSig(ctx, get(id), `${K.label} added – QA`);
    audit(ctx.user, `${K.label} added`, null, 'cform', null, `${number} v${version} ${title} (effective ${b.effectiveDate})${roles ? '; access: ' + roleText(roles) : ''}`, b.changeNote || `New ${K.noun}`, ctx.ip);
    return { id, number };
  });
  route('PUT', K.base + '/:id', (ctx) => {
    needQa(ctx.user, `changes the list of controlled ${K.noun}s`);
    const f = get(ctx.params.id), v = cfCurrent(f.id), b = ctx.body, reason = cfNeedReason(b.reason);
    if (f.status !== 'Effective') fail(409, `${f.number} is ${f.status}.`);
    const next = { title: b.title !== undefined ? String(b.title).trim() : f.title, section: b.section !== undefined ? String(b.section) : f.section, sop: b.sop !== undefined ? String(b.sop).trim() : f.sop };
    if (!next.title) fail(400, `Enter the ${K.noun} title.`);
    const eff = b.effectiveDate !== undefined ? String(b.effectiveDate) : v.effective_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) fail(400, 'Enter the effective date.');
    const roles = K.kind === 'sop' && b.roles !== undefined ? cdRoleList(b.roles) : null, oldRoles = cdRoles(f);
    const changed = ['title', 'section', 'sop'].filter(k => (next[k] || '') !== (f[k] || ''));
    const effChanged = eff !== v.effective_date, rolesChanged = roles && roles.slice().sort().join() !== oldRoles.slice().sort().join();
    if (!changed.length && !effChanged && !rolesChanged) return { changes: 0 };
    cdSign(ctx, f, `${K.label} changed – QA`);
    for (const k of changed) audit(ctx.user, `${K.label} changed`, null, k, f[k], next[k], `${f.number}: ${reason}`, ctx.ip);
    if (effChanged) audit(ctx.user, `${K.label} changed`, null, 'effectiveDate', v.effective_date, eff, `${f.number} v${v.version}: ${reason}`, ctx.ip);
    if (rolesChanged) audit(ctx.user, 'SOP access changed', null, 'roles', roleText(oldRoles), roleText(roles), `${f.number}: ${reason}`, ctx.ip);
    db.prepare('UPDATE cforms SET title=?,section=?,sop=?,roles=?,updated_at=? WHERE id=?').run(next.title, next.section, next.sop, roles ? JSON.stringify(roles) : f.roles, now(), f.id);
    db.prepare('UPDATE cform_versions SET effective_date=? WHERE id=?').run(eff, v.id);
    return { changes: changed.length + (effChanged ? 1 : 0) + (rolesChanged ? 1 : 0) };
  });
  // signed master / in-use file of the current version (replacing one needs a reason; the old file stays in the audit trail by checksum)
  route('POST', K.base + '/:id/files', (ctx) => {
    needQa(ctx.user, 'attaches the signed master and the in-use file');
    const f = get(ctx.params.id), v = cfCurrent(f.id), kind = ctx.body.kind;
    if (!['master', 'inuse'].includes(kind)) fail(400, `Choose the signed master or the ${K.inuse}.`);
    if (f.status !== 'Effective') fail(409, `${f.number} is ${f.status}.`);
    const file = cfFile(ctx.body, kind, K); if (!file) fail(400, 'Choose a file.');
    const old = v[kind + '_name'], reason = old ? cfNeedReason(ctx.body.reason) : ctx.body.reason || null;
    const label = kind === 'master' ? 'Signed master' : K.inuse.charAt(0).toUpperCase() + K.inuse.slice(1);
    verifySignature(ctx.user, ctx.body);
    db.prepare(`UPDATE cform_versions SET ${kind}_name=?, ${kind}=?, ${kind}_sha=? WHERE id=?`).run(file.name, file.buf, file.sha, v.id);
    cdRecordSig(ctx, f, `${label} ${old ? 'replaced' : 'attached'} – QA`);
    audit(ctx.user, `${label} ${old ? 'replaced' : 'attached'}`, null, 'cform', old ? `${old} (SHA-256 ${v[kind + '_sha'].slice(0, 16)}…)` : null, `${f.number} v${v.version}: ${file.name} (SHA-256 ${file.sha.slice(0, 16)}…)`, reason, ctx.ip);
    return { sha256: file.sha };
  });
  // files of any version: QA only. PDFs of superseded and obsolete versions carry a red stamp.
  route('GET', K.base + '/:id/versions/:vid/:kind', async (ctx) => {
    needQa(ctx.user, 'opens the signed master and the in-use file; other users work on issued copies');
    const f = get(ctx.params.id), kind = ctx.params.kind;
    const v = db.prepare('SELECT * FROM cform_versions WHERE id=? AND form_id=?').get(+ctx.params.vid, f.id);
    if (!v || !['master', 'inuse'].includes(kind) || !v[kind]) fail(404, 'File not found');
    let buf = Buffer.from(v[kind]); if (sha256(buf) !== v[kind + '_sha']) fail(500, 'Integrity check failed: file checksum does not match.');
    if (['Superseded', 'Obsolete'].includes(v.status) && kindOf(buf) === 'pdf') {
      try {
        const doc = await PDFLib.PDFDocument.load(buf);
        await stampPages(doc, [`${v.status.toUpperCase()} – DO NOT USE`, `${f.number} v${v.version} · ${v.status.toLowerCase()} ${v.ended_at ? dmyText(v.ended_at) : ''}${v.end_reason ? ' · ' + v.end_reason : ''}`, `Downloaded by ${ctx.user.fullname} on ${tsText(now())}`], 'red');
        buf = Buffer.from(await doc.save());
      } catch { /* encrypted or damaged PDF: returned as stored */ }
    }
    audit(ctx.user, `${kind === 'master' ? 'Signed master' : 'In-use file'} downloaded`, null, 'cform', null, `${f.number} v${v.version} (${v.status}): ${v[kind + '_name']}`, null, ctx.ip);
    return { __raw: buf, headers: { 'Content-Type': kindOf(buf) === 'pdf' ? 'application/pdf' : 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(v[kind + '_name'])}"` } };
  });
  // new version: the previous version becomes Superseded (on the new effective date if later)
  route('POST', K.base + '/:id/versions', (ctx) => {
    needQa(ctx.user, `issues new versions of controlled ${K.noun}s`);
    const f = get(ctx.params.id), v = cfCurrent(f.id), b = ctx.body, version = String(b.version || '').trim();
    if (f.status !== 'Effective') fail(409, `${f.number} is ${f.status}. Obsolete documents cannot get a new version.`);
    const pend = cfPending(f.id);
    if (pend) fail(409, `v${pend.version} of ${f.number} is already approved and becomes effective on ${dmyText(pend.effective_date)}.`);
    if (!CD_VERSION.test(version)) fail(400, 'Version: use the format 2.0.');
    if (+version <= +v.version) fail(400, `The new version must be higher than the current version ${v.version}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveDate || '')) fail(400, 'Enter the effective date of the new version.');
    const note = cfNeedReason(b.changeNote), master = cfFile(b.master, 'master', K), inuse = cfFile(b.inuse, 'inuse', K);
    if (!master || !inuse) fail(400, `Attach the signed master and the ${K.inuse} of the new version.`);
    verifySignature(ctx.user, b);
    const ts = now(), later = b.effectiveDate > today();
    if (!later) db.prepare("UPDATE cform_versions SET status='Superseded', ended_at=?, ended_by=?, end_reason=? WHERE id=?").run(ts, ctx.user.username, `Superseded by v${version}`, v.id);
    db.prepare('INSERT INTO cform_versions (form_id,version,effective_date,status,change_note,master_name,master,master_sha,inuse_name,inuse,inuse_sha,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(f.id, version, b.effectiveDate, later ? 'Approved' : 'Effective', note, master.name, master.buf, master.sha, inuse.name, inuse.buf, inuse.sha, ctx.user.username, ts);
    if (b.title && String(b.title).trim() !== f.title) audit(ctx.user, `${K.label} changed`, null, 'title', f.title, String(b.title).trim(), `${f.number} v${version}`, ctx.ip);
    db.prepare('UPDATE cforms SET title=?, updated_at=? WHERE id=?').run(String(b.title || '').trim() || f.title, ts, f.id);
    cdRecordSig(ctx, get(f.id), `${K.label} v${version} approved – QA`);
    audit(ctx.user, `${K.label} new version`, null, 'version', later ? `v${v.version} (in use until ${b.effectiveDate})` : `v${v.version} (now Superseded)`, `${f.number} v${version} ${later ? 'approved, effective' : 'effective'} ${b.effectiveDate}`, note, ctx.ip);
    return { version, status: later ? 'Approved' : 'Effective' };
  });
  route('POST', K.base + '/:id/obsolete', (ctx) => {
    needQa(ctx.user, `makes controlled ${K.noun}s obsolete`);
    const f = get(ctx.params.id), v = cfCurrent(f.id), reason = cfNeedReason(ctx.body.reason);
    if (f.status !== 'Effective') fail(409, `${f.number} is already ${f.status}.`);
    cdSign(ctx, f, `${K.label} made obsolete – QA`, 'Obsolete');
    const ts = now();
    db.prepare("UPDATE cform_versions SET status='Obsolete', ended_at=?, ended_by=?, end_reason=? WHERE form_id=? AND status IN ('Effective','Approved')").run(ts, ctx.user.username, reason, f.id);
    db.prepare("UPDATE cforms SET status='Obsolete', updated_at=? WHERE id=?").run(ts, f.id);
    audit(ctx.user, `${K.label} made obsolete`, null, 'status', 'Effective', `${f.number} v${v.version} Obsolete`, reason, ctx.ip);
    return { status: 'Obsolete' };
  });
  // QA issues copies of the current version and signs the issue. Forms: who for, purpose and number of copies (blue stamp).
  // SOPs: controlled or uncontrolled copy, who for and until when (green stamp). Each copy gets its own issue number.
  route('POST', K.base + '/:id/issue', async (ctx) => {
    needQa(ctx.user, `issues controlled ${K.noun}s`);
    const f = get(ctx.params.id), v = cfCurrent(f.id), b = ctx.body;
    if (f.status !== 'Effective' || v.status !== 'Effective') fail(409, `${f.number} is ${f.status}: only the current effective version is issued.`);
    if (b.version && String(b.version) !== v.version) fail(409, `Only the current version v${v.version} of ${f.number} can be issued.`);
    if (v.effective_date > today()) fail(409, `${f.number} v${v.version} is effective from ${dmyText(v.effective_date)}.`); // a new entry added ahead of its date
    if (!v.inuse) fail(409, `Attach the ${K.inuse} of ${f.number} v${v.version} before issuing it.`);
    const copies = Number(b.copies), purpose = String(b.purpose || '').trim();
    if (!Number.isInteger(copies) || copies < 1 || copies > 50) fail(400, 'Number of copies: 1 to 50.');
    if (!purpose) fail(400, 'Enter the purpose of the issue.');
    const to = b.issuedTo ? db.prepare('SELECT username,fullname,department,active,roles FROM users WHERE username=?').get(String(b.issuedTo)) : null;
    if (!to || !to.active) fail(400, `Choose the person the ${K.noun}${copies > 1 ? 's are' : ' is'} issued to.`);
    let copyType = null, expiry = null;
    if (K.kind === 'sop') {
      copyType = { controlled: 'Controlled', uncontrolled: 'Uncontrolled' }[String(b.copyType || '').toLowerCase()];
      if (!copyType) fail(400, 'Choose a controlled or an uncontrolled copy.');
      expiry = String(b.expiry || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) fail(400, `Enter the expiry date of the ${copyType.toLowerCase()} copy.`);
      if (expiry < today()) fail(400, 'The expiry date cannot be in the past.');
    }
    cdSign(ctx, f, K.kind === 'sop' ? `${copyType} copy issued – QA` : 'Form copies issued – QA');
    const { PDFDocument } = PDFLib, ts = now(), out = await PDFDocument.create(), nos = []; let single = null;
    const prefix = copyType === 'Controlled' ? 'CC' : copyType === 'Uncontrolled' ? 'UC' : 'FI';
    const ins = db.prepare('INSERT INTO form_issues (no,form_code,form_title,record_id,record_number,record_title,issued_to,issued_name,dept,ts,pdf,purpose,form_version,issued_by,copy_label,copy_type,expiry) VALUES (?,?,?,NULL,NULL,NULL,?,?,?,?,NULL,?,?,?,?,?,?)');
    for (let i = 1; i <= copies; i++) {
      const doc = await PDFDocument.load(Buffer.from(v.inuse)), no = nextIssueNo(prefix); nos.push(no);
      const lines = K.kind === 'sop'
        ? [`${copyType.toUpperCase()} COPY – ${no}`, `${f.number} v${v.version} · copy ${i} of ${copies} · issued ${dmyText(ts)}`, `Issued by ${ctx.user.fullname} to ${to.fullname}`, `Valid till ${dmyText(expiry)}${copyType === 'Uncontrolled' ? ' · not updated when revised' : ''}`]
        : [`ISSUED COPY – ${no}`, `${f.number} v${v.version} · copy ${i} of ${copies} · ${dmyText(ts)}`, `Issued to ${to.fullname} by ${ctx.user.fullname}`];
      await stampPages(doc, lines, K.kind === 'sop' ? 'green' : 'blue');
      // several copies go in one PDF for printing: the form fields are flattened so the copies do not share field names
      if (copies > 1) { try { doc.getForm().flatten(); } catch { /* no form fields */ } (await out.copyPages(doc, doc.getPageIndices())).forEach(p => out.addPage(p)); }
      else single = doc;
      ins.run(no, f.number, f.title, to.username, to.fullname, to.department || '', ts, purpose, v.version, ctx.user.username, `${i} of ${copies}`, copyType, expiry);
    }
    const what = K.kind === 'sop' ? `${copyType.toLowerCase()} cop${copies > 1 ? 'ies' : 'y'}` : `cop${copies > 1 ? 'ies' : 'y'}`;
    audit(ctx.user, `${K.label} issued (${nos[0]}${nos.length > 1 ? ' – ' + nos[nos.length - 1] : ''})`, null, 'cform', null,
      `${f.number} v${v.version}: ${copies} ${what} issued to ${to.fullname}${to.department ? ' (' + to.department + ')' : ''}${expiry ? ', valid till ' + dmyText(expiry) : ''}`, purpose, ctx.ip);
    if (to.username !== ctx.user.username) cdNotify(to.username, `${copies} issued ${what} of ${f.number}`,
      `${ctx.user.fullname} issued ${f.number} v${v.version} ${f.title} to you: ${nos.join(', ')}.${expiry ? `\nValid till ${dmyText(expiry)}.` : ''}\nPurpose: ${purpose}`);
    const target = single || out; target.setTitle(`${f.number} v${v.version} – issued ${nos.join(', ')}`);
    // SOP copies cannot be copied as text or edited (printing allowed)
    const buf = K.kind === 'sop' ? await lockPdf(await target.save({ useObjectStreams: false })) : Buffer.from(await target.save());
    const name = `${f.number.replace(/\//g, '-')} v${v.version} ${nos[0]}${nos.length > 1 ? ' to ' + nos[nos.length - 1] : ''}.pdf`;
    return { __raw: buf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"`, 'X-Issue-Numbers': nos.join(',') } };
  });
}
// SOP access by role: everyone, or the roles QA chose
function cdRoleList(v) {
  const list = Array.isArray(v) ? v.map(String) : [];
  if (list.includes('all')) return ['all'];
  const roles = [...new Set(list.filter(r => ROLE_KEYS.includes(r)))];
  if (!roles.length) fail(400, 'Choose who can see the SOP: everyone or at least one role.');
  return roles;
}
const roleText = (roles) => roles.includes('all') ? 'Everyone' : roles.map(r => ROLES[r].split(' (')[0]).join(', ');
// reading an SOP on screen (users with access): view-only copy, green stamp, no printing or copying
route('GET', '/api/csops/:id/view', async (ctx) => {
  const f = db.prepare("SELECT * FROM cforms WHERE id=? AND kind='sop'").get(ctx.params.id);
  if (!f || !cdCanSee(ctx.user, f) || f.status !== 'Effective') fail(404, 'SOP not found');
  const v = cfCurrent(f.id); if (!v.inuse) fail(404, 'The SOP file has not been attached yet.');
  const doc = await PDFLib.PDFDocument.load(Buffer.from(v.inuse));
  await stampPages(doc, [`READ-ONLY – NOT A CONTROLLED COPY`, `${f.number} v${v.version} · effective ${dmyText(v.effective_date)}`, `Viewed by ${ctx.user.fullname} on ${tsText(now())}`], 'green');
  audit(ctx.user, 'Controlled SOP viewed', null, 'cform', null, `${f.number} v${v.version}`, null, ctx.ip);
  const buf = await lockPdf(await doc.save({ useObjectStreams: false }), PDF_VIEW_ONLY);
  return { __raw: buf, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${f.number.replace(/\//g, '-')} v${v.version} read-only.pdf"`, 'Cache-Control': 'no-store' } };
});

module.exports = { cdRoleList, roleText };
