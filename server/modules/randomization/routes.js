/* Kit randomization API. */
'use strict';
const { db, now, sha256 } = require('../../core/db.js');
const { audit } = require('../../core/audit.js');
const { fail, route } = require('../../core/http.js');
const { hasRole, verifySignature } = require('../../core/auth.js');
const { getRecord, saveRecord, sign } = require('../../records/engine.js');
const { generateList, listCsv } = require('./lists.js');

// randomization
route('POST', '/api/records/:id/randomize', (ctx) => {
  const rec = getRecord(ctx.params.id);
  if (rec.type !== 'randomization' || rec.status !== 'Draft') fail(409, 'Lists can be generated only for Draft randomization records.');
  if (!hasRole(ctx.user, ['unblinded'])) fail(403, 'Unblinded role required.');
  verifySignature(ctx.user, ctx.body);
  const { list, seed } = generateList(rec.data);
  const csv = listCsv(list);
  db.prepare('INSERT OR REPLACE INTO rand_lists (record_id,list,seed,generated_by,ts) VALUES (?,?,?,?,?)').run(rec.id, JSON.stringify(list), seed, ctx.user.username, now());
  rec.data.checksum = sha256(csv); rec.data.seed = seed; rec.status = 'Generated'; saveRecord(rec);
  audit(ctx.user, 'Randomization list generated (e-signed: Generated)', rec, 'checksum', null, rec.data.checksum, `${list.length} kits; seed recorded`, ctx.ip);
  sign(ctx.user, rec, 'Generated', 'Draft', 'Generated');
  return { ok: true, kits: list.length };
});
route('GET', '/api/records/:id/kits', (ctx) => {
  const rec = getRecord(ctx.params.id);
  const rl = db.prepare('SELECT * FROM rand_lists WHERE record_id=?').get(rec.id); if (!rl) fail(404, 'No list generated');
  const list = JSON.parse(rl.list), unblinded = ctx.query.get('view') === 'unblinded';
  if (unblinded) {
    if (!hasRole(ctx.user, ['unblinded'])) fail(403, 'Unblinded role required.');
    audit(ctx.user, 'Unblinded list viewed', rec, null, null, null, null, ctx.ip);
    const arms = {}, blocks = {};
    for (const r of list) { arms[r.arm] = (arms[r.arm] || 0) + 1; (blocks[r.block] ||= {})[r.arm] = (blocks[r.block][r.arm] || 0) + 1; }
    return { unblinded: true, seed: rl.seed, list, balance: arms, blocks, checksumValid: sha256(listCsv(list)) === rec.data.checksum };
  }
  return { unblinded: false, list: list.map(r => ({ kit: r.kit })) };
});

module.exports = {  };
