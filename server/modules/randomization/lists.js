/* Kit randomization lists. */
'use strict';
const crypto = require('node:crypto');
const { fail } = require('../../core/http.js');

// ---------- randomization ----------
function prng(seedStr) { // sha256-seeded xorshift128+
  const h = crypto.createHash('sha256').update(seedStr).digest();
  let s0 = h.readBigUInt64LE(0), s1 = h.readBigUInt64LE(8); const M = (1n << 64n) - 1n;
  return () => { let x = s0; const y = s1; s0 = y; x ^= (x << 23n) & M; s1 = x ^ y ^ (x >> 17n) ^ (y >> 26n); return Number(((s1 + y) & M) >> 11n) / 2 ** 53; };
}
function generateList(d) {
  const arms = String(d.arms).split(',').map(s => s.trim()).filter(Boolean);
  const ratio = String(d.ratio).split(':').map(n => parseInt(n, 10));
  if (arms.length < 2 || ratio.length !== arms.length || ratio.some(n => !(n > 0))) fail(400, 'Treatment codes and ratio must match, e.g. A,B with 1:1.');
  const unit = ratio.reduce((a, b) => a + b, 0), bs = +d.blockSize, n = +d.kits, start = +d.startKit || 1;
  if (!(bs > 0) || bs % unit) fail(400, `Block size must be a multiple of ${unit} for ratio ${d.ratio}.`);
  if (!(n > 0) || n > 100000) fail(400, 'Number of kits must be between 1 and 100,000.');
  const seed = d.seed && String(d.seed).trim() ? String(d.seed).trim() : crypto.randomBytes(16).toString('hex');
  const rnd = prng(seed), template = [];
  for (let k = 0; k < bs / unit; k++) arms.forEach((a, i) => { for (let j = 0; j < ratio[i]; j++) template.push(a); });
  const list = []; let block = 0;
  while (list.length < n) {
    block++; const b = template.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    for (const a of b) { if (list.length >= n) break; list.push({ kit: start + list.length, block, arm: a }); }
  }
  return { list, seed };
}
const listCsv = (list) => 'kit,block,treatment\n' + list.map(r => `${r.kit},${r.block},${r.arm}`).join('\n');

module.exports = { prng, generateList, listCsv };
