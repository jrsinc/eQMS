/* SharePoint publishing (Microsoft Graph). */
'use strict';
const { CFG } = require('../core/config.js');
const { db } = require('../core/db.js');
const { esc } = require('../core/util.js');
const { audit } = require('../core/audit.js');
const { fail, route } = require('../core/http.js');
const { hasRole } = require('../core/auth.js');
const { getRecord, saveRecord } = require('../records/engine.js');

// ---------- SharePoint (Microsoft Graph) ----------
async function spToken() {
  const { tenant, clientId, secret } = CFG.sp;
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  const j = await r.json(); if (!r.ok) fail(502, 'SharePoint authentication failed: ' + (j.error_description || r.status));
  return j.access_token;
}
function renderDocHtml(rec, sigs) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const d = rec.data;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(rec.number)} ${esc(d.title)}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;max-width:800px;margin:2rem auto;line-height:1.5}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 8px;text-align:left}pre{white-space:pre-wrap;font-family:inherit}</style></head><body>
<table><tr><th>Document no.</th><td>${esc(rec.number)}</td><th>Version</th><td>${esc(d.version)}</td></tr>
<tr><th>Title</th><td colspan="3">${esc(d.title)}</td></tr><tr><th>Effective date</th><td>${esc(d.effectiveDate)}</td><th>Next review</th><td>${esc(d.nextReview)}</td></tr></table>
<pre>${esc(d.content)}</pre><h3>Electronic signatures</h3><table><tr><th>Name</th><th>Meaning</th><th>Date/time (UTC)</th></tr>
${sigs.map(s => `<tr><td>${esc(s.fullname)}</td><td>${esc(s.meaning)}</td><td>${esc(s.ts)}</td></tr>`).join('')}</table>
<p><em>Published from ${esc(CFG.orgName)} eQMS. Controlled copy is the eQMS record; printed copies are uncontrolled.</em></p></body></html>`;
}

// SharePoint
route('POST', '/api/sharepoint/publish/:id', async (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'documents' || rec.status !== 'Effective') fail(409, 'Only effective documents can be published.');
  if (!hasRole(ctx.user, ['qa', 'admin'])) fail(403, 'QA or administrator role required.');
  if (!(CFG.sp.tenant && CFG.sp.clientId && CFG.sp.secret && CFG.sp.siteId)) fail(501, 'SharePoint is not configured. Set SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET and SP_SITE_ID in .env.');
  const token = await spToken();
  const sigs = db.prepare('SELECT * FROM signatures WHERE record_id=?').all(rec.id);
  const file = `${rec.number}_v${rec.data.version}.html`.replace(/[^\w.-]/g, '_');
  const url = `https://graph.microsoft.com/v1.0/sites/${CFG.sp.siteId}/drive/root:/${encodeURIComponent(CFG.sp.folder)}/${file}:/content`;
  const r = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/html' }, body: renderDocHtml(rec, sigs) });
  const j = await r.json(); if (!r.ok) fail(502, 'SharePoint upload failed: ' + (j.error && j.error.message || r.status));
  const old = rec.data.sharepointUrl; rec.data.sharepointUrl = j.webUrl; saveRecord(rec);
  audit(ctx.user, 'Published to SharePoint', rec, 'sharepointUrl', old, j.webUrl, null, ctx.ip);
  return { webUrl: j.webUrl };
});

module.exports = { spToken, renderDocHtml };
