// Backup and restore (system administrators): one .jrsbak file with the whole database and its checksum; the same file restores
// the system after a check and an e-signed confirmation; the current database is kept first; everyone signs in again.
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import crypto from 'node:crypto';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 30000 + Math.floor(Math.random() * 1000), DATA = mkdtempSync(join(tmpdir(), 'qms-bk-'));
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', MODULE_GROUPS_OFF: '', ADMIN_INITIAL_PASSWORD: 'ChangeMe-2026!', SMTP_HOST: '' }, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 const raw=async(url)=>{const r=await fetch(B+url,{headers:{cookie:c}});return {s:r.status,disp:r.headers.get('content-disposition'),buf:Buffer.from(await r.arrayBuffer())}};
 const upload=async(url,buf)=>{const r=await fetch(B+url,{method:'POST',headers:{'Content-Type':'application/octet-stream',cookie:c,'X-CSRF-Token':j.csrf},body:buf});return {s:r.status,...(await r.json().catch(()=>({})))}};
 await call('POST','/api/esig-accept'); return {call,raw,upload,u,p};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const file=(name,text)=>({name,mime:'text/plain',base64:Buffer.from(text).toString('base64')});

let ad=await login('admin','ChangeMe-2026!'), mg=await login('director1'), qa=await login('qa.lead'), op=await login('operator1');
const SIG={sigUsername:'admin',password:'ChangeMe-2026!'};
// some content before the backup: a customer with an attachment
let before=await op.call('POST','/api/records',{type:'customers',data:{title:'Before backup',country:'UK',address:'1 Dock Rd',licenceNo:'L-1',licenceExpiry:'2030-01-01'},attachments:[file('evidence.pdf','evidence')]});
const nBefore=(await ad.call('GET','/api/records'))._arr.length;

// ===== backup =====
ok((await mg.raw('/api/admin/backup')).s===403&&(await qa.raw('/api/admin/backup')).s===403,'only system administrators take backups (not management or QA)');
let bk=await ad.raw('/api/admin/backup');
const MAGIC='JRS-EQMS-BACKUP 1\n', nl=bk.buf.indexOf(10,MAGIC.length), head=JSON.parse(bk.buf.subarray(MAGIC.length,nl).toString('utf8')), db=gunzipSync(bk.buf.subarray(nl+1));
ok(bk.s===200&&/JRS-eQMS-backup-\d{8}-\d{6}\.jrsbak/.test(bk.disp)&&bk.buf.subarray(0,MAGIC.length).toString()===MAGIC,'backup downloads as one .jrsbak file');
ok(db.subarray(0,15).toString()==='SQLite format 3'&&crypto.createHash('sha256').update(db).digest('hex')===head.sha256&&db.length===head.size,'the file holds the whole database with its SHA-256');
ok(head.createdBy==='admin'&&head.counts.records===nBefore&&head.counts.attachments>=1&&head.auditIntact,'header: who, when, what it contains ('+head.counts.records+' records, '+head.counts.attachments+' attachments)');

// changes after the backup – these go away with the restore
let after=await op.call('POST','/api/records',{type:'customers',data:{title:'After backup',country:'UK',address:'1 Dock Rd',licenceNo:'L-1',licenceExpiry:'2030-01-01'},attachments:[file('f.pdf','x')]});
ok(after.number&&(await ad.call('GET','/api/records'))._arr.length===nBefore+1,'a customer is added after the backup: '+after.number);

// ===== check the file =====
ok((await qa.upload('/api/admin/restore/check',bk.buf)).s===403,'only administrators restore');
ok((await ad.upload('/api/admin/restore/check',Buffer.from('hello'))).s===400,'a file that is not a backup is refused');
const bad=Buffer.from(bk.buf); bad[bad.length-40]^=0xff;
ok((await ad.upload('/api/admin/restore/check',bad)).s===400,'a damaged / changed backup is refused');
let chk=await ad.upload('/api/admin/restore/check',bk.buf);
ok(chk.s===200&&chk.token&&chk.integrity&&chk.audit.ok&&chk.counts.records===nBefore&&chk.current.records===nBefore+1&&chk.admins>=1,'the backup is checked and summarised before anything changes (backup '+chk.counts.records+' records, now '+chk.current.records+')');
ok((await ad.call('GET','/api/records'))._arr.length===nBefore+1,'checking changes nothing');

// ===== confirm and restore =====
ok((await ad.call('POST','/api/admin/restore',{token:chk.token,confirm:'RESTORE',reason:'Test'})).s===403,'restore needs the e-signature');
ok((await ad.call('POST','/api/admin/restore',{token:chk.token,confirm:'yes',reason:'Test',...SIG})).s===400,'restore needs RESTORE typed');
ok((await ad.call('POST','/api/admin/restore',{token:chk.token,confirm:'RESTORE',...SIG})).s===400,'restore needs a reason');
ok((await mg.call('POST','/api/admin/restore',{token:chk.token,confirm:'RESTORE',reason:'x',sigUsername:'director1',password:'Demo-Pass-2026'})).s===403,'management cannot restore');
let rs=await ad.call('POST','/api/admin/restore',{token:chk.token,confirm:'RESTORE',reason:'Recover the state before the test changes',...SIG});
ok(rs.ok&&/^pre-restore-\d{8}-\d{6}\.db$/.test(rs.kept)&&existsSync(join(DATA,'backup',rs.kept)),'restored; the database before the restore is kept in data/backup: '+rs.kept);
ok(!readdirSync(join(DATA,'backup')).some(f=>f.startsWith('rs-')),'the uploaded copy is removed after the restore');
ok((await op.call('GET','/api/records')).s===401&&(await ad.call('GET','/api/records')).s===401,'everyone is signed out');
ad=await login('admin','ChangeMe-2026!'); op=await login('operator1');
const recs=(await ad.call('GET','/api/records'))._arr;
ok(recs.length===nBefore&&recs.some(r=>r.id===before.id)&&!recs.some(r=>r.id===after.id),'the system is back at the backup: the later customer is gone, the earlier one is there');
let g=await op.call('GET','/api/records/'+before.id);
ok(g.attachments&&g.attachments.length===1,'attachments are restored');
ok((await ad.call('POST','/api/admin/restore',{token:chk.token,confirm:'RESTORE',reason:'again',...SIG})).s===409,'a checked upload is used once');
let nx=await op.call('POST','/api/records',{type:'customers',data:{title:'After restore',country:'UK',address:'1 Dock Rd',licenceNo:'L-1',licenceExpiry:'2030-01-01'},attachments:[file('f.pdf','x')]});
ok(nx.number===after.number,'record numbering continues from the backup ('+nx.number+')');
let au=(await ad.call('GET','/api/audit?action='+encodeURIComponent('Database restored')))._arr;
ok(au.length===1&&au[0].reason==='Recover the state before the test changes','the restore is in the audit trail with its reason');
let v=await ad.call('GET','/api/audit/verify');ok(v.ok,'audit trail chain intact after the restore ('+v.checked+' entries)');
let log=(await ad.call('GET','/api/admin/backups/log'))._arr;
ok(log.some(a=>a.action==='Database restored from backup'),'backup and restore log');
await ad.raw('/api/admin/backup');ok((await ad.call('GET','/api/admin/backups/log'))._arr[0].action==='Backup downloaded','new backups are logged');
// ===== account lock: other users are locked after 5 wrong passwords, system administrators never =====
const tryLogin=async(u,p)=>(await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})).status;
for (let i=0;i<5;i++) await tryLogin('pm1','wrong-password');
ok(await tryLogin('pm1','Demo-Pass-2026')===423,'a user is locked after 5 wrong passwords');
for (let i=0;i<6;i++) await tryLogin('admin','wrong-password');
ok(await tryLogin('admin','ChangeMe-2026!')===200,'the system administrator is never locked out');
ok((await ad.call('GET','/api/audit?action='+encodeURIComponent('Login failed')))._arr.filter(a=>a.username==='admin').length>=6,'failed administrator sign-ins are still in the audit trail');

srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
