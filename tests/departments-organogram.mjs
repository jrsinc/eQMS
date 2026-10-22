// Departments, organogram and roles: who creates departments, who changes the organogram, roles derived from it,
// approvals that follow the hierarchy, attachments at every stage, and the full report download (ZIP).
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';
const { PDFDocument } = createRequire(import.meta.url)('../vendor/pdf-lib.min.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 24000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-org-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const raw=async(url)=>{const r=await fetch(B+url,{headers:{cookie:c}});return {s:r.status,type:r.headers.get('content-type'),disp:r.headers.get('content-disposition'),buf:Buffer.from(await r.arrayBuffer())}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:u,password:p,...extra});
 const go=(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,...extra});
 const put=(id,data,reason='update')=>call('PUT',`/api/records/${id}`,{data,reason});
 const get=(id)=>call('GET',`/api/records/${id}`);
 const attach=(id,name,text)=>call('POST',`/api/records/${id}/attachments`,{name,mime:'text/plain',base64:Buffer.from(text).toString('base64')});
 await call('POST','/api/esig-accept'); return {call,raw,sig,go,put,get,attach,u,me:j};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const T=new Date().toISOString().slice(0,10);
// minimal ZIP reader (central directory) for checking the report download
function unzip(buf){const out={};const end=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));let p=buf.readUInt32LE(end+16);const n=buf.readUInt16LE(end+10);
 for(let i=0;i<n;i++){const nl=buf.readUInt16LE(p+28),xl=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),off=buf.readUInt32LE(p+42),cs=buf.readUInt32LE(p+20);const name=buf.slice(p+46,p+46+nl).toString('utf8');
  const lnl=buf.readUInt16LE(off+26),lxl=buf.readUInt16LE(off+28);out[name]=inflateRawSync(buf.slice(off+30+lnl+lxl,off+30+lnl+lxl+cs));p+=46+nl+xl+cl;}return out;}

const qa=await login('qa.lead'), qr=await login('qa.reviewer'), op=await login('operator1'), hod=await login('hod.ops'), pk=await login('packer1'), cs=await login('cs.manager'),
  dir=await login('director1'), tr=await login('trainer1'), ad=await login('admin','ChangeMe-2026!'), insp=await login('inspector1');

// ===== departments =====
let deps=(await op.call('GET','/api/departments'))._arr;
ok(['HRM','ITS','OPS','PKG','QAS'].every(c=>deps.some(d=>d.code===c))&&deps.length===5,'departments seeded: Operation, HR, Packaging, QA, IT');
ok((await op.call('POST','/api/departments',{code:'ENG',name:'Engineering'})).s===403,'a department user cannot create departments');
ok((await qa.call('POST','/api/departments',{code:'ENG',name:'Engineering'})).s===403,'QA cannot create departments');
ok((await dir.call('POST','/api/departments',{code:'e1',name:'Engineering'})).s===400,'department code must be 2–6 capital letters');
ok((await dir.call('POST','/api/departments',{code:'ENG',name:'Engineering',parent:'OPS',reason:'New function'})).ok,'management creates a department under Operation');
ok((await ad.call('POST','/api/departments',{code:'ENG',name:'Engineering 2'})).s===409,'department codes are unique');
ok((await ad.call('POST','/api/departments',{code:'WHS',name:'Warehouse'})).ok,'administrator creates a department');
ok((await dir.call('PUT','/api/departments/OPS',{parent:'ENG',reason:'test'})).s===400,'a department cannot sit under its own sub-department');
ok((await qa.call('PUT','/api/departments/WHS',{name:'Warehousing',reason:'x'})).s===403,'only admin and management rename departments');
ok((await dir.call('PUT','/api/departments/WHS',{name:'Warehousing',reason:'Name agreed'})).ok,'management renames a department');
// new department codes are usable at once (CAPA numbers, selects)
let k=await qa.call('POST','/api/records',{type:'capa',data:{title:'Calibrate HVAC sensors',respDept:'ENG',respPerson:'qa.reviewer',dueDate:'2099-01-01',source:'Deviation',nonconformance:'Drift'}});
ok(/^CAPA\/ENG\/001\//.test(k.number||''),'a new department can be used straight away: '+k.number);

// ===== organogram =====
ok((await op.call('GET','/api/organogram')).s===403,'department users cannot open the organogram');
ok((await qr.call('GET','/api/organogram')).s===403,'QA staff (not the Head of QA) cannot open the organogram');
ok((await hod.call('GET','/api/organogram')).s===403,'other Heads of Department cannot open the organogram');
let og=await qa.call('GET','/api/organogram');
ok(og.departments&&og.departments.find(d=>d.code==='PKG').hod==='cs.manager'&&og.departments.find(d=>d.code==='PKG').parent==='OPS','Head of QA opens the organogram: Packaging (Head cs.manager) sits under Operation');
ok(og.users.find(u=>u.username==='packer1').reports_to==='cs.manager','reporting lines shown');
ok((await dir.call('GET','/api/organogram')).departments,'management opens the organogram');
ok((await qa.call('PUT','/api/departments/ENG',{hod:'hod.ops',reason:'Interim Head'})).ok,'Head of QA sets the Head of Engineering');
ok((await qa.call('PUT','/api/departments/ENG',{name:'x',reason:'x'})).s===403,'the Head of QA changes the organogram but does not rename departments');
ok((await qa.call('PUT','/api/organogram/users/hod.ops',{reportsTo:'operator1',reason:'test'})).s===400,'reporting lines cannot form a loop');
ok((await dir.call('PUT','/api/organogram/users/trainer1',{department:'WHS',reason:'Moved to warehouse'})).ok,'management moves a user to another department');
ok((await op.call('PUT','/api/organogram/users/trainer1',{department:'OPS',reason:'x'})).s===403,'department users cannot change the organogram');

// ===== roles =====
const me=async(w)=>(await w.call('GET','/api/me'));
ok((await me(hod)).roles.includes('hod')&&(await me(hod)).hodOf.includes('OPS'),'Head of Operations holds the Head of Department role through the organogram');
ok(!(await me(op)).roles.includes('hod')&&(await me(op)).department==='OPS','operator1 is a department user in Operation');
ok((await me(qa)).roles.includes('numgen')&&(await me(qr)).roles.includes('numgen'),'all QA users assign record numbers');
ok((await me(dir)).allAccess&&(await me(ad)).allAccess,'management and administrators have all access');
ok((await ad.call('POST','/api/users',{username:'pkg.op2',fullname:'Second Packer',roles:['user','hod','numgen'],department:'PKG',reportsTo:'cs.manager',password:'Packer-Pass-2026'})).ok,'administrator creates a department user');
let nu=(await ad.call('GET','/api/users'))._arr.find(u=>u.username==='pkg.op2');
ok(nu.roles.join()==='user'&&nu.department==='PKG'&&nu.reports_to==='cs.manager','Head of Department / number roles are not assigned by hand; department and line manager saved');
ok((await dir.call('GET','/api/audit')).s===200&&(await dir.call('GET','/api/records?type=atreviews')).s===200,'management sees the audit trail and audit trail reviews');

// ===== deviation: department scope, attachments at every stage, report =====
let d=await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation',site:'JRS INC',title:'Shrink wrap torn on pallet',dateIdentified:T,requestDetails:'Found at goods-in',respPerson:'packer1'}});
ok((await op.attach(d.id,'photo-goods-in.txt','photo')).sha256,'initiator attaches a file to the request');
await qa.sig(d.id,'Initiation');
ok((await tr.get(d.id)).s===404&&(await tr.attach(d.id,'x.txt','x')).s===404,'users outside the department can neither see nor attach');
ok((await insp.get(d.id)).record,'read-only inspector can see the deviation');
ok((await dir.get(d.id)).record,'management sees every department');
await pk.attach(d.id,'pallet-label.txt','label');
await pk.put(d.id,{eventOrigin:'Goods-in',description:'Wrap torn on one side',immediate:'Pallet re-wrapped'}); await pk.sig(d.id,'QA Review');
await qa.put(d.id,{criticality:'Minor',impactedAreas:['Receipt']}); await qa.sig(d.id,'Investigation');
await pk.attach(d.id,'investigation-notes.txt','notes');
let det=await qa.get(d.id);
ok(det.attachments.map(a=>a.stage).join()==='Requested,Initiation,Investigation','each attachment keeps the stage it was added at: '+det.attachments.map(a=>a.stage).join(', '));
// report at an interim stage
let z=await pk.raw(`/api/records/${d.id}/report`);
ok(z.s===200&&z.type==='application/zip','report can be downloaded at any stage (ZIP)');
let files=unzip(z.buf), names=Object.keys(files);
const html=files[names.find(n=>n.endsWith('report.html'))].toString('utf8');
ok(names.filter(n=>n.startsWith('attachments/')).length===3&&names.some(n=>n.includes('Investigation - investigation-notes.txt')),'ZIP contains the report and all 3 attachments by stage');
ok(files[names.find(n=>n.includes('photo-goods-in'))].toString()==='photo','attachment content intact');
ok(html.includes('Interim report')&&html.includes('Part C – Investigation')&&html.includes('Part B approved – QA'),'interim report shows every part and the signatures');
ok(!names.includes('audit-trail.csv')&&html.includes('included in reports downloaded by QA'),'department users get the report without the audit trail');
z=await qa.raw(`/api/records/${d.id}/report`); files=unzip(z.buf);
ok(String(files['audit-trail.csv']).includes('Status changed')&&files[Object.keys(files).find(n=>n.endsWith('report.html'))].toString().includes('<h2>Audit trail</h2><table>'),'QA report ends with the audit trail (and a CSV copy)');
ok((await tr.raw(`/api/records/${d.id}/report`)).s===404,'users outside the department cannot download the report');
// merged PDF: report + PDF and image attachments + audit trail
{
  const two = await PDFDocument.create(); two.addPage([300, 300]); two.addPage([300, 300]);
  const pdfB64 = Buffer.from(await two.save()).toString('base64');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await pk.call('POST',`/api/records/${d.id}/attachments`,{name:'scan.pdf',mime:'application/pdf',base64:pdfB64});
  await pk.call('POST',`/api/records/${d.id}/attachments`,{name:'photo.png',mime:'image/png',base64:png});
  const one = await pk.raw(`/api/records/${d.id}/report.pdf`);
  ok(one.s===200&&one.type==='application/pdf'&&one.buf.slice(0,4).toString()==='%PDF','report downloads as one PDF');
  const P = await PDFDocument.load(one.buf), n = P.getPageCount();
    ok(n >= 5, 'merged PDF has the report, the 2 pages of the attached PDF and the image page ('+n+' pages)');
  const q = await qa.raw(`/api/records/${d.id}/report.pdf?inline=1`);
  ok(q.s===200&&/inline/.test(q.disp)&&(await PDFDocument.load(q.buf)).getPageCount()>=n,'print opens the same PDF in the browser; the QA copy also has the audit trail');
  ok((await tr.raw(`/api/records/${d.id}/report.pdf`)).s===404,'users outside the department cannot get the PDF');
  ok((await qa.call('GET','/api/audit?action='+encodeURIComponent('(PDF)')))._arr.length===2,'PDF downloads and prints are in the audit trail');
}

// finish and check closed-record attachments
await pk.put(d.id,{investigation:'Forklift damage',rootCause:'Forklift tine',riskAssessment:'Low',conclusion:'No impact',capaRequired:'No',capaJustification:'Isolated'});
await pk.sig(d.id,'HOD Approval'); await cs.sig(d.id,'QA Evaluation');
await qa.put(d.id,{finalDisposition:'Release / use as is',customerApproval:'Not applicable (no customer impact)',qaEvalComment:'Accepted'});
ok((await qa.sig(d.id,'Closed')).ok,'deviation closed');
ok((await pk.attach(d.id,'late.txt','late')).s===409,'after closure only QA adds attachments');
ok((await qa.attach(d.id,'closure-memo.txt','memo')).sha256,'QA adds a closure attachment');
z=await pk.raw(`/api/records/${d.id}/report`); files=unzip(z.buf);
ok(!files[Object.keys(files).find(n=>n.endsWith('report.html'))].toString().includes('Interim report')&&Object.keys(files).some(n=>n.includes('Closed - closure-memo.txt')),'final report after closure includes the closure attachment');
let au=await qa.call('GET','/api/audit?action='+encodeURIComponent('Report downloaded'));
ok(au._arr.filter(a=>a.action==='Report downloaded').length===3,'every ZIP download is in the audit trail (3)');
// no Head anywhere up the hierarchy → the investigation cannot go to approval
await dir.call('POST','/api/departments',{code:'LAB',name:'Laboratory',reason:'New'});
await dir.call('PUT','/api/organogram/users/trainer1',{department:'LAB',reportsTo:'',reason:'Lab start-up'});
let d2=await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation',site:'JRS INC',title:'Balance out of calibration',dateIdentified:T,requestDetails:'Daily check failed',respPerson:'trainer1'}});
ok(d2.data.respDept==='LAB','responsible department LAB from the responsible person');
await qa.sig(d2.id,'Initiation'); await tr.put(d2.id,{eventOrigin:'Lab',description:'x',immediate:'x'}); await tr.sig(d2.id,'QA Review');
await qa.put(d2.id,{criticality:'Minor',impactedAreas:['Storage']}); await qa.sig(d2.id,'Investigation');
await tr.put(d2.id,{investigation:'x',rootCause:'x',riskAssessment:'x',conclusion:'x',capaRequired:'No',capaJustification:'x'});
let nh=await tr.sig(d2.id,'HOD Approval');
ok(nh.s===400&&/organogram/.test(nh.error),'no Head of Department in the organogram: '+nh.error);
await dir.call('PUT','/api/departments/LAB',{hod:'director1',reason:'Interim'});
ok((await tr.sig(d2.id,'HOD Approval')).ok,'Head set in the organogram – submitted for approval');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
