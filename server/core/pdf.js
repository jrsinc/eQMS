/* PDF protection (copy lock) and stamps. */
'use strict';
const crypto = require('node:crypto');
// pdf-lib 1.17.1 (MIT, vendor/pdf-lib.LICENSE.md), vendored so the app installs no npm packages
const PDFLib = require('../../vendor/pdf-lib.min.js');
const { pdfText } = require('./util.js');

// ---------- issued copies of controlled forms (stamp on every page, fields stay fillable) ----------
// PDF standard security handler, RC4 128-bit (V2 / R3, ISO 32000-1 §7.6.3): opens without a password, may be printed;
// copying text, editing, annotating and form changes are not permitted. The owner password is random and not kept.
const PDF_PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const PDF_PRINT_ONLY = -1852;
 // bits 3 (print) and 12 (high-quality print) plus the reserved bits
const PDF_VIEW_ONLY = PDF_PRINT_ONLY & ~(4 | 2048);
 // no printing either (on-screen reading)
function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  const out = Buffer.alloc(data.length); let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = data[k] ^ s[(s[i] + s[j]) & 255]; }
  return out;
}
async function lockPdf(bytes, perms = PDF_PRINT_ONLY) {
  const { PDFDocument, PDFHexString, PDFString, PDFDict, PDFArray, PDFRawStream } = PDFLib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false }), ctx = doc.context;
  const md5 = (b) => crypto.createHash('md5').update(b).digest(), xor = (k, n) => Buffer.from(k.map(b => b ^ n));
  const id0 = crypto.randomBytes(16), pb = Buffer.alloc(4); pb.writeInt32LE(perms);
  let ok = md5(crypto.randomBytes(32)); for (let i = 0; i < 50; i++) ok = md5(ok);                       // algorithm 3: owner key
  let O = rc4(ok, PDF_PAD); for (let i = 1; i <= 19; i++) O = rc4(xor(ok, i), O);
  let key = md5(Buffer.concat([PDF_PAD, O, pb, id0])); for (let i = 0; i < 50; i++) key = md5(key);       // algorithm 2: file key (empty user password)
  let U = rc4(key, md5(Buffer.concat([PDF_PAD, id0]))); for (let i = 1; i <= 19; i++) U = rc4(xor(key, i), U); // algorithm 5: user entry
  U = Buffer.concat([U, Buffer.alloc(16)]);
  const objKey = (num, gen) => { const b = Buffer.alloc(5); b.writeUIntLE(num, 0, 3); b.writeUInt16LE(gen, 3); return md5(Buffer.concat([key, b])); };
  const enc = (o, k) => {
    if (o instanceof PDFString || o instanceof PDFHexString) return PDFHexString.of(rc4(k, Buffer.from(o.asBytes())).toString('hex'));
    if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i++) o.set(i, enc(o.get(i), k)); return o; }
    if (o instanceof PDFDict) { for (const [n, v] of o.entries()) o.set(n, enc(v, k)); return o; }
    return o;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const k = objKey(ref.objectNumber, ref.generationNumber);
    if (obj instanceof PDFRawStream) { enc(obj.dict, k); obj.contents = rc4(k, Buffer.from(obj.contents)); } else enc(obj, k);
  }
  ctx.trailerInfo.Encrypt = ctx.register(ctx.obj({ Filter: 'Standard', V: 2, R: 3, Length: 128, P: perms, O: PDFHexString.of(O.toString('hex')), U: PDFHexString.of(U.toString('hex')) }));
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id0.toString('hex')), PDFHexString.of(id0.toString('hex'))]);
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}
const STAMP_COLOURS = { blue: [0.08, 0.27, 0.68], green: [0.05, 0.45, 0.20], red: [0.75, 0.10, 0.10] };
// stamp on every page, left side of the footer: blue = issued copy, green = controlled / uncontrolled copy, red = superseded / obsolete
async function stampPages(doc, lines, colour) {
  const { StandardFonts, rgb } = PDFLib, c = rgb(...STAMP_COLOURS[colour]);
  const F = await doc.embedFont(StandardFonts.HelveticaBold), F2 = await doc.embedFont(StandardFonts.Helvetica);
  for (const p of doc.getPages()) {
    const w = 250, h = 8 + lines.length * 7.6, x = 18, y = 4;
    p.drawRectangle({ x, y, width: w, height: h, borderColor: c, borderWidth: 1.1, color: rgb(1, 1, 1), opacity: 0.92, borderOpacity: 1 });
    lines.forEach((l, i) => p.drawText(pdfText(l).slice(0, 64), { x: x + 6, y: y + h - 9.5 - i * 7.6, size: i ? 6 : 7.5, font: i ? F2 : F, color: c }));
  }
}

module.exports = { PDF_PAD, PDF_PRINT_ONLY, PDF_VIEW_ONLY, rc4, lockPdf, STAMP_COLOURS, stampPages };
