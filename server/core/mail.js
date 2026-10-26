/* E-mail (SMTP, no dependencies). */
'use strict';
const net = require('node:net');
const tls = require('node:tls');
const { CFG } = require('./config.js');
const { db, now, uid } = require('./db.js');
const { userRow } = require('./auth.js');

// ---------- e-mail (SMTP, no dependencies) and notifications ----------
const mailOn = () => !!(CFG.smtp.host && CFG.smtp.from);
async function smtpSend(to, subject, text) {
  const c = CFG.smtp; let sock = c.secure ? tls.connect({ host: c.host, port: c.port, servername: c.host }) : net.connect({ host: c.host, port: c.port });
  let buf = ''; const waiting = [];
  const flush = () => { while (waiting.length) { const m = buf.match(/^((?:\d{3}-[^\r\n]*\r?\n)*)(\d{3})(?: [^\r\n]*)?\r?\n/); if (!m) return; buf = buf.slice(m[0].length); waiting.shift().ok({ code: +m[2], text: m[0] }); } };
  const attach = (s) => { s.setTimeout(30000); s.on('data', d => { buf += d.toString('utf8'); flush(); }); s.on('timeout', () => s.destroy(new Error('SMTP timeout'))); s.on('error', e => waiting.splice(0).forEach(w => w.fail(e))); };
  const read = () => new Promise((ok, f) => { waiting.push({ ok, fail: f }); flush(); });
  const cmd = async (line, codes) => { if (line != null) sock.write(line + '\r\n'); const r = await read(); if (!codes.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.trim().slice(0, 200)}`); return r; };
  attach(sock);
  try {
    await cmd(null, [220]);
    let r = await cmd('EHLO jrs-eqms', [250]);
    if (!c.secure && /STARTTLS/i.test(r.text)) {
      await cmd('STARTTLS', [220]); sock.removeAllListeners('data'); sock.removeAllListeners('timeout');
      sock = tls.connect({ socket: sock, servername: c.host }); attach(sock);
      await new Promise((ok, f) => { sock.once('secureConnect', ok); sock.once('error', f); });
      r = await cmd('EHLO jrs-eqms', [250]);
    }
    if (c.user) { await cmd('AUTH LOGIN', [334]); await cmd(Buffer.from(c.user).toString('base64'), [334]); await cmd(Buffer.from(c.pass).toString('base64'), [235]); }
    await cmd(`MAIL FROM:<${c.from}>`, [250]);
    await cmd(`RCPT TO:<${to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const b64 = (v) => '=?UTF-8?B?' + Buffer.from(v).toString('base64') + '?=';
    await cmd([`From: ${b64(c.fromName)} <${c.from}>`, `To: <${to}>`, `Subject: ${b64(subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <${uid()}@jrs-eqms>`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n'), '.'].join('\r\n'), [250]);
    await cmd('QUIT', [221]).catch(() => {});
  } finally { sock.end(); }
}
// e-mails go out one at a time in the background; the result is kept on the notification (or logged for password e-mails)
const mailQueue = [];
 let mailBusy = false;
function queueMail(to, subject, text, noteId) {
  if (!mailOn() || !to) { if (noteId) db.prepare('UPDATE notifications SET email=? WHERE id=?').run(mailOn() ? 'No e-mail address' : 'E-mail not configured', noteId); return false; }
  mailQueue.push({ to, subject, text, noteId }); if (!mailBusy) setImmediate(drainMail); return true;
}
async function drainMail() {
  mailBusy = true;
  while (mailQueue.length) {
    const m = mailQueue.shift(); let result = 'Sent ' + now();
    try { await smtpSend(m.to, m.subject, m.text); } catch (e) { result = 'Failed: ' + e.message; console.error('E-mail to', m.to, 'failed:', e.message); }
    if (m.noteId) db.prepare('UPDATE notifications SET email=? WHERE id=?').run(result, m.noteId);
  }
  mailBusy = false;
}
function mailPassword(u, password, reset) {
  const p = userRow(u); if (!p || !p.email || !mailOn()) return false;
  return queueMail(p.email, reset ? 'JRS eQMS – your password was reset' : 'JRS eQMS – your account',
    [`Hello ${p.fullname},`, '', reset ? 'An administrator has reset your password for the JRS eQMS.' : 'An account has been created for you in the JRS eQMS.',
      `User ID: ${p.username} (or sign in with this e-mail address)`, `Temporary password: ${password}`, CFG.appUrl ? `Sign in: ${CFG.appUrl}` : '', '',
      'You must choose a new password when you sign in. Do not share your password.'].filter(x => x !== '').join('\n'));
}

module.exports = { mailOn, smtpSend, mailQueue, mailBusy, queueMail, drainMail, mailPassword };
