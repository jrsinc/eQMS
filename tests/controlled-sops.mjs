// Controlled SOPs (List of Controlled Documents – SOP, JRS/FRM/QAS/048; JRS/SOP/QAS/021): version control as for forms, QA chooses by role
// who can see each SOP, QA issues controlled / uncontrolled copies with an expiry date (green stamp), every step e-signed.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { inflateSync } from 'node:zlib';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PL = createRequire(import.meta.url)('../vendor/pdf-lib.min.js'), { PDFDocument, StandardFonts } = PL;
const PORT = 28000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-cs-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '', ADMIN_INITIAL_PASSWORD: 'ChangeMe-2026!', SMTP_HOST: '' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const ct=r.headers.get('content-type')||'';
   if(ct.includes('pdf'))return {s:r.status,disp:r.headers.get('content-disposition'),nos:(r.headers.get('x-issue-numbers')||'').split(','),buf:Buffer.from(await r.arrayBuffer())};
   const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const raw=async(url)=>{const r=await fetch(B+url,{headers:{cookie:c}});return {s:r.status,type:r.headers.get('content-type'),disp:r.headers.get('content-disposition'),buf:Buffer.from(await r.arrayBuffer())}};
 await call('POST','/api/esig-accept'); return {call,raw,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const T=new Date().toISOString().slice(0,10), Y=T.slice(0,4);
const addD=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)};
async function sopPdf(label){const d=await PDFDocument.create(),F=await d.embedFont(StandardFonts.Helvetica);for(let i=0;i<3;i++)d.addPage([612,792]).drawText(label+' page '+(i+1),{x:50,y:700,size:12,font:F});return {name:label+'.pdf',base64:Buffer.from(await d.save()).toString('base64')};}
const scan={name:'signed-master.pdf',base64:Buffer.from('%PDF-1.4 signed scan').toString('base64')};
// reads a copy protected with the standard security handler (empty user password): permissions and page 1 content
const PAD=Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A','hex');
const rc4=(key,data)=>{const s=[...Array(256).keys()];let j=0;for(let i=0;i<256;i++){j=(j+s[i]+key[i%key.length])&255;[s[i],s[j]]=[s[j],s[i]];}const o=Buffer.alloc(data.length);let i=0;j=0;for(let k=0;k<data.length;k++){i=(i+1)&255;j=(j+s[i])&255;[s[i],s[j]]=[s[j],s[i]];o[k]=data[k]^s[(s[i]+s[j])&255];}return o;};
async function readLocked(buf){
  let refused=false; try{await PDFDocument.load(buf);}catch(e){refused=/encrypt/i.test(e.message);}
  const d=await PDFDocument.load(buf,{ignoreEncryption:true}), ctx=d.context, enc=ctx.lookup(ctx.trailerInfo.Encrypt);
  const g=(k)=>enc.get(PL.PDFName.of(k)), P=g('P').asNumber(), O=Buffer.from(g('O').asBytes()), id0=Buffer.from(ctx.trailerInfo.ID.get(0).asBytes());
  const md5=(b)=>crypto.createHash('md5').update(b).digest(), pb=Buffer.alloc(4); pb.writeInt32LE(P);
  let key=md5(Buffer.concat([PAD,O,pb,id0])); for(let i=0;i<50;i++) key=md5(key);
  const pref=d.getPage(0).node.get(PL.PDFName.of('Contents')), refs=pref instanceof PL.PDFArray?pref.asArray():[pref];
  let plain=''; for(const r of refs){const s=ctx.lookup(r), b=Buffer.alloc(5); b.writeUIntLE(r.objectNumber,0,3); b.writeUInt16LE(r.generationNumber,3); const dec=rc4(md5(Buffer.concat([key,b])),Buffer.from(s.contents)); try{plain+=inflateSync(dec).toString('latin1');}catch{plain+=dec.toString('latin1');}}
  return {refused, P, pages:d.getPageCount(), plain};
}
const hex=(s)=>'<'+Buffer.from(s,'latin1').toString('hex').toUpperCase().slice(0,24);
const GREEN='0.05 0.45 0.2 RG', RED='0.75 0.1 0.1 RG', FOOTER_LEFT='1 0 0 1 18 4 cm';

const qa=await login('qa.lead'), op=await login('operator1'), au=await login('author1'), dr=await login('director1');
const SIG={sigUsername:'qa.lead',password:'Demo-Pass-2026'}, qs=(m,url,b)=>qa.call(m,url,{...b,...SIG});

// ===== list from JRS/FRM/QAS/048 – SOP =====
let list=(await op.call('GET','/api/csops'))._arr;
ok(list.length===72,'list of controlled SOPs and policies loaded from JRS/FRM/QAS/048 v1.0: '+list.length);
ok(list[0].number==='JRS/SOP/ADM/001'&&list[list.length-1].number==='JRS/POL/HRM/008','sections in the order of the list: Administrations … Policies');
const s004=list.find(r=>r.number==='JRS/SOP/OPS/004');
ok(s004&&s004.title==='Procedure for Storage and Distribution'&&s004.version==='9.0'&&s004.effectiveDate==='2025-10-15'&&s004.section==='Operations SOP','OPS/004 Procedure for Storage and Distribution v9.0');
ok(list.every(r=>r.roles===undefined),'access settings are shown to QA only');
ok((await qa.call('GET','/api/csops'))._arr[0].roles.join()==='all','by default everyone can see an SOP');

// ===== QA adds an SOP, chooses who can see it, signs =====
ok((await op.call('POST','/api/csops',{number:'JRS/SOP/QAS/023',title:'X',version:'1.0',effectiveDate:T,roles:['all']})).s===403,'only QA adds SOPs');
ok((await qa.call('POST','/api/csops',{number:'JRS/SOP/QAS/023',title:'X',version:'1.0',effectiveDate:T,roles:['all']})).s===403,'adding an SOP needs the e-signature');
ok((await qs('POST','/api/csops',{number:'JRS/FRM/QAS/099',title:'X',version:'1.0',effectiveDate:T,roles:['all']})).s===400,'SOP numbers: JRS/SOP/… or JRS/POL/…');
ok((await qs('POST','/api/csops',{number:'JRS/SOP/QAS/023',title:'X',version:'1.0',effectiveDate:T,roles:[]})).s===400,'access: everyone or at least one role');
let ns=await qs('POST','/api/csops',{number:'JRS/SOP/QAS/023',title:'Controlled Copy Management',version:'1.0',section:'Quality Assurance SOP',effectiveDate:T,roles:['author','bogus'],master:scan,inuse:await sopPdf('sop-023-v1')});
ok(ns.number==='JRS/SOP/QAS/023','QA adds JRS/SOP/QAS/023 with its signed master and SOP file');
let d=await qa.call('GET','/api/csops/'+ns.id);
ok(d.roles.join()==='author'&&d.signatures.some(x=>x.meaning==='Controlled SOP added – QA'),'access limited to document authors (unknown roles dropped); addition e-signed');

// ===== role-wise access =====
ok(!(await op.call('GET','/api/csops'))._arr.some(r=>r.id===ns.id)&&(await op.call('GET','/api/csops/'+ns.id)).s===404&&(await op.raw(`/api/csops/${ns.id}/view`)).s===404,'a department user without access does not see the SOP');
ok((await au.call('GET','/api/csops'))._arr.some(r=>r.id===ns.id),'a document author sees it');
ok((await dr.call('GET','/api/csops/'+ns.id)).number==='JRS/SOP/QAS/023','management sees every SOP');
let ad=await au.call('GET','/api/csops/'+ns.id);
ok(ad.canView&&ad.versions===undefined&&ad.issues===undefined&&ad.signatures===undefined,'users with access read the SOP; version history, signatures and issues are QA only');
let vw=await au.raw(`/api/csops/${ns.id}/view`), lv=await readLocked(vw.buf);
ok(vw.s===200&&lv.refused&&!(lv.P&4)&&!(lv.P&16),'on-screen reading: a locked copy – no printing, no copying text');
ok(lv.plain.includes(GREEN)&&lv.plain.includes(FOOTER_LEFT)&&lv.plain.includes(hex('READ-ONLY')),'read-only copy carries a green stamp at the left of the footer');
ok((await au.raw(`/api/csops/${ns.id}/versions/${d.current.id}/inuse`)).s===403,'only QA opens the signed master and SOP file');
ok((await qa.call('PUT','/api/csops/'+ns.id,{roles:['author','user'],reason:'Operators follow it'})).s===403,'changing access needs the e-signature');
let ch=await qs('PUT','/api/csops/'+ns.id,{roles:['author','user'],reason:'Operators follow it'});
ok(ch.changes===1&&(await op.call('GET','/api/csops'))._arr.some(r=>r.id===ns.id),'QA gives department users access (signed) – the operator now sees it');

// ===== issue: controlled / uncontrolled copy, who to, expiry =====
const iss=(b)=>qs('POST',`/api/csops/${ns.id}/issue`,{issuedTo:'operator1',purpose:'Packaging hall',copies:1,...b});
ok((await op.call('POST',`/api/csops/${ns.id}/issue`,{copyType:'controlled',issuedTo:'operator1',purpose:'x',copies:1,expiry:addD(T,30)})).s===403,'only QA issues SOP copies');
ok((await iss({expiry:addD(T,30)})).s===400,'issue asks: controlled or uncontrolled copy');
ok((await iss({copyType:'controlled'})).s===400,'issue needs the expiry date of the copy');
ok((await iss({copyType:'controlled',expiry:addD(T,-1)})).s===400,'the expiry date cannot be in the past');
ok((await qa.call('POST',`/api/csops/${ns.id}/issue`,{copyType:'controlled',issuedTo:'operator1',purpose:'x',copies:1,expiry:addD(T,30)})).s===403,'issuing needs the e-signature');
let cc=await iss({copyType:'controlled',expiry:addD(T,365),copies:2});
ok(cc.s===200&&cc.nos.join()===`CC-${Y}-001,CC-${Y}-002`,'controlled copies numbered CC-'+Y+'-001, -002');
let lc=await readLocked(cc.buf);
ok(lc.refused&&(lc.P&4)&&!(lc.P&16)&&lc.pages===6,'controlled copies: printable, text cannot be copied; 2 copies of the 3-page SOP');
ok(lc.plain.includes(GREEN)&&lc.plain.includes(FOOTER_LEFT)&&lc.plain.includes(hex('CONTROLLED COPY')),'green CONTROLLED COPY stamp at the left of the footer');
let uc=await iss({copyType:'uncontrolled',expiry:addD(T,14),issuedTo:'author1',purpose:'Customer audit request'});
let lu=await readLocked(uc.buf);
ok(uc.nos.join()===`UC-${Y}-001`&&lu.plain.includes(GREEN)&&lu.plain.includes(hex('UNCONTROLLED COPY')),'uncontrolled copy UC-'+Y+'-001 with a green UNCONTROLLED COPY stamp');
d=await qa.call('GET','/api/csops/'+ns.id);
ok(d.issues.length===3&&d.issues.filter(r=>r.copy_type==='Controlled'&&r.expiry===addD(T,365)&&r.issued_to==='operator1').length===2&&d.issues.some(r=>r.copy_type==='Uncontrolled'&&r.expiry===addD(T,14)&&r.issued_to==='author1'),'issue record: copy type, issued to, expiry');
ok(['Controlled copy issued – QA','Uncontrolled copy issued – QA','Controlled SOP changed – QA'].every(m=>d.signatures.some(x=>x.meaning===m)),'each issue is e-signed');
let reg=(await qa.call('GET','/api/form-issues'))._arr;
ok(reg.some(r=>r.no===`CC-${Y}-001`&&r.copy_type==='Controlled'&&r.expiry)&&reg.some(r=>r.no===`UC-${Y}-001`),'controlled and uncontrolled copies are in the issued register');
ok((await op.call('GET','/api/notifications')).items.some(x=>/controlled copies of JRS\/SOP\/QAS\/023/.test(x.subject)),'the person is notified');

// ===== versions, superseded / obsolete =====
let nv=await qs('POST',`/api/csops/${ns.id}/versions`,{version:'2.0',effectiveDate:T,changeNote:'Expiry rules added',master:scan,inuse:await sopPdf('sop-023-v2')});
d=await qa.call('GET','/api/csops/'+ns.id);
ok(nv.status==='Effective'&&d.current.version==='2.0'&&d.versions[1].status==='Superseded','v2.0 effective, v1.0 superseded');
let sup=await qa.raw(`/api/csops/${ns.id}/versions/${d.versions[1].id}/inuse`), sp=await PDFDocument.load(sup.buf);
const pc=(doc,p)=>{const c=doc.context.lookup(p.node.get(PL.PDFName.of('Contents')));const parts=c instanceof PL.PDFArray?c.asArray().map(x=>doc.context.lookup(x)):[c];return parts.map(s=>{let b=Buffer.from(s.contents);try{b=inflateSync(b);}catch{}return b.toString('latin1');}).join(' ');};
ok(sp.getPages().every(p=>pc(sp,p).includes(RED)),'the superseded SOP downloads with a red stamp');
ok((await iss({copyType:'controlled',expiry:addD(T,30),version:'1.0'})).s===409,'the superseded version cannot be issued');
ok((await qs('POST',`/api/csops/${ns.id}/obsolete`,{reason:'Merged into JRS/SOP/QAS/021'})).status==='Obsolete','QA makes the SOP obsolete (signed)');
d=await qa.call('GET','/api/csops/'+ns.id);
let ob=await qa.raw(`/api/csops/${ns.id}/versions/${d.versions[0].id}/inuse`), obp=await PDFDocument.load(ob.buf);
ok(d.versions[0].status==='Obsolete'&&pc(obp,obp.getPage(0)).includes(RED),'the obsolete SOP downloads with a red stamp');
ok((await iss({copyType:'controlled',expiry:addD(T,30)})).s===409&&(await op.call('GET','/api/csops/'+ns.id)).s===404,'obsolete: not issued, not shown to users');

// ===== master list =====
ok((await qa.call('POST','/api/csops/master-list',{purpose:'Audit'})).s===403,'issuing the SOP master list needs the e-signature');
let mp=await qs('POST','/api/csops/master-list',{purpose:'Customer audit'});
ok(mp.s===200&&/List of Controlled Documents - SOP FI-/.test(mp.disp)&&mp.nos[0],'SOP master list issued as '+mp.nos[0]);
ok((await qa.call('GET','/api/csops/master-list/issues'))._arr[0].purpose==='Customer audit','SOP master list issues are recorded');
ok((await au.call('POST','/api/csops/master-list',{purpose:'x',sigUsername:'author1',password:'Demo-Pass-2026'})).s===403,'only QA issues the master list');

let v=await qa.call('GET','/api/audit/verify');ok(v.ok,'audit chain intact, entries '+v.checked);
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
