import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {cloudAdmin} from '../scripts/cloud-admin.mjs';
const origin=process.env.RAVEN_CLOUD_TEST_ORIGIN||'http://127.0.0.1:8787';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw Error('Estas pruebas solo utilizan el emulador local.');
const token=(await readFile(new URL('../.cloud/operator-token',import.meta.url),'utf8')).trim();
const suffix=Date.now().toString(36),slug='qa-'+suffix,other='qb-'+suffix,password='Temporary-Cloud-Rules-2026!';
const adminBody=(action,extra)=>cloudAdmin({action,...extra},{origin,token});
let admin,waiter,waiter2,foreign,product,table,order,sale;
async function api(path,{method='GET',body,session,headers={}}={}) {
  const r=await fetch(origin+'/api/'+path,{method,headers:{...(method==='POST'?{'Content-Type':'application/json',Origin:origin,'X-CSRF-Token':session?.csrf||''}:{}),...(session?{Cookie:session.cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')};
}
async function login(email){const r=await api('login',{method:'POST',body:{email,password}});assert.equal(r.status,200,JSON.stringify(r.data));assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);const session={cookie:r.cookie.split(';')[0]};const me=await api('me',{session});session.csrf=me.data.csrf;return session;}
const post=(path,body,session=admin)=>api('t/'+slug+'/'+path,{method:'POST',body,session});
const state=()=>api('t/'+slug+'/state',{session:admin});
before(async()=>{
  await adminBody('create',{slug,name:'Prueba Cloud A',email:'admin-'+suffix+'@example.test',owner_name:'Admin',password,active:true,expires_at:'2099-01-01T00:00:00Z'});
  await adminBody('create',{slug:other,name:'Prueba Cloud B',email:'other-'+suffix+'@example.test',owner_name:'Otro',password,active:true,expires_at:'2099-01-01T00:00:00Z'});
  admin=await login('admin-'+suffix+'@example.test');foreign=await login('other-'+suffix+'@example.test');
});
test('Cloud: salud, autenticación, origen y secreto de plataforma',async()=>{
  assert.equal((await api('health')).status,200);assert.equal((await api('me')).status,401);
  assert.equal((await api('platform',{method:'POST',body:{action:'list'}})).status,403);
  assert.equal((await api('login',{method:'POST',body:{email:'unknown@example.test',password},headers:{Origin:'https://elsewhere.test'}})).status,403);
  assert.equal((await api('login',{method:'POST',body:{email:'unknown@example.test',password}})).status,401);
});
test('Cloud: bases independientes, roles y CSRF',async()=>{
  assert.equal((await api('t/'+slug+'/state',{session:foreign})).status,404);
  assert.equal((await post('cash/open',{opening:0},{...admin,csrf:'invalid'})).status,403);
  for(const [tag,name]of [['waiter','Mozo 1'],['waiter2','Mozo 2']])assert.equal((await post('users',{email:tag+'-'+suffix+'@example.test',name,password,role:'mesero'})).status,200);
  waiter=await login('waiter-'+suffix+'@example.test');waiter2=await login('waiter2-'+suffix+'@example.test');
  assert.equal((await post('products',{name:'No permitido'},waiter)).status,403);
  assert.equal((await post('cash/open',{opening:0},waiter)).status,403);
});
test('Cloud: caja obligatoria y preparación del catálogo',async()=>{
  const p=await post('products',{name:'Hamburguesa',category:'Platos',price:2400,cost:1000,stock:20,active:true,track_stock:true,image:'burger'});assert.equal(p.status,200);product=p.data.id;
  const t=await post('tables',{name:'01',area:'Salón',capacity:4,active:true});assert.equal(t.status,200);table=t.data.id;
  assert.equal((await post('orders',{table_id:table,items:[{product_id:product,quantity:2}]},waiter)).status,409);
  assert.equal((await post('cash/open',{opening:10000})).status,200);
  const b=await api('t/'+other+'/state',{session:foreign});assert.equal(b.data.products.length,0);assert.equal(b.data.orders.length,0);
});
test('Cloud: primer mozo, stock compartido y transacción contra doble mesa',async()=>{
  const results=await Promise.all([post('orders',{table_id:table,items:[{product_id:product,quantity:2}]},waiter),post('orders',{table_id:table,items:[{product_id:product,quantity:2}]},waiter2)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);order=results.find(r=>r.status===200).data;
  const owner=results[0].status===200?waiter:waiter2,otherWaiter=owner===waiter?waiter2:waiter;
  assert.equal((await post('orders/'+order.id,{...order,items:[{product_id:product,quantity:3}]},otherWaiter)).status,403);
  assert.equal((await state()).data.products[0].stock,18);
  const update=await post('orders/'+order.id,{...order,items:[{product_id:product,quantity:3}]});assert.equal(update.status,200);order=update.data;
  assert.equal((await state()).data.products[0].stock,17);
});
test('Cloud: falta de stock y versión obsoleta no alteran datos',async()=>{
  assert.equal((await post('orders/'+order.id,{...order,version:order.version-1})).status,409);
  assert.equal((await post('orders',{items:[{product_id:product,quantity:100}]})).status,409);
  assert.equal((await state()).data.products[0].stock,17);
});
test('Cloud: cobro atómico no descuenta doble y anulación repone una vez',async()=>{
  const payment={version:order.version,payments:[{method:'efectivo',amount:7200,received:8000}],tip:0};
  const results=await Promise.all([post('checkout/'+order.id,payment),post('checkout/'+order.id,payment)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);sale=results.find(r=>r.status===200).data.id;
  const paid=(await state()).data;assert.equal(paid.products[0].stock,17);assert.equal(paid.orders.length,0);assert.equal(paid.sales[0].payments[0].change,800);
  const correction={version:order.version+1,reason:'Se duplicó un producto',quantities:[2],refunds:[2400]};
  assert.equal((await post('correction/'+sale,correction,waiter)).status,403);
  assert.equal((await post('correction/'+sale,correction)).status,200);
  assert.equal((await post('correction/'+sale,correction)).status,409);
  const corrected=(await state()).data;
  assert.equal(corrected.products[0].stock,18);
  assert.equal(corrected.sales[0].total,4800);
  assert.equal((await post('void/'+sale,{reason:'Prueba de anulación'})).status,200);assert.equal((await post('void/'+sale,{reason:'Repetida'})).status,409);assert.equal((await state()).data.products[0].stock,20);
});
test('Cloud: suspensión y vencimiento cortan sesiones existentes',async()=>{
  await adminBody('suspend',{slug});assert.equal((await state()).status,403);assert.equal((await post('cash/movement',{type:'in',amount:1,reason:'No permitido'})).status,403);
  await adminBody('activate',{slug,expires_at:'2099-01-01T00:00:00Z'});assert.equal((await state()).status,200);
});
test('Cloud: exportación conserva empresas separadas y no incluye sesiones',async()=>{
  const backup=await adminBody('export');assert.equal(backup.format,'raven-cloud-v1');assert.equal(backup.registry.sessions,undefined);
  const a=backup.tenants.find(t=>t.tenant.slug===slug),b=backup.tenants.find(t=>t.tenant.slug===other);assert.equal(a.data.products[0].stock,20);assert.equal(b.data.products.length,0);assert.ok(a.bookmark);
});
test('Cloud: restablecer contraseña revoca sesiones; salir también',async()=>{
  await adminBody('reset-password',{email:'admin-'+suffix+'@example.test',password:'Changed-temporary-password-2026!'});assert.equal((await state()).status,401);
  assert.equal((await api('logout',{method:'POST',body:{},session:foreign})).status,200);assert.equal((await api('me',{session:foreign})).status,401);
});
