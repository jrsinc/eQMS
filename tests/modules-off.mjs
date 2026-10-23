// Switched-off module groups (modules.js GROUPS_OFF): Compliance, Clinical supply and Documents & training are hidden from everyone,
// management / administrators and QA included; the other modules and the controlled forms and SOPs stay available.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 29000 + Math.floor(Math.random() * 1000);
const env = { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), 'qms-off-')), PORT: String(PORT), HOST: '127.0.0.1', SEED_DEMO: 'true', SMTP_HOST: '' };
delete env.MODULE_GROUPS_OFF; // the default list from modules.js
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: root, env, stdio: 'ignore' });
const B = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 150; i++) { try { await fetch(B + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
let failed = 0;
async function login(u,p='Demo-Pass-2026'){const r=await fetch(B+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});const j=await r.json();if(!r.ok)throw new Error(u+': '+j.error);const c=r.headers.get('set-cookie').split(';')[0];
 const call=async(m,url,b)=>{const r=await fetch(B+url,{method:m,headers:{'Content-Type':'application/json',cookie:c,'X-CSRF-Token':j.csrf},body:b?JSON.stringify(b):undefined});const o=await r.json().catch(()=>({}));return {s:r.status,_arr:Array.isArray(o)?o:null,...(Array.isArray(o)?{}:o)}};
 return {call,u};}
const ok=(c,m)=>{if(!c)failed++;console.log((c?'PASS ':'FAIL ')+m)};
const OFF=['documents','training','tni','trainers','issues','archives','selfinspections','sischedule','auditors','extaudits','risks','mgmtreviews','atreviews','comparators','packaging','labels','randomization'];

const mg=await login('director1'), qa=await login('qa.lead'), op=await login('operator1');
const me=await mg.call('GET','/api/me');
ok(me.allAccess&&[...me.modulesOff].sort().join()===[...OFF].sort().join(),'the 17 modules of Compliance, Clinical supply and Documents & training are off – management (all access) included');
const off=me.modulesOff;
ok(['documents','training','selfinspections','atreviews','risks'].every(k=>off.includes(k)),'Documents & training, Compliance modules are off');
ok(!off.some(k=>['investigations','capa','changes','extensions','vendors','customers'].includes(k)),'quality events and supply chain stay on');
for (const u of [mg,qa]) {
  ok((await u.call('POST','/api/records',{type:'documents',data:{title:'X'}})).s===403,`${u.u}: cannot create a document`);
  ok((await u.call('GET','/api/records?type=selfinspections'))._arr?.length===0||(await u.call('GET','/api/records?type=selfinspections')).s>=400,`${u.u}: no self-inspections listed`);
}
ok((await mg.call('POST','/api/records',{type:'comparators',data:{title:'X'}})).s===403,'clinical supply records cannot be created, even with all access');
ok((await op.call('POST','/api/records',{type:'investigations',data:{title:'Still on'}})).s!==403,'deviations can still be raised');
ok((await op.call('GET','/api/cforms'))._arr.length===133&&(await op.call('GET','/api/csops'))._arr.length===72,'controlled forms and SOPs stay available');
srv.kill();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
