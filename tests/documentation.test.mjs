import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {uid,now} from '../server/store.mjs';

async function fixture(work){
 const dir=mkdtempSync(join(tmpdir(),'raven-order-rules-'));
 const app=createApp({dataDir:dir,origin:'http://127.0.0.1:4181'}),store=app.store;
 const tenantId=store.createTenant('restaurant-a','A','2099-01-01T00:00:00Z');
 const otherId=store.createTenant('restaurant-b','B','2099-01-01T00:00:00Z');
 const accounts={};
 for(const [key,role,tid,name]of [['admin','admin',tenantId,'Administración'],['cashier','cajero',tenantId,'Caja'],['waiter1','mesero',tenantId,'Mozo Uno'],['waiter2','mesero',tenantId,'Mozo Dos'],['other','admin',otherId,'Otra empresa']]){
  const user=store.createUser(key+'@example.test',name,'Test-password-2026!');
  store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user,tid,role);accounts[key]={user};
 }
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+app.server.address().port;
 async function api(user,path,method='GET',body){
  const auth=accounts[user];const res=await fetch(url+'/api/'+path,{method,headers:{Origin:'http://127.0.0.1:4181',...(body?{'Content-Type':'application/json'}:{}),...(auth?.cookie?{Cookie:auth.cookie,'X-CSRF-Token':auth.csrf||''}:{})},body:body?JSON.stringify(body):undefined});
  return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
 }
 for(const key of Object.keys(accounts)){
  const login=await api(key,'login','POST',{email:key+'@example.test',password:'Test-password-2026!'});assert.equal(login.status,200);accounts[key].cookie=login.cookie.split(';')[0];accounts[key].csrf=(await api(key,'me')).data.csrf;
 }
 const post=(user,path,body)=>api(user,'t/restaurant-a/'+path,'POST',body);
 const state=user=>api(user,'t/restaurant-a/state');
 const product=(await post('admin','products',{name:'Hamburguesa',category:'Platos',price:100,stock:10})).data.id;
 const table=(await post('admin','tables',{name:'01',area:'Salón',capacity:4})).data.id;
 const open=async()=>{const result=await post('admin','cash/open',{opening:0});assert.equal(result.status,200);return result.data.id;};
 const line=(quantity=1)=>({product_id:product,quantity});
 const stock=async()=>((await state('admin')).data.products.find(p=>p.id===product));
 try{await work({app,store,accounts,tenantId,otherId,api,post,state,product,table,open,line,stock,db:store.tenant(tenantId)});}
 finally{await new Promise(resolve=>app.server.close(resolve));store.close();rmSync(dir,{recursive:true,force:true});}
}


test('CP01 RF01 Acceso válido de empresa activa',()=>fixture(async f=>{const r=await f.state('admin');assert.equal(r.status,200);assert.equal(r.data.role,'admin');}));
test('CP02 RF01 Acceso cruzado de otra empresa',()=>fixture(async f=>{assert.equal((await f.api('other','t/restaurant-a/state')).status,404);}));
test('CP03 RF02 Apertura y cierre de caja',()=>fixture(async f=>{await f.open();assert.equal((await f.state('admin')).data.cash_open,true);assert.equal((await f.post('cashier','cash/close',{counted:0})).status,200);assert.equal((await f.state('admin')).data.cash_open,false);}));
test('CP04 RF02 Pedido con caja cerrada',()=>fixture(async f=>{assert.equal((await f.post('waiter1','orders',{items:[f.line()]})).status,409);assert.equal((await f.stock()).stock,10);}));
test('CP05 RF03 Pedido del primer mesero',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{table_id:f.table,items:[f.line()]})).data;assert.equal(o.created_by,f.accounts.waiter1.user);assert.equal((await f.post('waiter1','orders/'+o.id,{...o,items:[f.line(2)]})).status,200);}));
test('CP06 RF03 Otro mesero intenta editar',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{table_id:f.table,items:[f.line()]})).data;assert.equal((await f.post('waiter2','orders/'+o.id,{...o,items:[f.line(2)]})).status,403);assert.equal((await f.stock()).stock,9);}));
test('CP07 RF04 Reserva compartida de inventario',()=>fixture(async f=>{await f.open();await f.post('waiter1','orders',{items:[f.line(2)]});assert.equal((await f.stock()).stock,8);assert.equal((await f.state('waiter2')).data.products.find(p=>p.id===f.product).stock,8);}));
test('CP08 RF04 Inventario insuficiente',()=>fixture(async f=>{await f.open();assert.equal((await f.post('waiter1','orders',{items:[f.line(11)]})).status,409);assert.equal((await f.stock()).stock,10);assert.equal((await f.state('admin')).data.orders.length,0);}));
test('CP09 RF05 Transición válida en cocina',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{items:[f.line()],send_kitchen:true})).data;assert.equal(o.kitchen,'received');assert.equal((await f.post('admin','kitchen/'+o.id,{version:o.version,status:'preparing'})).status,200);}));
test('CP10 RF05 Salto de estado en cocina',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{items:[f.line()],send_kitchen:true})).data;assert.equal((await f.post('admin','kitchen/'+o.id,{version:o.version,status:'ready'})).status,409);}));
test('CP11 RF06 Cobro exacto sin doble descuento',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{items:[f.line(2)]})).data;assert.equal((await f.post('cashier','checkout/'+o.id,{version:o.version,payments:[{method:'efectivo',amount:200}]})).status,200);assert.equal((await f.stock()).stock,8);assert.equal((await f.state('admin')).data.sales.length,1);}));
test('CP12 RF06 Pago menor al total',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{items:[f.line(2)]})).data;assert.equal((await f.post('cashier','checkout/'+o.id,{version:o.version,payments:[{method:'efectivo',amount:100}]})).status,400);assert.equal((await f.state('admin')).data.sales.length,0);}));
test('CP13 RF07 Corrección repone una unidad',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{items:[f.line(2)]})).data;const s=(await f.post('cashier','checkout/'+o.id,{version:o.version,payments:[{method:'efectivo',amount:200}]})).data;assert.equal((await f.post('cashier','correction/'+s.id,{version:o.version+1,reason:'Una unidad de más',quantities:[1],refunds:[100]})).status,200);assert.equal((await f.stock()).stock,9);assert.equal((await f.state('admin')).data.sales[0].total,100);}));
test('CP14 RF07 Corrección con caja original cerrada',()=>fixture(async f=>{await f.open();const o=(await f.post('waiter1','orders',{items:[f.line(2)]})).data;const s=(await f.post('cashier','checkout/'+o.id,{version:o.version,payments:[{method:'efectivo',amount:200}]})).data;await f.post('cashier','cash/close',{counted:200});await f.open();assert.equal((await f.post('cashier','correction/'+s.id,{version:o.version+1,reason:'Fuera de turno',quantities:[1],refunds:[100]})).status,409);assert.equal((await f.stock()).stock,8);}));
test('CP15 RF08 Compra aumenta existencias',()=>fixture(async f=>{assert.equal((await f.post('admin','purchases',{product_id:f.product,quantity:5,total:500,reference:'CP15'})).status,200);assert.equal((await f.stock()).stock,15);}));
test('CP16 RF08 Contacto con RUC inválido',()=>fixture(async f=>{assert.equal((await f.post('admin','contacts',{name:'Proveedor',type:'proveedor',document_type:'RUC',document:'12'})).status,400);assert.equal((await f.state('admin')).data.contacts.length,0);}));