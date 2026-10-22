// Quality Events end-to-end checks against the JRS SOPs:
// investigations (JRS/SOP/QAS/022), CAPA (QAS/006), change control (QAS/007), extension requests (form QAS/045).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-qe-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:u,password:p,...extra});
 const go=(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,...extra});
 const put=(id,data,reason='update')=>call('PUT',`/api/records/${id}`,{data,reason});
 const get=(id)=>call('GET',`/api/records/${id}`);
 await call('POST','/api/esig-accept'); return {call,sig,go,put,get,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
// UTC date helpers (same rules as the server)
const T=new Date().toISOString().slice(0,10), Y=T.slice(0,4), YY=T.slice(2,4);
const D=(d)=>new Date(d+'T00:00:00Z'), iso=(x)=>x.toISOString().slice(0,10);
const addD=(d,n)=>{const x=D(d);x.setUTCDate(x.getUTCDate()+n);return iso(x)};
const addM=(d,n)=>{const x=D(d);x.setUTCMonth(x.getUTCMonth()+n);return iso(x)};
const addWD=(d,n)=>{const x=D(d);while(n>0){x.setUTCDate(x.getUTCDate()+1);if(x.getUTCDay()%6)n--;}return iso(x)};

const qa=await login('qa.lead'), qr=await login('qa.reviewer'), au=await login('author1'), op=await login('operator1'), hod=await login('hod.ops'), pm=await login('pm1'), rp=await login('rp1'), pk=await login('packer1'), cs=await login('cs.manager'), tr=await login('trainer1');
const PW='Demo-Pass-2026';
let p;

// ===== Deviations and complaints – JRS/SOP/QAS/022 with the JRS workflow =====
// request (any department) → QA: approve (number assigned automatically) / need to update / reject → Part A (initiator or responsible department)
// → Part B (QA; may return Part A) → Part C investigation (responsible person / department) → Head of Department → QA evaluation and closure
const req=(invType,title,extra={},who=op)=>who.call('POST','/api/records',{type:'investigations',data:{invType,site:'JRS INC',title,dateIdentified:T,requestDetails:'Logger in cold room 2 showed 9.1 °C for 40 min',...extra}});
const open=async(r)=>{await qa.sig(r.id,'Initiation'); return (await qa.get(r.id)).record;};
let d1=await req('Deviation','Cold room 2 temperature excursion',{description:'not allowed yet',respPerson:'packer1'});
ok(/^REQ-\d{4}-\d{4}$/.test(d1.number)&&d1.status==='Requested'&&d1.data.qaNotified===T,'request to QA gets a temporary request number '+d1.number);
ok(!d1.data.description&&!d1.data.dateOpened,'only the request fields are entered with the request');
ok(d1.data.respDept==='PKG','responsible department follows the responsible person (packer1 → PKG)');
ok((await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation',site:'JRS INC',title:'x',dateIdentified:T}})).s===400,'request details are required');
// QA: need to update
ok((await op.sig(d1.id,'Initiation')).s===403,'only QA approves the request');
ok((await qa.go(d1.id,'Request Update')).s===400,'"need to update" needs a reason');
ok((await qa.go(d1.id,'Request Update',{reason:'Add the logger ID'})).ok,'QA returns the request: need to update');
ok((await cs.go(d1.id,'Requested')).s===403,'only the initiator resubmits the request');
await op.put(d1.id,{requestDetails:'Logger CR2-01 in cold room 2 showed 9.1 °C for 40 min'},'Logger ID added');
ok((await op.go(d1.id,'Requested')).ok,'initiator updates and resubmits the request');
// QA approval: the number is assigned at once
ok((await qa.sig(d1.id,'Initiation')).ok,'QA approves the request');
let g=await qa.get(d1.id);
ok(g.record.number===`JRS-DEVN-${Y}-001`&&g.record.data.requestNo===d1.number&&g.record.data.dateOpened===T&&g.record.status==='Initiation','number assigned automatically on approval: '+g.record.number+' (request '+d1.number+')');
d1=g.record;
let c1=await open(await req('Complaint','Damaged shipper received at site',{respPerson:'operator1'}));
ok(c1.number===`JRS-COM-${Y}-001`,'complaint uses its own sequence '+c1.number);
let d2r=await req('Deviation','Label count discrepancy',{dateIdentified:addD(T,-3),respPerson:'operator1'});
ok(d2r.data.reporting.startsWith('Late')&&d1.data.reporting.startsWith('Met'),'24-hour reporting to QA evaluated (met / late)');
let d2=await open(d2r);ok(d2.number===`JRS-DEVN-${Y}-002`,'second deviation '+d2.number);
let d3=await req('Deviation','Raised in error');
ok((await qa.sig(d3.id,'Initiation')).s===400,'approval needs the responsible person');
ok((await qa.sig(d3.id,'Rejected')).s===400,'rejecting a request needs a reason');
ok((await qa.sig(d3.id,'Rejected',{reason:'Not a quality event'})).ok,'QA can reject a request (no number assigned)');
// visibility: initiator, responsible person / department, its Head; QA and management
ok((await tr.get(d1.id)).s===404&&!(await tr.call('GET','/api/records?type=investigations'))._arr.some(r=>r.id===d1.id),'a user outside the responsible department cannot see the deviation');
ok((await pk.get(d1.id)).record&&(await cs.get(d1.id)).record&&(await op.get(d1.id)).record,'responsible person, Head of Packaging and initiator see the deviation');
ok((await hod.get(d1.id)).record,'Head of Operations (Packaging sits under Operations) sees the deviation');
// Part A – initiator or responsible department, saved as drafts, signed on submit
ok((await op.put(d1.id,{invType:'Complaint'})).s===400,'investigation type cannot change after creation');
ok((await qa.put(d1.id,{description:'x'})).s===403,'QA does not write Part A');
ok((await tr.put(d1.id,{description:'x'})).s===404,'other departments cannot change the deviation');
ok((await pk.put(d1.id,{criticality:'Major'})).s===403,'the responsible person cannot fill in Part B');
ok((await pk.put(d1.id,{description:'Logger showed 9.1 °C for 40 min'},'Draft')).changes===1,'responsible person saves a Part A draft');
let eo=await pk.sig(d1.id,'QA Review');ok(eo.s===400&&/Event origin/.test(eo.error),'Event origin is required before Part A is submitted');
ok((await op.put(d1.id,{eventOrigin:'Cold room 2'},'Draft')).changes===1,'initiator adds to the Part A draft');
ok((await pk.sig(d1.id,'QA Review')).s===400,'Part A needs the description and immediate action');
await pk.put(d1.id,{immediate:'Stock quarantined, logger data saved'});
ok((await qr.sig(d1.id,'QA Review')).s===403,'QA cannot submit Part A');
ok((await pk.sig(d1.id,'QA Review')).ok,'responsible person signs and submits Part A to QA');
// Part B – QA review; "need to update" reopens Part A
ok((await pk.put(d1.id,{description:'changed'})).s===403,'Part A cannot be changed while QA reviews it');
ok((await qa.go(d1.id,'Part A Update')).s===400,'returning Part A needs a reason');
ok((await qa.go(d1.id,'Part A Update',{reason:'State how long the door was open'})).ok,'QA returns Part A: need to update');
ok((await qa.put(d1.id,{criticality:'Major'})).s===403,'Part B waits until Part A is resubmitted');
await pk.put(d1.id,{description:'Logger showed 9.1 °C for 40 min; door open about 10 min'},'QA request');
ok((await pk.sig(d1.id,'QA Review')).ok,'responsible person updates and resubmits Part A');
ok((await qa.sig(d1.id,'Investigation')).s===400,'Part B needs criticality and impacted areas');
await qa.put(d1.id,{criticality:'Critical',impactedAreas:['Storage'],qaReviewComment:'Critical: cold chain'},'Part B');
g=await qa.get(d1.id);
ok(g.record.data.dueDate===addWD(T,10),'Critical event due in 10 working days: '+g.record.data.dueDate);
ok((await op.sig(d1.id,'Investigation')).s===403,'only QA submits Part B');
ok((await qa.sig(d1.id,'Investigation')).ok,'QA signs and submits Part B – investigation starts');
// Parts A and B are locked for everyone
ok((await pk.put(d1.id,{description:'changed'})).s===403&&(await qa.put(d1.id,{criticality:'Major'})).s===403,'after QA submits Part B nobody can change Parts A and B');
ok((await qa.go(d1.id,'Part A Update',{reason:'x'})).s===409,'Part A can no longer be returned');
// Part C – investigation, updated each time, signed on submit
const inv={investigation:'Logger data and door alarm log reviewed',historicalReview:'No similar events in the last 12 months',rootCause:'Door left ajar during picking',riskAssessment:'Exposure within stability data',conclusion:'No product impact'};
ok((await op.put(d1.id,inv)).s===403,'the initiator from another department does not write Part C');
ok((await qa.put(d1.id,inv)).s===403,'QA does not write Part C');
await pk.put(d1.id,{invLog:[{date:T,entry:'Logger data downloaded'}]},'Investigation update 1');
await pk.put(d1.id,{invLog:[{date:T,entry:'Logger data downloaded'},{date:T,entry:'Door alarm log reviewed'}],...inv},'Investigation update 2');
g=await qa.get(d1.id);ok(g.record.data.invLog.length===2,'investigation log updated each time (2 entries)');
ok((await pk.sig(d1.id,'HOD Approval')).s===400,'submission blocked until the CAPA decision is recorded');
await pk.put(d1.id,{capaRequired:'No'});
ok((await pk.sig(d1.id,'HOD Approval')).s===400,'"no CAPA" needs a justification');
await pk.put(d1.id,{capaRequired:'Yes'});
ok((await tr.sig(d1.id,'HOD Approval')).s===404,'other departments cannot submit the investigation');
ok((await pk.sig(d1.id,'HOD Approval')).ok,'responsible person signs and submits the investigation (Part C)');
g=await qa.get(d1.id);ok(g.record.data.hodApprover==='cs.manager','approver from the organogram: Head of Packaging');
ok((await pk.put(d1.id,{conclusion:'changed'})).s===403,'Part C locked while the Head of Department reviews');
// Part D – Head of Department
ok((await hod.sig(d1.id,'QA Evaluation')).s===403,'only the Head named on the record approves');
ok((await cs.sig(d1.id,'Investigation')).s===400,'rejection needs a reason');
ok((await cs.sig(d1.id,'Investigation',{reason:'Add the training records of the picker'})).ok,'Head of Department rejects – back to the responsible person');
await pk.put(d1.id,{invLog:[...g.record.data.invLog,{date:T,entry:'Picker training records checked'}]},'HOD request');
await pk.sig(d1.id,'HOD Approval');
await cs.put(d1.id,{hodComment:'Investigation adequate'});
ok((await cs.sig(d1.id,'QA Evaluation')).ok,'Head of Department approves');
// Part E – QA evaluation and closure
ok((await qa.sig(d1.id,'Investigation')).s===400,'QA rejection needs a comment');
await qa.put(d1.id,{finalDisposition:'Release / use as is',customerApproval:'Not applicable (no customer impact)',qaEvalComment:'Root cause confirmed'});
ok((await qa.sig(d1.id,'Closed')).s===400,'closure blocked: CAPA required but none linked');
let k1=await op.call('POST','/api/records',{type:'capa',linkFrom:d1.id,data:{title:'Door alarm for cold room 2',respDept:'OPS',respPerson:'operator1',dueDate:addD(T,60),source:'Deviation',sourceRecord:d1.number,nonconformance:'Door left ajar',corrective:'Install a door-open alarm',caDue:addD(T,30)}});
ok(k1.number===`CAPA/OPS/001/${YY}`,'CAPA numbered by department and year: '+k1.number);
g=await qa.get(d1.id);ok(g.links.some(l=>l.id===k1.id),'CAPA linked to the deviation');
ok((await qa.sig(d1.id,'Customer Approval')).s===400,'no customer impact: the report does not go to the customer');
ok((await qa.sig(d1.id,'Closed')).ok,'QA approves and closes (final report)');
g=await qa.get(d1.id);
const want=['Request approved – QA (number assigned)','Part A submitted – initiator / responsible person','Part A updated – initiator / responsible person','Part B approved – QA','Investigation completed – responsible person','Rejected – Head of Department','Approved – Head of Department','Approved and closed – QA'];
ok(want.every(m=>g.signatures.some(s=>s.meaning===m)),'every stage signed and dated: '+g.signatures.map(s=>s.fullname.split(' (')[0]+' – '+s.meaning.split(' – ')[0]).join('; '));

// complaint with customer impact; the Head is the responsible person → the Head above approves
await op.put(c1.id,{eventOrigin:'Investigator site',description:'Shipper crushed on arrival',immediate:'Site asked to quarantine kit',customer:'Sponsor A',receivedVia:'Email',customerNotified:T});
await op.sig(c1.id,'QA Review');
await qa.put(c1.id,{criticality:'Major',impactedAreas:['Distribution']});
g=await qa.get(c1.id);ok(g.record.data.dueDate===addD(T,30),'Major event due in 30 calendar days: '+g.record.data.dueDate);
ok(g.record.data.notifyStatus.startsWith('Met'),'customer notified within 3 days');
await qa.sig(c1.id,'Investigation');
await op.put(c1.id,{...inv,capaRequired:'No',capaJustification:'Isolated courier handling damage; courier informed'});
await op.sig(c1.id,'HOD Approval');
g=await qa.get(c1.id);ok(g.record.data.hodApprover==='hod.ops','Head of Operations approves for Operations');
await hod.sig(c1.id,'QA Evaluation');
await qa.put(c1.id,{finalDisposition:'Destroy',customerApproval:'Pending',qaEvalComment:'Report to sponsor'});
ok((await qa.sig(c1.id,'Closed')).s===400,'customer impacted: use "send report to customer"');
p=await qa.sig(c1.id,'Customer Approval');
ok(p.status==='Customer Approval','customer impacted: QA approval sends the report to the customer');
ok((await pm.get(c1.id)).record,'Project Manager sees the complaint at customer approval');
await qa.put(c1.id,{reportSent:T});
g=await qa.get(c1.id);ok(g.record.data.nextFollowUp===`Follow-up 1 due ${addD(T,15)}`,'follow-up reminder: '+g.record.data.nextFollowUp);
await qa.put(c1.id,{customerApproval:'Deemed closed – no response after 3 follow-ups',reportSent:addD(T,-20),followUp1:addD(T,-15),followUp2:addD(T,-10),followUp3:addD(T,-5)});
ok((await pm.sig(c1.id,'Closed')).s===400,'deemed closure blocked before 45 days');
await qa.put(c1.id,{reportSent:addD(T,-50),followUp1:addD(T,-35),followUp2:addD(T,-20),followUp3:addD(T,-5)});
ok((await pm.sig(c1.id,'Closed')).ok,'deemed closure after 3 follow-ups and 45 days (Project Manager)');
// a Head of Department never approves their own investigation: the Head of the parent department does
let d4=await open(await req('Deviation','Carton print smudged',{respPerson:'cs.manager'},pk));
await cs.put(d4.id,{eventOrigin:'Packaging line 1',description:'Smudged print on 20 cartons',immediate:'Cartons segregated'}); await cs.sig(d4.id,'QA Review');
await qa.put(d4.id,{criticality:'Minor',impactedAreas:['Packaging (kitting & assembly)']}); await qa.sig(d4.id,'Investigation');
await cs.put(d4.id,{...inv,capaRequired:'No',capaJustification:'One-off'}); await cs.sig(d4.id,'HOD Approval');
g=await qa.get(d4.id);ok(g.record.data.hodApprover==='hod.ops','Head of Packaging is the responsible person: Head of Operations (parent department) approves');
ok((await cs.sig(d4.id,'QA Evaluation')).s===403,'the Head cannot approve their own investigation');

// ===== CAPA – JRS/SOP/QAS/006 (form JRS/FRM/QAS/006 v3.0) =====
// Part A (initiator) → Head of the responsible department (comment, approve / reject) → QA Part B (comment, effectiveness check)
// → Part C (responsible department) → Head verifies → QA Part D closure → Part E effectiveness (when required)
let k2=await qa.call('POST','/api/records',{type:'capa',data:{title:'Update picking SOP',respDept:'QAS',respPerson:'qa.reviewer',dueDate:addD(T,45),source:'Internal audit / self-inspection',nonconformance:'SOP lacks door-closure step'}});
let k3=await op.call('POST','/api/records',{type:'capa',data:{title:'Retrain warehouse staff',respDept:'QAS',respPerson:'operator1',dueDate:addD(T,45),source:'Deviation',nonconformance:'Training gap',corrective:'Retrain',caDue:addD(T,20)}});
ok(k2.number===`CAPA/QAS/001/${YY}`&&k3.number===`CAPA/QAS/002/${YY}`,'serial restarts per department: '+k2.number+', '+k3.number);
ok((await qa.sig(k2.id,'HOD Pre-Approval')).s===400,'Part A needs at least one proposed action with a due date');
// visibility: responsible department, its Head, QA
ok((await tr.get(k1.id)).s===404&&(await cs.get(k1.id)).s===404,'other departments cannot see the CAPA');
ok((await hod.get(k1.id)).record&&(await qr.get(k1.id)).record,'the responsible department\'s Head and QA can see it');
// Part A – initiator
ok((await hod.put(k1.id,{nonconformance:'x'})).s===403,'only the initiator writes Part A');
ok((await au.sig(k1.id,'HOD Pre-Approval')).s===403,'only the initiator submits Part A');
ok((await op.sig(k1.id,'HOD Pre-Approval')).ok,'initiator signs and submits Part A to the Head of Department');
g=await qa.get(k1.id);ok(g.record.data.hodApprover==='hod.ops','Head of the responsible department from the organogram: Head of Operation');
ok((await op.put(k1.id,{nonconformance:'changed'})).s===403,'Part A is locked once submitted');
// Head of Department – comment, approve or reject
ok((await hod.sig(k1.id,'QA Pre-Approval')).s===400,'the Head of Department comment is required');
ok((await hod.sig(k1.id,'Initiated',{reason:'Add the alarm delay to the CAPA description'})).ok,'Head of Department rejects – back to the initiator');
await op.put(k1.id,{capaDetail:'Door-open alarm with a 2-minute delay'},'Head of Department request');
await op.sig(k1.id,'HOD Pre-Approval');
await hod.put(k1.id,{hodComment:'Agreed – alarm to be installed by Operation'});
ok((await qa.sig(k1.id,'QA Pre-Approval')).s===403,'only the Head named on the CAPA approves');
ok((await hod.sig(k1.id,'QA Pre-Approval')).ok,'Head of Department approves with a comment');
// QA – Part B
ok((await hod.put(k1.id,{qaPreComment:'x'})).s===403,'only QA writes the QA part of Part B');
await qa.put(k1.id,{qaPreComment:'Plan adequate',ecRequired:'Not required'});
ok((await qa.sig(k1.id,'Implementation')).s===400,'effectiveness check "not required" needs a reason');
await qa.put(k1.id,{ecRequired:'Required',ecDue:'3 months'});
ok((await qa.sig(k1.id,'Implementation')).ok,'QA reviews, comments and approves Part B');
// Part C – responsible department
ok((await qa.put(k1.id,{caDone:'x'})).s===403,'QA does not write Part C');
ok((await qr.sig(k1.id,'HOD Verification')).s===403,'only the responsible person / department submits Part C');
ok((await op.sig(k1.id,'HOD Verification')).s===400,'implementation needs the Part C entries');
await op.put(k1.id,{caDone:'Door alarm installed and tested',caDate:T,caRef:'WO-1001'});
ok((await op.sig(k1.id,'HOD Verification')).ok,'responsible person completes and signs Part C');
// Head of Department verifies
ok((await qa.sig(k1.id,'QA Closure')).s===403,'only the Head of Department verifies');
await hod.put(k1.id,{hodVerifyComment:'Alarm tested on site'});
ok((await hod.sig(k1.id,'QA Closure')).ok,'Head of Department verifies the implementation');
// QA – Part D closure, Part E effectiveness
await qa.put(k1.id,{closureRemarks:'Evidence reviewed'});
ok((await qa.sig(k1.id,'Closed')).s===400,'cannot skip a required effectiveness check');
ok((await qa.sig(k1.id,'Effectiveness Check')).ok,'QA completes Part D – effectiveness check pending');
g=await qa.get(k1.id);ok(g.record.data.ecDueDate===addM(T,3),'effectiveness check due in 3 months: '+g.record.data.ecDueDate);
await qa.put(k1.id,{effective:'No',ecQaComment:'Door found open again'});
ok((await qa.sig(k1.id,'Closed')).ok,'effectiveness recorded');
g=await qa.get(k1.id);let fu=g.links.find(l=>l.type==='capa'&&l.number===`CAPA/OPS/002/${YY}`);
ok(!!fu,'not effective: follow-up CAPA raised and linked '+(fu&&fu.number));
const wantK=['Part A submitted – initiator','Rejected – Head of Department','Pre-approved – Head of Department','Pre-approved – QA','Implemented – responsible person','Verified – Head of Department','Closed – QA (effectiveness check pending)','Effectiveness verified – QA'];
ok(wantK.every(m=>g.signatures.some(s=>s.meaning===m)),'every CAPA step signed and dated');
// segregation of duties
await qa.put(k2.id,{correction:'Revise SOP',corrDue:addD(T,10)});
await qa.sig(k2.id,'HOD Pre-Approval'); await qa.put(k2.id,{hodComment:'OK'}); await qa.sig(k2.id,'QA Pre-Approval');
await qa.put(k2.id,{qaPreComment:'OK',ecRequired:'Not required',ecReason:'Editorial SOP change'});
ok((await qa.sig(k2.id,'Implementation')).s===403,'CAPA initiator cannot give the QA pre-approval');
ok((await qr.sig(k2.id,'Implementation')).ok,'second QA person approves');


// ===== Extension requests – form JRS/FRM/QAS/045 =====
// extension requests are raised from the record (the "Request extension" button beside its due date)
const idOf=async(no)=>((await qa.call('GET','/api/records'))._arr.find(r=>r.number===no)||{}).id;
const er=async(documentId,requestedDate,extra={})=>op.call('POST','/api/records',{type:'extensions',linkFrom:await idOf(documentId),data:{documentId,requestedDate,justification:'Awaiting vendor report',interimUpdate:'Investigation 70% complete',impactAssessment:'No product impact; stock on hold',...extra}});
ok((await op.call('POST','/api/records',{type:'extensions',data:{documentId:d2.number,requestedDate:addD(T,40),justification:'x',interimUpdate:'x',impactAssessment:'x'}})).s===400,'no separate extension form: it is requested from the record');
ok((await er(d2.number,addD(T,40))).s===400,'extension refused while the record has no due date');
await op.put(d2.id,{eventOrigin:'Labelling room',description:'Label count off by 2',immediate:'Labels quarantined'}); await op.sig(d2.id,'QA Review');
await qa.put(d2.id,{criticality:'Major'});
ok((await er(d2.number,addD(T,10))).s===400,'requested date must be later than the current due date');
let e1=await er(d2.number,addD(T,45));
ok(e1.number===`ER-${Y}-001`&&e1.data.recordType==='Deviation'&&e1.data.originalDue===addD(T,30)&&e1.data.hodApprover==='hod.ops'&&e1.data.requesterDept==='OPS','extension request '+e1.number+' for '+d2.number+': numbered automatically, Head of Operation approves');
ok((await er(d2.number,addD(T,50))).s===400,'only one extension per record');
await op.sig(e1.id,'HOD Review');
ok((await qa.sig(e1.id,'Head of Quality Approval')).s===403,'Head of Department signs before Head of Quality');
await hod.sig(e1.id,'Head of Quality Approval');
ok((await qa.sig(e1.id,'Approved')).ok,'Head of Quality approves the extension');
g=await qa.get(d2.id);ok(g.record.data.extendedDue===addD(T,45)&&g.links.some(l=>l.id===e1.id),'deviation extended due date set and linked: '+g.record.data.extendedDue);
let k4=await op.call('POST','/api/records',{type:'capa',data:{title:'Late CAPA',respDept:'OPS',respPerson:'operator1',dueDate:addD(T,-1),source:'Other',nonconformance:'x'}});
ok((await er(k4.number,addD(T,20))).s===400,'extension refused after the due date has passed');
ok((await er(d1.number,addD(T,60))).s===400,'extension refused for a closed record');
let e2=await er(k3.number,addD(T,40),{scope:'Corrective action (CAPA)'});
ok(e2.number===`ER-${Y}-002`&&e2.data.originalDue===addD(T,20),'CAPA action-level extension request '+e2.number);

// ===== Change control – JRS/SOP/QAS/007 =====
const ROWS=['Subject / patient safety','Product quality / integrity','Data integrity (ALCOA+)','GMP / GCP / GDP compliance','Client requirement (client notification / approval required)','Regulatory filings','Validation / qualification','Cold chain','Labelling / packaging','Computer system (21 CFR Part 11)','Training requirement'];
const check=(n)=>Object.fromEntries(ROWS.slice(0,n).map(r=>[r,{v:r==='Cold chain'?'Yes':'No',r:''}]));
// Part A (initiator, drafts) → Part B (QA: approve with number / reject) → responsible person → Head of the responsible department
// → QA approval (effectiveness check, other departments) → other department approvals → implementation → change control report
// (department) → QA review report → closed, or effectiveness check after the assigned period
const partA={nature:'Permanent',respPerson:'operator1',dueDate:addD(T,60),changeType:['Equipment / instrument'],impactedAreas:['Storage (+2 to +8 °C)'],description:'Install a second calibrated logger',justification:'Monitoring redundancy'};
let cc=await au.call('POST','/api/records',{type:'changes',data:{title:'Add a second data logger to cold room 2',nature:'Permanent',respPerson:'operator1',description:'Install a second calibrated logger',classification:'Minor'}});
ok(/^REQ-CC-\d{4}-0001$/.test(cc.number)&&cc.status==='Draft'&&!cc.data.classification,'Part A saved as a draft with a request number '+cc.number+' (QA fields not taken)');
ok(cc.data.respDept==='OPS','responsible department follows the responsible person (operator1 → OPS)');
ok((await tr.get(cc.id)).record,'every department can view change controls');
ok((await qa.put(cc.id,{justification:'x'})).s===403,'only the initiator writes Part A');
ok((await au.put(cc.id,{classification:'Minor'})).s===403,'the initiator cannot fill in Part B');
await au.put(cc.id,{...partA,dueDate:addD(T,95)},'Draft');
ok((await au.sig(cc.id,'QA Review')).s===400,'permanent change must be due within 90 days');
await au.put(cc.id,{dueDate:addD(T,60)});
ok((await tr.sig(cc.id,'QA Review')).s===403,'other departments cannot submit Part A');
ok((await au.sig(cc.id,'QA Review')).ok,'initiator signs and submits Part A to QA');
ok((await au.put(cc.id,{description:'changed'})).s===403,'Part A is locked once submitted');
ok((await qa.go(cc.id,'Draft',{reason:'Add the logger model'})).ok,'QA returns Part A: need to update');
await au.put(cc.id,{description:'Install a second calibrated logger (model TL-200)'},'QA request');
ok((await op.put(cc.id,{current:'Single logger in cold room 2'},'Draft')).changes===1,'anyone in the responsible department can edit the draft');
ok((await tr.put(cc.id,{current:'x'},'Draft')).s===403,'other departments cannot edit the draft');
ok((await au.sig(cc.id,'QA Review')).ok,'initiator updates and resubmits Part A');
// Part B – QA
const plan=[{activity:'Install logger',dept:'OPS',person:'operator1',due:addD(T,20)},{activity:'Update SOP',dept:'QAS',person:'qa.reviewer',due:addD(T,30)}];
await qa.put(cc.id,{impactCheck:check(5),impactSummary:'Cold chain monitoring only',classification:'Major',classRationale:'Affects GDP storage monitoring',riskRequired:'Not required',plan,clientPre:'Not required',clientPost:'Required'});
ok((await qa.sig(cc.id,'RP Review')).s===400,'Part B blocked: impact checklist incomplete');
await qa.put(cc.id,{impactCheck:check(11)});
ok((await qa.sig(cc.id,'RP Review')).s===400,'Major change requires a risk assessment');
await qa.put(cc.id,{riskRequired:'Required'});
ok((await qa.sig(cc.id,'RP Review')).s===400,'a required risk assessment needs its reference');
let rk=await qa.call('POST','/api/records',{type:'risks',data:{site:'JRS INC',title:'Logger failure undetected',fmea:[{id:'1',step:'Cold storage',mode:'Logger failure',s:'3',o:'2',d:'2'}]}});
ok((await qa.put(cc.id,{riskRef:'RA/JRS/0000-999'})).s===400,'risk reference must be an existing risk assessment');
await qa.put(cc.id,{riskRef:rk.number});
ok((await qa.sig(cc.id,'RP Review')).s===400,'client communication needs a responsible Project Manager');
await qa.put(cc.id,{pm:'pm1'});
ok((await qa.sig(cc.id,'RP Review')).ok,'QA approves Part B');
g=await qa.get(cc.id);
ok(g.record.number===`CC-JRS-${Y}-001`&&g.record.data.requestNo===cc.number&&g.record.data.dateOpened===T,'number assigned on QA approval: '+g.record.number+' (request '+cc.number+')');
ok((await qa.put(cc.id,{classification:'Minor'})).s===403,'Part B is locked once approved');
// responsible person, then Head of the responsible department
ok((await au.sig(cc.id,'HOD Approval')).s===403,'only the responsible person reviews');
await op.put(cc.id,{rpComment:'Agreed; installation by OPS'});
ok((await op.sig(cc.id,'HOD Approval')).ok,'responsible person reviews and approves Parts A and B');
g=await qa.get(cc.id);ok(g.record.data.hodApprover==='hod.ops','approver from the organogram: Head of Operation');
ok((await cs.sig(cc.id,'QA Approval')).s===403,'only the Head named on the record approves');
ok((await hod.sig(cc.id,'QA Review')).s===400,'Head of Department rejection needs a reason');
ok((await hod.sig(cc.id,'QA Review',{reason:'Add validation of the new logger to the plan'})).ok,'Head of Department rejects – back to QA');
await qa.put(cc.id,{plan:[...plan,{activity:'Qualify logger',dept:'QAS',person:'qa.reviewer',due:addD(T,25)}]});
await qa.sig(cc.id,'RP Review'); await op.sig(cc.id,'HOD Approval');
ok((await qa.get(cc.id)).record.number===`CC-JRS-${Y}-001`,'number kept after the return');
await hod.put(cc.id,{hodComment:'Approved'});
ok((await hod.sig(cc.id,'QA Approval')).ok,'Head of Department approves');
// QA approval: effectiveness check and other departments
await qa.put(cc.id,{ecRequired:'Required'});
ok((await qa.sig(cc.id,'Implementation')).s===400,'effectiveness check period must be assigned');
ok((await qa.put(cc.id,{optionalDepts:['QAS','ITS','OPS','HRM','PKG']})).s===400,'at most 4 other departments');
await qa.put(cc.id,{ecDue:'6 months',optionalDepts:['QAS','PKG']});
ok((await qa.sig(cc.id,'Implementation')).s===400,'other departments named: their approval comes first');
ok((await qa.sig(cc.id,'Optional Approvals')).ok,'QA approves and sends to the other departments');
ok((await au.put(cc.id,{title:'changed'})).s===409,'pre-approved change cannot be edited');
ok((await au.call('POST',`/api/records/${cc.id}/transition`,{to:'Implementation'})).s===400,'implementation blocked until the other departments approve');
const dept=(who,d)=>who.call('POST',`/api/records/${cc.id}/dept-approve`,{dept:d,comment:'No objection',sigUsername:who.u,password:PW});
ok((await dept(op,'QAS')).s===403,'department approval needs the Head of that department (organogram)');
ok((await dept(hod,'QAS')).s===403,'the Head of Operation cannot approve for QA');
ok((await dept(tr,'HRM')).s===400,'only departments named by QA approve');
ok((await dept(qa,'QAS')).ok,'QA department approval e-signed by the Head of QA');
ok((await dept(qa,'QAS')).s===409,'a department approves only once');
ok((await dept(cs,'PKG')).ok,'Packaging approval e-signed by the Head of Packaging');
ok((await au.call('POST',`/api/records/${cc.id}/transition`,{to:'Implementation'})).ok,'all pre-approvals signed – implementation starts');
// implementation and the department's change control report
const closedPlan=[...plan,{activity:'Qualify logger',dept:'QAS',person:'qa.reviewer',due:addD(T,25)}];
await op.put(cc.id,{finalImplDate:addD(T,-200),finalSummary:'Logger TL-200 installed, qualified and SOP updated'});
await pm.put(cc.id,{clientCommunicated:'Yes'});
ok((await op.sig(cc.id,'QA Closure Review')).s===400,'report blocked while implementation activities are open');
await op.put(cc.id,{plan:closedPlan.map(p=>({...p,closed:T}))});
ok((await tr.sig(cc.id,'QA Closure Review')).s===403,'only the responsible person / department submits the report');
ok((await op.sig(cc.id,'QA Closure Review')).ok,'responsible department signs the change control report');
// QA review report and closure
ok((await qa.sig(cc.id,'Closed – EC Pending')).s===400,'QA review report required');
await qa.put(cc.id,{qaReport:'Implementation verified against the plan; records reviewed'});
ok((await qa.sig(cc.id,'Closed')).s===400,'effectiveness check required: cannot close fully yet');
ok((await qa.sig(cc.id,'Closed – EC Pending')).ok,'QA signs the review report – effectiveness check pending');
g=await qa.get(cc.id);ok(g.record.data.ecDueDate===addM(addD(T,-200),6),'effectiveness check due 6 months after implementation: '+g.record.data.ecDueDate);
ok(g.signatures.filter(s=>s.meaning.startsWith('Approved – optional approval')).length===2,'other department approvals recorded as e-signatures');
await op.put(cc.id,{ecRespComment:'Second logger reporting since go-live'});
await qa.put(cc.id,{effective:'Yes',ecQaComment:'Both loggers reporting'});
ok((await qa.sig(cc.id,'Closed')).ok,'change control closed after the effectiveness check');
g=await qa.get(cc.id);
const wantCC=['Part A submitted – initiator / responsible department','Part B approved – QA (number assigned)','Reviewed and approved – responsible person','Rejected – Head of Department','Approved – Head of Department','Pre-approved – QA','Change control report – responsible department','Closed – QA review report (effectiveness check pending)','Effectiveness verified – QA'];
ok(wantCC.every(m=>g.signatures.some(s=>s.meaning===m)),'every stage signed and dated: '+g.signatures.map(s=>s.fullname.split(' (')[0]+' – '+s.meaning.split(' – ')[0]).join('; '));
// effectiveness check cannot be recorded before its period has passed
let cc3=await au.call('POST','/api/records',{type:'changes',data:{...partA,title:'Relabel freezer shelves'}});
await au.sig(cc3.id,'QA Review');
await qa.put(cc3.id,{impactCheck:check(11),impactSummary:'Labels only',classification:'Minor',classRationale:'No product impact',riskRequired:'Not required',plan:[{activity:'Relabel',dept:'OPS',person:'operator1',due:addD(T,5)}],clientPre:'Not required',clientPost:'Not required'});
await qa.sig(cc3.id,'RP Review'); await op.sig(cc3.id,'HOD Approval'); await hod.sig(cc3.id,'QA Approval');
await qa.put(cc3.id,{ecRequired:'Required',ecDue:'3 months'});
ok((await qa.sig(cc3.id,'Implementation')).ok,'no other departments: QA approval completes the pre-approval');
await op.put(cc3.id,{finalImplDate:T,finalSummary:'Shelves relabelled',plan:[{activity:'Relabel',dept:'OPS',person:'operator1',due:addD(T,5),closed:T}]});
await op.sig(cc3.id,'QA Closure Review'); await qa.put(cc3.id,{qaReport:'Verified'}); await qa.sig(cc3.id,'Closed – EC Pending');
await qa.put(cc3.id,{effective:'Yes',ecQaComment:'Too early'});
ok((await qa.sig(cc3.id,'Closed')).s===400,'effectiveness check waits until the assigned period has passed');
// temporary change
let cc2=await au.call('POST','/api/records',{type:'changes',data:{title:'Temporary storage in backup fridge',nature:'Temporary'}});
await au.put(cc2.id,{...partA,nature:'Temporary'});
ok((await au.sig(cc2.id,'QA Review')).s===400,'temporary change needs start and end dates');
ok((await er(cc2.number,addD(T,70),{scope:'Correction (CAPA)'})).s===400,'action-level extensions apply to CAPA only');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
