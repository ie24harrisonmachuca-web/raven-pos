import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/index.mjs';

const publicOrigin='http://127.0.0.1:4173';
const password='Temporary-access-test-2026!';
const projectRoot=fileURLToPath(new URL('../',import.meta.url));

async function fixture(work){
 const dir=mkdtempSync(join(tmpdir(),'raven-access-integration-'));
 const app=createApp({dataDir:dir,origin:publicOrigin});
 const {store}=app;
 const tenant=store.createTenant('paid-business','Negocio autorizado','2099-01-01T00:00:00Z');
 const other=store.createTenant('other-business','Otra empresa','2099-01-01T00:00:00Z');
 const user=store.createUser('owner@example.test','Titular',password);
 store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user,tenant,'admin');
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+app.server.address().port;
 async function request(path,{method='GET',body,session,origin=publicOrigin}={}){
  const response=await fetch(url+'/api/'+path,{method,headers:{
   ...(body?{'Content-Type':'application/json'}:{}),
   ...(method==='GET'?{}:{Origin:origin}),
   ...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf||''}:{})
  },body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
 }
 async function login(secret=password,email='owner@example.test'){
  const response=await request('login',{method:'POST',body:{email,password:secret}});
  if(response.status!==200)return response;
  const session={cookie:response.cookie.split(';')[0]};
  session.csrf=(await request('me',{session})).data.csrf;
  return {...response,session};
 }
 function operator(input){
  const result=spawnSync(process.execPath,['scripts/tenant.mjs'],{cwd:projectRoot,env:{...process.env,DATA_DIR:dir},input:JSON.stringify(input),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }
 try{await work({app,store,tenant,other,user,request,login,operator});}
 finally{await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
}

test('El acceso web requiere cuenta válida y no crea cuentas públicas ni empresas',()=>fixture(async f=>{
 assert.equal((await f.login(password,'unknown@example.test')).status,401);
 assert.equal((await f.login('Wrong-password-2026!')).status,401);
 assert.equal((await f.request('t/paid-business/state')).status,401);
 for(const route of ['register','signup','demo','tenants']){
  const response=await f.request(route,{method:'POST',body:{email:'new@example.test',password}});
  assert.equal(response.status,401,route);
  assert.equal(response.cookie,null,route);
 }
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);
 assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM tenants').get().n,2);
}));

test('El origen de la web funciona detrás del proxy sin relajar cookie ni CSRF',()=>fixture(async f=>{
 const access=await f.login();assert.equal(access.status,200);
 assert.match(access.cookie,/Path=\//);assert.match(access.cookie,/HttpOnly/);assert.match(access.cookie,/SameSite=Strict/);
 assert.equal((await f.request('t/paid-business/cash/open',{method:'POST',body:{opening:0},session:access.session})).status,200);
 assert.equal((await f.request('t/paid-business/cash/movement',{method:'POST',body:{type:'in',amount:100,reason:'Prueba'},session:access.session,origin:'https://foreign.example.test'})).status,403);
 assert.equal((await f.request('t/paid-business/cash/movement',{method:'POST',body:{type:'in',amount:100,reason:'Prueba'},session:{...access.session,csrf:'wrong'}})).status,403);
}));

test('Suspender o vencer la empresa corta lecturas y escrituras de una sesión ya iniciada',()=>fixture(async f=>{
 const {session}=await f.login();
 const mutations=['cash/open','products','tables','contacts','purchases','orders','checkout/not-existing','users','settings','subscription'];
 for(const mode of ['suspended','expired']){
  if(mode==='suspended')f.operator({action:'suspend',slug:'paid-business'});
  else f.store.db.prepare("UPDATE tenants SET status='active',expires_at='2000-01-01T00:00:00Z' WHERE id=?").run(f.tenant);
  assert.equal((await f.request('t/paid-business/state',{session})).status,403,mode);
  assert.equal((await f.request('t/paid-business/receipt/not-existing',{session})).status,403,mode);
  for(const route of mutations)assert.equal((await f.request('t/paid-business/'+route,{method:'POST',body:{status:'active'},session})).status,403,mode+':'+route);
 }
 assert.equal(f.store.tenant(f.tenant).prepare('SELECT COUNT(*) AS n FROM products').get().n,0);
 f.operator({action:'activate',slug:'paid-business',expires_at:'2099-01-01T00:00:00Z'});
 assert.equal((await f.request('t/paid-business/state',{session})).status,200);
}));

test('Quitar la pertenencia revoca inmediatamente la empresa y mantiene inaccesible otra',()=>fixture(async f=>{
 const {session}=await f.login();
 assert.equal((await f.request('t/other-business/state',{session})).status,404);
 assert.equal((await f.request('t/other-business/settings',{method:'POST',body:{name:'Intrusión'},session})).status,404);
 f.store.db.prepare('DELETE FROM memberships WHERE user_id=? AND tenant_id=?').run(f.user,f.tenant);
 assert.equal((await f.request('me',{session})).data.tenants.length,0);
 assert.equal((await f.request('t/paid-business/state',{session})).status,404);
 assert.equal((await f.request('t/paid-business/orders',{method:'POST',body:{items:[]},session})).status,404);
}));

test('La recuperación manual revoca sesiones existentes y la contraseña anterior',()=>fixture(async f=>{
 const first=await f.login(),second=await f.login();
 const nextPassword='Replacement-test-password-2026!';
 f.operator({action:'reset-password',email:'owner@example.test',password:nextPassword});
 for(const access of [first,second])assert.equal((await f.request('t/paid-business/state',{session:access.session})).status,401);
 assert.equal((await f.login()).status,401);
 const replacement=await f.login(nextPassword);assert.equal(replacement.status,200);
 assert.equal((await f.request('t/paid-business/state',{session:replacement.session})).status,200);
}));
