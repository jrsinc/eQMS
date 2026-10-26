/* QualiSuite eQMS server — Node.js >= 22.13, no npm dependencies.
 * Provides: authentication, role-based access, record workflows, e-signatures,
 * hash-chained audit trail, attachments with SHA-256, kit randomization,
 * label print logging, SharePoint (Microsoft Graph) publishing, static UI.
 * The code is in server/: core/ (configuration, database, audit trail, HTTP, sign-in, e-mail, PDF),
 * org/ (departments), records/ (record engine and SOP rules), modules/<area>/ (API of each area),
 * integrations/ and app.js (HTTP server and start-up). Module definitions are in public/modules/. */
'use strict';
const app = require('./server/app.js');
if (require.main === module) app.start();
module.exports = app; // internals for maintenance scripts (scripts/)
