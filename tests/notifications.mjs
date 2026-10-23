// Notifications and e-mail (against a local fake SMTP server), passwords e-mailed by the administrator,
// the signature register (own registration only), all missing fields reported at once, sign-in by e-mail.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// fake SMTP server: records every message
const mails = [];
const smtp = net.createServer((s) => {
  let data = false, buf = '', from = '', to = [];
  s.write('220 fake ESMTP\r\n');
  s.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = data ? buf.indexOf('\r\n.\r\n') : buf.indexOf('\r\n')) >= 0) {
      if (data) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 5); data = false;
        const [head, body] = raw.split('\r\n\r\n');
        const subj = (head.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=/m) || [])[1];
        mails.push({ from, to, subject: subj ? Buffer.from(subj, 'base64').toString() : '', text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString() });
        s.write('250 queued\r\n'); continue;
      }
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^EHLO/i.test(line)) s.write('250-fake\r\n250 OK\r\n');
      else if (/^MAIL FROM:<(.*)>/i.test(line)) { from = line.match(/<(.*)>/)[1]; to = []; s.write('250 OK\r\n'); }
      else if (/^RCPT TO:<(.*)>/i.test(line)) { to.push(line.match(/<(.*)>/)[1]); s.write('250 OK\r\n'); }
      else if (/^DATA/i.test(line)) { data = true; s.write('354 go\r\n'); }
      else if (/^QUIT/i.test(line)) { s.write('221 bye\r\n'); s.end(); }
      else s.write('250 OK\r\n');
    }
  });
});
await new Promise(r => smtp.listen(0, '127.0.0.1', r));
const PORT = 25000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-nt-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.address().port), SMTP_FROM: 'eqms@jrs.test', SMTP_USER: '', APP_URL: 'http://qms.test:8080' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const sig=async(id,to,extra={})=>call('POST',`/api/records/${id}/transition`,{to,sigUsername:j.username,password:p,...extra});
 const put=(id,data,reason='update')=>call('PUT',`/api/records/${id}`,{data,reason});
 return {call,sig,put,u:j.username,me:j};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const wait=async(fn)=>{for(let i=0;i<40;i++){if(fn())return true;await new Promise(r=>setTimeout(r,50));}return false;};
const T=new Date().toISOString().slice(0,10);
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const ad=await login('admin','ChangeMe-2026!');
for (const [u,e] of [['qa.lead','qa.lead@jrs.test'],['packer1','packer1@jrs.test'],['operator1','operator1@jrs.test'],['cs.manager','cs.manager@jrs.test']])
  await ad.call('PUT','/api/users/'+u,{email:e,reason:'E-mail addresses for notifications'});
ok((await ad.call('GET','/api/users'))._arr.find(u=>u.username==='packer1').email==='packer1@jrs.test','administrator sets e-mail addresses');
ok((await ad.call('PUT','/api/users/packer1',{email:'not-an-email',reason:'x'})).s===400,'e-mail address is validated');

// ===== sign-in with the e-mail address =====
const pkByMail=await login('Packer1@JRS.test');ok(pkByMail.u==='packer1','sign in with the e-mail address (any case)');

// ===== signature register: each employee registers their own signature =====
const op=await login('operator1'), qa=await login('qa.lead'), qr=await login('qa.reviewer'), pk=await login('packer1'), cs=await login('cs.manager');
ok((await op.call('POST','/api/signature/register',{initials:'RP',signature:PNG,accept:true,password:'wrong'})).s===422,'registration needs the employee\'s own password');
ok((await op.call('POST','/api/signature/register',{initials:'RP',signature:'data:image/png;base64,',accept:true,password:'Demo-Pass-2026'})).s===400,'a drawn signature is required');
ok((await op.call('POST','/api/signature/register',{initials:'RP',signature:PNG,password:'Demo-Pass-2026'})).s===400,'the e-signature statement must be accepted');
ok((await op.call('POST','/api/signature/register',{initials:'rp',signature:PNG,accept:true,password:'Demo-Pass-2026'})).ok,'operator1 registers their signature');
let us=(await ad.call('GET','/api/users'))._arr.find(u=>u.username==='operator1');
ok(us.initials==='RP'&&us.hasSignature&&us.esigCurrent,'register shows initials, signature and current registration');
let img=await fetch(B+'/api/users/operator1/signature',{headers:{cookie:''}});ok(img.status===401,'signature image needs a session');
ok((await ad.call('PUT','/api/users/operator1',{initials:'XX',reason:'x'})).ok&&(await ad.call('GET','/api/users'))._arr.find(u=>u.username==='operator1').initials==='RP','the administrator cannot change an employee\'s registered initials');
for (const w of [qa,qr,pk,cs]) await w.call('POST','/api/signature/register',{initials:'XY',signature:PNG,accept:true,password:'Demo-Pass-2026'});

// ===== all missing fields at once =====
let miss=await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation'}});
ok(miss.s===400&&miss.missing.length===4&&/Applicable JRS site.*Short description.*Date identified.*What happened/.test(miss.error),'creating lists every empty required field: '+miss.error);

// ===== notifications on every status change =====
let d=await op.call('POST','/api/records',{type:'investigations',data:{invType:'Deviation',site:'JRS INC',title:'Pallet wrap torn',dateIdentified:T,requestDetails:'Found at goods-in',respPerson:'packer1'}});
let qn=await qa.call('GET','/api/notifications');
ok(qn.unread>=1&&qn.items[0].record_id===d.id&&qn.items[0].action==='Approve request – assign number','QA is notified of the new request with the action to take');
ok(await wait(()=>mails.some(m=>m.to.includes('qa.lead@jrs.test')&&m.subject.includes(d.number))),'QA receives the e-mail');
let m1=mails.find(m=>m.to.includes('qa.lead@jrs.test'));ok(m1.text.includes('http://qms.test:8080/#/r/'+d.id)&&m1.from==='eqms@jrs.test','e-mail links to the record');
ok(!(await op.call('GET','/api/notifications')).items.some(n=>n.record_id===d.id),'the person who made the change is not notified');
await qa.sig(d.id,'Initiation');
let pn=await pk.call('GET','/api/notifications');
ok(pn.items.some(n=>n.record_id===d.id&&n.action==='Submit Part A to QA'),'responsible person is told to write and submit Part A');
ok((await op.call('GET','/api/notifications')).items.some(n=>n.record_id===d.id&&/Initiation/.test(n.body)),'the initiator is informed of the status change (and may write Part A)');
ok(await wait(()=>mails.some(m=>m.to.includes('packer1@jrs.test')&&/action needed: Submit Part A/.test(m.subject))),'responsible person receives the e-mail');
await pk.put(d.id,{eventOrigin:'Goods-in',immediate:'Re-wrapped'});
miss=await pk.sig(d.id,'QA Review');
ok(miss.s===400&&miss.missing.join()==='description','submitting lists the fields still pending: '+miss.error);
await pk.put(d.id,{description:'Wrap torn on one side'}); await pk.sig(d.id,'QA Review');
await qa.put(d.id,{criticality:'Minor',impactedAreas:['Receipt']}); await qa.sig(d.id,'Investigation');
await pk.put(d.id,{investigation:'x',rootCause:'x',riskAssessment:'x',conclusion:'x',capaRequired:'No',capaJustification:'x'}); await pk.sig(d.id,'HOD Approval');
ok((await cs.call('GET','/api/notifications')).items.some(n=>n.record_id===d.id&&n.action==='Approve – Head of Department'),'the approving Head of Department is notified');
let rd=await cs.call('POST','/api/notifications/read');ok(rd.ok&&(await cs.call('GET','/api/notifications?count=1')).unread===0,'notifications are marked as read');

// ===== passwords set by the administrator are e-mailed to the user =====
let r=await ad.call('PUT','/api/users/packer1',{password:'Reset-Pass-2026',reason:'Forgot password'});
ok(r.emailed===true,'reset password is e-mailed');
ok(await wait(()=>mails.some(m=>m.to.includes('packer1@jrs.test')&&m.text.includes('Temporary password: Reset-Pass-2026'))),'the user receives the temporary password');
r=await ad.call('POST','/api/users',{username:'new.user',fullname:'New User',email:'new.user@jrs.test',roles:['user'],department:'OPS',password:'Welcome-Pass-2026'});
ok(r.emailed===true&&await wait(()=>mails.some(m=>m.to.includes('new.user@jrs.test')&&/your account/.test(m.subject))),'a new user receives their account e-mail');
r=await ad.call('PUT','/api/users/qa.reviewer',{password:'Reset-Pass-2026',reason:'x'});
ok(r.emailed===false,'no e-mail address: the administrator is told to pass the password on');
let au=await ad.call('GET','/api/audit?action='+encodeURIComponent('Temporary password e-mailed'));ok(au._arr.length===2,'password e-mails are in the audit trail (without the password)');
ok(!au._arr.some(a=>JSON.stringify(a).includes('Reset-Pass-2026')),'the password itself is never in the audit trail');
// audit trail: one entry for a new record (no "Field set" rows)
let at=await ad.call('GET','/api/audit?record='+encodeURIComponent(d.number));
ok(!at._arr.some(a=>a.action==='Field set')&&at._arr.some(a=>a.action==='Record created'&&/Short description: Pallet wrap torn/.test(a.new_value)),'record creation is one audit entry listing the values entered');

// ===== every user has an e-mail address =====
ok((await ad.call('POST','/api/users',{username:'no.mail',fullname:'No Mail',roles:['user'],department:'OPS',password:'Welcome-Pass-2026'})).s===400,'a user cannot be created without an e-mail address');
ok((await ad.call('PUT','/api/users/operator1',{email:'',reason:'x'})).s===400,'an e-mail address cannot be removed');

// ===== help desk: employees raise tickets, the administrators are notified by e-mail =====
await ad.call('PUT','/api/users/admin',{email:'admin@jrs.test',reason:'Help desk e-mails'});
mails.length=0;
let hd=await op.call('POST','/api/records',{type:'helpdesk',data:{title:'Cannot print the label report',category:'Error / something does not work',priority:'Medium',area:'Secondary packaging',description:'Clicking Print shows an error.'},attachments:[{name:'screenshot.png',mime:'image/png',base64:PNG.split(',')[1]}]});
ok(/^HLP-\d{4}-001$/.test(hd.number)&&hd.status==='Open','employee raises ticket '+hd.number);
ok((await op.call('GET','/api/records/'+hd.id)).attachments.length===1,'a screenshot can be attached to the ticket');
ok(await wait(()=>mails.some(m=>m.to.includes('admin@jrs.test')&&m.subject.includes(hd.number))),'the administrators are e-mailed about the new ticket');
ok((await pk.call('GET','/api/records/'+hd.id)).s>=400&&!(await pk.call('GET','/api/records?type=helpdesk'))._arr.some(r=>r.id===hd.id),'other employees do not see the ticket');
ok((await op.call('GET','/api/records?type=helpdesk'))._arr.some(r=>r.id===hd.id),'the employee sees their own ticket');
ok((await qa.sig(hd.id,'In Progress')).s>=400&&(await op.sig(hd.id,'In Progress')).s===403,'only administrators work on tickets (QA does not even see it; the employee cannot take it)');
const adSig=(id,to,extra={})=>ad.call('POST',`/api/records/${id}/transition`,{to,sigUsername:'admin',password:'ChangeMe-2026!',...extra});
mails.length=0;
ok((await adSig(hd.id,'In Progress')).ok&&(await ad.call('GET','/api/records/'+hd.id)).record.data.assignedTo==='admin','the administrator takes the ticket and is assigned to it');
ok(await wait(()=>mails.some(m=>m.to.includes('operator1@jrs.test')&&m.subject.includes(hd.number))),'the employee is e-mailed about the progress');
ok((await adSig(hd.id,'Resolved')).s===400,'resolving needs the resolution');
await ad.call('PUT','/api/records/'+hd.id,{data:{resolution:'Printer driver updated'},reason:'Fixed'});
ok((await adSig(hd.id,'Resolved')).ok,'ticket resolved');
ok((await op.sig(hd.id,'Closed')).ok,'the employee confirms it is fixed – ticket closed');
let hat=await ad.call('GET','/api/audit?record='+encodeURIComponent(hd.number));
ok(['Record created','Status changed'].every(x=>hat._arr.some(a=>a.action.startsWith(x)))||hat._arr.length>=4,'every ticket step is in the audit trail ('+hat._arr.length+' entries)');

// ===== password change confirmed by an e-mailed code =====
mails.length=0;
let pc=await op.call('POST','/api/password',{current:'Demo-Pass-2026',next:'New-Operator-Pass-2026'});
ok(pc.codeSent&&/^op•••@jrs\.test$/.test(pc.to),'changing the password e-mails a confirmation code ('+pc.to+')');
ok(await wait(()=>mails.some(m=>m.to.includes('operator1@jrs.test')&&/confirm your password change/.test(m.subject))),'the code arrives by e-mail');
const code=(mails.find(m=>/confirm your password change/.test(m.subject)).text.match(/\b(\d{6})\b/)||[])[1];
ok((await op.call('POST','/api/password',{current:'Demo-Pass-2026',next:'New-Operator-Pass-2026',code:code==='000000'?'111111':'000000'})).s===400,'a wrong code is refused');
ok((await op.call('POST','/api/password',{current:'Demo-Pass-2026',next:'Other-Operator-Pass-2026',code})).s===400,'the code only confirms the password it was sent for');
ok((await op.call('POST','/api/password',{current:'Demo-Pass-2026',next:'New-Operator-Pass-2026',code})).ok,'the right code changes the password');
ok(!!(await login('operator1','New-Operator-Pass-2026')).u,'sign in with the new password');
ok(await wait(()=>mails.some(m=>m.to.includes('operator1@jrs.test')&&/your password was changed/.test(m.subject))),'a "password changed" e-mail follows');
ok((await qr.call('POST','/api/password',{current:'Reset-Pass-2026',next:'New-Reviewer-Pass-2026'})).s===400,'no e-mail address: the password change cannot be confirmed');
let pa=(await ad.call('GET','/api/audit'))._arr.map(a=>a.action);
ok(pa.includes('Password change requested')&&pa.includes('Password change: wrong confirmation code')&&pa.includes('Password changed'),'password change steps are in the audit trail');
ok(!(await ad.call('GET','/api/audit'))._arr.some(a=>JSON.stringify(a).includes(code)),'the code is never in the audit trail');

srv.kill(); smtp.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
