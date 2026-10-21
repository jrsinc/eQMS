// Compliance & audits end-to-end checks against the JRS SOPs:
// self-inspection (JRS/SOP/QAS/004), external audit (QAS/002), quality risk management (QAS/020), management review (QAS/019).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 20000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-ca-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true' }, stdio: 'ignore' });
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
const T=new Date().toISOString().slice(0,10), Y=T.slice(0,4);
const D=(d)=>new Date(d+'T00:00:00Z'), iso=(x)=>x.toISOString().slice(0,10);
const addD=(d,n)=>{const x=D(d);x.setUTCDate(x.getUTCDate()+n);return iso(x)};
const addM=(d,n)=>{const x=D(d);x.setUTCMonth(x.getUTCMonth()+n);return iso(x)};
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

const qa=await login('qa.lead'), qr=await login('qa.reviewer'), au=await login('author1'), op=await login('operator1'), hod=await login('hod.ops'), cs=await login('cs.manager'), dir=await login('director1'), insp=await login('inspector1');

// ===== Qualified auditors (FRM/QAS/039) =====
const aud=(auditor,department,scope=['Self-inspection (FRM/QAS/039)'])=>qa.create('auditors',{auditor,department,designation:'Auditor',experience:6,scope,basis:'Internal auditor training; two audits observed'});
let a1=await aud('qa.reviewer','QAS');
ok(a1.number==='AUDR-001','auditor list entry '+a1.number);
ok((await qa.sig(a1.id,'Qualified')).s===403,'the person proposing an auditor cannot approve the entry');
ok((await qr.sig(a1.id,'Qualified')).ok,'Head of Quality adds the auditor to the qualified list');
for (const [u,dpt] of [['cs.manager','PMT'],['hod.ops','OPS']]) { const a=await aud(u,dpt); await qr.sig(a.id,'Qualified'); }
await aud('author1','QAS'); // proposed only, not qualified
ok((await aud('qa.reviewer','QAS')).s===409,'one active auditor entry per person');

// ===== Annual self-inspection schedule (FRM/QAS/038) =====
const P=addD(T,10), PM=MONTHS[D(P).getUTCMonth()];
let sc=await qa.create('sischedule',{year:+Y,plan:[{dept:'OPS',month:PM},{dept:'QAS',month:'March'},{dept:'PMT',month:'June'}]});
ok(sc.number===`SIS-${Y}`,'schedule numbered '+sc.number);
ok((await qr.sig(sc.id,'Approved')).s===400,'at least four self-inspections a year are required');
await qa.put(sc.id,{plan:[{dept:'OPS',month:PM},{dept:'QAS',month:'March'},{dept:'PMT',month:'June'},{dept:'ENG',month:'September'}]});
ok((await qr.sig(sc.id,'Approved')).ok,'Head of Quality approves the schedule');
ok((await qa.create('sischedule',{year:+Y})).s===409,'one schedule per year');

// ===== Self-inspection – JRS/SOP/QAS/004 =====
const siData={auditeeDept:'OPS',title:'Warehouse GDP self-inspection',auditee:'operator1',scheduleRef:`SIS-${Y}`,plannedDate:P,leadAuditor:'qa.reviewer',coAuditor:'hod.ops',notifiedOn:T};
let si1=await qa.create('selfinspections',siData);
ok(si1.number===`JRS-SI-${Y}-001`,'self-inspection numbered '+si1.number);
ok((await qa.go(si1.id,'Notified')).s===400,'an auditor from the audited department cannot audit it');
await qa.put(si1.id,{coAuditor:'author1'});
ok((await qa.go(si1.id,'Notified')).s===400,'only qualified auditors can be assigned');
await qa.put(si1.id,{coAuditor:'cs.manager',notifiedOn:addD(P,-1)});
ok((await qa.go(si1.id,'Notified')).s===400,'the auditee must be notified at least 3 working days before');
await qa.put(si1.id,{notifiedOn:T});
ok((await qa.go(si1.id,'Notified')).ok,'agenda sent; date and team confirmed');
let si2=await qa.create('selfinspections',{...siData,coAuditor:'cs.manager',scheduleRef:'',title:'Unscheduled self-inspection after excursion'});
let r2=await qa.go(si2.id,'Notified');ok(r2.s===400&&/trigger/.test(r2.error),'an unscheduled self-inspection needs a trigger');
let si3=await qa.create('selfinspections',{...siData,coAuditor:'cs.manager',plannedDate:addM(P,2),notifiedOn:T});
let r3=await qa.go(si3.id,'Notified');ok(r3.s===400&&/one month/.test(r3.error),'a scheduled self-inspection can move by one month at most');
ok((await qa.go(si1.id,'In Progress')).s===403,'only the assigned auditors start the self-inspection');
ok((await qr.go(si1.id,'In Progress')).ok,'lead auditor starts the self-inspection');
const obs=[{no:'1',system:'Storage',category:'Major',description:'Temperature data not reviewed monthly',recommendation:'Define a monthly review',status:'Open'}];
await qr.put(si1.id,{auditDate:T,reportDate:addD(T,16),summary:'Warehouse generally compliant',observations:obs});
ok((await cs.sig(si1.id,'Report Issued')).s===403,'only the lead auditor issues the report');
ok((await qr.sig(si1.id,'Report Issued')).s===400,'the report must be issued within 15 calendar days');
await qr.put(si1.id,{reportDate:T});
ok((await qr.sig(si1.id,'Report Issued')).ok,'lead auditor issues the report (FRM/QAS/003)');
let g=await qa.get(si1.id);ok(g.record.data.dueDate===addD(T,15),'response due 15 calendar days after the report: '+g.record.data.dueDate);
ok((await qa.sig(si1.id,'Response Submitted')).s===403,'only the auditee submits the response');
ok((await op.sig(si1.id,'Response Submitted')).s===400,'every observation needs a corrective action, due date and responsible person');
await op.put(si1.id,{observations:[{...obs[0],corrective:'Monthly review added to SOP',caDue:addD(T,30),preventive:'Add to QMR KPIs',paDue:addD(T,60),responsible:'Ravi Patel'}]});
ok((await op.sig(si1.id,'Response Submitted')).ok,'auditee submits the response and CAPA plan (FRM/QAS/041)');
g=await qa.get(si1.id);ok(g.record.data.responseDate===T&&g.record.data.responseTimeliness==='On time','response recorded on time');
ok((await hod.sig(si1.id,'Auditor Review')).ok,'manager of the CAPA plan owner approves');
ok((await cs.sig(si1.id,'Response Accepted')).s===403,'only the lead auditor approves the CAPA plan');
ok((await qr.sig(si1.id,'Response Accepted')).ok,'lead auditor approves the CAPA plan');
await qa.put(si1.id,{qaVerification:'Monthly review evidence seen'});
ok((await qa.sig(si1.id,'Closed')).s===400,'closure needs a CAPA for every observation (JRS/SOP/QAS/006)');
ok((await qa.put(si1.id,{observations:[{...g.record.data.observations[0],capa:'CAPA/OPS/999/99'}]})).s===400,'CAPA numbers must refer to existing CAPA records');
let k1=await op.create('capa',{title:'Monthly temperature data review',respDept:'OPS',respPerson:'operator1',dueDate:addD(T,30),source:'Internal audit / self-inspection',sourceRecord:si1.number,nonconformance:'Temperature data not reviewed',corrective:'Add review',caDue:addD(T,30)});
await qa.put(si1.id,{observations:[{...g.record.data.observations[0],capa:k1.number}]});
ok((await qa.sig(si1.id,'Closed')).s===400,'closure needs every observation complied with');
await qa.put(si1.id,{observations:[{...g.record.data.observations[0],capa:k1.number,status:'Complied'}]});
ok((await qa.sig(si1.id,'Closed')).ok,'QA verifies and closes the self-inspection');
g=await qa.get(si1.id);ok(g.links.some(l=>l.id===k1.id),'observation CAPA linked to the self-inspection');
// extension of the response (one only)
await qa.put(si2.id,{unscheduledTrigger:'Quality event / deviation'});
await qa.go(si2.id,'Notified'); await qr.go(si2.id,'In Progress');
await qr.put(si2.id,{auditDate:T,reportDate:T,summary:'x',observations:obs});
await qr.sig(si2.id,'Report Issued');
let e1=await op.create('extensions',{documentId:si2.number,requestedDate:addD(T,25),justification:'Auditee on leave',interimUpdate:'Draft CAPA plan prepared',impactAssessment:'None'});
ok(e1.number&&e1.data.recordType==='Self-inspection response','extension request for the self-inspection response '+e1.number);
await op.sig(e1.id,'HOD Review'); await hod.sig(e1.id,'Head of Quality Approval');
ok((await qa.sig(e1.id,'Approved')).ok,'Head of Quality approves the extension');
g=await qa.get(si2.id);ok(g.record.data.extendedDue===addD(T,25),'response due date extended to '+g.record.data.extendedDue);
ok((await op.create('extensions',{documentId:si2.number,requestedDate:addD(T,40),justification:'x',interimUpdate:'x',impactAssessment:'x'})).s===400,'only one extension');
// confidentiality
let il=await insp.call('GET','/api/records?type=selfinspections');ok(il._arr&&il._arr.length===0,'self-inspections hidden from external auditors');
ok((await insp.get(si1.id)).s===404,'self-inspection report not viewable by external auditors');
let ia=await insp.call('GET','/api/audit?q='+encodeURIComponent(si1.number));ok(ia._arr&&ia._arr.length===0,'self-inspection audit trail hidden from external auditors');
ok((await insp.create('extaudits',{title:'x',auditType:'Regulatory inspection',planned:'Planned'})).s===403,'external auditors have read-only access');

// ===== External audit – JRS/SOP/QAS/002 =====
let ea=await qa.create('extaudits',{title:'Sponsor A – audit of JRS',auditType:'Customer / client audit',planned:'Planned',mode:'On-site',auditStart:addD(T,-5)});
ok(ea.number===`JRS-EA-${Y}-001`,'external audit numbered '+ea.number);
ok((await qa.go(ea.id,'Confirmed')).s===400,'audit cannot be confirmed without a signed confidentiality agreement');
await qa.put(ea.id,{cdaSigned:addD(T,-10),agenda:'Facility tour, QMS, temperature control'});
ok((await qa.go(ea.id,'Confirmed')).ok,'audit confirmed');
ok((await qa.go(ea.id,'Audit Completed')).s===400,'close-out needs the attendees');
await qa.put(ea.id,{attendees:[{name:'Priya Raman',company:'JRS'},{name:'J. Smith',company:'Sponsor A'}]});
await qa.go(ea.id,'Audit Completed');
await qa.put(ea.id,{reportDate:T,responseDue:addD(T,30),findings:[{no:'1',finding:'No monthly review of temperature data',category:'Major'},{no:'2',finding:'Visitor log incomplete'}]});
ok((await qa.go(ea.id,'Report Received')).s===400,'every finding needs a category');
const F=[{no:'1',finding:'No monthly review of temperature data',category:'Major'},{no:'2',finding:'Visitor log incomplete',category:'Observation'}];
await qa.put(ea.id,{findings:F});
ok((await qa.go(ea.id,'Report Received')).ok,'report received and accepted');
g=await qa.get(ea.id);ok(g.record.data.findingCounts==='0 / 1 / 0 / 1','finding counts (C/M/m/O): '+g.record.data.findingCounts);
ok((await qa.sig(ea.id,'Response Prepared')).s===400,'every finding needs a response and due date');
const F2=F.map(f=>({...f,response:'Action plan agreed',due:addD(T,30),status:'Open'}));
await qa.put(ea.id,{findings:F2});
ok((await qa.sig(ea.id,'Response Prepared')).ok,'QA Manager prepares the response (FRM/QAS/013)');
ok((await qa.sig(ea.id,'Response Approved')).s===403,'the preparer cannot also approve the response');
ok((await qr.sig(ea.id,'Response Approved')).ok,'Head-QA approves the response');
await qa.put(ea.id,{initialResponse:T,finalResponse:T,clientClosure:'Confirmed',findings:F2.map(f=>({...f,status:'Closed'}))});
ok((await qa.sig(ea.id,'Closed')).s===400,'a Major finding cannot close without a CAPA');
await qa.put(ea.id,{findings:F2.map((f,i)=>({...f,status:'Closed',capa:i===0?k1.number:''}))});
ok((await qa.sig(ea.id,'Closed')).ok,'external audit closed; observation closed without CAPA');
ok((await insp.get(ea.id)).s===200,'external auditors can view external audit records');

// ===== Quality risk management – JRS/SOP/QAS/020 =====
const row1={id:'1',step:'Storage',mode:'Cooling failure',effect:'Product exposed',s:'5',cause:'Compressor failure',o:'4',control:'Alarm',d:'4'}, row2={id:'2',step:'Picking',mode:'Door left open',s:'3',o:'3',d:'3'};
let ra=await au.create('risks',{site:'JRS INC',title:'Cold room 2 storage',fmea:[row1,row2],conclusion:'Cooling failure is the main risk'});
ok(ra.number===`RA/JRS/${Y}-001`,'risk assessment numbered '+ra.number);
ok(ra.data.fmea[0].rpn==='80'&&ra.data.fmea[0].level==='Critical'&&ra.data.fmea[1].rpn==='27'&&ra.data.fmea[1].level==='Moderate','RPN = S×O×D and risk levels calculated (80 Critical, 27 Moderate)');
ok(ra.data.highestRisk==='80 – Critical','highest risk '+ra.data.highestRisk);
ok((await au.put(ra.id,{fmea:[{...row1,s:'6'},row2]})).s===400,'scores must be 1 to 5');
ok((await au.sig(ra.id,'HOD Review')).ok,'prepared by SME');
ok((await hod.sig(ra.id,'QA Approval')).ok,'reviewed by Head of Department');
ok((await qa.sig(ra.id,'Approved')).s===400,'approval needs an accept / not accept decision per row');
await qa.put(ra.id,{fmea:[{...row1,accept:'Yes'},{...row2,accept:'Yes'}]});
ok((await qa.sig(ra.id,'Approved')).s===400,'an unmitigated Critical risk needs a justification');
await qa.put(ra.id,{fmea:[{...row1,accept:'Yes',comments:'Backup storage vendor available'},{...row2,accept:'Yes'}]});
ok((await qa.sig(ra.id,'Approved')).s===400,'an unmitigated Critical risk needs senior leadership acceptance');
ok((await qa.sig(ra.id,'QA Approval')).s===403,'only senior leadership can accept the risk');
ok((await dir.sig(ra.id,'QA Approval')).ok,'senior leadership accepts the Critical risk');
ok((await qa.sig(ra.id,'Approved')).ok,'QA Head approves the risk assessment');
await au.go(ra.id,'Residual Risk Review');
g=await au.get(ra.id);const rows=g.record.data.fmea;
await au.put(ra.id,{fmea:[{...rows[0],mitigation:'Install redundant compressor'},rows[1]]});
ok((await qa.sig(ra.id,'Approved')).s===400,'residual risk must be scored after mitigation');
await au.put(ra.id,{fmea:[{...rows[0],mitigation:'Install redundant compressor',ps:'5',po:'1',pd:'2'},rows[1]]});
ok((await qa.sig(ra.id,'Approved')).ok,'residual risk assessment approved');
g=await qa.get(ra.id);ok(g.record.data.fmea[0].prpn==='10'&&g.record.data.highestRisk==='27 – Moderate','residual RPN 10; highest risk now '+g.record.data.highestRisk);

// ===== Management review – JRS/SOP/QAS/019 =====
const dc=await login('docctrl1');
let dv=await op.create('investigations',{invType:'Deviation',site:'JRS INC',title:'Excursion in cold room 2',dateIdentified:T,requestDetails:'Logger alarm'});
await qa.sig(dv.id,'Number Assignment'); await dc.sig(dv.id,'Initiation');
await op.put(dv.id,{description:'x',immediate:'x'}); await op.sig(dv.id,'QA Assessment');
await qa.put(dv.id,{tempRange:'Cold chain / refrigerated (+2 to +8 °C)'});
const q=Math.floor(D(T).getUTCMonth()/3)+1, QQ='Q'+q;
const att=[{name:'',designation:'Manager Quality Assurance',mandatory:'Yes',attendance:''},{name:'',designation:'Director International Business',mandatory:'Yes',attendance:''}];
let qm=await qa.create('mgmtreviews',{quarter:QQ,year:+Y,attendees:att});
ok(qm.number===`QMR-${Y}-${QQ}`,'management review numbered '+qm.number);
ok((await qa.create('mgmtreviews',{quarter:QQ,year:+Y})).s===409,'one management review per quarter');
let iq=await insp.call('GET','/api/records?type=mgmtreviews');ok(iq._arr&&iq._arr.length===0,'management reviews hidden from external auditors');
ok((await op.call('POST',`/api/records/${qm.id}/compile`)).s===403,'only QA compiles the QMR data');
ok((await qa.call('POST',`/api/records/${qm.id}/compile`)).status==='Data Compiled','QMR data compiled');
g=await qa.get(qm.id);const M=g.record.data.metrics;
ok(M.sections.length===13&&M.kpis.length===8,'13 agenda topics and 8 KPIs compiled');
const devTotal=M.sections[2].rows[0], tempRow=M.sections[2].rows.find(r=>r[0]==='Temperature-related');
ok(devTotal[1]===1&&tempRow[1]===1,'deviations this quarter: '+devTotal[1]+', temperature-related: '+tempRow[1]);
ok(M.sections[6].rows.find(r=>r[0]==='Major')[1]>=2,'audit findings counted from self-inspections and external audits');
await qa.put(qm.id,{meetingDate:T});
ok((await qa.go(qm.id,'Meeting Held')).s===400,'mandatory attendees must be recorded as present');
await qa.put(qm.id,{attendees:[{...att[0],name:'Priya Raman',attendance:'Present'},{...att[1],name:'Alex Morgan',attendance:'Absent'}]});
ok((await qa.go(qm.id,'Meeting Held')).s===400,'meeting cannot proceed with a mandatory attendee absent');
await qa.put(qm.id,{attendees:[{...att[0],name:'Priya Raman',attendance:'Present'},{...att[1],name:'Alex Morgan',attendance:'Present'}]});
ok((await qa.go(qm.id,'Meeting Held')).ok,'meeting held');
await qa.put(qm.id,{discussion:'All topics reviewed',nextMeeting:addM(T,3),actions:[{recommendation:'Add monthly temperature data review to KPIs',responsibility:'Manager QA',target:addD(T,60)}]});
ok((await qa.sig(qm.id,'Minutes Compiled')).s===400,'minutes need a conclusion');
await qa.put(qm.id,{conclusion:'QMS effective; one action raised'});
ok((await qa.sig(qm.id,'Minutes Compiled')).ok,'Manager QA compiles the minutes (FRM/QAS/035)');
ok((await qa.sig(qm.id,'Authorized')).s===403,'only the Director / Management Representative authorizes');
ok((await dir.sig(qm.id,'Authorized')).ok,'minutes authorized');
ok((await qa.put(qm.id,{conclusion:'x'})).s===409,'authorized minutes are locked');
const nq=q===4?{quarter:'Q1',year:+Y+1}:{quarter:'Q'+(q+1),year:+Y};
let qm2=await qa.create('mgmtreviews',nq);
ok(qm2.data.prevActions.length===1&&qm2.data.prevActions[0].from===qm.number,'next QMR carries forward the open actions of '+qm.number);

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
