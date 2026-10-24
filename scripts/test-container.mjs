import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Public dummy credentials are used only in an isolated, disposable container.
const suffix = randomUUID().slice(0, 8);
const name = `cap-smoke-${suffix}`;
const volume = `cap-smoke-data-${suffix}`;
const image = process.env.CAP_DOCKER_IMAGE || 'cap-personal-assistant:local';

function docker(args, input = '') {
  return new Promise((resolve, reject) => {
    const command = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let errors = '';
    command.stdout.on('data', value => { output += value; });
    command.stderr.on('data', value => { errors += value; });
    command.on('error', reject);
    command.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors || output || 'Docker a échoué.')));
    command.stdin.end(input);
  });
}

const common = `
import assert from 'node:assert/strict';
const base='http://127.0.0.1:3001';
let ready=false;
for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,100));}
assert.ok(ready,'Le serveur doit démarrer.');
const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
`;
const first = common + `
assert.equal((await fetch(base+'/')).status,200);
assert.equal((await fetch(base+'/manifest.webmanifest')).status,200);
assert.equal((await fetch(base+'/api/workspace')).status,401);
const setup=await post('/api/auth/setup',{username:'container-owner',password:'Container-only-test-password-2026',setupCode:'Container-only-test-code-2026'});
assert.equal(setup.status,201);
const header=setup.headers.get('set-cookie');assert.match(header,/Secure/);assert.match(header,/HttpOnly/);
const cookie=header.split(';')[0];
const workspace={version:1,isDemo:false,habitDate:'2026-10-24',data:{profile:{firstName:'Container test',profession:'Patient Experience Specialist',country:''},finance:{monthlyIncome:2000,savings:100,expenses:[]},goals:[{id:'test-goal',title:'Objectif de test conteneur',category:'Carrière',done:false}],habits:[],checkins:[]},messages:[]};
const saved=await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({workspace,expectedRevision:0})});
assert.equal(saved.status,200);assert.equal((await saved.json()).revision,1);
assert.equal((await post('/api/chat',{messages:[{role:'user',content:'Mon budget'}]})).status,401);
const reply=await post('/api/chat',{messages:[{role:'user',content:'Mon budget'}]},cookie);
assert.equal(reply.status,200);assert.equal((await reply.json()).mode,'discovery');
console.log('Image : interface, compte, cookies Secure, sauvegarde et conversation protégée validés.');
`;
const second = common + `
const login=await post('/api/auth/login',{username:'container-owner',password:'Container-only-test-password-2026'});
assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
const state=await(await fetch(base+'/api/workspace',{headers:{Cookie:cookie}})).json();
assert.equal(state.revision,1);assert.equal(state.workspace.data.profile.firstName,'Container test');
const conflict=await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({workspace:state.workspace,expectedRevision:0})});
assert.equal(conflict.status,409);
assert.equal((await post('/api/auth/logout',{},cookie)).status,200);
assert.equal((await fetch(base+'/api/workspace',{headers:{Cookie:cookie}})).status,401);
console.log('Redémarrage : compte et espace persistants, conflit et déconnexion validés.');
`;

try {
  assert.ok(image.length > 0);
  await docker(['volume', 'create', volume]);
  await docker(['run', '-d', '--name', name, '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--mount', `type=volume,source=${volume},target=/data`, '-e', 'CAP_SETUP_CODE=Container-only-test-code-2026', image]);
  console.log(await docker(['exec', '-i', name, 'node', '--input-type=module'], first));
  await docker(['restart', name]);
  console.log(await docker(['exec', '-i', name, 'node', '--input-type=module'], second));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await docker(['rm', '-f', name]).catch(() => {});
  await docker(['volume', 'rm', volume]).catch(() => {});
  console.log('Conteneur et volume de test supprimés. Aucun port public ni appel fournisseur utilisé.');
}
