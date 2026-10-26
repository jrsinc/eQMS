/* Dates, text and file-name helpers. */
'use strict';
const { now } = require('./db.js');

// Dates are ISO yyyy-mm-dd and calculated in UTC so results do not shift with the server time zone or daylight saving
const today = () => now().slice(0, 10);
const utc = (d) => new Date(String(d).slice(0, 10) + 'T00:00:00Z');
const addDays = (d, n) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const x = utc(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const addWorkingDays = (d, n) => { const x = utc(d); while (n > 0) { x.setUTCDate(x.getUTCDate() + 1); if (x.getUTCDay() % 6) n--; } return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const csvCell = (v) => /[",\n\r]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v ?? '');
const safeName = (n) => String(n).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);

// ---------- merged PDF report ----------
// Standard PDF fonts use the Windows-1252 character set: map the few other characters used in the forms
const WINANSI = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfText = (v) => String(v ?? '').replace(/\r/g, '').replace(/\t/g, '  ').replace(/[→⇒]/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/[−‐‑]/g, '-')
  .replace(/[^\n\x20-\x7e\xa0-\xff]/g, c => WINANSI.includes(c) ? c : '?');
const kindOf = (buf) => buf.slice(0, 4).toString('latin1') === '%PDF' ? 'pdf' : buf[0] === 0x89 && buf[1] === 0x50 ? 'png' : buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : '';
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dmyText = (v) => { const [y, m, d] = String(v).slice(0, 10).split('-'); return `${d}-${MON3[+m - 1]}-${y}`; };
const tsText = (v) => `${dmyText(v)} ${String(v).slice(11, 19)} UTC`;

module.exports = { today, utc, addDays, addMonths, addWorkingDays, daysBetween, MONTHS, esc, csvCell, safeName, WINANSI, pdfText, kindOf, MON3, dmyText, tsText };
