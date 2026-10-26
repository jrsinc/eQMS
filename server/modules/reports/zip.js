/* Full record report as ZIP. */
'use strict';
const zlib = require('node:zlib');
const { MODULES } = require('../../../public/modules.js');
const { db, now } = require('../../core/db.js');
const { csvCell, esc, safeName } = require('../../core/util.js');
const { userLabel } = require('../../core/auth.js');
const { LOCKED, canSee, canSeeAudit, contentHash, fmt, linked } = require('../../records/engine.js');

// ---------- full record report (any stage): report.html, every attachment and the audit trail, in one ZIP ----------
function zipFiles(files) { // stored with deflate, UTF-8 names; no dependencies
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'), raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8'), body = zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(h, name, body); central.push(c, name); offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
function reportValue(f, v) {
  if (v === '' || v == null || (Array.isArray(v) && !v.length)) return '<span class="empty">—</span>';
  if (f.type === 'table') return `<table><tr>${f.cols.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr>${v.map(row => `<tr>${f.cols.map(c => `<td>${esc(row[c.k])}</td>`).join('')}</tr>`).join('')}</table>`;
  if (f.type === 'checklist') return `<table>${f.rows.map(r => `<tr><td>${esc(r)}</td><td>${esc((v[r] || {}).v)}</td><td>${esc((v[r] || {}).r)}</td></tr>`).join('')}</table>`;
  if (f.type === 'user' || f.fmt === 'user') return esc(userLabel(v));
  if (f.optionLabels && f.optionLabels[v]) return esc(f.optionLabels[v]);
  return esc(fmt(v)).replace(/\n/g, '<br>');
}
function reportZip(user, rec) {
  const mod = MODULES[rec.type], h = contentHash(rec), withAudit = canSeeAudit(user);
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=? ORDER BY id').all(rec.id);
  const atts = db.prepare('SELECT * FROM attachments WHERE record_id=? ORDER BY ts').all(rec.id);
  const trail = withAudit ? db.prepare('SELECT * FROM audit WHERE record_id=? ORDER BY id').all(rec.id) : [];
  const links = linked(rec.id).filter(r => canSee(user, r));
  const files = [], attRows = atts.map((a, i) => {
    const p = `attachments/Attachment ${String(i + 1).padStart(2, '0')} - ${safeName(a.name)}`;
    files.push({ name: p, data: Buffer.from(a.blob) });
    return `<tr><td>${i + 1}</td><td>${esc(a.stage || '')}</td><td>${esc(a.name)}<br><small>${esc(p)}</small></td><td>${a.size}</td><td>${esc(userLabel(a.uploaded_by))}</td><td>${esc(a.ts.slice(0, 16).replace('T', ' '))}</td><td><small>${esc(a.sha256)}</small></td></tr>`;
  });
  let body = '', open = false;
  for (const f of mod.fields) {
    if (f.type === 'section') { body += (open ? '</table>' : '') + `<h2>${esc(f.label)}</h2><table class="kv">`; open = true; continue; }
    if (!open) { body += '<table class="kv">'; open = true; }
    body += `<tr><th>${esc(f.label)}</th><td>${reportValue(f, rec.data[f.k])}</td></tr>`;
  }
  if (open) body += '</table>';
  const final = LOCKED.has(rec.status) || rec.status.startsWith('Closed');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rec.number)} report</title><style>
body{font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#1b1f24;margin:24px;max-width:1000px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #1f4e79;color:#1f4e79}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border:1px solid #c9d1d9;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f3f6f9}.kv th{width:34%;font-weight:600}
.meta{color:#555;margin-bottom:12px}.banner{padding:8px 10px;margin:10px 0;border:1px solid #d29922;background:#fff8e5}.empty{color:#999}small{color:#666;word-break:break-all}
@media print{body{margin:0}h2{break-after:avoid}}</style></head><body>
<h1>${esc(mod.name)} – ${esc(rec.number)}</h1>
<div class="meta">${esc(rec.data.title || '')}<br>Status: <b>${esc(rec.status)}</b> · Created by ${esc(userLabel(rec.created_by))} on ${esc(rec.created_at.slice(0, 10))} · Report generated by ${esc(user.fullname)} on ${esc(now().slice(0, 16).replace('T', ' '))} UTC</div>
${final ? '' : '<div class="banner">Interim report – the record is still in progress (stage "' + esc(rec.status) + '").</div>'}
${body}
<h2>Electronic signatures</h2>${sigs.length ? `<table><tr><th>Meaning</th><th>Name</th><th>User ID</th><th>Date / time (UTC)</th><th>Stage</th><th>Valid for current content</th></tr>${sigs.map(x => `<tr><td>${esc(x.meaning)}</td><td>${esc(x.fullname)}</td><td>${esc(x.username)}</td><td>${esc(x.ts.slice(0, 19).replace('T', ' '))}</td><td>${esc(x.from_state)} → ${esc(x.to_state)}</td><td>${x.content_hash === h ? 'Yes' : 'Signed an earlier version'}</td></tr>`).join('')}</table>` : '<p class="empty">No signatures yet.</p>'}
<h2>Attachments (${atts.length})</h2>${atts.length ? `<table><tr><th>#</th><th>Stage</th><th>File (path in this ZIP)</th><th>Bytes</th><th>Added by</th><th>Added (UTC)</th><th>SHA-256</th></tr>${attRows.join('')}</table>` : '<p class="empty">No attachments.</p>'}
<h2>Linked records</h2>${links.length ? `<table><tr><th>Number</th><th>Module</th><th>Title</th><th>Status</th></tr>${links.map(l => `<tr><td>${esc(l.number)}</td><td>${esc(MODULES[l.type].name)}</td><td>${esc(l.data.title || '')}</td><td>${esc(l.status)}</td></tr>`).join('')}</table>` : '<p class="empty">None.</p>'}
<h2>Audit trail</h2>${withAudit ? `<table><tr><th>Date / time (UTC)</th><th>User</th><th>Action</th><th>Field</th><th>Old value</th><th>New value</th><th>Reason</th></tr>${trail.map(a => `<tr><td>${esc(a.ts.slice(0, 19).replace('T', ' '))}</td><td>${esc(a.fullname)}</td><td>${esc(a.action)}</td><td>${esc(a.field || '')}</td><td>${esc(a.old_value || '')}</td><td>${esc(a.new_value || '')}</td><td>${esc(a.reason || '')}</td></tr>`).join('')}</table>` : '<p class="empty">The audit trail is included in reports downloaded by QA, administrators and management.</p>'}
</body></html>`;
  files.unshift({ name: `${safeName(rec.number)} report.html`, data: html });
  if (withAudit) files.push({ name: 'audit-trail.csv', data: '\ufeff' + [['ID', 'Date / time (UTC)', 'User ID', 'Name', 'Action', 'Field', 'Old value', 'New value', 'Reason', 'Hash'],
    ...trail.map(a => [a.id, a.ts, a.username, a.fullname, a.action, a.field, a.old_value, a.new_value, a.reason, a.hash])].map(r => r.map(csvCell).join(',')).join('\r\n') });
  return zipFiles(files);
}

module.exports = { zipFiles, reportValue, reportZip };
