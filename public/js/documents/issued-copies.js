/* Printing issued copies with the stamp. */
'use strict';
// ---------- issued copies with stamp ----------
function printIssued(r) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print the issued copies.');
  const verify = `${location.origin}/#/verify/${encodeURIComponent(r.issueNo)}`;
  const stamp = (c, p) => `<div class="stamp"><div class="row1"><b>${c.replacement ? 'REPLACEMENT COPY – ISSUED' : 'CONTROLLED COPY – ISSUED'}</b><span>${esc(r.org)}</span></div>
    <div>Doc: <b>${esc(r.doc.number)} v${esc(r.doc.version)}</b> &nbsp; Issue: <b>${esc(r.issueNo)}</b> &nbsp; Copy <b>${c.copyNo}</b>${c.replacement ? ` (replaces voided copy ${c.replaces})` : ` of ${r.totalCopies}`}</div>
    <div>Issued to: ${esc(r.issuedToName)} &nbsp; By: ${esc(r.issuedBy)} &nbsp; Issued: ${dmyt(r.issuedAt)} ${esc(tz)} &nbsp; Return by: ${dmy(r.returnBy)}</div>
    <div>Purpose / batch: ${esc(r.purpose)}<span class="pg">Page ${p + 1} of ${r.pages.length}</span></div>
    <div class="ver">Verify: ${esc(verify)}</div></div>`;
  const pages = r.copies.map(c => r.pages.map((txt, p) => `<section class="page">${stamp(c, p)}<h1>${esc(r.doc.title)}</h1><pre>${esc(txt)}</pre>
    <footer>${esc(r.doc.number)} v${esc(r.doc.version)} · ${esc(r.issueNo)} copy ${c.copyNo} · Page ${p + 1} of ${r.pages.length} · Not valid without issue stamp</footer></section>`).join('')).join('');
  w.document.write(`<!doctype html><title>${esc(r.issueNo)}</title><style>
    @page{size:A4;margin:12mm} body{margin:0;font:10.5pt Arial,sans-serif;color:#000}
    .page{page-break-after:always;min-height:270mm;position:relative} .page:last-child{page-break-after:auto}
    .stamp{border:2.5px double #b00020;color:#b00020;padding:2mm 3mm;font-size:9pt;line-height:1.45;margin-bottom:5mm}
    .stamp .row1{display:flex;justify-content:space-between;font-size:11pt} .stamp .pg{float:right;font-weight:bold} .stamp .ver{font-size:8pt;color:#555}
    h1{font-size:13pt;margin:0 0 3mm} pre{white-space:pre-wrap;font:10.5pt/1.45 Arial,sans-serif;margin:0}
    footer{position:absolute;bottom:0;left:0;right:0;font-size:8pt;color:#444;border-top:1px solid #999;padding-top:1mm}</style>${pages}`);
  w.document.close(); w.focus(); w.print();
}
function verifyView(no) {
  const r = ALL.find(x => x.type === 'issues' && x.number === no);
  if (!r) return shell('', `<h1>Issue ${esc(no)}</h1><div class="panel"><span class="pill bad">Not found</span><p>No issue record with this number exists. Treat the copy as uncontrolled and inform QA.</p></div>`);
  const doc = ALL.filter(x => x.type === 'documents' && x.number === r.data.docNumber && x.status === 'Effective')[0];
  const current = doc && doc.data.version === r.data.docVersion;
  shell('issues', `<h1>Issue ${esc(no)}</h1><div class="panel"><p>${pill(r.status)} ${current ? '<span class="pill done">Version is current</span>' : '<span class="pill bad">Version superseded – return this copy</span>'}</p>
    <p><b>${esc(r.data.docNumber)} v${esc(r.data.docVersion)}</b> – ${esc(r.data.title)}<br>Issued to ${esc(userName(r.data.issuedTo))} for ${esc(r.data.purpose)} · Return by ${dmy(r.data.returnBy)}</p>
    <p class="small muted">Voided copies: ${esc((r.data.printLog || []).filter(j => j.voided).map(j => j.voided).join(', ') || 'none')}</p><a class="btn" href="#/r/${r.id}">Open issue record</a></div>`);
}

