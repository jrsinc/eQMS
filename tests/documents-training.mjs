// Documents & training end-to-end checks against the JRS SOPs:
// document management (JRS/SOP/QAS/021), training (QAS/003), record retention (QAS/012), register of signatures (QAS/009).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 21000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-dt-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:u,password:p,...extra});
 const go=(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,...extra});
 const put=(id,data,reason='update')=>call('PUT',`/api/records/${id}`,{data,reason});
 const get=(id)=>call('GET',`/api/records/${id}`);
 const create=(type,data,extra={})=>call('POST','/api/records',{type,data,...extra});
 await call('POST','/api/esig-accept'); return {call,sig,go,put,get,create,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const T=new Date().toISOString().slice(0,10);
const D=(d)=>new Date(d+'T00:00:00Z'), iso=(x)=>x.toISOString().slice(0,10);
const addD=(d,n)=>{const x=D(d);x.setUTCDate(x.getUTCDate()+n);return iso(x)};

const qa=await login('qa.lead'), qr=await login('qa.reviewer'), au=await login('author1'), op=await login('operator1'), hod=await login('hod.ops'), cs=await login('cs.manager'), tr=await login('trainer1');
const trainings=async()=>(await qa.call('GET','/api/records?type=training'))._arr;

// ===== Document management – JRS/SOP/QAS/021 =====
const doc=(extra)=>au.create('documents',{docType:'SOP',division:'QAS',title:'Handling of deviations',sites:['JRS INC'],reviewer:'hod.ops',revisionSummary:'New SOP',trainingImpact:'None',content:'1. Purpose …',...extra});
let d1=await doc({sites:['JRS INC','JRS IND'],crossDepts:['OPS'],trainingImpact:'Read & Understand',trainingRoles:['user','cs']});
ok(d1.number==='JRS/SOP/QAS/001'&&d1.data.version==='1.0'&&d1.data.revisionType==='New document','SOP numbered '+d1.number+' v'+d1.data.version);
ok(d1.data.title==='[GLB] HANDLING OF DEVIATIONS','title in capitals with [GLB] for more than one site: '+d1.data.title);
let f1=await au.create('documents',{docType:'Form',division:'OPS',title:'Temperature log',sites:['JRS INC'],reviewer:'hod.ops',revisionSummary:'New form',trainingImpact:'None'});
let w1=await au.create('documents',{docType:'Work Instruction',division:'QAS',title:'Logger download',sites:['JRS INC'],reviewer:'hod.ops',revisionSummary:'New WI',trainingImpact:'None'});
let d2=await doc({title:'Training plan and records',trainingImpact:'Assessment required',trainingRoles:['user']});
ok(f1.number==='JRS/FRM/OPS/001'&&w1.number==='JRS/WI/QAS/001'&&d2.number==='JRS/SOP/QAS/002','numbering per type and division: '+[f1.number,w1.number,d2.number].join(', '));
ok((await qa.put(d1.id,{docType:'Policy'})).s===400,'document type cannot change after creation');
ok((await op.sig(d1.id,'In Review')).s===403,'only the author submits the draft');
ok((await au.sig(d1.id,'In Review')).ok,'author signs and submits for review');
ok((await au.put(d1.id,{content:'changed'})).s===403,'draft locked for the author once in review');
ok((await qr.sig(d1.id,'QA Review')).s===403,'only the assigned reviewer completes the review');
ok((await hod.sig(d1.id,'QA Review')).s===400,'review blocked until cross-functional departments have signed');
const dept=(who,dpt)=>who.call('POST',`/api/records/${d1.id}/dept-approve`,{dept:dpt,comment:'No objection',sigUsername:who.u,password:'Demo-Pass-2026'});
ok((await dept(op,'OPS')).s===403,'cross-functional review needs the Head of Department role');
ok((await dept(hod,'OPS')).ok,'OPS cross-functional review signed');
ok((await hod.sig(d1.id,'QA Review')).ok,'reviewer (SME / Head of Department) signs');
ok((await qr.sig(d1.id,'Approval')).ok,'QA review signed (GDocP, format, numbering)');
await qa.put(d1.id,{effectiveDate:addD(T,10)});
ok((await qr.sig(d1.id,'Approved – Training')).s===403,'the QA reviewer cannot also approve');
await qa.put(d1.id,{effectiveDate:addD(T,3)});
ok((await qa.sig(d1.id,'Approved – Training')).s===400,'effective date must be at least 8 days after approval');
await qa.put(d1.id,{effectiveDate:addD(T,10)});
ok((await qa.sig(d1.id,'Approved – Training')).ok,'Head QA approves the document');
let t1=(await trainings()).filter(t=>t.data.docRef===d1.number);
ok(t1.length===3&&t1.every(t=>t.data.dueDate===addD(T,10)&&t.data.docVersion==='1.0')&&t1.map(t=>t.data.trainee).sort().join()==='cs.manager,operator1,packer1','training assigned on approval, due by the effective date; author, reviewer and approvers exempt');
ok((await qa.sig(d1.id,'Effective')).s===400,'cannot become effective before the effective date');

// ===== Certified trainers – FRM/QAS/032 / 033 =====
const scores={p1:8,p2:8,p3:6,p4:6,p5:10,p6:10,p7:10};
let tc=await hod.create('trainers',{trainer:'trainer1',department:'QAS',qualification:'MSc Pharmacy',experience:'8 years',topics:'GMP, GDP, QA SOPs',...scores});
ok(tc.number==='TRC-001'&&tc.data.total.startsWith('58'),'trainer assessment '+tc.number+', total '+tc.data.total);
ok((await hod.sig(tc.id,'Head of Quality Approval')).s===400,'trainer below the acceptance criterion cannot be submitted');
await hod.put(tc.id,{p5:16,p6:16,p7:16});
ok((await hod.sig(tc.id,'Head of Quality Approval')).ok,'Head of Department submits the trainer assessment');
ok((await qa.sig(tc.id,'Certified')).ok,'Head of Quality adds trainer to the certified trainer list');

// ===== Training with assessment – JRS/SOP/QAS/003 =====
await au.sig(d2.id,'In Review'); await hod.sig(d2.id,'QA Review'); await qr.sig(d2.id,'Approval');
await qa.put(d2.id,{effectiveDate:T,shortNotice:'Urgent CAPA implementation'});
ok((await qa.sig(d2.id,'Approved – Training')).ok,'approved with a QA-justified short effective period');
ok((await qa.sig(d2.id,'Effective')).s===400,'cannot become effective until training is completed');
let t2=(await trainings()).find(t=>t.data.docRef===d2.number&&t.data.trainee==='operator1');
// packer1 (department user) is assigned too; out of scope here
for (const x of (await trainings()).filter(t=>t.data.docRef===d2.number&&t.data.trainee!=='operator1')) await qa.go(x.id,'Cancelled',{reason:'Not in scope of this test'});
ok(t2.data.assessment===true&&t2.data.trainee==='operator1','assessment training assigned to operator1');
ok((await qa.go(t2.id,'In Progress')).s===403,'only the trainee starts the training');
await op.go(t2.id,'In Progress');
const q=(a,b)=>[{question:'When is a deviation reported?',answer:'Within 24 h',marks:'5',obtained:String(a)},{question:'Who classifies it?',answer:'QA',marks:'5',obtained:String(b)}];
await op.put(t2.id,{trainer:'qa.reviewer',trainingDate:T,mode:'Classroom',questions:q(3,3)});
ok((await op.sig(t2.id,'Trainer Evaluation')).ok,'trainee signs the training log');
ok((await qr.sig(t2.id,'Completed')).s===400,'evaluation needs a certified trainer');
await op.put(t2.id,{trainer:'trainer1'});
let g=await qa.get(t2.id);ok(g.record.data.score.startsWith('60%'),'score '+g.record.data.score);
ok((await tr.sig(t2.id,'Completed')).s===400,'score below 80% cannot pass');
ok((await tr.sig(t2.id,'Failed')).ok,'trainer records the unsatisfactory result');
ok((await tr.go(t2.id,'Assigned')).ok,'retraining assigned');
g=await qa.get(t2.id);ok(g.record.data.attempt==='2'&&g.record.data.questions.every(x=>!x.obtained),'attempt 2 with the marks cleared');
await op.go(t2.id,'In Progress'); await op.put(t2.id,{questions:q(5,4)}); await op.sig(t2.id,'Trainer Evaluation');
ok((await tr.sig(t2.id,'Completed')).s===400,'score 90%: the topic not understood must be recorded');
await tr.put(t2.id,{gapTopic:'Classification of criticality – explained again, understood'});
ok((await tr.sig(t2.id,'Completed')).ok,'certified trainer evaluates and signs (90%)');
g=await qa.get(t2.id);ok(['Trained – trainee','Evaluated – certified trainer'].every(m=>g.signatures.some(s=>s.meaning===m)),'training log signed by both trainee and trainer');
ok((await qa.sig(d2.id,'Effective')).ok,'document effective once training is complete');
g=await qa.get(d2.id);ok(g.record.data.nextReview===addD(T,1096),'periodic review due in 3 years: '+g.record.data.nextReview);
let sr=await qa.create('training',{trainee:'cs.manager',title:'QA SOP self-reading',docRef:d2.number,trainingType:'Self-reading (Manager and above)',dueDate:addD(T,7)});
await cs.go(sr.id,'In Progress');
ok((await cs.sig(sr.id,'Completed')).ok,'self-reading signed as read and understood by the trainee');
const opT=t1.find(t=>t.data.trainee==='operator1'); await op.go(opT.id,'In Progress');
ok((await op.sig(opT.id,'Completed')).s===400,'read & understand training cannot skip the certified trainer');
// revisions
ok((await au.call('POST',`/api/records/${d2.id}/revise`,{revisionType:'Revision – technical / procedural change',reason:'New step'})).s===400,'a revision with changes needs an approved change control');
let r2=await au.call('POST',`/api/records/${d2.id}/revise`,{revisionType:'Periodic review – no change',reason:'Periodic review'});
ok(r2.number===d2.number&&r2.data.version==='2.0'&&r2.data.revisionType==='Periodic review – no change','periodic review without change issues v2.0 of '+r2.number);
await au.sig(r2.id,'In Review'); await hod.sig(r2.id,'QA Review'); await qr.sig(r2.id,'Approval');
await qa.put(r2.id,{effectiveDate:T,shortNotice:'No change'}); await qa.sig(r2.id,'Approved – Training');
ok(!(await trainings()).some(t=>t.data.docRef===d2.number&&t.data.docVersion==='2.0'),'no training for a periodic review without change');
await qa.sig(r2.id,'Effective');
g=await qa.get(d2.id);ok(g.record.status==='Superseded','v1.0 superseded when v2.0 becomes effective');
ok((await qa.sig(r2.id,'Obsolete',{reason:'Merged into another SOP'})).s===400,'discontinuation needs a pre-approved change control');

// ===== Training need identification and certificate – FRM/QAS/030 / 031 =====
let tn=await hod.create('tni',{employee:'operator1',designation:'Warehouse operator',department:'OPS',reason:'New joiner (induction)',plan:[{subject:'Temperature log',refDoc:f1.number,type:'Induction'}]});
ok((await hod.sig(tn.id,'Head of Quality Approval')).s===400,'TNI must include QA SOPs');
await hod.put(tn.id,{plan:[{subject:'Temperature log',refDoc:f1.number,type:'Induction'},{subject:'Training SOP',refDoc:d2.number,type:'SOP training – read & understand'}]});
ok((await hod.sig(tn.id,'Head of Quality Approval')).ok,'Head of Department prepares the TNI');
ok((await qa.sig(tn.id,'Training In Progress')).ok,'Head of Quality approves the TNI');
let tt=(await trainings()).filter(t=>t.data.sourceRecord===tn.number);
ok(tt.length===2,'TNI approval assigns '+tt.length+' trainings');
await hod.put(tn.id,{area:'Warehouse – receipt and storage'});
ok((await hod.sig(tn.id,'Certificate Issued')).s===400,'certificate only after all TNI training is completed');
for (const t of tt) { await op.go(t.id,'In Progress'); await op.put(t.id,{trainer:'trainer1',trainingDate:T,mode:'On-the-job'}); await op.sig(t.id,'Trainer Evaluation'); await tr.sig(t.id,'Completed'); }
ok((await hod.sig(tn.id,'Certificate Issued')).ok,'line manager issues the training certificate');
ok((await qa.sig(tn.id,'Certified')).ok,'Head of Quality approves the certificate');
g=await qa.get(tn.id);ok(g.record.data.certificateDate===T,'certificate effective on the Head of Quality signature date');

// ===== Record retention – JRS/SOP/QAS/012 =====
const arc=(extra)=>qa.create('archives',{title:'CAPA register 2025',recordType:'QMS records (change control, deviations, CAPA, complaints, logs)',mode:'Physical',uniqueId:'QMS-2025-01',boxId:'BOX-12',location:'On-site archive',...extra});
let a1=await arc({location:'Off-site storage (qualified vendor)'});
ok(a1.data.retention==='15 years from archival','retention period '+a1.data.retention);
ok((await qa.sig(a1.id,'Archived')).s===400,'archiving needs verification and the archival date');
await qa.put(a1.id,{verified:true,archivalDate:T});
ok((await qa.sig(a1.id,'Archived')).s===400,'off-site storage needs an approved vendor');
await qa.put(a1.id,{location:'On-site archive'});
ok((await qa.sig(a1.id,'Archived')).ok,'archived by QA');
g=await qa.get(a1.id);ok(g.record.data.destroyFrom===addD(T,Math.round(15*365.25)),'eligible for destruction from '+g.record.data.destroyFrom);
ok((await qa.sig(a1.id,'Retrieved')).s===400,'retrieval needs a request in the retrieval log');
await qa.put(a1.id,{retrievals:[{date:T,by:'External auditor',purpose:'Customer audit'}]});
ok((await qa.sig(a1.id,'Retrieved')).ok,'retrieval approved by QA');
ok((await qa.sig(a1.id,'Archived')).s===400,'re-archival needs the return recorded');
await qa.put(a1.id,{retrievals:[{date:T,by:'External auditor',purpose:'Customer audit',returned:T,rearchived:T}]});
ok((await qa.sig(a1.id,'Archived')).ok,'returned and re-archived');
await qa.put(a1.id,{destructionDate:T,destructionMethod:'Paper shredder'});
ok((await qa.sig(a1.id,'Destroyed',{reason:'test'})).s===400,'destruction blocked before the retention period ends');
let a2=await arc({title:'Quality agreement Sponsor A',recordType:'Contracts / agreements (clients, vendors, consultants)'});
ok(a2.data.retention==='Permanent','contracts kept permanently');
let a3=await arc({title:'Study ABC-301 shipment records',recordType:'Project-specific files (project manual, packaging records, label proofs, shipment and receipt documents)',client:'Sponsor A',clientRetention:'Sponsor letter 2026-10-01: destroy after study close-out'});
for (const a of [a2,a3]) { await qa.put(a.id,{verified:true,archivalDate:T}); await qa.sig(a.id,'Archived'); await qa.put(a.id,{destructionDate:T,destructionMethod:'Paper shredder'}); }
ok((await qa.sig(a2.id,'Destroyed',{reason:'x'})).s===400,'permanent records cannot be destroyed');
ok((await qa.sig(a3.id,'Destroyed',{reason:'Client instruction'})).ok,'client-specific records destroyed on the client instruction');

// ===== Register of signatures – JRS/SOP/QAS/009 =====
const ad=await login('admin','ChangeMe-2026!');
ok((await ad.call('PUT','/api/users/operator1',{designation:'Warehouse operator',department:'OPS',reason:'Signature register'})).ok,'admin records designation and department');
ok((await op.call('POST','/api/signature/register',{initials:'rp',signature:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',accept:true,password:'Demo-Pass-2026'})).ok,'the employee registers their own initials and signature');
let us=(await ad.call('GET','/api/users'))._arr, o=us.find(u=>u.username==='operator1');
ok(o.initials==='RP'&&o.department==='OPS'&&o.esig_accepted&&o.reregisterBy===addD(o.esig_accepted.slice(0,10),1826),'register shows registration date and re-registration due in 5 years: '+o.reregisterBy);
await ad.call('PUT','/api/users/stat1',{active:false,reason:'Left the company'});
us=(await ad.call('GET','/api/users'))._arr;ok(us.find(u=>u.username==='stat1').inactive_date===T,'separation date kept in the register');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
