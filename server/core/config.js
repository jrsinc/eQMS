/* Configuration from the environment / .env. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..', '..'); // project folder (.env, data, public, forms, vendor)

// ---------- configuration ----------
loadEnv(path.join(ROOT, '.env'));
const CFG = {
  port: +process.env.PORT || 8080,
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  idleMinutes: +process.env.SESSION_IDLE_MINUTES || 60, // automatic lock after 1 hour without activity
  maxFailed: 5,
  orgName: process.env.ORG_NAME || 'Your Organisation',
  envLabel: process.env.APP_ENV_LABEL || '', // e.g. "TEST – not for GxP use", shown as a banner on every page
  demoPassword: process.env.DEMO_PASSWORD || 'Demo-Pass-2026',
  // WAL needs shared memory; network file shares (e.g. Azure App Service /home) need DELETE
  journal: ['WAL', 'DELETE', 'TRUNCATE'].includes(String(process.env.SQLITE_JOURNAL).toUpperCase()) ? String(process.env.SQLITE_JOURNAL).toUpperCase() : 'WAL',
  // outgoing e-mail for notifications and passwords (e.g. Microsoft 365: smtp.office365.com, port 587, STARTTLS)
  smtp: { host: process.env.SMTP_HOST || '', port: +process.env.SMTP_PORT || 587, secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.SMTP_FROM || process.env.SMTP_USER || '', fromName: process.env.SMTP_FROM_NAME || 'JRS eQMS' },
  appUrl: (process.env.APP_URL || '').replace(/\/$/, ''), // link in e-mails, e.g. http://192.168.1.100:8080
  sp: {
    tenant: process.env.SP_TENANT_ID, clientId: process.env.SP_CLIENT_ID,
    secret: process.env.SP_CLIENT_SECRET, siteId: process.env.SP_SITE_ID,
    folder: process.env.SP_FOLDER || 'Effective Documents'
  }
};
fs.mkdirSync(CFG.dataDir, { recursive: true });
const PUBLIC = path.join(ROOT, 'public');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

module.exports = { ROOT, CFG, PUBLIC, loadEnv };
