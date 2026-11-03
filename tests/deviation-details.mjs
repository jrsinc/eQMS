// Deviation / product complaint details (compared with the Deviation Detail Report template): deviation owner, original due date,
// category, divisions, structured immediate action, late-reporting reason, complaint information and sample inspections,
// escalation, product / material / equipment grids, named quality reviewer and approver, internal approvers and notification,
// client communication, investigation plan actions → action items, root cause grid, repeated incident, health hazard.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 32000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-dvd-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '', ADMIN_INITIAL_PASSWORD: 'ChangeMe-2026!', SMTP_HOST: '' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:u,password:p,...extra});
 const put=(id,data,reason='update')=>call('PUT',`/api/records/${id}`,{data,reason});
 const get=(id)=>call('GET',`/api/records/${id}`);
 await call('POST','/api/esig-accept'); return {call,sig,put,get,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const T=new Date().toISOString().slice(0,10);
const addD=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};

const qa=await login('qa.lead'), qr=await login('qa.reviewer'), op=await login('operator1'), hod=await login('hod.ops'), tr=await login('trainer1'), cs=await login('cs.manager'), pm=await login('pm1');

// ===== request → number; deviation owner, original due date =====
let c=await op.call('POST','/api/records',{type:'investigations',data:{invType:'Complaint',site:'JRS INC',title:'1 broken vial of product X lot 123',dateIdentified:T,requestDetails:'Sponsor reports a broken vial in kit 1001',respPerson:'operator1',qaReviewer:'qa.reviewer',qaApprover:'qa.lead'}});
ok((await qr.call('GET','/api/notifications')).items.some(x=>x.record_id===c.id&&x.action)&&!(await qa.call('GET','/api/notifications')).items.some(x=>x.record_id===c.id&&x.action),'only the named initial quality reviewer is asked to review the request');
ok(c.status==='Requested','complaint requested: '+c.number);
ok((await qr.sig(c.id,'Initiation')).ok,'QA approves the request – number assigned');
c=(await op.get(c.id)).record;
ok(/^JRS-COM-/.test(c.number)&&c.data.assignedTo==='operator1','complaint '+c.number+'; deviation owner defaults to the responsible person');

// ===== Part A: event, structured immediate action, complaint information =====
await op.put(c.id,{eventOrigin:'Investigator site',description:'What: product X 10 ml lot 123. Problem: vial broken on opening the kit. When: received today. Who: site pharmacist (SP).',immediate:'Site told to quarantine the kit',immNotifications:'QA and the sponsor informed by e-mail on receipt',immScoping:'Kit 1001 only so far',immContainment:'Remaining kits of lot 123 placed on hold',immCorrections:'Replacement kit shipped',dvCategory:'Product complaint',dvSubCategory:'Breakage',otherSites:['JRS IND'],refRecord:'',division1:'Clinical Trial Division (CTD)',complaintOrigin:'Investigator site / pharmacy',complaintReceivedOn:T,clientSeverity:'Medium',qualityType:'Packaging / labelling',sampleRequested:'Yes',sampleReceived:'Yes',sampleCount:'1',sampleDisposition:'Retained',customer:'Sponsor A',customerNotified:T,clientsImpacted:[{client:'Sponsor A',study:'STUDY-01',note:''}],clientCommRequired:'Yes',clientCommResp:'pm1'},'Part A');
let up=await op.call('POST',`/api/records/${c.id}/attachments`,{name:'returned-vial.jpg',mime:'image/jpeg',base64:Buffer.from('jpeg').toString('base64'),category:'returnedSample'});
ok(up.sha256,'returned sample photo attached in the complaint attachments');
ok((await op.sig(c.id,'QA Review')).ok,'Part A submitted');
c=(await op.get(c.id)).record;
ok(c.data.immContainment&&c.data.complaintOrigin==='Investigator site / pharmacy'&&c.data.sampleReceived==='Yes'&&c.data.clientsImpacted.length===1,'structured immediate action, complaint and client communication details kept');

// ===== initial quality review: escalation, grids, approvers =====
await qr.put(c.id,{criticality:'Major',impactedAreas:['Distribution'],significantEvent:'No',recall:'No',fieldAlert:'No',otherRegNotification:'Yes',complaintValidity:'Valid',complaintClassification:'Confirmed',
  materialImpacted:'No',productImpacted:'Yes',products:[{site:'JRS INC',code:'PX-10',desc:'Product X 10 ml',lot:'123',qty:'1',rejected:'No',comment:''}],equipmentInvolved:'No',
  approvers:[{user:'operator1',type:'Functional area approver'}],internalNotify:[{user:'cs.manager',note:'Warehouse lead'}]},'Part B');
let r=await qr.sig(c.id,'Investigation');
ok(r.s===400&&/escalation/.test(r.error),'a regulatory notification needs the assessment / escalation statement: '+r.error);
await qr.put(c.id,{escalation:'Sponsor informed; authority notification by the sponsor (ref. SA-17)'},'Escalation');
r=await qr.sig(c.id,'Investigation');
ok(r.s===400&&/cannot be internal approvers/.test(r.error),'the responsible person cannot be an internal approver: '+r.error);
await qr.put(c.id,{approvers:[{user:'trainer1',type:'Subject matter expert'}]},'Approvers');
ok((await qr.sig(c.id,'Investigation')).ok,'QA approves Part B – investigation starts');
ok((await cs.call('GET','/api/notifications')).items.some(x=>x.record_id===c.id),'the internal notification list is informed of status changes');

// ===== investigation: plan actions → action items, root cause grid, details =====
await op.put(c.id,{invActions:[{action:'Inspect the returned vial',person:'operator1',due:addD(T,5)},{action:'Review the packing record of lot 123',person:'cs.manager',due:addD(T,7)}]},'Plan');
let g=(await op.get(c.id)).record;
ok(g.data.invActions.every(a=>/^AI-/.test(a.actionItem)),'each investigation plan action became an action item: '+g.data.invActions.map(a=>a.actionItem).join(', '));
const inv={seqEvents:'Packed 01-Oct, shipped 03-Oct, received at site today',background:'Glass vials in foam inserts',investigation:'Returned vial inspected; packing record reviewed',causalFactors:'Insert missing in one slot',rootCauseGrid:[{type:'Method / procedure',category:'Packing',level1:'Insert check',level2:'',comment:'Missing foam insert'}],rcaTools:['5 Whys'],rootCause:'Foam insert not checked at packing',riskAssessment:'Single kit affected',productImpact:'Kit replaced; lot released',expandedImpact:'Other kits of lot 123 checked – no missing inserts',corrections:'Replacement kit shipped',correctiveActions:'Add insert check to the packing checklist (CAPA)',historicalReview:'No similar complaints in 3 years',conclusion:'Isolated packing error',capaRequired:'No',capaJustification:'Covered by a checklist update',repeatedIncident:'Yes',healthHazardReq:'Yes'};
await op.put(c.id,inv,'Investigation');
r=await op.sig(c.id,'HOD Approval');
ok(r.s===400&&/returned sample inspection/.test(r.error),'a received sample needs the returned sample inspection: '+r.error);
await op.put(c.id,{returnedInspection:'Vial cracked at the neck; foam insert missing',retentionInspection:'Retain kits checked – inserts present'},'Inspections');
r=await op.sig(c.id,'HOD Approval');ok(r.s===400&&/Health hazard/.test(r.error),'health hazard required: summary needed – '+r.error);
await op.put(c.id,{healthHazardSummary:'N/A – no patient exposure'},'Hazard');
r=await op.sig(c.id,'HOD Approval');ok(r.s===400&&/earlier incidents/.test(r.error),'repeated incident needs the earlier record numbers – '+r.error);
await op.put(c.id,{repeatedRefs:'JRS-COM-2025-004'},'Repeated');
r=await op.sig(c.id,'HOD Approval');ok(r.s===400&&/Action items not closed/.test(r.error),'the investigation waits for its action items: '+r.error);
const all=(await qa.call('GET','/api/records?type=actionitems'))._arr, own={operator1:op,'cs.manager':cs};
for (const a of g.data.invActions) { const it=all.find(x=>x.number===a.actionItem); await own[it.data.respPerson].put(it.id,{completion:'Done'},'Done'); await own[it.data.respPerson].sig(it.id,'Completed'); await qa.sig(it.id,'Closed'); }
await new Promise(r=>setTimeout(r,200));
ok((await op.get(c.id)).record.data.invActions.every(a=>a.closed===T),'closing the action items closes the plan actions');
ok((await op.sig(c.id,'HOD Approval')).ok,'investigation submitted to the Head of Department');

// ===== internal approvals with the Head of Department =====
ok((await tr.call('GET','/api/notifications')).items.some(x=>x.record_id===c.id&&/Internal approval/.test(x.action||'')),'the internal approver is asked to sign');
r=await hod.sig(c.id,'QA Evaluation');
ok(r.s===400&&/Internal approvals outstanding/.test(r.error),'the Head approves only after the internal approvers: '+r.error);
ok((await tr.call('POST',`/api/records/${c.id}/dept-approve`,{person:true,comment:'Agreed',sigUsername:'trainer1',password:'Demo-Pass-2026'})).ok,'internal approver signs');
ok((await hod.sig(c.id,'QA Evaluation')).ok,'Head of Department approves');
ok((await qa.call('GET','/api/notifications')).items.some(x=>x.record_id===c.id&&x.action),'the named quality approver is asked for the QA evaluation');
g=await qa.get(c.id);
ok(g.signatures.some(s=>s.meaning==='Approved – optional approver (Subject matter expert)'),'internal approval in the e-signatures');
ok(g.record.data.originalDue===g.record.data.dueDate&&g.record.data.originalDue,'original due date kept: '+g.record.data.originalDue);

// ===== late reporting reason =====
let d=await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation',site:'JRS INC',title:'Late reported excursion',dateIdentified:addD(T,-6),requestDetails:'Found at the weekly review',respPerson:'operator1'}});
await qa.sig(d.id,'Initiation');
await op.put(d.id,{eventOrigin:'Cold room',description:'x',immediate:'y'},'Part A');
r=await op.sig(d.id,'QA Review');ok(r.s===400&&/1 business day/.test(r.error),'reported late: the reason is required – '+r.error);

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
