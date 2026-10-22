/* Replaces every user except "admin" with the people in an organogram file, and sets the departments, Heads and
 * reporting lines. Each new user gets a random initial password that must be changed at first sign-in; the passwords
 * are written to deploy/out/ (not committed) – hand them to each person separately.
 * Stop the server first.   usage: node scripts/load-organogram.js scripts/organogram-v25.json */
'use strict';
process.env.SEED_DEMO = 'false';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { db, audit, hashPw, now } = require('../server.js');
const org = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const why = `Organogram loaded: ${org.source}`;
const password = () => { // 14 characters with upper, lower and digits (password policy)
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789', all = A + a + d;
  const pick = (s) => s[crypto.randomInt(s.length)];
  const chars = [pick(A), pick(a), pick(d), ...Array.from({ length: 11 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
};
const out = [['User ID', 'Name', 'Department', 'Initial password (must be changed at first sign-in)']];
db.exec('BEGIN');
try {
  const removed = db.prepare("SELECT username FROM users WHERE username <> 'admin'").all().map(u => u.username);
  db.prepare("DELETE FROM users WHERE username <> 'admin'").run();
  audit(null, 'Users removed', null, null, removed.join(', '), null, why);
  for (const d of org.departments) {
    const cur = db.prepare('SELECT * FROM departments WHERE code=?').get(d.code);
    if (cur) db.prepare('UPDATE departments SET name=?, parent=NULL, hod=NULL, active=1 WHERE code=?').run(d.name, d.code);
    else db.prepare('INSERT INTO departments (code,name,active,created_by,created_at) VALUES (?,?,1,?,?)').run(d.code, d.name, 'system', now());
  }
  // departments not in the organogram stay for existing records but are set inactive
  const codes = org.departments.map(d => d.code);
  for (const d of db.prepare('SELECT code FROM departments').all()) if (!codes.includes(d.code)) db.prepare('UPDATE departments SET active=0, hod=NULL, parent=NULL WHERE code=?').run(d.code);
  for (const u of org.users) {
    const pw = password();
    db.prepare('INSERT INTO users (username,fullname,email,roles,pw_hash,must_change,created_at,designation,department) VALUES (?,?,?,?,?,1,?,?,?)')
      .run(u.username, u.fullname, u.email || '', JSON.stringify(u.roles), hashPw(pw), now(), u.designation || '', u.department);
    audit(null, 'User created', null, 'roles', null, `${u.username}: ${u.roles.join(', ')} (${u.department})`, why);
    out.push([u.username, u.fullname, u.department, pw]);
  }
  for (const u of org.users) if (u.reportsTo) db.prepare('UPDATE users SET reports_to=? WHERE username=?').run(u.reportsTo, u.username);
  for (const d of org.departments) db.prepare('UPDATE departments SET parent=?, hod=? WHERE code=?').run(d.parent || null, d.hod || null, d.code);
  audit(null, 'Organogram loaded', null, 'departments', null, org.departments.map(d => `${d.code} ${d.name}${d.hod ? ' (Head ' + d.hod + ')' : ''}`).join('; '), why);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
const dir = path.join(__dirname, '..', 'deploy', 'out'); fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `initial-passwords-${now().slice(0, 10)}.csv`);
fs.writeFileSync(file, out.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n'));
console.log(`Loaded ${org.users.length} users and ${org.departments.length} departments. Initial passwords: ${path.relative(path.join(__dirname, '..'), file)}`);
