/* Backup and restore. */
'use strict';
// ---------- backup and restore (system administrators) ----------
const isSysAdmin = () => !!ME && ME.roles.includes('admin');
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const countsText = (c) => c ? `${c.records ?? '–'} records · ${c.attachments ?? '–'} attachments · ${c.users ?? '–'} users · ${c.audit ?? '–'} audit trail entries · ${c.cforms ?? '–'} controlled forms / SOPs` : '';
async function backupView() {
  if (!isSysAdmin()) return dashboard();
  const log = await api('GET', '/api/admin/backups/log');
  shell('backup', `<h1>Backup and restore</h1><p class="muted">For system administrators. A backup is one file (.jrsbak) with the whole database: records, attachments, signatures, users, audit trail, controlled forms and SOPs and issued copies. Give the same file back here to restore it.</p>
    <div class="panel"><h2>Take a backup</h2><p>Downloads <span class="mono">JRS-eQMS-backup-&lt;date-time&gt;.jrsbak</span>. The file includes a checksum, so a damaged or changed file is refused at restore. Keep it somewhere safe: it contains every record and the users' password hashes.</p>
      <a class="btn primary" id="bkdl" href="/api/admin/backup" download>Download backup</a></div>
    <div class="panel"><h2>Restore from a backup</h2><p>Choose a .jrsbak file. It is checked first and nothing changes until you confirm. Before restoring, the current database is kept in <span class="mono">data/backup</span> on the server. Everyone, including you, is signed out after the restore.</p>
      <div class="row"><input type="file" id="bkf" accept=".jrsbak"><button class="btn" id="bkc">Check file</button></div><div id="bkr" style="margin-top:.8rem"></div></div>
    <div class="panel"><h2>Backup and restore log</h2>${log.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Date / time</th><th>By</th><th>Action</th><th>Details</th><th>Reason</th></tr></thead><tbody>${log.map(a => `<tr><td class="small">${dmyt(a.ts)}</td><td>${esc(a.fullname)}</td><td>${esc(a.action)}</td><td class="small">${esc(a.new_value || '')}${a.old_value ? `<br><span class="muted">${esc(a.old_value)}</span>` : ''}</td><td class="small">${esc(a.reason || '')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No backups taken yet.</p>'}</div>`);
  $('#bkdl').addEventListener('click', () => setTimeout(() => route(), 1500)); // the download is logged: show it in the log
  $('#bkc').addEventListener('click', async () => {
    const file = $('#bkf').files[0], out = $('#bkr'); if (!file) return toast('Choose the backup file first.');
    out.innerHTML = `<p class="muted">Checking ${esc(file.name)} (${mb(file.size)})…</p>`;
    try {
      const r = await fetch('/api/admin/restore/check', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': ME.csrf }, body: file });
      resetIdle(); const c = await r.json(); if (!r.ok) throw new Error(c.error || 'Check failed');
      const h = c.header;
      out.innerHTML = `<table class="kv"><tbody><tr><th>Backup taken</th><td>${dmyt(h.createdAt)} by ${esc(h.createdByName || h.createdBy)}${h.org ? ' · ' + esc(h.org) : ''}</td></tr>
        <tr><th>File check</th><td><span class="pill done">Checksum OK</span> <span class="pill ${c.integrity ? 'done' : 'bad'}">Database integrity ${c.integrity ? 'OK' : 'failed'}</span> <span class="pill ${c.audit.ok ? 'done' : 'bad'}">Audit trail ${c.audit.ok ? 'intact' : 'broken'}</span></td></tr>
        <tr><th>In the backup</th><td>${countsText(c.counts)}</td></tr><tr><th>Now in the system</th><td>${countsText(c.current)}</td></tr>
        <tr><th>Active administrators in the backup</th><td>${c.admins}${c.admins ? '' : ' <span class="pill bad">No administrator – nobody could take backups after the restore</span>'}</td></tr></tbody></table>
        <div class="row" style="margin-top:.8rem"><button class="btn danger" id="bkgo">Restore this backup…</button></div>`;
      $('#bkgo').addEventListener('click', async () => {
        if (!(await ensureEsigAccepted())) return;
        const ok = await modal({ title: 'Restore the database', ok: 'Sign and restore', okClass: 'danger', html: `<p>All current data is replaced by the backup of <b>${dmyt(h.createdAt)}</b>. Changes made since then are removed from the system (the current database is kept in data/backup). Everyone is signed out.</p>
          <div><label class="f">Reason <span class="req">*</span></label><textarea name="reason" rows="2"></textarea></div>
          <div><label class="f">Type RESTORE to confirm <span class="req">*</span></label><input type="text" name="confirm" autocomplete="off"></div>${cdSigHtml('Database restored from backup – administrator')}`,
          onOk: (fm) => api('POST', '/api/admin/restore', { token: c.token, reason: val(fm, 'reason'), confirm: val(fm, 'confirm'), ...cdSig(fm) }) });
        if (ok) { ME = null; clearInterval(idleTimer); renderLogin(`Database restored from the backup of ${dmyt(h.createdAt)}. Sign in again.`); }
      });
    } catch (x) { out.innerHTML = `<p class="error">${esc(x.message)}</p>`; }
  });
}

