// Customer qualification (JRS/SOP/OPS/010, form JRS/FRM/QAS/010): any department requests with documents, only QA changes or adds
// documents afterwards, QA qualifies / rejects / puts on hold, issued copies of the fillable form carry a numbered stamp.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PL = createRequire(import.meta.url)('../vendor/pdf-lib.min.js'), { PDFDocument } = PL;
// rectangles drawn by pdf-lib on a page (x, y, w, h), from its content streams
const rects=(doc,p)=>{const look=(x)=>x instanceof PL.PDFRef?doc.context.lookup(x):x;const c=look(p.node.get(PL.PDFName.of('Contents')));const parts=c instanceof PL.PDFArray?c.asArray().map(look):[c];
  return parts.flatMap(s=>{let b=Buffer.from(s.contents);if(String(s.dict.get(PL.PDFName.of('Filter'))||'').includes('Flate'))b=inflateSync(b);return [...b.toString('latin1').matchAll(/1 0 0 1 ([-\d.]+) ([-\d.]+) cm\s+(?:1 0 0 1 0 0 cm\s+)*0 0 m\s+0 ([-\d.]+) l\s+([-\d.]+) [-\d.]+ l/g)].map(m=>[+m[1],+m[2],+m[4],+m[3]]);});};
// page content streams as text
const contents=(doc,p)=>{const look=(x)=>x instanceof PL.PDFRef?doc.context.lookup(x):x;const c=look(p.node.get(PL.PDFName.of('Contents')));const parts=c instanceof PL.PDFArray?c.asArray().map(look):[c];return parts.map(s=>{let b=Buffer.from(s.contents);if(String(s.dict.get(PL.PDFName.of('Filter'))||'').includes('Flate'))b=inflateSync(b);return b.toString('latin1');}).join(' ');};
const PORT = 26000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-cu-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '', SMTP_HOST: '' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const raw=async(url)=>{const r=await fetch(B+url,{headers:{cookie:c}});return {s:r.status,type:r.headers.get('content-type'),disp:r.headers.get('content-disposition'),buf:Buffer.from(await r.arrayBuffer())}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:u,password:p,...extra});
 const put=(id,data,reason='update')=>call('PUT',`/api/records/${id}`,{data,reason});
 const get=(id)=>call('GET',`/api/records/${id}`);
 await call('POST','/api/esig-accept'); return {call,raw,sig,put,get,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const T=new Date().toISOString().slice(0,10), Y=T.slice(0,4);
const addD=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const file=(name,text)=>({name,mime:'text/plain',base64:Buffer.from(text).toString('base64')});

const op=await login('operator1'), pk=await login('packer1'), qa=await login('qa.lead'), qr=await login('qa.reviewer'), rp=await login('rp1');

// ===== request by any department: customer name, ship-to address, licence no., expiry, verification link, review date + documents =====
ok((await op.call('POST','/api/records',{type:'customers',data:{title:'Pharma Wholesale Ltd'}})).s===400,'country, ship-to address, licence no. and expiry are required');
ok((await op.call('POST','/api/records',{type:'customers',data:{title:'X',country:'UK',address:'Y',licenceNo:'Z',licenceExpiry:addD(T,30),licenceLink:'not a link'}})).s===400,'the verification link must be a web address');
let c=await op.call('POST','/api/records',{type:'customers',data:{title:'Pharma Wholesale Ltd',country:'United Kingdom',address:'1 Dock Rd, London',licenceNo:'WDA(H) 1234',licenceExpiry:addD(T,-1),licenceLink:'https://cms.mhra.gov.uk/mhra/wda/1234'},attachments:[file('customer-form.pdf','form'),file('wda-licence.pdf','licence')]});
ok(/^CUS-\d{4}-001$/.test(c.number)&&c.status==='Under QA Review','customer number generated automatically: '+c.number+', status Under QA Review');
ok(c.data.requesterDept==='OPS'&&c.data.licenceLink==='https://cms.mhra.gov.uk/mhra/wda/1234','requesting department and licence verification link recorded');
let g=await op.get(c.id);
ok(g.attachments.length===2&&g.attachments.every(a=>a.stage==='Under QA Review'),'documents attached with the request');
ok((await pk.get(c.id)).record,'every department can read the customer');
// ===== after the request: read-only for everyone except QA =====
ok((await op.put(c.id,{address:'changed'})).s===403,'the requester cannot change the request afterwards');
ok((await pk.put(c.id,{licenceNo:'x'})).s===403,'other departments cannot change the customer');
ok((await op.call('POST',`/api/records/${c.id}/attachments`,file('late.pdf','late'))).s===403,'the requester cannot add documents after the request');
ok((await qa.call('POST',`/api/records/${c.id}/attachments`,file('register-check.pdf','check'))).sha256,'QA adds documents');
// ===== QA review =====
ok((await op.sig(c.id,'Qualified')).s===403&&(await rp.sig(c.id,'Qualified')).s===403,'only QA qualifies a customer');
let q=await qa.sig(c.id,'Qualified');
ok(q.s===400&&q.missing.join()==='reviewDate','qualification needs the review date: '+q.error);
await qa.put(c.id,{reviewDate:addD(T,365)},'Review date set');
ok((await qa.sig(c.id,'Qualified')).s===400,'an expired licence blocks qualification');
await qa.put(c.id,{licenceExpiry:addD(T,400)},'Current licence received');
ok((await qa.sig(c.id,'On Hold')).s===400,'putting on hold needs a reason');
ok((await qa.sig(c.id,'On Hold',{reason:'Waiting for the parent company form'})).ok,'QA puts the customer on hold');
ok((await qa.sig(c.id,'Qualified')).ok,'QA qualifies the customer');
ok((await qa.put(c.id,{licenceExpiry:addD(T,700)},'Licence renewed')).changes===1,'QA keeps the licence details up to date');
ok((await op.put(c.id,{licenceExpiry:addD(T,800)})).s===403,'others cannot change a qualified customer');
ok((await qa.sig(c.id,'On Hold',{reason:'Licence under review'})).ok,'a qualified customer can be put on hold');
let c2=await pk.call('POST','/api/records',{type:'customers',data:{title:'Unknown Trader',country:'Unknown',address:'Unknown',licenceNo:'none',licenceExpiry:addD(T,10)}});
ok(/^CUS-\d{4}-002$/.test(c2.number),'next customer number '+c2.number);
ok((await qa.sig(c2.id,'Customer rejected')).s===409,'unknown step refused');
ok((await qa.sig(c2.id,'Rejected',{reason:'No valid licence'})).ok,'QA rejects a customer');
ok([403,409].includes((await qa.put(c2.id,{licenceNo:'x'})).s),'a rejected customer is closed');

// ===== customer form: issued from the customer record, once per customer =====
ok((await op.raw('/api/forms/customers')).s===400,'the customer form is issued from the customer record, not as a blank form');
ok((await op.raw(`/api/forms/customers?record=${c2.id}`)).s===409,'no customer form for a rejected customer');
let f2=await op.raw(`/api/forms/customers?record=${c.id}`), f3=await qa.raw(`/api/forms/customers?record=${c.id}`);
ok(f2.s===200&&f2.type==='application/pdf'&&/FI-\d{4}-001/.test(f2.disp),'customer form issued from the customer as FI-'+Y+'-001');
ok(f3.disp===f2.disp&&Buffer.compare(f2.buf,f3.buf)===0,'issued once per customer: every later download gives the same file');
let pdf=await PDFDocument.load(f2.buf);
const stamps=pdf.getPages().map(p=>rects(pdf,p).find(r=>r[2]===250));
ok(stamps.every(r=>r&&r[0]===18&&r[1]===4),'issue stamp at the left side of the footer of every page ('+stamps.map(r=>r&&r[0]+','+r[1]).join(' / ')+')');
ok(pdf.getPages().every(p=>contents(pdf,p).includes('0.08 0.27 0.68 RG')),'issue stamp is blue');
ok(pdf.getForm().getFields().length>=60,'the issued customer form stays fillable ('+pdf.getForm().getFields().length+' fields)');
const tf=(n)=>pdf.getForm().getTextField(n).getText();
ok(tf('NAME OF CUSTOMER COMPANYORGANIZATION')==='Pharma Wholesale Ltd'&&tf('SHIP TO ADDRESS')==='1 Dock Rd, London'&&tf('LICENSE')==='WDA(H) 1234'&&tf('CUSTOMER ACCOUNT NUMBER')===c.number,'pre-filled with name, ship-to address, licence and customer number');
ok((await op.raw('/api/forms/capa')).s===404,'modules without a controlled form have no download');
let au=await qa.call('GET','/api/audit?action='+encodeURIComponent('Controlled form'));
ok(au._arr.filter(a=>/issued/.test(a.action)).length===1&&au._arr.filter(a=>/downloaded again/.test(a.action)).length===1,'one issue and one repeat download in the audit trail');
g=await qa.get(c.id);ok((g.record.data.formIssues||[]).length===1,'the issue is listed on the customer');
ok(g.signatures.map(s=>s.meaning).includes('Customer qualified – QA'),'qualification e-signed by QA');

// ===== customer master list (qualified customers): customer ID, name, country, effective date, review date =====
ok(g.record.data.effectiveDate===T,'effective date set automatically when the customer was qualified');
await qa.sig(c.id,'Qualified');
let c3=await op.call('POST','/api/records',{type:'customers',data:{title:'Alpha Pharma',country:'Germany',address:'Berlin',licenceNo:'DE-1',licenceExpiry:addD(T,200),reviewDate:addD(T,300),effectiveDate:addD(T,-10)},attachments:[file('form.pdf','x')]});
await qa.sig(c3.id,'Qualified');
let ml=await op.raw('/api/master-list/customers?format=csv'), csv=ml.buf.toString('utf8').replace(/^\ufeff/,'').split('\r\n');
ok(ml.s===200&&csv[0]==='Sr. no.,Customer ID,Customer name,Country,Effective date,Review date','CSV master list columns: customer ID, name, country, effective date, review date');
ok(csv.length===3&&csv[1].startsWith('1,'+c3.number+',Alpha Pharma,Germany,')&&csv[2].includes(c.number)&&!csv.join().includes('Unknown Trader'),'only qualified customers are listed, by name');
let mp=await op.raw('/api/master-list/customers');
ok(mp.s===200&&mp.type==='application/pdf'&&(await PDFDocument.load(mp.buf)).getPageCount()===1,'customer master list downloads as PDF');
ok((await qa.call('GET','/api/audit?action='+encodeURIComponent('Master list downloaded')))._arr.length===2,'master list downloads are in the audit trail');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
