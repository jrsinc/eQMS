// Audit trail, version history and audit trail review: access for QA, admin and management only, filters, readable data,
// saved versions and comparison, document versions, periodic review with summary and two signatures.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 23000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-at-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true' }, stdio: 'ignore' });
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

// a failed sign-in, picked up later by the review summary
await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'operator1',password:'wrong-password'})});
const qa=await login('qa.lead'), qr=await login('qa.reviewer'), op=await login('operator1'), au=await login('author1'), dir=await login('director1'), insp=await login('inspector1'), ad=await login('admin','ChangeMe-2026!');

// ===== a record with several versions =====
let d=await op.create('investigations',{invType:'Deviation',site:'JRS INC',title:'Freezer door seal damaged',dateIdentified:T,requestDetails:'Seal torn at the hinge side',respPerson:'operator1'});
const reqNo=d.number;
await op.put(d.id,{title:'Walk-in freezer door seal damaged'},'More precise title');
await op.put(d.id,{title:'Walk-in freezer door seal damaged'},'No real change');
await qa.sig(d.id,'Initiation');
d=(await qa.get(d.id)).record;

// ===== access: QA, admin and management only =====
ok((await op.call('GET','/api/audit')).s===403,'general user cannot open the audit trail');
ok((await op.call('GET','/api/audit/verify')).s===403,'general user cannot run the integrity check');
ok((await insp.call('GET','/api/audit')).s===403,'external auditor cannot open the audit trail');
let od=await op.get(d.id);ok(od.auditAccess===false&&od.audit.length===0&&od.versionCount===0,'record page shows no audit trail or versions to a general user');
ok((await op.call('GET',`/api/records/${d.id}/versions`)).s===403,'general user cannot see version history');
let ex=await op.call('GET','/api/export/'+d.id);ok(ex.record&&ex.audit===undefined,'record export leaves out the audit trail for a general user');
ok((await ad.call('GET','/api/audit')).s===200,'administrator can open the audit trail');
ok((await dir.call('GET','/api/audit')).s===200,'management can open the audit trail');
let qd=await qa.get(d.id);ok(qd.auditAccess===true&&qd.audit.length>0&&qd.versionCount>=3,'QA sees the record audit trail and '+qd.versionCount+' versions');
ok((await qa.call('GET','/api/export/'+d.id)).audit.length>0,'record export includes the audit trail for QA');

// ===== version history =====
let vh=await qa.call('GET',`/api/records/${d.id}/versions`);
const vs=vh.versions.slice().reverse(); // oldest first
ok(vs.length===3,'versions: created, edited, approved with the number assigned ('+vs.length+'); the save without a change added none');
let v1=await qa.call('GET',`/api/records/${d.id}/versions/1`), v2=await qa.call('GET',`/api/records/${d.id}/versions/2`), vl=await qa.call('GET',`/api/records/${d.id}/versions/${vs.length}`);
ok(v1.data.title==='Freezer door seal damaged'&&v1.status==='Requested'&&v1.number===reqNo,'version 1 keeps the original title, status and request number');
ok(v2.data.title==='Walk-in freezer door seal damaged'&&v2.reason==='More precise title'&&v2.username==='operator1','version 2 records the change, who made it and the reason');
ok(vl.number===d.number&&vl.status==='Initiation','latest version carries the assigned number '+vl.number);
ok((await qa.call('GET',`/api/records/${d.id}/versions/99`)).s===404,'unknown version not found');

// ===== filters =====
const q=(s)=>qa.call('GET','/api/audit?'+s).then(r=>r._arr);
let r1=await q('type=investigations&user=operator1');
ok(r1.length>0&&r1.every(a=>a.record_type==='investigations'&&a.username==='operator1'),'filter by module and user ('+r1.length+' entries)');
let r2=await q('record='+encodeURIComponent(d.number));
ok(r2.some(a=>a.record_number===reqNo)&&r2.some(a=>a.record_number===d.number),'filter by record number finds entries from before and after numbering');
let r3=await q('type=system');ok(r3.length>0&&r3.every(a=>!a.record_id),'filter system events (sign-ins, users)');
let r4=await q(`from=${T}&to=${T}`);ok(r4.length>0&&r4.every(a=>a.ts.startsWith(T)),'filter by date range');
ok((await q('from='+addD(T,1))).length===0,'no entries in a future period');
let r5=await q('action='+encodeURIComponent('Login failed'));ok(r5.length>=1,'filter by action finds the failed sign-in');
let r6=await q('q='+encodeURIComponent('More precise title'));ok(r6.length>=1&&r6.every(a=>a.reason==='More precise title'||JSON.stringify(a).includes('More precise title')),'free-text search finds the reason');
ok((await qa.call('POST','/api/audit/report',{kind:'print',filters:'Module: Deviations'})).ok,'printing the audit trail report is logged');
ok((await op.call('POST','/api/audit/report',{kind:'csv'})).s===403,'general user cannot log an audit trail export');
ok((await q('action='+encodeURIComponent('Audit trail report printed'))).length===1,'audit trail printing appears in the audit trail');

// ===== document versions =====
let doc=await au.create('documents',{docType:'SOP',division:'QAS',title:'Audit trail review',sites:['JRS INC'],reviewer:'qa.reviewer',revisionSummary:'New SOP',trainingImpact:'None'});
await au.sig(doc.id,'In Review'); await qr.sig(doc.id,'QA Review'); await qr.sig(doc.id,'Approval');
await qa.put(doc.id,{effectiveDate:T,shortNotice:'Test'}); await qa.sig(doc.id,'Approved – Training'); await qa.sig(doc.id,'Effective');
let rev=await au.call('POST',`/api/records/${doc.id}/revise`,{revisionType:'Periodic review – no change',reason:'Periodic review'});
let dv=await qa.call('GET',`/api/records/${rev.id}/versions`);
ok(dv.docVersions.map(x=>x.version).join()==='2.0,1.0'&&dv.docVersions[1].status==='Effective','document version list shows 2.0 (draft) and 1.0 (effective)');

// ===== audit trail review =====
ok((await op.call('GET','/api/records?type=atreviews'))._arr.length===0,'audit trail reviews are hidden from general users');
ok((await op.create('atreviews',{title:'x',periodFrom:addD(T,-30),periodTo:T})).s===403,'general user cannot create an audit trail review');
let bad=await qa.create('atreviews',{title:'Q4 review',periodFrom:addD(T,-30),periodTo:addD(T,1)});
ok((await qa.go(bad.id,'Under Review')).s===400,'review period cannot end in the future');
let rv=await qa.create('atreviews',{title:'Audit trail review – last 30 days',periodFrom:addD(T,-30),periodTo:T});
ok(/^ATR-\d{4}-\d{4}$/.test(rv.number),'review numbered '+rv.number);
ok((await op.get(rv.id)).s===404&&(await op.put(rv.id,{title:'x'})).s===404,'general user cannot open or change a review');
ok((await qa.go(rv.id,'Under Review')).ok,'review started');
let g=await qa.get(rv.id), S=g.record.data.summary;
const flag=(l)=>S.flags.find(x=>x[0].startsWith(l))[1];
ok(S.total>0&&S.records>0&&S.chain.ok,'summary compiled: '+S.total+' entries, '+S.records+' records, hash chain intact');
ok(flag('Failed sign-ins')>=1&&flag('Field changes')>=1&&flag('Audit trail exported')>=1,'events to look at first counted (failed sign-ins, field changes, audit trail exports)');
await qa.put(rv.id,{reviewer:'qa.lead',findings:'One failed sign-in (operator1, typing error); all field changes have reasons.',anomalies:'Anomalies found – deviation or CAPA raised',conclusion:'Audit trail reviewed.'});
ok((await qa.sig(rv.id,'QA Approval')).s===400,'anomalies need a deviation or CAPA number');
await qa.put(rv.id,{anomalies:'No anomalies found'});
ok((await qa.sig(rv.id,'QA Approval')).ok,'reviewer signs the review');
ok((await qa.sig(rv.id,'Approved')).s===403,'the reviewer cannot also approve');
ok((await qr.sig(rv.id,'Approved')).ok,'second QA person approves the review');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
