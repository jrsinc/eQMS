/* HTTP server and start-up migrations. */
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { CFG, PUBLIC } = require('./core/config.js');
const { db, now } = require('./core/db.js');
const { audit } = require('./core/audit.js');
const { HttpError, SEC_HEADERS, fail, readBody, routes, send } = require('./core/http.js');
const { getUser } = require('./core/auth.js');
const { DERIVE, rowToRecord, saveRecord, setActor, snapshot } = require('./records/engine.js');
const { generateList } = require('./modules/randomization/lists.js');
const { hashPw } = require('./core/passwords.js');
const { loadDepartments } = require('./org/departments.js');
// every area registers its API routes when loaded; the order is the order in which routes are matched
for (const m of ['core/mail', 'core/pdf', 'records/rules', 'modules/notifications/notify', 'modules/notifications/routes', 'integrations/sharepoint',
  'modules/system/routes', 'modules/org/routes', 'modules/users/routes', 'modules/records/routes', 'modules/documents/issuance', 'modules/randomization/routes',
  'modules/audit-trail/routes', 'modules/reports/zip', 'modules/issued-forms/routes', 'modules/supply-chain/routes', 'modules/controlled-documents/store',
  'modules/controlled-documents/routes', 'modules/backup/routes', 'modules/reports/pdf']) require('./' + m + '.js');

// ---------- HTTP server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!url.pathname.startsWith('/api/')) {
    let p = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!p.startsWith(PUBLIC) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC_HEADERS });
    return fs.createReadStream(p).pipe(res);
  }
  try {
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) fail(404, 'Not found');
    const ctx = { params: url.pathname.match(r.re).groups || {}, query: url.searchParams, ip, body: {} };
    if (!r.opts.public) {
      ctx.user = getUser(req); if (!ctx.user) fail(401, 'Session expired. Sign in again.');
      if (req.method !== 'GET' && req.headers['x-csrf-token'] !== ctx.user.csrf) fail(403, 'Security token missing. Reload the page.');
      if (req.method !== 'GET' && ctx.user.roles.every(r => r === 'extaud') && !['/api/logout', '/api/password', '/api/esig-accept'].includes(url.pathname))
        fail(403, 'Read-only access: external auditors and inspectors cannot change records.');
    }
    if (r.opts.rawBody) ctx.raw = await readBody(req, r.opts.rawBody, true); // file upload sent as is (backup restore)
    else if (req.method === 'POST' || req.method === 'PUT') ctx.body = await readBody(req);
    setActor({ user: ctx.user || null, reason: String(ctx.body.reason || '').slice(0, 500) });
    const out = await r.handler(ctx);
    const headers = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
    if (out && out.__raw) return send(res, 200, out.__raw, { ...out.headers, ...headers });
    send(res, 200, out ?? { ok: true }, headers);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    send(res, e instanceof HttpError ? e.code : 500, { error: e instanceof HttpError ? e.message : 'Unexpected server error', ...(e instanceof HttpError && e.extra ? e.extra : {}) });
  }
});
const STATE_MAP = { vendors: { Prospective: 'Risk Assessment', 'Under Qualification': 'Under Quality Review', 'Conditionally Approved': 'Approved', 'Under QA Review': 'Risk Assessment', Evaluation: 'Under Quality Review', Suspended: 'On Hold', Disqualified: 'Rejected' }, customers: { Pending: 'Under QA Review', Requested: 'Under QA Review', Blocked: 'On Hold' }, investigations: { Initiated: 'Initiation', 'Number Assignment': 'Requested', 'QA Assessment': 'QA Review', 'Pre-Approval': 'QA Review', Evaluation: 'QA Evaluation' }, changes: { 'Number Assignment': 'Draft', Requested: 'Draft', Initiation: 'Draft', 'QA Assessment': 'QA Review', 'Pre-Approval': 'RP Review', 'Pending Closure': 'QA Closure Review' } };
for (const [type, map] of Object.entries(STATE_MAP)) for (const r of db.prepare(`SELECT * FROM records WHERE type=? AND status IN (${Object.keys(map).map(() => '?').join(',')})`).all(type, ...Object.keys(map)).map(rowToRecord)) {
  const from = r.status; r.status = map[from]; r.data.stateEnteredAt = now();
  setActor({ user: null, reason: 'Workflow updated' }); if (DERIVE[type]) DERIVE[type](r); saveRecord(r);
  audit(null, 'Status changed (workflow updated)', r, 'status', from, r.status, 'Workflow updated: departments and organogram');
}
// records that existed before version history was introduced get a baseline version 1 (once)
for (const r of db.prepare('SELECT * FROM records WHERE id NOT IN (SELECT DISTINCT record_id FROM versions)').all().map(rowToRecord)) {
  setActor({ user: null, reason: 'Baseline – version history started for an existing record' }); snapshot(r);
}
setActor(null);
const start = () => server.listen(CFG.port, CFG.host, () => console.log(`eQMS listening on http://${CFG.host}:${CFG.port}`));

module.exports = { server, start, generateList, db, audit, hashPw, now, loadDepartments }; // internals for maintenance scripts (scripts/)
