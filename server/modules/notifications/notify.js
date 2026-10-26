/* Who is notified of a status change. */
'use strict';
const { MODULES } = require('../../../public/modules.js');
const { CFG } = require('../../core/config.js');
const { db, now } = require('../../core/db.js');
const { userRow, usersWithRole } = require('../../core/auth.js');
const { hodFor } = require('../../org/departments.js');
const { queueMail } = require('../../core/mail.js');
const { link } = require('../../records/engine.js');

// who has to act next on a record (and the step they can take)
function nextActors(rec) {
  const mod = MODULES[rec.type], d = rec.data, out = new Map(), add = (u, label) => { if (u && !out.has(u)) out.set(u, label); };
  for (const t of mod.transitions.filter(x => x.from === rec.status && !x.reason && !['Cancelled', 'Rejected'].includes(x.to))) {
    const c = t.checks || [];
    if (c.includes('isHodApprover')) add(d.hodApprover, t.label);
    else if (c.includes('isRespPerson') || c.includes('isPartCOwner')) add(d.respPerson, t.label);
    else if (c.includes('isPartAOwner') || c.includes('isCcDept') || c.includes('isResponsible')) { add(rec.created_by, t.label); add(d.respPerson, t.label); }
    else if (c.includes('isInitiator')) add(rec.created_by, t.label);
    else if (c.includes('isReviewer')) add(d.reviewer, t.label);
    else if (c.includes('isTrainee') || t.traineeOnly) add(d.trainee, t.label);
    else if (c.includes('isTrainer')) add(d.trainer, t.label);
    else for (const r of t.roles) {
      if (r === 'hod') add(d.respDept ? hodFor(d.respDept) : '', t.label);
      else if (r === 'pm' && d.pm) add(d.pm, t.label);
      else if (r !== 'any') usersWithRole(r).forEach(u => add(u, t.label));
    }
  }
  const da = mod.deptApproval;
  if (da && rec.status === da.state) for (const code of d[da.field] || []) if (!(d.deptApprovals || []).some(a => a.dept === code)) add(hodFor(code), `${da.label} (${code})`);
  return out;
}
// every status change: the people who act next, plus the initiator, responsible person and approving Head, in the app and by e-mail
function notifyStatus(actor, rec, from, to) {
  const d = rec.data, mod = MODULES[rec.type], act = nextActors(rec), people = new Set([...act.keys(), rec.created_by, d.respPerson, d.hodApprover].filter(Boolean));
  const link = CFG.appUrl ? `${CFG.appUrl}/#/r/${rec.id}` : '';
  for (const u of people) {
    if (u === actor.username) continue;
    const p = userRow(u); if (!p || !p.active) continue;
    const action = act.get(u) || '';
    const subject = `${rec.number} – ${action ? 'action needed: ' + action : to}`;
    const body = [`${mod.name}: ${rec.number} – ${d.title || ''}`, from ? `Status: ${from} → ${to} (by ${actor.fullname})` : `New record, status ${to} (by ${actor.fullname})`,
      action ? `Your action: ${action}` : 'For your information – no action needed from you now.', link ? `Open: ${link}` : '', '', 'JRS eQMS – automatic notification. Do not reply.'].filter(x => x !== '').join('\n');
    const id = db.prepare('INSERT INTO notifications (username,record_id,record_number,subject,body,action,ts) VALUES (?,?,?,?,?,?,?)').run(u, rec.id, rec.number, subject, body, action, now()).lastInsertRowid;
    queueMail(p.email, subject, body, id);
  }
}

module.exports = { nextActors, notifyStatus };
