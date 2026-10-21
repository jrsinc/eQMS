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
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,...o}};
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

const qa=await login('qa.lead'), qr=await login('qa.reviewer'), au=await login('author1'), op=await login('operator1'), hod=await login('hod.ops'), pm=await login('pm1'), rp=await login('rp1'), dc=await login('docctrl1');
const PW='Demo-Pass-2026';

// ===== Deviations and complaints – JRS/SOP/QAS/022 with the JRS workflow =====
// request to QA → QA approval → number generator assigns the number → Part 1 (initiator) → Part 2 (QA) → pre-approval (QA + RP) → Part 3 → Part 4 (QA + RP)
const req=(invType,title,extra={})=>op.call('POST','/api/records',{type:'investigations',data:{invType,site:'JRS INC',title,dateIdentified:T,requestDetails:'Logger in cold room 2 showed 9.1 °C for 40 min',...extra}});
const open=async(r)=>{await qa.sig(r.id,'Number Assignment'); await dc.sig(r.id,'Initiation'); return (await qa.get(r.id)).record;};
const pre=(who,id,label)=>who.sig(id,'Pre-Approval',{label});
const part4=(who,id,label)=>who.sig(id,'Evaluation',{label});
let d1=await req('Deviation','Cold room 2 temperature excursion',{description:'not allowed yet'});
ok(/^REQ-\d{4}-\d{4}$/.test(d1.number)&&d1.status==='Requested'&&d1.data.qaNotified===T,'request to QA gets a temporary request number '+d1.number);
ok(!d1.data.description&&!d1.data.dateOpened,'only the request fields are entered with the request');
ok((await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation',site:'JRS INC',title:'x',dateIdentified:T}})).s===400,'request details are required');
ok((await op.sig(d1.id,'Number Assignment')).s===403,'only QA approves the request');
ok((await qa.sig(d1.id,'Number Assignment')).ok,'QA approves the request');
ok((await qa.sig(d1.id,'Initiation')).s===403,'only the designated number generator assigns the number');
ok((await dc.sig(d1.id,'Initiation')).ok,'number generator assigns the number');
let g=await qa.get(d1.id);
ok(g.record.number===`JRS-DEVN-${Y}-001`&&g.record.data.requestNo===d1.number&&g.record.data.dateOpened===T&&g.record.status==='Initiation','deviation number '+g.record.number+' (request '+d1.number+'), opened today');
d1=g.record;
let c1=await open(await req('Complaint','Damaged shipper received at site'));
ok(c1.number===`JRS-COM-${Y}-001`,'complaint uses its own sequence '+c1.number);
let d2r=await req('Deviation','Label count discrepancy',{dateIdentified:addD(T,-3)});
ok(d2r.data.reporting.startsWith('Late')&&d1.data.reporting.startsWith('Met'),'24-hour reporting to QA evaluated (met / late)');
let d2=await open(d2r);ok(d2.number===`JRS-DEVN-${Y}-002`,'second deviation '+d2.number);
let d3=await req('Deviation','Raised in error');
ok((await qa.sig(d3.id,'Rejected')).s===400,'rejecting a request needs a reason');
ok((await qa.sig(d3.id,'Rejected',{reason:'Not a quality event'})).ok,'QA can reject a request (no number assigned)');
// Part 1 – initiator
ok((await op.put(d1.id,{invType:'Complaint'})).s===400,'investigation type cannot change after creation');
ok((await qa.put(d1.id,{description:'x'})).s===403,'Part 1 is completed by the initiator at this stage');
ok((await op.put(d1.id,{criticality:'Major'})).s===403,'the initiator cannot fill in Part 2');
ok((await op.sig(d1.id,'QA Assessment')).s===400,'Part 1 needs the description and immediate action');
await op.put(d1.id,{description:'Logger showed 9.1 °C for 40 min',immediate:'Stock quarantined, logger data saved',respDept:'OPS',eventOrigin:'Cold room 2'});
ok((await au.sig(d1.id,'QA Assessment')).s===403,'only the initiator submits Part 1');
ok((await op.sig(d1.id,'QA Assessment')).ok,'initiator signs and submits Part 1 to QA');
// Part 2 – QA assessment
ok((await op.put(d1.id,{description:'changed'})).s===403,'initiator can no longer change Part 1 after submission');
ok((await qa.put(d1.id,{description:'Logger in cold room 2 showed 9.1 °C for 40 minutes (QA corrected)'})).s===200,'QA can correct Part 1 during the assessment');
ok((await qa.sig(d1.id,'Pre-Approval')).s===400,'Part 2 needs criticality and impacted areas');
await qa.put(d1.id,{criticality:'Critical',impactedAreas:['Storage'],respPerson:'author1'},'Initial quality review');
g=await qa.get(d1.id);
ok(g.record.data.description.endsWith('(QA corrected)')&&g.record.data.dueDate===addWD(T,10),'QA correction saved; Critical event due in 10 working days: '+g.record.data.dueDate);
ok((await qa.sig(d1.id,'Pre-Approval')).ok,'QA signs Part 2 and submits for pre-approval');
// pre-approval – QA and RP
ok((await rp.put(d1.id,{criticality:'Major'})).s===403,'Part 2 is locked once submitted for pre-approval');
ok((await pre(op,d1.id,'Pre-approve – QA')).s===403,'pre-approval only by QA and RP');
let p=await pre(qa,d1.id,'Pre-approve – QA');
ok(p.status==='Pre-Approval'&&p.pending.join()==='Pre-approved – RP','QA pre-approval recorded; RP pre-approval pending');
ok((await pre(qr,d1.id,'Pre-approve – QA')).s===409,'the same pre-approval cannot be given twice');
p=await pre(rp,d1.id,'Pre-approve – RP');
ok(p.status==='Investigation','QA and RP pre-approved – investigation starts');
// Part 3 – investigation by QA and RP
const inv={investigation:'Logger data and door alarm log reviewed',historicalReview:'No similar events in the last 12 months',rootCause:'Door left ajar during picking',riskAssessment:'Exposure within stability data',conclusion:'No product impact'};
ok((await op.put(d1.id,inv)).s===403,'Part 3 is completed by QA and RP');
await rp.put(d1.id,inv,'Investigation');
ok((await rp.sig(d1.id,'Evaluation')).s===400,'submission blocked until the CAPA decision is recorded');
await rp.put(d1.id,{capaRequired:'No'});
ok((await rp.sig(d1.id,'Evaluation')).s===400,'"no CAPA" needs a justification');
await rp.put(d1.id,{capaRequired:'Yes'});
ok((await rp.sig(d1.id,'Evaluation')).ok,'RP signs and submits the investigation (Part 3)');
// Part 4 – evaluation by QA and RP
await qa.put(d1.id,{finalDisposition:'Release / use as is',customerApproval:'Not applicable (no customer impact)'});
ok((await part4(qa,d1.id,'Approve Part 4 – QA')).s===400,'Part 4 approval blocked: CAPA required but none linked');
let k1=await op.call('POST','/api/records',{type:'capa',linkFrom:d1.id,data:{title:'Door alarm for cold room 2',respDept:'OPS',respPerson:'operator1',dueDate:addD(T,60),source:'Deviation',sourceRecord:d1.number,nonconformance:'Door left ajar',corrective:'Install a door-open alarm',caDue:addD(T,30)}});
ok(k1.number===`CAPA/OPS/001/${YY}`,'CAPA numbered by department and year: '+k1.number);
g=await qa.get(d1.id);ok(g.links.some(l=>l.id===k1.id),'CAPA linked to the deviation');
p=await part4(qa,d1.id,'Approve Part 4 – QA');ok(p.status==='Evaluation','QA approves Part 4; RP approval pending');
p=await part4(rp,d1.id,'Approve Part 4 – RP');ok(p.status==='Closed','QA and RP approved Part 4 – closed (no customer impact)');
g=await qa.get(d1.id);
const want=['Request approved – QA','Number assigned – number generator','Initiated – investigation initiator','Assessed – QA (Part 2)','Pre-approved – QA','Pre-approved – RP','Investigation completed – QA / RP','Approved – QA evaluation','Approved – RP evaluation'];
ok(want.every(m=>g.signatures.some(s=>s.meaning===m)),'every stage signed and dated in order: '+g.signatures.map(s=>s.fullname.split(' (')[0]+' – '+s.meaning.split(' – ')[0]).join('; '));
ok(g.signatures.filter(s=>s.meaning.startsWith('Pre-approved')).map(s=>s.username).join()==='qa.lead,rp1','pre-approvals by two different people (QA and RP)');

// complaint: a return resets the pre-approval; customer approval / deemed closure
await op.put(c1.id,{description:'Shipper crushed on arrival',immediate:'Site asked to quarantine kit',customer:'Sponsor A',receivedVia:'Email',customerNotified:T});
await op.sig(c1.id,'QA Assessment');
await qa.put(c1.id,{criticality:'Major',respDept:'PMT',impactedAreas:['Distribution']});
g=await qa.get(c1.id);ok(g.record.data.dueDate===addD(T,30),'Major event due in 30 calendar days: '+g.record.data.dueDate);
ok(g.record.data.notifyStatus.startsWith('Met'),'customer notified within 3 days');
await qa.sig(c1.id,'Pre-Approval'); await pre(qa,c1.id,'Pre-approve – QA');
ok((await rp.go(c1.id,'QA Assessment',{reason:'Add the courier name'})).ok,'RP returns the complaint to QA assessment');
await qa.sig(c1.id,'Pre-Approval');
p=await pre(rp,c1.id,'Pre-approve – RP');
ok(p.status==='Pre-Approval'&&p.pending.join()==='Pre-approved – QA','pre-approval given before the return no longer counts');
await pre(qa,c1.id,'Pre-approve – QA');
await qa.put(c1.id,{...inv,capaRequired:'No',capaJustification:'Isolated courier handling damage; courier informed'});
await qa.sig(c1.id,'Evaluation');
await qa.put(c1.id,{finalDisposition:'Destroy',customerApproval:'Pending'});
await part4(qa,c1.id,'Approve Part 4 – QA');
p=await part4(rp,c1.id,'Approve Part 4 – RP');
ok(p.status==='Customer Approval','customer impacted: QA and RP approval sends the report to the customer');
await qa.put(c1.id,{reportSent:T});
g=await qa.get(c1.id);ok(g.record.data.nextFollowUp===`Follow-up 1 due ${addD(T,15)}`,'follow-up reminder: '+g.record.data.nextFollowUp);
await qa.put(c1.id,{customerApproval:'Deemed closed – no response after 3 follow-ups',reportSent:addD(T,-20),followUp1:addD(T,-15),followUp2:addD(T,-10),followUp3:addD(T,-5)});
ok((await pm.sig(c1.id,'Closed')).s===400,'deemed closure blocked before 45 days');
await qa.put(c1.id,{reportSent:addD(T,-50),followUp1:addD(T,-35),followUp2:addD(T,-20),followUp3:addD(T,-5)});
ok((await pm.sig(c1.id,'Closed')).ok,'deemed closure after 3 follow-ups and 45 days (Project Manager)');

// ===== CAPA – JRS/SOP/QAS/006 =====
let k2=await qa.call('POST','/api/records',{type:'capa',data:{title:'Update picking SOP',respDept:'QAS',respPerson:'qa.reviewer',dueDate:addD(T,45),source:'Internal audit / self-inspection',nonconformance:'SOP lacks door-closure step'}});
let k3=await op.call('POST','/api/records',{type:'capa',data:{title:'Retrain warehouse staff',respDept:'QAS',respPerson:'operator1',dueDate:addD(T,45),source:'Deviation',nonconformance:'Training gap',corrective:'Retrain',caDue:addD(T,20)}});
ok(k2.number===`CAPA/QAS/001/${YY}`&&k3.number===`CAPA/QAS/002/${YY}`,'serial restarts per department: '+k2.number+', '+k3.number);
ok((await qa.call('POST',`/api/records/${k2.id}/transition`,{to:'HOD Pre-Approval'})).s===400,'submission needs at least one proposed action with due date');
await op.call('POST',`/api/records/${k1.id}/transition`,{to:'HOD Pre-Approval'});
ok((await hod.sig(k1.id,'QA Pre-Approval')).ok,'Department Head pre-approval');
await qa.put(k1.id,{ecRequired:'Not required'});
ok((await qa.sig(k1.id,'Implementation')).s===400,'effectiveness check "not required" needs a reason');
await qa.put(k1.id,{ecRequired:'Required',ecDue:'3 months'});
ok((await qa.sig(k1.id,'Implementation')).ok,'QA pre-approval');
ok((await au.sig(k1.id,'HOD Verification')).s===403,'only the responsible person (or QA) records implementation');
ok((await op.sig(k1.id,'HOD Verification')).s===400,'implementation needs Part C entries');
await op.put(k1.id,{caDone:'Door alarm installed and tested',caDate:T,caRef:'WO-1001'});
ok((await op.sig(k1.id,'HOD Verification')).ok,'responsible person records implementation');
ok((await hod.sig(k1.id,'QA Closure')).ok,'Department Head verifies implementation');
await qa.put(k1.id,{closureRemarks:'Evidence reviewed'});
ok((await qa.sig(k1.id,'Closed')).s===400,'cannot skip a required effectiveness check');
ok((await qa.sig(k1.id,'Effectiveness Check')).ok,'QA closure, effectiveness check pending');
g=await qa.get(k1.id);ok(g.record.data.ecDueDate===addM(T,3),'effectiveness check due in 3 months: '+g.record.data.ecDueDate);
await qa.put(k1.id,{effective:'No',ecQaComment:'Door found open again'});
ok((await qa.sig(k1.id,'Closed')).ok,'effectiveness recorded');
g=await qa.get(k1.id);let fu=g.links.find(l=>l.type==='capa'&&l.number===`CAPA/OPS/002/${YY}`);
ok(!!fu,'not effective: follow-up CAPA raised and linked '+(fu&&fu.number));
// segregation of duties
await qa.put(k2.id,{correction:'Revise SOP',corrDue:addD(T,10),ecRequired:'Not required',ecReason:'Editorial SOP change'});
await qa.call('POST',`/api/records/${k2.id}/transition`,{to:'HOD Pre-Approval'});await hod.sig(k2.id,'QA Pre-Approval');
ok((await qa.sig(k2.id,'Implementation')).s===403,'CAPA initiator cannot give the QA pre-approval');
ok((await qr.sig(k2.id,'Implementation')).ok,'second QA person approves');

// ===== Extension requests – form JRS/FRM/QAS/045 =====
const er=(documentId,requestedDate,extra={})=>op.call('POST','/api/records',{type:'extensions',data:{documentId,requestedDate,justification:'Awaiting vendor report',interimUpdate:'Investigation 70% complete',impactAssessment:'No product impact; stock on hold',...extra}});
ok((await er(d2.number,addD(T,40))).s===400,'extension refused while the record has no due date');
await op.put(d2.id,{description:'Label count off by 2',immediate:'Labels quarantined'}); await op.sig(d2.id,'QA Assessment');
await qa.put(d2.id,{criticality:'Major'});
ok((await er(d2.number,addD(T,10))).s===400,'requested date must be later than the current due date');
let e1=await er(d2.number,addD(T,45));
ok(e1.number===`ER-${Y}-001`&&e1.data.recordType==='Deviation'&&e1.data.originalDue===addD(T,30),'extension request '+e1.number+' for '+d2.number);
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
// request → QA approval → number generator → Part A (initiator) → Parts B + C (QA) → pre-approval (QA + RP) → optional approvals → implementation → Part D closure (QA + RP) → Part E
const ccReq={title:'Add a second data logger to cold room 2',nature:'Permanent',requestDetails:'Install a second calibrated logger for monitoring redundancy'};
const partA={respPerson:'author1',respDept:'OPS',dueDate:addD(T,60),changeType:['Equipment / instrument'],impactedAreas:['Storage (+2 to +8 °C)'],description:'Install a second calibrated logger',justification:'Monitoring redundancy'};
let cc=await au.call('POST','/api/records',{type:'changes',data:{...ccReq,classification:'Minor'}});
ok(/^REQ-CC-\d{4}-0001$/.test(cc.number)&&cc.status==='Requested'&&!cc.data.classification,'change request to QA gets a temporary request number '+cc.number);
ok((await au.sig(cc.id,'Number Assignment')).s===403,'only QA approves the change request');
ok((await qa.sig(cc.id,'Number Assignment')).ok,'QA approves the change request');
ok((await qa.sig(cc.id,'Initiation')).s===403,'only the designated number generator assigns the number');
ok((await dc.sig(cc.id,'Initiation')).ok,'number generator assigns the number');
g=await qa.get(cc.id);
ok(g.record.number===`CC-JRS-${Y}-001`&&g.record.data.requestNo===cc.number&&g.record.data.dateOpened===T,'change control number '+g.record.number+' (request '+cc.number+')');
// Part A – initiator
ok((await qa.put(cc.id,partA)).s===403,'Part A is completed by the initiator at this stage');
ok((await au.put(cc.id,{classification:'Minor'})).s===403,'the initiator cannot fill in Part B');
await au.put(cc.id,{...partA,dueDate:addD(T,95)});
ok((await au.sig(cc.id,'QA Assessment')).s===400,'permanent change must be due within 90 days');
await au.put(cc.id,{dueDate:addD(T,60)});
ok((await op.sig(cc.id,'QA Assessment')).s===403,'only the initiator submits Part A');
ok((await au.sig(cc.id,'QA Assessment')).ok,'initiator signs and submits Part A to QA');
ok((await au.put(cc.id,{description:'changed'})).s===403,'initiator can no longer change Part A after submission');
// Parts B and C – QA assessment
const plan=[{activity:'Install logger',dept:'OPS',person:'author1',due:addD(T,20)},{activity:'Update SOP',dept:'QAS',person:'qa.reviewer',due:addD(T,30)}];
await qa.put(cc.id,{impactCheck:check(5),impactSummary:'Cold chain monitoring only',classification:'Major',classRationale:'Affects GDP storage monitoring',riskRequired:'Not required',plan,clientPre:'Not required',clientPost:'Required',ecRequired:'Required',ecDue:'6 months',optionalDepts:['QAS','ITS']});
ok((await qa.sig(cc.id,'Pre-Approval')).s===400,'submission blocked: impact checklist incomplete');
await qa.put(cc.id,{impactCheck:check(11)});
ok((await qa.sig(cc.id,'Pre-Approval')).s===400,'Major change requires a risk assessment');
ok((await qa.put(cc.id,{optionalDepts:['QAS','ITS','ENG','HRM','ADM']})).s===400,'at most 4 optional approval departments');
await qa.put(cc.id,{riskRequired:'Required'});
ok((await qa.sig(cc.id,'Pre-Approval')).s===400,'a required risk assessment needs its reference');
let rk=await qa.call('POST','/api/records',{type:'risks',data:{site:'JRS INC',title:'Logger failure undetected',fmea:[{id:'1',step:'Cold storage',mode:'Logger failure',s:'3',o:'2',d:'2'}]}});
ok((await qa.put(cc.id,{riskRef:'RA/JRS/0000-999'})).s===400,'risk reference must be an existing risk assessment');
await qa.put(cc.id,{riskRef:rk.number});
ok((await qa.sig(cc.id,'Pre-Approval')).s===400,'client communication needs a responsible Project Manager');
await qa.put(cc.id,{pm:'pm1'});
ok((await qa.sig(cc.id,'Pre-Approval')).ok,'QA signs Parts B and C and submits for pre-approval');
ok((await qa.put(cc.id,{classification:'Minor'})).s===403,'Parts B and C are locked once submitted for pre-approval');
// pre-approval – QA and RP
p=await qa.sig(cc.id,'Pre-Approval',{label:'Pre-approve – QA'});
ok(p.status==='Pre-Approval'&&p.pending.join()==='Pre-approved – RP','QA pre-approval recorded; RP pre-approval pending');
p=await rp.sig(cc.id,'Pre-Approval',{label:'Pre-approve – RP'});
ok(p.status==='Optional Approvals','QA and RP pre-approved – optional departmental approvals next');
ok((await au.put(cc.id,{title:'changed'})).s===409,'pre-approved change is locked against edits');
ok((await au.call('POST',`/api/records/${cc.id}/transition`,{to:'Implementation'})).s===400,'implementation blocked until optional approvals are complete');
const dept=(who,d)=>who.call('POST',`/api/records/${cc.id}/dept-approve`,{dept:d,comment:'No objection',sigUsername:who.u,password:PW});
ok((await dept(op,'QAS')).s===403,'optional approval needs the Department Head role');
ok((await dept(hod,'ENG')).s===400,'only departments named by QA can approve');
ok((await dept(hod,'QAS')).ok,'QAS optional approval e-signed');
ok((await dept(hod,'QAS')).s===409,'a department approves only once');
await dept(hod,'ITS');
ok((await au.call('POST',`/api/records/${cc.id}/transition`,{to:'Implementation'})).ok,'implementation started');
await au.put(cc.id,{finalImplDate:T,finalSummary:'Logger installed and SOP updated'});
ok((await au.sig(cc.id,'Pending Closure')).s===400,'closure blocked while implementation activities are open');
await au.put(cc.id,{plan:[{activity:'Install logger',dept:'OPS',person:'author1',due:addD(T,20),closed:T},{activity:'Update SOP',dept:'QAS',person:'qa.reviewer',due:addD(T,30),closed:T}]});
ok((await op.sig(cc.id,'Pending Closure')).s===403,'only the initiator, responsible person or QA submits for closure');
ok((await au.sig(cc.id,'Pending Closure')).ok,'all activities closed – responsible person submits for closure');
// Part D closure – QA and RP
await qa.put(cc.id,{clientCommunicated:'No'});
ok((await qa.sig(cc.id,'Pending Closure',{label:'Approve closure – QA'})).s===400,'client post-communication must be confirmed');
await pm.put(cc.id,{clientCommunicated:'Yes'});
p=await qa.sig(cc.id,'Pending Closure',{label:'Approve closure – QA'});
ok(p.status==='Pending Closure'&&p.pending.join()==='Closure approved – RP','QA closure approval recorded; RP approval pending');
p=await rp.sig(cc.id,'Pending Closure',{label:'Approve closure – RP'});
ok(p.status==='Closed – EC Pending','QA and RP approved closure – effectiveness check pending');
g=await qa.get(cc.id);ok(g.record.data.ecDueDate===addM(T,6),'effectiveness check due 6 months after implementation: '+g.record.data.ecDueDate);
ok(g.signatures.filter(s=>s.meaning.startsWith('Approved – optional approval')).length===2,'optional approvals recorded as e-signatures');
// Part E
await au.put(cc.id,{ecRespComment:'Second logger reporting since go-live'});
await qa.put(cc.id,{effective:'Yes',ecQaComment:'Both loggers reporting'});
ok((await qa.sig(cc.id,'Closed')).ok,'change control closed after effectiveness check');
g=await qa.get(cc.id);
const wantCC=['Request approved – QA','Number assigned – number generator','Initiated – change initiator','Assessed – QA (Parts B and C)','Pre-approved – QA','Pre-approved – RP','Implemented – responsible person','Closure approved – QA','Closure approved – RP','Effectiveness verified – QA'];
ok(wantCC.every(m=>g.signatures.some(s=>s.meaning===m)),'every stage signed and dated: '+g.signatures.map(s=>s.fullname.split(' (')[0]+' – '+s.meaning.split(' – ')[0]).join('; '));
let cc2=await au.call('POST','/api/records',{type:'changes',data:{...ccReq,title:'Temporary storage in backup fridge',nature:'Temporary'}});
await qa.sig(cc2.id,'Number Assignment'); await dc.sig(cc2.id,'Initiation'); cc2=(await qa.get(cc2.id)).record;
await au.put(cc2.id,partA);
ok((await au.sig(cc2.id,'QA Assessment')).s===400,'temporary change needs start and end dates');
ok((await er(cc2.number,addD(T,70),{scope:'Correction (CAPA)'})).s===400,'action-level extensions apply to CAPA only');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
