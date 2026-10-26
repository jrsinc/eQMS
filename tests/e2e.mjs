import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-test-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '', ADMIN_INITIAL_PASSWORD: 'ChangeMe-2026!' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,...o, _arr:Array.isArray(o)?o:null}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:u,password:p,...extra});
 await call('POST','/api/esig-accept'); return {call,sig,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const au=await login('author1'), qa=await login('qa.lead'), qr=await login('qa.reviewer'), op=await login('operator1'), st=await login('stat1'), cs=await login('cs.manager');
// documents
// documents (full JRS/SOP/QAS/021 and 003 rules are in tests/documents-training.mjs)
const today=new Date().toISOString().slice(0,10);
let d=await au.call('POST','/api/records',{type:'documents',data:{docType:'SOP',division:'QAS',title:'Deviation management',sites:['JRS INC'],reviewer:'qa.reviewer',revisionSummary:'New SOP',trainingImpact:'None',content:'Step 1...'}});
ok(d.number==='JRS/SOP/QAS/001'&&d.status==='Draft'&&d.data.version==='1.0','document created '+d.number);
ok((await au.sig(d.id,'In Review')).s===200,'send for review');
ok((await qr.sig(d.id,'QA Review')).ok,'review signed');
ok((await qr.sig(d.id,'Approval')).ok,'QA review signed');
ok((await au.sig(d.id,'Approved – Training')).s===403,'author cannot approve (role)');
await qa.call('PUT',`/api/records/${d.id}`,{data:{effectiveDate:today,shortNotice:'Test'},reason:'set effective date'});
let bad=await qa.call('POST',`/api/records/${d.id}/transition`,{to:'Approved – Training',sigUsername:'qa.lead',password:'wrong'});ok(bad.s===422,'wrong password rejected: '+bad.error);
ok((await qa.sig(d.id,'Approved – Training')).ok,'Head QA approves');
ok((await qa.sig(d.id,'Effective')).ok,'QA makes effective');
let ed=await au.call('PUT',`/api/records/${d.id}`,{data:{title:'x'},reason:'test'});ok(ed.s===409,'effective doc locked');
let rv=await au.call('POST',`/api/records/${d.id}/revise`,{revisionType:'Periodic review – no change',reason:'periodic review'});ok(rv.number===d.number&&rv.data.version==='2.0','revision v2.0 same number');
// deviation (full Quality Events rules are in tests/quality-events.mjs)
let dv=await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation',site:'JRS INC',title:'Temp excursion WH-2',dateIdentified:'2026-10-19',requestDetails:'Logger showed 9°C for 2h'}});
ok(/^REQ-\d{4}-0001$/.test(dv.number),'deviation request numbered '+dv.number);
let up=await op.call('PUT',`/api/records/${dv.id}`,{data:{title:'x'}});ok(up.s===400,'edit without reason blocked');
await op.call('POST',`/api/records/${dv.id}/transition`,{to:'Initiation',sigUsername:'operator1',password:'Demo-Pass-2026'}).then(r=>ok(r.s===403,'operator cannot approve the request (role)'));
// randomization
let rn=await st.call('POST','/api/records',{type:'randomization',data:{title:'Kit list',study:'ABC-301',arms:'A,B',ratio:'2:1',blockSize:6,kits:60,startKit:1001,seed:'test-seed'}});
ok(rn.number,'rand created');
let g=await st.call('POST',`/api/records/${rn.id}/randomize`,{sigUsername:'stat1',password:'Demo-Pass-2026'});ok(g.kits===60,'generated 60 kits');
let ub=await st.call('GET',`/api/records/${rn.id}/kits?view=unblinded`);ok(ub.balance.A===40&&ub.balance.B===20&&ub.checksumValid,'balance A40 B20, checksum ok');
ok((await cs.call('GET',`/api/records/${rn.id}/kits?view=unblinded`)).s===403,'blinded user cannot see unblinded');
ok((await st.sig(rn.id,'Approved')).s===403,'generator cannot approve');
ok((await qa.sig(rn.id,'Approved')).ok,'second person approves list');
// reproducibility
// labels
let lb=await cs.call('POST','/api/records',{type:'labels',data:{title:'ABC-301 UK label',study:'ABC-301',country:'UK / English'}});
await cs.sig(lb.id,'Regulatory Review');await au.sig(lb.id,'Sponsor Approval');await cs.sig(lb.id,'QA Approval');
ok((await qa.sig(lb.id,'Approved')).ok,'label approved');
let pj=await cs.call('POST',`/api/records/${lb.id}/print`,{firstKit:1001,qty:60,batch:'B123',expiry:'31-Dec-2027',sigUsername:'cs.manager',password:'Demo-Pass-2026'});ok(pj.qty===60,'print job logged');
// packaging reconciliation
let pk=await cs.call('POST','/api/records',{type:'packaging',data:{title:'Pack ABC-301',study:'ABC-301',randList:rn.number,labelRef:lb.number,kits:60,lineClearStart:true}});
await cs.sig(pk.id,'In Progress');
await cs.call('PUT',`/api/records/${pk.id}`,{data:{issued:62,used:60,damaged:1,returned:0,lineClearEnd:true},reason:'reconciliation'});
ok((await cs.sig(pk.id,'Reconciled')).s===400,'unbalanced reconciliation blocked');
await cs.call('PUT',`/api/records/${pk.id}`,{data:{returned:1},reason:'found 1 label'});
ok((await cs.sig(pk.id,'Reconciled')).ok,'balanced reconciliation');
ok((await qa.sig(pk.id,'QP Certified')).ok,'QP certified');
// customer sanctions
let cu=await op.call('POST','/api/records',{type:'customers',data:{title:'Pharma Wholesale Ltd',country:'United Kingdom',address:'1 Dock Rd, London',licenceNo:'WDA(H) 1234',licenceExpiry:'2099-01-01'}});
const rp=await login('rp1');
ok((await rp.sig(cu.id,'Qualified')).s===403,'only QA qualifies customers');
ok((await qa.sig(cu.id,'Qualified')).s===400,'qualification blocked without a review date');
// audit trail
let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
let det=await qa.call('GET',`/api/records/${rn.id}`);ok(det.signatures.length===2,'randomization signatures '+det.signatures.length);
ok((await fetch(B+'/api/records')).status===401,'unauthenticated blocked');
let nocsrf=await fetch(B+'/api/logout',{method:'POST',headers:{cookie:'x'}});ok(nocsrf.status===401,'no session on POST');

// document issuance
let is1=await op.call('POST','/api/records',{type:'issues',data:{docNumber:'JRS/SOP/QAS/999',copyType:'Controlled copy (department display / reference)',copies:2,issuedTo:'operator1',purpose:'Line 2',returnBy:'2026-12-31'}});
ok(is1.s===400,'issue blocked for non-effective document');
let is=await op.call('POST','/api/records',{type:'issues',data:{docNumber:d.number,copyType:'Form issued by QA (ISSUED BY QA, FRM/QAS/050)',copies:2,issuedTo:'operator1',purpose:'BMR lot B2610-07',returnBy:'2026-12-31'}});
ok(is.data&&is.data.docVersion==='1.0','issue request filled with effective version '+(is.data&&is.data.docVersion));
ok((await qa.call('POST',`/api/records/${is.id}/issue-print`,{sigUsername:'qa.lead',password:'Demo-Pass-2026'})).s===409,'print blocked before approval');
ok((await qa.sig(is.id,'Approved')).ok,'QA approves issue');
let pr=await qa.call('POST',`/api/records/${is.id}/issue-print`,{sigUsername:'qa.lead',password:'Demo-Pass-2026'});
ok(pr.copies&&pr.copies.length===2&&pr.pages.length>=1,'2 stamped copies issued, '+(pr.pages&&pr.pages.length)+' page(s) each');
let rep=await qa.call('POST',`/api/records/${is.id}/issue-print`,{reprint:true,copyNo:1,reason:'Copy damaged',sigUsername:'qa.lead',password:'Demo-Pass-2026'});
ok(rep.copies&&rep.copies[0].copyNo===3&&rep.copies[0].replaces===1,'replacement copy 3 voids copy 1');
await qa.call('PUT',`/api/records/${is.id}`,{data:{returned:1,destroyed:0},reason:'return'});
await op.call('POST',`/api/records/${is.id}/transition`,{to:'Returned'});
ok((await qa.sig(is.id,'Reconciled')).s===400,'reconciliation blocked while copies outstanding');
await qa.call('PUT',`/api/records/${is.id}`,{data:{destroyed:1},reason:'unused copy destroyed'});
ok((await qa.sig(is.id,'Reconciled')).ok,'issue reconciled');
let v2=await qa.call('GET','/api/audit/verify');ok(v2.ok,'audit chain intact after issuance, entries '+v2.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
