// Customer qualification (JRS/SOP/OPS/010, form JRS/FRM/QAS/010): any department requests with documents, only QA changes or adds
// documents afterwards, QA qualifies / rejects / puts on hold, issued copies of the fillable form carry a numbered stamp.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PDFDocument } = createRequire(import.meta.url)('../vendor/pdf-lib.min.js');
const PORT = 26000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-cu-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', SMTP_HOST: '' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
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

// ===== request by any department, with documents =====
ok((await op.call('POST','/api/records',{type:'customers',data:{title:'Pharma Wholesale Ltd'}})).s===400,'business activity, country and reason are required');
let c=await op.call('POST','/api/records',{type:'customers',data:{title:'Pharma Wholesale Ltd',customerType:'Wholesaler / distributor',country:'United Kingdom',requestReason:'Comparator supply for study ABC-301',licenceNo:'not taken from the requester',notes:'x'},attachments:[file('customer-form.pdf','form'),file('wda-licence.pdf','licence')]});
ok(/^CUS-\d{4}-001$/.test(c.number)&&c.status==='Requested','customer qualification requested: '+c.number);
ok(c.data.requesterDept==='OPS'&&!c.data.licenceNo&&!c.data.notes,'only the request fields are taken from the requester; requesting department recorded');
let g=await op.get(c.id);
ok(g.attachments.length===2&&g.attachments.every(a=>a.stage==='Requested'),'documents attached with the request');
ok((await pk.get(c.id)).record,'every department can read the customer');
// ===== after the request: read-only for everyone except QA =====
ok((await op.put(c.id,{requestReason:'changed'})).s===403,'the requester cannot change the request afterwards');
ok((await pk.put(c.id,{billTo:'x'})).s===403,'other departments cannot change the customer');
ok((await op.call('POST',`/api/records/${c.id}/attachments`,file('late.pdf','late'))).s===403,'the requester cannot add documents after the request');
ok((await qa.put(c.id,{requestReason:'Comparator supply for studies ABC-301 and ABC-302',billTo:'1 Main St, London',businessType:'Limited liability company',contacts:[{dept:'Quality',person:'J Smith',phone:'+44 20 0000',email:'qa@pwl.test'}]},'Form details')).changes===4,'QA completes and corrects the details');
ok((await qa.call('POST',`/api/records/${c.id}/attachments`,file('register-check.pdf','check'))).sha256,'QA adds documents');
// ===== QA review: licence, sanctions, documents =====
ok((await op.sig(c.id,'Qualified')).s===403&&(await rp.sig(c.id,'Qualified')).s===403,'only QA qualifies a customer');
let q=await qa.sig(c.id,'Qualified');
ok(q.s===400&&q.missing.length>=4,'qualification needs the licence, issuing authority, validity, register check and QA remarks: '+q.error);
await qa.put(c.id,{licenceNo:'WDA(H) 1234',issuingAuthority:'MHRA',licenceExpiry:addD(T,-1),verifiedIn:'MHRA register',notes:'Form complete; licence checked'});
ok((await qa.sig(c.id,'Qualified')).s===400,'sanctions screening must be clear');
await qa.put(c.id,{sanctions:'Clear'});
ok((await qa.sig(c.id,'Qualified')).s===400,'an expired licence blocks qualification');
await qa.put(c.id,{licenceExpiry:addD(T,365)});
ok((await qa.sig(c.id,'On Hold')).s===400,'putting on hold needs a reason');
ok((await qa.sig(c.id,'On Hold',{reason:'Waiting for the parent company form'})).ok,'QA puts the customer on hold');
ok((await qa.sig(c.id,'Qualified')).ok,'QA qualifies the customer');
ok((await qa.put(c.id,{licenceExpiry:addD(T,700)},'Licence renewed')).changes===1,'QA keeps the licence details up to date');
ok((await op.put(c.id,{licenceExpiry:addD(T,800)})).s===403,'others cannot change a qualified customer');
ok((await qa.sig(c.id,'On Hold',{reason:'Licence under review'})).ok,'a qualified customer can be put on hold');
let c2=await pk.call('POST','/api/records',{type:'customers',data:{title:'Unknown Trader',customerType:'Others',country:'X',requestReason:'Enquiry'}});
ok((await qa.sig(c2.id,'Customer rejected')).s===409,'unknown step refused');
ok((await qa.sig(c2.id,'Rejected',{reason:'No valid licence'})).ok,'QA rejects a customer');
ok((await qa.put(c2.id,{notes:'x'})).s===409||(await qa.put(c2.id,{notes:'x'})).s===403,'a rejected customer is closed');

// ===== issued copy of the fillable customer form =====
let f1=await op.raw('/api/forms/customers');
ok(f1.s===200&&f1.type==='application/pdf'&&/FI-\d{4}-001/.test(f1.disp),'blank form downloaded as issued copy FI-'+Y+'-001');
let pdf=await PDFDocument.load(f1.buf);
ok(pdf.getForm().getFields().length>=60,'the issued form stays fillable ('+pdf.getForm().getFields().length+' fields)');
let f2=await op.raw(`/api/forms/customers?record=${c.id}`);
pdf=await PDFDocument.load(f2.buf);
ok(/FI-\d{4}-002/.test(f2.disp)&&pdf.getForm().getTextField('NAME OF CUSTOMER COMPANYORGANIZATION').getText()==='Pharma Wholesale Ltd','issued copy for a customer is numbered and pre-filled with the company name');
ok((await op.raw('/api/forms/vendors')).s===404,'modules without a controlled form have no download');
let au=await qa.call('GET','/api/audit?action='+encodeURIComponent('Controlled form issued'));
ok(au._arr.length===2&&au._arr.some(a=>a.record_id===c.id),'every issued copy is in the audit trail');
g=await qa.get(c.id);ok((g.record.data.formIssues||[]).length===1,'issued copies are listed on the customer');
ok(g.signatures.map(s=>s.meaning).includes('Customer qualified – QA'),'qualification e-signed by QA');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
