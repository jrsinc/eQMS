// Change control details (compared with the TrackWise change record): site and divisions, change owner and additional owners,
// original due date, change level from impact × complexity, impact grid, regulatory and product release impact, standard risk
// questions, material / product / room / equipment grids, named optional approvers, QA pre-assessor, action items, cancellation
// details, client post-approval, effectiveness check owner and plan, workflow (previous state).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 31000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-ccd-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '', ADMIN_INITIAL_PASSWORD: 'ChangeMe-2026!', SMTP_HOST: '' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:u,password:p,...extra});
 const go=(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,...extra});
 const put=(id,data,reason='update')=>call('PUT',`/api/records/${id}`,{data,reason});
 const get=(id)=>call('GET',`/api/records/${id}`);
 await call('POST','/api/esig-accept'); return {call,sig,go,put,get,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const T=new Date().toISOString().slice(0,10);
const addD=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
const M=createRequire(import.meta.url)('../public/modules.js').MODULES;
const check=(n)=>Object.fromEntries(M.changes.fields.find(f=>f.k==='impactCheck').rows.slice(0,n).map(r=>[r,{v:'No',r:''}]));
const RQ=(n=14)=>Object.fromEntries(M.changes.fields.find(f=>f.k==='riskQuestions').rows.slice(0,n).map((r,i)=>[r,{v:i===4?'Yes':'No',r:i===4?'IQ / OQ / PQ will be performed':''}]));

const qa=await login('qa.lead'), qr=await login('qa.reviewer'), au=await login('author1'), op=await login('operator1'), hod=await login('hod.ops'), pm=await login('pm1'), cs=await login('cs.manager'), tr=await login('trainer1');

// ===== change request: site, owners, divisions, affected areas, original due date =====
const partA={title:'Relocation of freezer room unit-01 for refrigerant pipe replacement',nature:'Permanent',respPerson:'operator1',dueDate:addD(T,60),changeType:['Facility / utilities (HVAC, cold room, freezer, power backup)','Other'],description:'New refrigerant pipeline with insulation; outdoor unit relocated',justification:'Pipeline installed in 2008, insulation torn',current:'Insulation torn at multiple locations',affectedArea1:'Facilities',affectedArea2:'Operations',division1:'Clinical Trial Division (CTD)',division2:'Clinical',division3:'Clinical',client:'',otherSites:['JRS IND'],owners:[{user:'cs.manager',role:'Warehouse impact'}]};
ok((await au.call('POST','/api/records',{type:'changes',data:{...partA}})).s===400,'site is required in the change request');
let cc=await au.call('POST','/api/records',{type:'changes',data:{...partA,site:'JRS INC'}});
let d=cc.data;
ok(cc.status==='Draft'&&d.site==='JRS INC'&&d.otherSites.join()==='JRS IND'&&d.division1==='Clinical Trial Division (CTD)'&&d.affectedArea1==='Facilities','site, other sites, divisions and affected areas recorded');
ok(d.assignedTo==='operator1'&&d.owners[0].user==='cs.manager','change owner defaults to the responsible person; additional change owners kept');
ok(d.originalDue===addD(T,60),'original due date kept: '+d.originalDue);
await au.put(cc.id,{dueDate:addD(T,50)},'Earlier target');
ok((await au.get(cc.id)).record.data.originalDue===addD(T,60),'changing the target date keeps the original due date');
ok((await au.sig(cc.id,'QA Review')).s===400,'change type "Other" needs an explanation');
await au.put(cc.id,{changeTypeOther:'Refrigerant line replacement',qaAssessor:'qa.reviewer'},'Explain other');
ok((await au.sig(cc.id,'QA Review')).ok,'Part A submitted to QA');
let n=await qr.call('GET','/api/notifications'), nq=await qa.call('GET','/api/notifications');
ok(n.items.some(x=>x.record_id===cc.id&&x.action)&&!nq.items.some(x=>x.record_id===cc.id&&x.action),'only the named QA pre-assessor is asked to act (not every QA user)');
ok((await qa.get(cc.id)).record.data.prevStatus==='Draft','workflow keeps the previous state (Draft → QA Review)');

// ===== change level 1: level from impact × complexity, impact grid, regulatory, risk questions, grids =====
await qr.put(cc.id,{classification:'Major',complexity:'Moderate'},'Level');
ok((await qr.get(cc.id)).record.data.changeLevel==='L1','Major impact, moderate complexity → change level L1');
await qr.put(cc.id,{complexity:'High'},'Level'); ok((await qr.get(cc.id)).record.data.changeLevel==='L2','Major impact, high complexity → L2');
await qr.put(cc.id,{classification:'Minor',complexity:'Low'},'Level'); ok((await qr.get(cc.id)).record.data.changeLevel==='L0','Minor impact, low complexity → L0');
await qr.put(cc.id,{classification:'Minor',complexity:'Moderate'},'Level');
ok((await qr.get(cc.id)).record.data.changeLevel==='L1','Minor impact, moderate complexity → L1');
ok((await qr.put(cc.id,{impactGrid:[{site:'JRS INC',dept:'OPS',impact:'Yes',comment:'Line replacement',action:'AI-2026-9999'}]},'Grid')).s===400,'impact grid: the action item number must exist');
const partB={impactGrid:[{site:'JRS INC',dept:'OPS',impact:'Yes',comment:'Line replacement'},{site:'JRS INC',dept:'QAS',impact:'Yes',comment:'PQ'}],impactCheck:check(11),impactSummary:'Facility only; two units in operation during the work',classRationale:'Qualified equipment changed',productImpact:'No',productStrategy:'No impact on the product: two units in operation',regLocal:'No',regSmf:'No',regClient:'No',regDetails:'No impact on regulatory filing',riskRequired:'Not required',plan:[{activity:'Store additional gel packs',dept:'OPS',person:'operator1',due:addD(T,10)},{activity:'Replace refrigerant line',dept:'OPS',person:'operator1',due:addD(T,20)}],clientPre:'Not required',clientPost:'Required',clientsImpacted:[{client:'All clients',study:'',note:'Informed after the work'}],pm:'pm1',equipment:[{site:'JRS INC',asset:'FR-01',desc:'Freezer room unit-01'}],rooms:[{site:'JRS INC',room:'R-12',desc:'Freezer room'}],approvers:[{user:'tr'+'ainer1',type:'Subject matter expert'},{user:'operator1',type:'Engineering / facilities'}]};
await qr.put(cc.id,{...partB,riskQuestions:RQ(10)},'Part B');
let r=await qr.sig(cc.id,'RP Review');
ok(r.s===400&&/standard questions|risk questions/.test(r.error),'all 14 standard risk questions must be answered: '+r.error);
await qr.put(cc.id,{riskQuestions:RQ(14)},'Risk questions');
r=await qr.sig(cc.id,'RP Review');
ok(r.s===400&&/must not be approvers/.test(r.error),'the change owner cannot be an optional approver: '+r.error);
await qr.put(cc.id,{approvers:[{user:'trainer1',type:'Subject matter expert'}]},'Approvers');
ok((await qr.sig(cc.id,'RP Review')).ok,'QA approves Part B – number assigned');
cc=(await qr.get(cc.id)).record;
ok(cc.data.equipment[0].asset==='FR-01'&&cc.data.rooms[0].room==='R-12'&&cc.data.regDetails&&cc.data.productStrategy,'equipment / room grids, regulatory and product release details kept');

// ===== action items raised from the change control =====
let ai=await qr.call('POST','/api/records',{type:'actionitems',data:{parentRef:cc.number,title:'Perform IQ and OQ',actionType:'Qualification (IQ / OQ / PQ)',respPerson:'operator1',dueDate:addD(T,25),description:'IQ / OQ of the freezer room unit after the work'},linkFrom:cc.id});
ok(/^AI-\d{4}-0001$/.test(ai.number)&&ai.status==='Open'&&ai.data.respDept==='OPS','action item '+ai.number+' raised with owner and due date');
ok((await qr.get(cc.id)).links.some(l=>l.id===ai.id),'the action item is linked to the change control');
ok((await op.call('GET','/api/notifications')).items.some(x=>x.record_id===ai.id&&x.action),'the action owner is asked to complete it');
let ai2=await qr.call('POST','/api/records',{type:'actionitems',data:{parentRef:cc.number,title:'Risk assessment',actionType:'Risk assessment',respPerson:'operator1',dueDate:addD(T,5),description:'Risk assessment of the work'}});
await qr.put(cc.id,{},'x');

// ===== approvals: responsible person, Head, QA, named approver =====
await op.sig(cc.id,'HOD Approval'); await hod.sig(cc.id,'QA Approval');
await qa.put(cc.id,{ecRequired:'Required',ecDue:'3 months'},'EC');
r=await qa.sig(cc.id,'Implementation');
ok(r.s===400,'named optional approver: QA must send it for optional approval');
ok((await qa.sig(cc.id,'Optional Approvals')).s===400,'a required effectiveness check needs an owner and an evaluation plan');
await qa.put(cc.id,{ecAssignee:'operator1',ecPlan:'Temperature data of the freezer room for three months'},'EC plan');
ok((await qa.sig(cc.id,'Optional Approvals')).ok,'QA approves – sent to the named optional approver');
ok((await tr.call('GET','/api/notifications')).items.some(x=>x.record_id===cc.id&&/Optional approval/.test(x.action||'')),'the named approver is asked to approve');
ok((await op.go(cc.id,'Implementation')).s===400,'implementation waits for the named approver');
const appr=(who,b)=>who.call('POST',`/api/records/${cc.id}/dept-approve`,{person:true,comment:'Agreed',sigUsername:who.u,password:'Demo-Pass-2026',...b});
ok((await appr(cs)).s===403,'only a named approver signs');
ok((await appr(tr)).ok,'the named approver signs (e-signature)');
ok((await appr(tr)).s===409,'a named approver signs once');
ok((await op.go(cc.id,'Implementation')).ok,'implementation starts');

// ===== closure: action items, all activities complete, first lot, final attachments, client post-approval =====
await op.put(cc.id,{plan:cc.data.plan.map(p=>({...p,closed:T})),finalImplDate:T,finalSummary:'Line replaced; ODU relocated; IQ / OQ done',firstLot:'N/A'},'Report');
await pm.put(cc.id,{clientCommunicated:'Yes'},'Client');
r=await op.sig(cc.id,'QA Closure Review');
ok(r.s===400&&r.error.includes(ai.number),'the report waits until the action items are closed: '+r.error);
ok((await op.get(cc.id)).record.data.allActivitiesComplete==='No','all change control activities complete? No');
ok((await op.sig(ai.id,'Completed')).s===400,'completing needs what was done');
await op.put(ai.id,{completion:'IQ / OQ protocols executed, reports attached'},'Done');
ok((await cs.sig(ai.id,'Completed')).s===403,'only the action owner completes the action item');
ok((await op.sig(ai.id,'Completed')).ok,'the owner completes the action item');
ok((await op.get(ai.id)).record.data.completedOn===T,'completion date recorded');
ok((await qa.sig(ai.id,'Closed')).ok,'QA verifies and closes it');
await qa.go(ai2.id,'Cancelled',{reason:'Covered by the existing risk assessment'});
await new Promise(r=>setTimeout(r,200));
ok((await op.get(cc.id)).record.data.allActivitiesComplete==='Yes','all activities complete once the plan and action items are closed');
let up=await op.call('POST',`/api/records/${cc.id}/attachments`,{name:'final-summary.pdf',mime:'application/pdf',base64:Buffer.from('%PDF-1.4 final').toString('base64'),category:'final'});
ok(up.sha256,'final attachment added in its own box');
ok((await op.sig(cc.id,'QA Closure Review')).ok,'change control report signed');
await qa.put(cc.id,{qaReport:'All activities verified'},'QA report');
ok((await qa.sig(cc.id,'Closed – EC Pending')).s===400,'client post-approval required before closure');
ok((await qa.sig(cc.id,'Pending Client Post-Approval')).ok,'pending client post-approval');
ok((await qa.go(cc.id,'Implementation',{reason:'Client asked for more data'})).ok&&(await qa.get(cc.id)).record.data.prevStatus==='Pending Client Post-Approval','client did not approve – back to implementation (previous state recorded)');
await op.sig(cc.id,'QA Closure Review'); await qa.sig(cc.id,'Pending Client Post-Approval');
await pm.put(cc.id,{clientApprovalDate:T,clientApprovalRef:'Sponsor e-mail'},'Client approval');
ok((await qa.sig(cc.id,'Closed – EC Pending')).ok,'closed after the client approved – effectiveness check pending');
ok((await op.call('GET','/api/notifications')).items.some(x=>x.record_id===cc.id&&x.action==='Effectiveness check'),'the effectiveness check owner is notified');
let g=await qa.get(cc.id);
ok(g.signatures.some(s=>s.meaning==='Approved – optional approver (Subject matter expert)'),'named approval in the e-signatures');

// ===== cancellation details =====
let c2=await au.call('POST','/api/records',{type:'changes',data:{...partA,site:'JRS IND',title:'Not needed',changeTypeOther:'x'}});
await au.go(c2.id,'Cancelled',{reason:'Duplicate of '+cc.number});
let cd=(await au.get(c2.id)).record.data;
ok(cd.cancelReason==='Duplicate of '+cc.number&&cd.cancelledBy==='author1'&&cd.cancelledOn===T,'cancellation reason, by and on kept on the record');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
