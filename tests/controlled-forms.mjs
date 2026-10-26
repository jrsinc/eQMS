// Controlled forms (List of Controlled Documents JRS/FRM/QAS/048, JRS/SOP/QAS/021): QA adds and changes forms, everyone views the list;
// signed master and in-use form per version; new versions supersede, QA makes forms obsolete; QA issues numbered copies of the current version only.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PL = createRequire(import.meta.url)('../vendor/pdf-lib.min.js'), { PDFDocument, StandardFonts } = PL;
import { inflateSync } from 'node:zlib';
// page content streams as text (stamp colour and position)
const contents=(doc,p)=>{const look=(x)=>x instanceof PL.PDFRef?doc.context.lookup(x):x;const c=look(p.node.get(PL.PDFName.of('Contents')));const parts=c instanceof PL.PDFArray?c.asArray().map(look):[c];return parts.map(s=>{let b=Buffer.from(s.contents);if(String(s.dict.get(PL.PDFName.of('Filter'))||'').includes('Flate'))b=inflateSync(b);return b.toString('latin1');}).join(' ');};
const BLUE='0.08 0.27 0.68 RG', GREEN='0.05 0.45 0.2 RG', RED='0.75 0.1 0.1 RG', FOOTER_LEFT=/1 0 0 1 18 4 cm/;
const PORT = 27000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-cf-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '', ADMIN_INITIAL_PASSWORD: 'ChangeMe-2026!', SMTP_HOST: '' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const ct=r.headers.get('content-type')||'';
   if(ct.includes('pdf'))return {s:r.status,type:ct,disp:r.headers.get('content-disposition'),nos:(r.headers.get('x-issue-numbers')||'').split(','),buf:Buffer.from(await r.arrayBuffer())};
   const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const raw=async(url)=>{const r=await fetch(B+url,{headers:{cookie:c}});return {s:r.status,type:r.headers.get('content-type'),buf:Buffer.from(await r.arrayBuffer())}};
 await call('POST','/api/esig-accept'); return {call,raw,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const T=new Date().toISOString().slice(0,10), Y=T.slice(0,4);
const addD=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
// a two-page blank form with one fillable field, as the in-use PDF
async function blankForm(label){const d=await PDFDocument.create(),F=await d.embedFont(StandardFonts.Helvetica);for(let i=0;i<2;i++){const p=d.addPage([612,792]);p.drawText(label+' page '+(i+1),{x:50,y:700,size:12,font:F});}
  const t=d.getForm().createTextField('Batch no');t.addToPage(d.getPage(0),{x:50,y:600,width:200,height:20});return {name:label+'.pdf',base64:Buffer.from(await d.save()).toString('base64')};}
const scan={name:'signed-master.pdf',base64:Buffer.from('%PDF-1.4 signed scan').toString('base64')};

const qa=await login('qa.lead'), op=await login('operator1'), pk=await login('packer1');
const SIG={sigUsername:'qa.lead',password:'Demo-Pass-2026'}, qs=(m,url,b)=>qa.call(m,url,{...b,...SIG});

// ===== the list from JRS/FRM/QAS/048, viewable by everyone =====
let list=(await op.call('GET','/api/cforms'))._arr;
ok(list.length===133,'list of controlled forms loaded from JRS/FRM/QAS/048 v1.0: '+list.length+' forms');
const pkg1=list.find(r=>r.number==='JRS/FRM/PKG/001');
ok(pkg1&&pkg1.title==='Production Order'&&pkg1.version==='4.0'&&pkg1.effectiveDate==='2025-12-23'&&pkg1.section==='Annexure Packaging SOP','entries keep number, title, version, effective date and section (PKG/001 Production Order v4.0)');
ok(list.find(r=>r.number==='JRS/FRM/QAS/010').version==='2.0','QAS/010 New Customer Creation Form v2.0');
let d=await op.call('GET','/api/cforms/'+pkg1.id);
ok(d.current&&d.current.version==='4.0'&&d.versions===undefined&&d.issues===undefined,'other users see the current version only – no version history or issue record');
ok(!d.current.master&&!d.current.inuse,'no signed master or in-use form yet');

// ===== only QA adds and changes =====
ok((await op.call('POST','/api/cforms',{number:'JRS/FRM/QAS/056',title:'X',version:'1.0',effectiveDate:T})).s===403,'others cannot add forms');
ok((await qs('POST','/api/cforms',{number:'QAS-56',title:'X',version:'1.0',effectiveDate:T})).s===400,'form number format JRS/FRM/XXX/NNN');
ok((await qs('POST','/api/cforms',{number:'JRS/FRM/PKG/001',title:'X',version:'1.0',effectiveDate:T})).s===409,'form numbers are unique');
ok((await qs('POST','/api/cforms',{number:'JRS/FRM/QAS/056',title:'Y',version:'1.0',effectiveDate:T,inuse:{name:'x.docx',base64:Buffer.from('PK word').toString('base64')}})).s===400,'the in-use form must be a PDF');
ok((await qa.call('POST','/api/cforms',{number:'JRS/FRM/QAS/057',title:'No signature',version:'1.0',effectiveDate:T})).s===403,'adding a form needs the e-signature');
ok((await qa.call('POST','/api/cforms',{number:'JRS/FRM/QAS/057',title:'Wrong password',version:'1.0',effectiveDate:T,sigUsername:'qa.lead',password:'wrong'})).s===422&&!(await qa.call('GET','/api/cforms'))._arr.some(r=>r.number==='JRS/FRM/QAS/057'),'wrong password: nothing is added');
let nf=await qs('POST','/api/cforms',{number:'jrs/frm/qas/056',title:'Line Clearance – Warehouse',version:'1.0',section:'Annexure of Quality Assurance SOP',sop:'JRS/SOP/QAS/021',effectiveDate:T,master:scan,inuse:await blankForm('line-clearance-v1')});
ok(nf.number==='JRS/FRM/QAS/056','QA adds a form with its signed master and in-use form');
d=await qa.call('GET','/api/cforms/'+nf.id);
ok(d.current.master.name==='signed-master.pdf'&&d.current.inuse.name==='line-clearance-v1.pdf'&&d.versions.length===1&&d.current.status==='Effective','current version 1.0 Effective with both files');
ok((await op.call('PUT','/api/cforms/'+nf.id,{title:'Z',reason:'x'})).s===403,'others cannot change a form');
ok((await qs('PUT','/api/cforms/'+nf.id,{title:'Line Clearance – Warehouse Area'})).s===400,'changes need a reason');
ok((await qs('PUT','/api/cforms/'+nf.id,{title:'Line Clearance – Warehouse Area',reason:'Title as on the signed master'})).changes===1,'QA changes the title with a reason');
ok((await op.raw(`/api/cforms/${nf.id}/versions/${d.current.id}/inuse`)).s===403,'only QA opens the signed master and in-use files');
let m=await qa.raw(`/api/cforms/${nf.id}/versions/${d.current.id}/master`);
ok(m.s===200&&m.buf.toString().startsWith('%PDF-1.4 signed'),'QA downloads the signed master');

// ===== issue: who for, purpose, number of copies; only the current version =====
ok((await op.call('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'x',copies:1})).s===403,'only QA issues forms');
ok((await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',copies:2})).s===400,'issue needs the purpose');
ok((await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'x',copies:0})).s===400,'issue needs the number of copies (1–50)');
ok((await qs('POST',`/api/cforms/${nf.id}/issue`,{purpose:'x',copies:1})).s===400,'issue needs the person it is issued to');
ok((await qs('POST',`/api/cforms/${pkg1.id}/issue`,{issuedTo:'packer1',purpose:'x',copies:1})).s===409,'a form without an in-use file cannot be issued');
let is=await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'PO-2026-114 line clearance',copies:3,version:'1.0'});
let pdf=await PDFDocument.load(is.buf);
ok(is.s===200&&is.nos.length===3&&is.nos.every(n=>new RegExp('^FI-'+Y+'-\\d{3}$').test(n))&&new Set(is.nos).size===3,'3 copies issued, each with its own number: '+is.nos.join(', '));
ok(pdf.getPages().every(p=>contents(pdf,p).includes(BLUE)&&FOOTER_LEFT.test(contents(pdf,p))),'blue issue stamp at the left side of the footer of every page');
ok(pdf.getPageCount()===6&&pdf.getForm().getFields().length===0,'one PDF with 3 copies of the 2-page form, fields flattened for printing');
ok(/JRS-FRM-QAS-056 v1.0 FI-/.test(is.disp),'file named after the form, version and issue numbers');
let one=await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'operator1',purpose:'Warehouse audit',copies:1});
pdf=await PDFDocument.load(one.buf);
ok(one.nos.length===1&&pdf.getPageCount()===2&&pdf.getForm().getFields().length===1,'a single copy stays fillable');
d=await qa.call('GET','/api/cforms/'+nf.id);
ok(d.issues.length===4&&d.issues.filter(r=>r.issued_to==='packer1').length===3&&d.issues.every(r=>r.form_version==='1.0'&&r.issued_by==='Priya Raman (QA Head / QP)')&&d.issues.some(r=>r.purpose==='PO-2026-114 line clearance'&&r.copy_label==='1 of 3'),'issue record: number, version, copy, issued to, purpose, issued by');
let reg=(await qa.call('GET','/api/form-issues'))._arr;
ok(reg.filter(r=>r.form_code==='JRS/FRM/QAS/056').length===4,'copies are in the issued forms register');
let n=await pk.call('GET','/api/notifications');
ok(n.items.some(x=>/3 issued copies of JRS\/FRM\/QAS\/056/.test(x.subject)&&x.body.includes('PO-2026-114')),'the person receives a notification with the issue numbers and purpose');

// ===== new version supersedes; only the updated version is issued =====
ok((await qs('POST',`/api/cforms/${nf.id}/versions`,{version:'1.0',effectiveDate:T,changeNote:'x',master:scan,inuse:await blankForm('v')})).s===400,'the new version must be higher');
ok((await qs('POST',`/api/cforms/${nf.id}/versions`,{version:'2.0',effectiveDate:T,changeNote:'Added temperature row'})).s===400,'a new version needs the signed master and in-use form');
ok((await op.call('POST',`/api/cforms/${nf.id}/versions`,{version:'2.0',effectiveDate:T,changeNote:'x',master:scan,inuse:await blankForm('v')})).s===403,'only QA makes new versions');
let nv=await qs('POST',`/api/cforms/${nf.id}/versions`,{version:'2.0',effectiveDate:T,changeNote:'Added temperature row',master:scan,inuse:await blankForm('line-clearance-v2')});
d=await qa.call('GET','/api/cforms/'+nf.id);
ok(nv.version==='2.0'&&d.current.version==='2.0'&&d.versions.length===2&&d.versions[1].status==='Superseded'&&d.versions[1].endReason==='Superseded by v2.0','v2.0 effective, v1.0 superseded – version history kept');
let sup=await qa.raw(`/api/cforms/${nf.id}/versions/${d.versions[1].id}/inuse`), sp=await PDFDocument.load(sup.buf);
ok(sup.s===200&&sp.getPages().every(p=>contents(sp,p).includes(RED)),'QA can still open the files of the superseded version – with a red SUPERSEDED stamp');
let cu=await qa.raw(`/api/cforms/${nf.id}/versions/${d.versions[0].id}/inuse`), cp=await PDFDocument.load(cu.buf);
ok(!contents(cp,cp.getPage(0)).includes(RED),'the current version has no red stamp');
ok((await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'x',copies:1,version:'1.0'})).s===409,'the superseded version cannot be issued');
let i2=await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'Next batch',copies:1});
ok(i2.s===200&&(await qa.call('GET','/api/cforms/'+nf.id)).issues[0].form_version==='2.0','copies now come from v2.0');
// later effective date: the new version waits as Approved, the version in use is still issued until then
let fut=await qs('POST',`/api/cforms/${nf.id}/versions`,{version:'3.0',effectiveDate:addD(T,10),changeNote:'Layout',master:scan,inuse:await blankForm('v3')});
d=await qa.call('GET','/api/cforms/'+nf.id);
ok(fut.status==='Approved'&&d.current.version==='2.0'&&d.pending.version==='3.0'&&d.versions[0].status==='Approved','v3.0 approved with a later effective date; v2.0 stays in use');
ok((await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'x',copies:1,version:'3.0'})).s===409,'a version is not issued before its effective date');
ok((await qs('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'Before v3.0',copies:1})).s===200,'v2.0 is issued until v3.0 becomes effective');
ok((await qs('POST',`/api/cforms/${nf.id}/versions`,{version:'4.0',effectiveDate:T,changeNote:'x',master:scan,inuse:await blankForm('v4')})).s===409,'no further version while one is waiting for its effective date');

// ===== obsolete =====
ok((await qs('POST',`/api/cforms/${pkg1.id}/obsolete`,{})).s===400,'making a form obsolete needs a reason');
ok((await op.call('POST',`/api/cforms/${pkg1.id}/obsolete`,{reason:'x'})).s===403,'only QA makes forms obsolete');
ok((await qs('POST',`/api/cforms/${pkg1.id}/obsolete`,{reason:'Replaced by the eQMS production order'})).status==='Obsolete','QA makes PKG/001 obsolete');
ok(!(await op.call('GET','/api/cforms'))._arr.some(r=>r.number==='JRS/FRM/PKG/001')&&(await op.call('GET','/api/cforms/'+pkg1.id)).s===404,'obsolete forms leave the list other users see');
let ql=(await qa.call('GET','/api/cforms'))._arr.find(r=>r.number==='JRS/FRM/PKG/001');
ok(ql&&ql.status==='Obsolete','QA still sees the obsolete form');
ok((await qs('POST',`/api/cforms/${pkg1.id}/versions`,{version:'5.0',effectiveDate:T,changeNote:'x',master:scan,inuse:await blankForm('v')})).s===409&&(await qs('POST',`/api/cforms/${pkg1.id}/issue`,{issuedTo:'packer1',purpose:'x',copies:1})).s===409,'obsolete forms get no new version and are not issued');
ok((await qs('POST','/api/cforms',{number:'JRS/FRM/PKG/001',title:'Again',version:'1.0',effectiveDate:T})).s===409,'the number of an obsolete form is not reused');

// ===== e-signatures and master list =====
d=await qa.call('GET','/api/cforms/'+nf.id);
const meanings=d.signatures.map(x=>x.meaning);
ok(['Controlled form added – QA','Controlled form changed – QA','Form copies issued – QA','Controlled form v2.0 approved – QA'].every(m=>meanings.includes(m))&&d.signatures.every(x=>x.username==='qa.lead'),'every change and issue is e-signed: '+[...new Set(meanings)].join('; '));
ok((await qa.call('POST',`/api/cforms/${nf.id}/issue`,{issuedTo:'packer1',purpose:'x',copies:1})).s===403,'issuing needs the e-signature');
ok((await qa.call('POST',`/api/cforms/${nf.id}/files`,{kind:'master',...scan,reason:'Clearer scan'})).s===403,'replacing a file needs the e-signature');
ok((await qa.call('POST','/api/cforms/master-list',{purpose:'Document control file'})).s===403,'issuing the master list needs the e-signature');
ok((await qs('POST','/api/cforms/master-list',{})).s===400,'issuing the master list needs a purpose');
ok((await op.call('POST','/api/cforms/master-list',{purpose:'x',sigUsername:'operator1',password:'Demo-Pass-2026'})).s===403,'only QA issues the master list');
let mp=await qs('POST','/api/cforms/master-list',{purpose:'Document control file'}), mpd=await PDFDocument.load(mp.buf);
ok(mp.s===200&&/^FI-[0-9]{4}-[0-9]{3}$/.test(mp.nos[0])&&mpd.getPageCount()>=3&&mpd.getPages().every(p=>contents(mpd,p).includes(BLUE)&&FOOTER_LEFT.test(contents(mpd,p))),'master list issued as '+mp.nos[0]+' ('+mpd.getPageCount()+' pages) with the blue issue stamp on every page');
let mli=(await qa.call('GET','/api/cforms/master-list/issues'))._arr, mreg=(await qa.call('GET','/api/form-issues'))._arr.find(r=>r.no===mp.nos[0]);
ok(mli.length===1&&mli[0].purpose==='Document control file'&&mreg&&mreg.form_code==='JRS/FRM/QAS/048','the issue is recorded with its purpose in the issued forms register');
ok((await qa.call('GET','/api/audit'))._arr.some(a=>a.action===`Master list issued (${mp.nos[0]})`&&a.reason==='Document control file'),'master list issue in the audit trail');
ok((await qa.raw('/api/cforms/master-list')).s!==200,'the master list is no longer a plain download');

// ===== audit trail =====
let au=(await qa.call('GET','/api/audit'))._arr.map(a=>a.action);
ok(['Controlled forms loaded','Controlled form added','Controlled form changed','Signed master downloaded','Controlled form new version','Controlled form made obsolete'].every(x=>au.includes(x))&&au.some(x=>/^Controlled form issued \(FI-/.test(x)),'every change, download and issue is in the audit trail');
let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
