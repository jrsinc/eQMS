/* Password hashing and policy. */
'use strict';
const crypto = require('node:crypto');

// ---------- passwords ----------
function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPw(pw, stored) {
  const [, salt, h] = String(stored).split('$');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function pwPolicy(pw) {
  if (!pw || pw.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password needs upper case, lower case and a number.';
  return null;
}

module.exports = { hashPw, checkPw, pwPolicy };
