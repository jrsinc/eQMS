/* Label printing. */
'use strict';
// ---------- labels ----------
function fillLabel(d, v) { return String(d.template || '').replace(/\{KIT\}/g, v.kit).replace(/\{BATCH\}/g, v.batch).replace(/\{EXPIRY\}/g, v.expiry).replace(/\{PROTOCOL\}/g, d.study || '').replace(/\{SPONSOR\}/g, (d.sponsor || '').replace(/\n/g, ', ')); }
function labelBox(d, v) { return `<div class="label" style="width:${+d.width || 90}mm;height:${+d.height || 50}mm">${esc(fillLabel(d, v))}</div>`; }
function zpl(d, v) {
  const dots = (mm) => Math.round(mm * 8), W = dots(+d.width || 90), H = dots(+d.height || 50);
  const txt = fillLabel(d, v).replace(/[\^~]/g, ' ').split('\n').join('\\&');
  return `^XA^CI28^PW${W}^LL${H}^FO20,20^A0N,22,22^FB${W - 40},14,2,L^FD${txt}^FS^FO${W - 300},${H - 110}^BCN,70,Y,N,N^FD${v.kit}^FS^XZ`;
}
function labelPanel(rec) {
  const d = rec.data, log = d.printLog || [];
  $('#special').innerHTML = `<div class="panel"><h3>Label preview</h3><p class="muted small">Sample values. Variable fields are filled at print time. Text must match the approved country text exactly.</p>
    ${labelBox(d, { kit: '1001', batch: 'B-SAMPLE', expiry: 'MMM-YYYY' })}
    <div class="row" style="margin-top:1rem">${rec.status === 'Approved' && hasRole(['cs', 'qa']) ? '<button class="btn primary sign" id="lp">Print labels</button>' : '<span class="muted small">Printing is available once the label is Approved, for clinical supply and QA roles.</span>'}</div></div>
    <div class="panel"><h3>Print log</h3>${log.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Job</th><th>Date</th><th>By</th><th>Kits</th><th>Qty</th><th>Batch</th><th>Expiry</th><th>Label version</th></tr></thead><tbody>${log.slice().reverse().map(j => `<tr><td class="mono">${esc(j.id)}</td><td>${dmyt(j.ts)}</td><td>${esc(userName(j.by))}</td><td class="mono">${j.firstKit}–${j.firstKit + j.qty - 1}</td><td>${j.qty}</td><td>${esc(j.batch)}</td><td>${esc(j.expiry)}</td><td>${esc(j.version)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No print jobs yet.</p>'}</div>`;
  $('#lp')?.addEventListener('click', async () => {
    const job = await stepDialog({
      title: 'Print labels', meaning: 'Printed',
      extra: `<div class="grid"><div><label class="f">First kit number</label><input type="number" name="firstKit" value="1001"></div><div><label class="f">Quantity</label><input type="number" name="qty" value="10"></div>
       <div><label class="f">Batch</label><input type="text" name="batch"></div><div><label class="f">Use-by / expiry (as printed)</label><input type="text" name="expiry" placeholder="e.g. 31-Dec-2027"></div>
       <div class="full"><label class="f">Output</label><select name="printer"><option>Browser / PDF</option><option>Zebra ZPL file</option></select></div></div>`,
      perform: (v) => api('POST', `/api/records/${rec.id}/print`, v)
    });
    if (!job) return;
    const vals = Array.from({ length: job.qty }, (_, i) => ({ kit: String(job.firstKit + i), batch: job.batch, expiry: job.expiry }));
    if (job.printer === 'Zebra ZPL file') download(`${rec.number}_job_${job.id}.zpl`, vals.map(v => zpl(d, v)).join('\n'), 'text/plain');
    else { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.'); w.document.write(`<!doctype html><title>${esc(rec.number)} job ${esc(job.id)}</title><style>@page{margin:8mm}body{margin:0;font:9pt Arial,sans-serif}.label{border:1px dashed #999;padding:2.5mm 3mm;white-space:pre-wrap;overflow:hidden;display:inline-block;margin:0 4mm 4mm 0;vertical-align:top}</style>${vals.map(v => labelBox(d, v)).join('')}`); w.document.close(); w.print(); }
    route();
  });
}

