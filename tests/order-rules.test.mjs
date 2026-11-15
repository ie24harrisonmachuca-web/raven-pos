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

test('Caja abierta es obligatoria para crear, editar y cancelar pedidos o cotizaciones',()=>fixture(async f=>{
 assert.equal((await f.state('waiter1')).data.cash_open,false);
 assert.equal((await f.post('waiter1','orders',{table_id:f.table,items:[f.line(2)]})).status,409);
 assert.equal((await f.post('admin','orders',{status:'quote',items:[f.line()]})).status,409);
 await f.open();let order=(await f.post('waiter1','orders',{table_id:f.table,items:[f.line(2)]})).data;
 const waiterState=(await f.state('waiter1')).data;assert.equal(waiterState.cash_open,true);assert.equal(waiterState.shift,null);
 await f.post('cashier','cash/close',{counted:0});
 assert.equal((await f.post('waiter1','orders/'+order.id,{...order,items:[f.line(3)]})).status,409);
 assert.equal((await f.post('admin','orders/'+order.id,{version:order.version,cancel:true,reason:'Caja cerrada'})).status,409);
 assert.equal((await f.stock()).stock,8);
 await f.open();assert.equal((await f.post('waiter1','orders/'+order.id,{version:order.version,cancel:true,reason:'Cancelado'})).status,200);assert.equal((await f.stock()).stock,10);
}));

test('El primer mozo conserva la propiedad; otro mozo no puede editar ni cancelar',()=>fixture(async f=>{
 await f.open();let order=(await f.post('waiter1','orders',{table_id:f.table,items:[f.line()]})).data;
 assert.equal(order.created_by,f.accounts.waiter1.user);assert.equal(order.owner_name,'Mozo Uno');assert.equal(order.can_edit,true);
 const second=(await f.state('waiter2')).data.orders.find(o=>o.id===order.id);assert.equal(second.can_edit,false);assert.equal(second.owner_name,'Mozo Uno');assert.equal(Object.hasOwn(second,'owner_email'),false);
 for(const body of [{...order,created_by:f.accounts.waiter2.user,items:[f.line(2)]},{version:order.version,cancel:true,reason:'No autorizado'}])assert.equal((await f.post('waiter2','orders/'+order.id,body)).status,403);
 order=(await f.post('cashier','orders/'+order.id,{...order,items:[f.line(2)]})).data;assert.equal(order.created_by,f.accounts.waiter1.user);
 order=(await f.post('admin','orders/'+order.id,{...order,items:[f.line(3)]})).data;assert.equal(order.created_by,f.accounts.waiter1.user);assert.equal(order.can_edit,true);
 order=(await f.post('waiter1','orders/'+order.id,{...order,items:[f.line(4)]})).data;assert.equal(order.items[0].quantity,4);assert.equal((await f.stock()).stock,6);
}));

test('Dos mozos que guardan la misma mesa simultáneamente tienen un único ganador',()=>fixture(async f=>{
 await f.open();const body={table_id:f.table,items:[f.line(2)]};
 const results=await Promise.all([f.post('waiter1','orders',body),f.post('waiter2','orders',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const orders=(await f.state('admin')).data.orders;assert.equal(orders.length,1);assert.equal((await f.stock()).stock,8);
 const winner=results[0].status===200?'waiter1':'waiter2';assert.equal(orders[0].created_by,f.accounts[winner].user);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM order_stock_reservations').get().n,1);
}));

test('Guardar aplica deltas compartidos de stock; reducir, quitar y cancelar repone exactamente una vez',()=>fixture(async f=>{
 await f.open();let order=(await f.post('waiter1','orders',{items:[f.line(2)]})).data;assert.equal((await f.stock()).stock,8);assert.equal((await f.state('waiter2')).data.products.find(p=>p.id===f.product).stock,8);
 let revision=(await f.stock()).version;order=(await f.post('waiter1','orders/'+order.id,order)).data;assert.equal((await f.stock()).stock,8);assert.equal((await f.stock()).version,revision);
 order=(await f.post('waiter1','orders/'+order.id,{...order,items:[f.line(4)]})).data;assert.equal((await f.stock()).stock,6);
 order=(await f.post('waiter1','orders/'+order.id,{...order,items:[f.line(1)]})).data;assert.equal((await f.stock()).stock,9);
 const untracked=(await f.post('admin','products',{name:'Servicio',category:'Otros',price:0,stock:0,track_stock:false})).data.id;
 order=(await f.post('waiter1','orders/'+order.id,{...order,items:[{product_id:untracked,quantity:1}]})).data;assert.equal((await f.stock()).stock,10);
 order=(await f.post('waiter1','orders/'+order.id,{...order,items:[f.line(3)]})).data;assert.equal((await f.stock()).stock,7);
 assert.equal((await f.post('waiter1','orders/'+order.id,{version:order.version,cancel:true,reason:'Cancelación'})).status,200);assert.equal((await f.stock()).stock,10);
 assert.equal((await f.post('waiter1','orders/'+order.id,{version:order.version,cancel:true,reason:'Repetición'})).status,409);assert.equal((await f.stock()).stock,10);
}));

test('Falta de stock revierte pedido, reservas y todas las revisiones',()=>fixture(async f=>{
 await f.open();const empty=(await f.post('admin','products',{name:'Agotado',category:'Platos',price:100,stock:0})).data.id;
 assert.equal((await f.post('waiter1','orders',{items:[f.line(2),{product_id:empty,quantity:1}]})).status,409);
 assert.equal((await f.stock()).stock,10);assert.equal((await f.stock()).version,1);assert.equal((await f.state('admin')).data.orders.length,0);
 let order=(await f.post('waiter1','orders',{items:[f.line(2)]})).data;const revision=(await f.stock()).version;
 assert.equal((await f.post('waiter1','orders/'+order.id,{...order,items:[f.line(3),{product_id:empty,quantity:1}]})).status,409);
 assert.equal((await f.stock()).stock,8);assert.equal((await f.stock()).version,revision);const saved=(await f.state('waiter1')).data.orders[0];assert.equal(saved.version,order.version);assert.equal(saved.items[0].quantity,2);
}));

test('Cobrar no descuenta dos veces y anular repone una sola vez',()=>fixture(async f=>{
 await f.open();const order=(await f.post('waiter1','orders',{table_id:f.table,items:[f.line(2)]})).data;const revision=(await f.stock()).version;
 const paid=await f.post('cashier','checkout/'+order.id,{version:order.version,payments:[{method:'tarjeta',amount:200}]});assert.equal(paid.status,200);assert.equal((await f.stock()).stock,8);assert.equal((await f.stock()).version,revision);
 assert.equal((await f.post('cashier','checkout/'+order.id,{version:order.version,payments:[{method:'tarjeta',amount:200}]})).status,409);
 assert.equal((await f.post('admin','void/'+paid.data.id,{reason:'Prueba'})).status,200);assert.equal((await f.stock()).stock,10);
 assert.equal((await f.post('admin','void/'+paid.data.id,{reason:'Repetida'})).status,409);assert.equal((await f.stock()).stock,10);
}));

test('Las cotizaciones no consumen stock y la conversión reconcilia las reservas',()=>fixture(async f=>{
 await f.open();let quote=(await f.post('waiter1','orders',{status:'quote',items:[f.line(2)]})).data;assert.equal((await f.stock()).stock,10);
 quote=(await f.post('waiter1','orders/'+quote.id,{...quote,status:'open',table_id:f.table})).data;assert.equal((await f.stock()).stock,8);
 quote=(await f.post('admin','orders/'+quote.id,{...quote,status:'quote',table_id:null})).data;assert.equal((await f.stock()).stock,10);
}));

function legacyOrder(f,status='open'){
 const id=uid(),time=now(),items=[{product_id:f.product,name:'Hamburguesa',price:100,quantity:2,track_stock:true,note:''}];
 f.db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,1,f.table,null,status,JSON.stringify(items),200,0,'',1,1,'draft',f.accounts.waiter1.user,time,time);
 return{id,items};
}
test('Los pedidos históricos abiertos reservan al siguiente guardado y no al iniciar la base',()=>fixture(async f=>{
 const legacy=legacyOrder(f);assert.equal((await f.stock()).stock,10);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM order_stock_reservations').get().n,0);
 await f.open();let order=(await f.state('waiter1')).data.orders[0];assert.equal((await f.post('waiter2','orders/'+order.id,order)).status,403);
 order=(await f.post('waiter1','orders/'+order.id,order)).data;assert.equal((await f.stock()).stock,8);
 const paid=await f.post('cashier','checkout/'+order.id,{version:order.version,payments:[{method:'tarjeta',amount:200}]});assert.equal(paid.status,200);assert.equal((await f.stock()).stock,8);
 assert.equal((await f.post('admin','void/'+paid.data.id,{reason:'Histórico'})).status,200);assert.equal((await f.stock()).stock,10);
}));
test('El cobro directo de un pedido histórico reserva el stock antes de cerrar',()=>fixture(async f=>{
 const legacy=legacyOrder(f);await f.open();const paid=await f.post('cashier','checkout/'+legacy.id,{version:1,payments:[{method:'tarjeta',amount:200}]});assert.equal(paid.status,200);assert.equal((await f.stock()).stock,8);
}));
test('La anulación de ventas históricas ya descontadas devuelve su stock una vez',()=>fixture(async f=>{
 const shift=await f.open(),legacy=legacyOrder(f,'paid'),sale=uid();f.db.prepare('UPDATE products SET stock=8 WHERE id=?').run(f.product);
 f.db.prepare('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(sale,1,legacy.id,shift,200,0,JSON.stringify([{method:'tarjeta',amount:200,received:200,change:0}]),'paid',f.accounts.cashier.user,now(),null);
 assert.equal((await f.post('admin','void/'+sale,{reason:'Anular histórico'})).status,200);assert.equal((await f.stock()).stock,10);assert.equal((await f.post('admin','void/'+sale,{reason:'Repetir'})).status,409);
}));
test('La reserva afecta solo al inventario de su empresa',()=>fixture(async f=>{
 await f.open();const otherProduct=(await f.api('other','t/restaurant-b/products','POST',{name:'Otro catálogo',category:'Platos',price:100,stock:20})).data.id;
 await f.post('waiter1','orders',{items:[f.line(2)]});const otherState=(await f.api('other','t/restaurant-b/state')).data;assert.equal(otherState.products.find(p=>p.id===otherProduct).stock,20);assert.equal(otherState.orders.length,0);assert.equal((await f.stock()).stock,8);
 assert.equal((await f.api('other','t/restaurant-b/orders','POST',{items:[f.line(1)]})).status,409);
}));


test('Corregir una venta mixta repone stock legado una sola vez y conserva la caja',()=>fixture(async f=>{
 await f.open();
 const other=(await f.post('admin','products',{name:'Gaseosa',category:'Bebidas',price:50,stock:10})).data.id;
 f.db.prepare('UPDATE products SET stock=3 WHERE id=?').run(f.product);
 const order=(await f.post('waiter1','orders',{table_id:f.table,items:[f.line(2),{product_id:other,quantity:1}],send_kitchen:true})).data;
 assert.equal(order.kitchen,'received');
 const sale=await f.post('cashier','checkout/'+order.id,{version:order.version,payments:[{method:'efectivo',amount:100},{method:'yape',amount:150}]});
 assert.equal(sale.status,200);
 assert.equal((await f.stock()).stock,1);
 f.db.prepare('DELETE FROM order_stock_reservations WHERE order_id=?').run(order.id);
 const path='correction/'+sale.data.id;
 const correction={version:order.version+1,reason:'Se registró un plato de más',quantities:[1,1],refunds:[50,50]};
 assert.equal((await f.post('waiter1',path,correction)).status,403);
 assert.equal((await f.post('cashier',path,{...correction,refunds:[0,50]})).status,400);
 assert.equal((await f.stock()).stock,1);
 const results=await Promise.all([f.post('cashier',path,correction),f.post('admin',path,correction)]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);
 assert.equal((await f.stock()).stock,2);
 const state=(await f.state('admin')).data;
 assert.equal(state.shift.expected,50);
 assert.equal(state.sales[0].total,150);
 assert.deepEqual(state.sales[0].payments.map(p=>p.amount),[50,100]);
 assert.equal(state.sales[0].items[0].quantity,1);
 assert.equal(state.audit.filter(entry=>entry.action==='sale.correct').length,1);
 assert.equal((await f.post('cashier','cash/close',{counted:50})).status,200);
 assert.equal((await f.post('cashier',path,{...correction,version:order.version+2})).status,409);
}));
