// Supplier qualification (JRS/SOP/QAS/005 v7.0): request by any department → risk assessment (JRS/FRM/QAS/042, RPN = S × O × D)
// → Head of Department review → Under Quality Review (by risk level: licence, licence copy, questionnaire issued once, audit certificate;
// effective and requalification dates) → Approved / Rejected / On Hold; requalification repeats the process; issued forms register.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PDFDocument } = createRequire(import.meta.url)('../vendor/pdf-lib.min.js');
const PORT = 27000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-su-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', SMTP_HOST: '' }, stdio: 'ignore' });
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
const addM=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCMonth(x.getUTCMonth()+n);return x.toISOString().slice(0,10)};
const file=(name,text)=>({name,mime:'text/plain',base64:Buffer.from(text).toString('base64')});
const req=(who,title,extra={})=>who.call('POST','/api/records',{type:'vendors',data:{title,reason:'New requirement – comparator sourcing for study ABC-301',sites:['JRS INC'],services:'Comparator procurement services',address:'135 Duryea Rd, Melville NY',contactPerson:'J Doe',contactPhone:'+1 631 000 0000',contactEmail:'jdoe@supplier.test',...extra},attachments:[file('company-profile.pdf','profile')]});

const op=await login('operator1'), pk=await login('packer1'), qa=await login('qa.lead'), qr=await login('qa.reviewer'), hod=await login('hod.ops'), cs=await login('cs.manager');
// QA submits the risk assessment; the Head of the requesting department approves it
const riskOk=async(id,head)=>{await qa.sig(id,'HOD Review'); const g=await head.get(id); await head.put(id,{hodComment:'Agreed'},'Review'); return head.sig(id,'Under Quality Review');};
// documents attached by QA during the quality review, with their type (licence copy, filled questionnaire, audit certificate)
const doc=(id,category,name)=>qa.call('POST',`/api/records/${id}/attachments`,{...file(name,'document'),category});

// ===== request by any department =====
ok((await op.call('POST','/api/records',{type:'vendors',data:{title:'X'}})).s===400,'reason, sites, services, address and contact details are required');
let s1=await req(op,'Henry Schein, Inc.');
ok(/^SUP-\d{4}-001$/.test(s1.number)&&s1.status==='Risk Assessment'&&s1.data.requesterDept==='OPS','supplier qualification requested: '+s1.number+', status Risk Assessment');
ok((await op.get(s1.id)).attachments.length===1,'documents attached with the request');
ok((await qa.call('GET','/api/notifications')).items.some(n=>n.record_id===s1.id),'QA is notified of the request');
ok((await op.put(s1.id,{services:'changed'})).s===403&&(await op.put(s1.id,{severity:'3'})).s===403,'the requester cannot change the request or the risk assessment');
ok((await op.call('POST',`/api/records/${s1.id}/attachments`,file('late.pdf','x'))).s===403,'only QA adds documents after the request');

// ===== risk assessment (JRS/FRM/QAS/042): only severity, occurrence, detection =====
ok((await qa.sig(s1.id,'HOD Review')).s===400,'the three scores are required');
await qa.put(s1.id,{severity:'3',occurrence:'2',detection:'2'},'Risk assessment');
let d=(await qa.get(s1.id)).record.data;
ok(d.rpn==='12'&&d.riskLevel==='Low risk'&&d.auditType==='Certificate verification'&&d.auditFrequency==='Annually or as needed','RPN 3×2×2 = 12: low risk, certificate verification, annually (as on the paper form)');
ok((await qa.put(s1.id,{effectiveDate:T})).s===403,'review result fields are not part of the risk assessment');
ok((await qa.sig(s1.id,'Under Quality Review')).s===409,'QA cannot skip the Head of Department review');
ok((await qa.sig(s1.id,'HOD Review')).ok,'QA signs and submits the risk assessment to the Head of Department');
d=(await qa.get(s1.id)).record.data;
ok(d.hodApprover==='hod.ops','reviewer from the organogram: Head of the requesting department (Operation)');
ok((await qa.put(s1.id,{severity:'4'})).s===403,'the risk assessment is locked while the Head of Department reviews it');
ok((await hod.sig(s1.id,'Under Quality Review')).s===400,'the Head of Department comment is required');
ok((await hod.sig(s1.id,'Risk Assessment',{reason:'Occurrence looks too low – please check the supply history'})).ok,'Head of Department returns the risk assessment to QA');
ok((await qa.put(s1.id,{occurrence:'2'},'Supply history checked')).s===200,'QA can revise the risk assessment after the return');
await qa.sig(s1.id,'HOD Review');
await hod.put(s1.id,{hodComment:'Risk assessment agreed'},'HOD review');
ok((await cs.sig(s1.id,'Under Quality Review')).s===403,'only the Head named on the record approves');
ok((await hod.sig(s1.id,'Under Quality Review')).ok,'Head of Department approves the risk assessment – Under Quality Review');
ok((await hod.get(s1.id)).signatures.some(s=>s.meaning==='Risk assessment approved – Head of Department'),'Head of Department approval e-signed');
ok((await qa.put(s1.id,{severity:'5'})).s===403,'the risk assessment is locked during the quality review');

// ===== quality review – certificate verification: licence no. / expiry, licence copy, verified =====
ok(!(await qa.get(s1.id)).record.data.licenceNo,'licence details are entered during the quality review, not at the risk assessment');
await qa.put(s1.id,{approvedFor:'Comparator procurement',qaConclusion:'Licence verified'});
let ap=await qa.sig(s1.id,'Approved');
ok(ap.s===400&&ap.missing.join()==='licenceNo,licenceExpiry,effectiveDate,requalDate','approval needs the licence no., expiry date, effective date and requalification date');
await qa.put(s1.id,{licenceNo:'NY-WD-123',licenceExpiry:addD(T,-1),effectiveDate:T},'Licence and effective date');
d=(await qa.get(s1.id)).record.data;
ok(d.requalDate===addM(T,12),'requalification date suggested from the risk level frequency: '+d.requalDate);
await qa.put(s1.id,{requalDate:addM(T,11)},'Requalification before the annual review meeting');
ok((await qa.get(s1.id)).record.data.requalDate===addM(T,11),'QA can change the requalification date');
ok((await qa.sig(s1.id,'Approved')).s===400,'an expired licence blocks approval');
await qa.put(s1.id,{licenceExpiry:addD(T,300)},'Current licence');
ap=await qa.sig(s1.id,'Approved');
ok(ap.s===400&&/attach the licence copy/.test(ap.error),'certificate verification needs the licence copy');
ok((await doc(s1.id,'licence','wda-licence.pdf')).sha256,'QA attaches the licence copy');
ap=await qa.sig(s1.id,'Approved');
ok(ap.s===400&&/Licence verified/.test(ap.error),'certificate verification needs "Licence verified" ticked');
await qa.put(s1.id,{licenceVerified:true},'Checklist');
ok((await qa.sig(s1.id,'On Hold')).s===400,'on hold needs a reason');
ok((await qa.sig(s1.id,'On Hold',{reason:'Waiting for the GDP certificate'})).ok,'QA puts the supplier on hold');
ok((await qa.sig(s1.id,'Approved')).ok,'QA approves the supplier');
d=(await qa.get(s1.id)).record.data;
ok(d.approvedOn===T&&d.effectiveDate===T&&d.requalDate===addM(T,11),'approved supplier: effective '+d.effectiveDate+', requalification '+d.requalDate);

// ===== requalification: the same process again =====
ok((await qa.sig(s1.id,'Risk Assessment',{reason:'Annual requalification'})).ok,'requalification starts with a new risk assessment');
d=(await qa.get(s1.id)).record.data;
ok((d.qualHistory||[]).length===1&&d.qualHistory[0].effectiveDate===T&&!d.effectiveDate&&!d.approvedOn&&!d.licenceVerified,'previous qualification kept in the history; review results cleared for the new cycle');
await qa.put(s1.id,{occurrence:'4'},'Supply issues this year');
d=(await qa.get(s1.id)).record.data;
ok(d.rpn==='24'&&d.auditType==='Questionnaire based audit','new risk assessment: RPN 24 – questionnaire based audit');
ok((await riskOk(s1.id,hod)).ok,'requalification risk assessment approved by the Head of Department');
await qa.put(s1.id,{approvedFor:'Comparator procurement',effectiveDate:T,qaConclusion:'Questionnaire satisfactory'});
ap=await qa.sig(s1.id,'Approved');
ok(ap.s===400&&/filled questionnaire/.test(ap.error),'questionnaire based audit needs the filled questionnaire (the licence copy of the last cycle does not count)');
let q1=await qa.raw(`/api/forms/vendors?record=${s1.id}`), q2=await qa.raw(`/api/forms/vendors?record=${s1.id}`);
ok(q1.s===200&&q1.disp===q2.disp&&Buffer.compare(q1.buf,q2.buf)===0,'questionnaire issued once: every download gives the same file ('+(q1.disp.match(/FI-\d{4}-\d{3}/)||[''])[0]+')');
await doc(s1.id,'questionnaire','questionnaire-completed.pdf');
ok((await qa.sig(s1.id,'Approved')).ok,'requalified supplier approved');
ok((await qa.get(s1.id)).record.data.requalDate===addM(T,60),'next requalification in five years (moderate risk)');

// ===== high risk: site audit – audit date, audit certificate, licence =====
let s2=await req(pk,'Pack Partners Ltd',{services:'Secondary packaging and labelling'});
await qa.put(s2.id,{severity:'4',occurrence:'4',detection:'3'});
d=(await qa.get(s2.id)).record.data;
ok(d.rpn==='48'&&d.riskLevel==='High risk'&&d.auditType==='Site audit'&&d.auditFrequency==='Every three years','RPN 4×4×3 = 48: high risk, site audit, every three years');
ok((await riskOk(s2.id,cs)).ok,'Packaging request: risk assessment approved by the Head of Packaging');
ok((await qa.raw(`/api/forms/vendors?record=${s2.id}`)).s===409,'no questionnaire for a site audit');
ok((await qa.raw(`/api/records/${s2.id}/agenda.pdf`)).s===400,'the optional agenda needs the audit date and schedule');
await qa.put(s2.id,{auditDate:addD(T,-5),auditCategory:'Prospective supplier audit',auditMethod:'On-site',leadAuditor:'qa.reviewer',agenda:[{date:addD(T,-5),time:'09:00',activity:'Opening meeting',participants:'All'}]},'Audit');
let ag=await qa.raw(`/api/records/${s2.id}/agenda.pdf`);
ok(ag.s===200&&ag.type==='application/pdf','audit agenda (JRS/FRM/QAS/021) downloaded as PDF');
await qa.put(s2.id,{licenceNo:'UK-WDA-55',licenceExpiry:addD(T,500),approvedFor:'Secondary packaging',effectiveDate:T,qaConclusion:'Approved after audit'});
ap=await qa.sig(s2.id,'Approved');
ok(ap.s===400&&/audit certificate date/.test(ap.error),'site audit needs the audit certificate date');
await qa.put(s2.id,{auditCertDate:T});
ap=await qa.sig(s2.id,'Approved');
ok(ap.s===400&&/attach the audit certificate/.test(ap.error),'site audit needs the audit certificate attached');
await doc(s2.id,'auditCert','audit-certificate.pdf');
ok((await qa.sig(s2.id,'Approved')).ok,'site audit complete – supplier approved');
ok((await qa.get(s2.id)).record.data.requalDate===addM(T,36),'requalification in three years');

// ===== catastrophic: questionnaire and site audit both =====
let s4=await req(op,'API Maker',{services:'API supply'});
await qa.put(s4.id,{severity:'5',occurrence:'4',detection:'4'});
ok((await qa.get(s4.id)).record.data.auditType==='Supplier questionnaire and site audit','RPN 80: catastrophic, supplier questionnaire and site audit');
await riskOk(s4.id,hod);
await qa.put(s4.id,{licenceNo:'API-1',licenceExpiry:addD(T,400),auditDate:T,auditCertDate:T,approvedFor:'API',effectiveDate:T,qaConclusion:'Both evaluations done'});
await doc(s4.id,'auditCert','audit-certificate.pdf');
ap=await qa.sig(s4.id,'Approved');
ok(ap.s===400&&/filled questionnaire/.test(ap.error),'catastrophic risk needs the questionnaire as well as the site audit');
await qa.raw(`/api/forms/vendors?record=${s4.id}`); await doc(s4.id,'questionnaire','questionnaire-completed.pdf');
ok((await qa.sig(s4.id,'Approved')).ok,'questionnaire and site audit complete – supplier approved (requalification every two years)');

// ===== questionnaire: the controlled PDF unchanged, QA only, from the record, only when needed =====
let s3=await req(op,'Courier Co',{services:'Specialty courier'});
await qa.put(s3.id,{severity:'3',occurrence:'3',detection:'3'});
ok((await qa.get(s3.id)).record.data.auditType==='Questionnaire based audit','RPN 27: moderate risk, questionnaire based audit');
ok((await qa.raw(`/api/forms/vendors?record=${s3.id}`)).s===409,'no questionnaire during the risk assessment');
ok((await qa.raw('/api/forms/vendors')).s===400,'the questionnaire is issued from the supplier record, not as a blank form');
await qa.sig(s3.id,'HOD Review');
ok((await qa.raw(`/api/forms/vendors?record=${s3.id}`)).s===409,'no questionnaire during the Head of Department review');
await hod.put(s3.id,{hodComment:'Agreed'},'Review'); await hod.sig(s3.id,'Under Quality Review');
ok((await op.raw(`/api/forms/vendors?record=${s3.id}`)).s===403,'only QA issues the questionnaire');
let qf=await qa.raw(`/api/forms/vendors?record=${s3.id}`);
const orig=await PDFDocument.load(fs.readFileSync(join(root,'forms','JRS-FRM-QAS-004 v3.0 Vendor qualification checklist.pdf')));
let pdf=await PDFDocument.load(qf.buf);
ok(qf.s===200&&/JRS-FRM-QAS-004 FI-\d{4}-\d{3}/.test(qf.disp),'QA issues the questionnaire as a numbered issued copy');
ok(pdf.getPageCount()===orig.getPageCount()&&pdf.getPages().every((p,i)=>JSON.stringify(p.getSize())===JSON.stringify(orig.getPage(i).getSize())),'the controlled JRS/FRM/QAS/004 PDF is issued unchanged ('+orig.getPageCount()+' pages) with the issue stamp');
let reg=await qa.call('GET','/api/form-issues');
ok(reg._arr.length===3&&reg._arr.every(r=>r.form_code==='JRS/FRM/QAS/004')&&reg._arr.some(r=>r.record_number===s3.number),'issued forms register: one issue per supplier and cycle ('+reg._arr.length+')');
ok((await op.call('GET','/api/form-issues')).s===403,'only QA (and admin / management) can view the issued forms register');
let g=await qa.get(s3.id);ok((g.record.data.formIssues||[]).length===1,'the issue is shown on the supplier');
ok((await qa.sig(s3.id,'Rejected',{reason:'Questionnaire not returned'})).ok,'QA rejects a supplier');
ok((await qa.sig(s2.id,'On Hold',{reason:'Licence under review'})).ok,'an approved supplier can be put on hold');
let s5=await req(op,'Not needed Ltd');ok((await qa.sig(s5.id,'Rejected',{reason:'Not required any more'})).ok,'QA rejects at the risk assessment');

// ===== list and report =====
const M=createRequire(import.meta.url)('../public/modules.js').MODULES;
const list=(await qa.call('GET','/api/records?type=vendors'))._arr.sort(M.vendors.listSort).map(r=>+r.data.rpn||0);
ok(list.join()===[...list].sort((x,y)=>y-x).join(),'supplier list ordered by RPN, highest first: '+list.join(', '));
ok((await qa.raw(`/api/records/${s1.id}/report.pdf`)).s===200,'supplier report downloads as one PDF');
g=await qa.get(s1.id);ok(g.signatures.filter(s=>s.meaning==='Supplier approved – QA').length===2&&g.signatures.some(s=>s.meaning==='Risk assessment prepared – QA'),'each qualification cycle e-signed');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
