import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/index.mjs';
import {uid,openStore} from '../server/store.mjs';
const password='Test-only-password-2026!';
let app,url,dir,a,b,waiter,product,table,tenantA,tenantB;
async function request(path,method='GET',data,session,extra={}){
 const res=await fetch(url+'/api/'+path,{method,headers:{...(method==='GET'?{}:{'Content-Type':'application/json',Origin:'http://127.0.0.1:4181','X-CSRF-Token':session?.csrf||''}),...(session?{Cookie:session.cookie}:{}),...extra},body:data?JSON.stringify(data):undefined});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')};
}
async function login(email){const r=await request('login','POST',{email,password});assert.equal(r.status,200);const session={cookie:r.cookie.split(';')[0]};const m=await request('me','GET',null,session);session.csrf=m.data.csrf;return session;}
const post=(path,data,user=a)=>request('t/a/'+path,'POST',data,user);
const state=()=>request('t/a/state','GET',null,a);
before(async()=>{
 dir=mkdtempSync(join(tmpdir(),'raven-pos-test-'));app=createApp({dataDir:dir,origin:'http://127.0.0.1:4181'});const s=app.store;
 tenantA=s.createTenant('a','Restaurante A','2099-01-01T00:00:00Z');tenantB=s.createTenant('b','Restaurante B','2099-01-01T00:00:00Z');
 for(const[email,tid,role]of [['a@example.test',tenantA,'admin'],['b@example.test',tenantB,'admin'],['waiter@example.test',tenantA,'mesero']]){const u=s.createUser(email,email,password);s.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(u,tid,role);}
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+app.server.address().port;a=await login('a@example.test');b=await login('b@example.test');waiter=await login('waiter@example.test');
});
after(async()=>{await new Promise(r=>app.server.close(r));app.store.close();rmSync(dir,{recursive:true,force:true});});
test('Sesión obligatoria, cookie HttpOnly y CSRF',async()=>{
 assert.equal((await request('t/a/state')).status,401);
 assert.equal((await post('tables',{name:'01',area:'Salón',capacity:4}, {...a,csrf:'wrong'})).status,403);
 assert.equal((await request('t/a/tables','POST',{},a,{Origin:'https://evil.test'})).status,403);
 const r=await request('login','POST',{email:'a@example.test',password});assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);
});
test('Aislamiento físico y denegación cruzada de empresas',async()=>{
 assert.equal(readdirSync(join(dir,'tenants')).filter(x=>x.endsWith('.sqlite')).length,2);
 assert.equal((await request('t/b/state','GET',null,a)).status,404);
 assert.equal((await request('t/a/state','GET',null,b)).status,404);
 product=(await post('products',{name:'Producto A',category:'Carta',price:1250,cost:400,stock:10})).data.id;
 table=(await post('tables',{name:'01',area:'Salón',capacity:4})).data.id;
 assert.ok(product&&table);
 assert.equal((await request('t/b/state','GET',null,b)).data.products.length,0);
 assert.equal((await request('t/b/products/'+product,'POST',{name:'Intrusión'},b)).status,404);
});
test('Roles aplicados por servidor',async()=>{
 assert.equal((await post('products',{name:'Prohibido'},waiter)).status,403);
 assert.equal((await post('cash/open',{opening:0},waiter)).status,403);
 const r=await request('t/a/state','GET',null,waiter);assert.equal(r.data.users.length,0);assert.equal(r.data.sales.length,0);assert.equal(r.data.products[0].cost,undefined);
});
let order;
test('Precios del servidor, descuento y control de concurrencia',async()=>{
 const r=await post('orders',{table_id:table,items:[{product_id:product,quantity:2,price:1}],discount:100,guests:2});assert.equal(r.status,200);order=r.data;assert.equal(order.total,2400);
 assert.equal((await post('orders',{table_id:table,items:[{product_id:product,quantity:1}]})).status,409);
 assert.equal((await post('orders/'+order.id,{...order,version:0})).status,400);
 const update=await post('orders/'+order.id,{...order,send_kitchen:true});assert.equal(update.status,200);
 assert.equal((await post('orders/'+order.id,order)).status,409);order=update.data;
 assert.equal((await post('tables/'+table,{name:'01',area:'Salón',capacity:4,active:false})).status,409);
});
test('Cobro exige caja y pagos exactos',async()=>{
 assert.equal((await post('checkout/'+order.id,{version:order.version,payments:[{method:'efectivo',amount:2400}]})).status,409);
 assert.equal((await post('cash/open',{opening:10000})).status,200);
 assert.equal((await post('cash/open',{opening:0})).status,409);
 assert.equal((await post('checkout/'+order.id,{version:order.version,payments:[{method:'efectivo',amount:1}]})).status,400);
 assert.equal((await state()).data.products[0].stock,10);
});
let sale;
test('Cobro atómico, pagos divididos, vuelto y repetición',async()=>{
 const data={version:order.version,tip:100,payments:[{method:'efectivo',amount:1500,received:2000},{method:'yape',amount:1000}]};
 const result=await Promise.all([post('checkout/'+order.id,data),post('checkout/'+order.id,data)]);assert.deepEqual(result.map(x=>x.status).sort(),[200,409]);sale=result.find(x=>x.status===200).data.id;
 const s=(await state()).data;assert.equal(s.products[0].stock,8);assert.equal(s.shift.expected,11500);assert.equal(s.sales.length,1);assert.equal(s.orders.length,0);assert.equal(s.sales[0].payments[0].change,500);
});
test('Anulación repone existencias una sola vez y conserva historial',async()=>{
 assert.equal((await post('void/'+sale,{reason:'Prueba de anulación'})).status,200);assert.equal((await post('void/'+sale,{reason:'Repetida'})).status,409);
 const s=(await state()).data;assert.equal(s.products[0].stock,10);assert.equal(s.shift.expected,10000);assert.equal(s.sales[0].status,'void');
});
test('Stock insuficiente revierte toda la operación',async()=>{
 const o=(await post('orders',{items:[{product_id:product,quantity:11}]})).data;
 assert.equal((await post('checkout/'+o.id,{version:o.version,payments:[{method:'tarjeta',amount:o.total}]})).status,409);const s=(await state()).data;assert.equal(s.products[0].stock,10);assert.equal(s.sales.length,1);assert.equal(s.orders[0].status,'open');
});
test('Compras, contactos y validación documental',async()=>{
 assert.equal((await post('contacts',{name:'Proveedor',document_type:'RUC',document:'12'})).status,400);
 const c=await post('contacts',{name:'Proveedor',type:'proveedor',document_type:'RUC',document:'20123456789'});assert.equal(c.status,200);
 const p=await post('purchases',{supplier_id:c.data.id,product_id:product,quantity:5,total:2000,reference:'TEST'});assert.equal(p.status,200);assert.equal((await state()).data.products[0].stock,15);
 assert.equal((await request('t/b/purchases','POST',{supplier_id:c.data.id,product_id:product,quantity:1,total:1},b)).status,404);
});
test('Cocina requiere versión y transiciones válidas',async()=>{
 const o=(await post('orders',{items:[{product_id:product,quantity:1}],send_kitchen:true})).data;
 assert.equal((await post('kitchen/'+o.id,{version:o.version,status:'ready'})).status,409);
 assert.equal((await post('kitchen/'+o.id,{version:o.version,status:'preparing'})).status,200);
 assert.equal((await post('kitchen/'+o.id,{version:o.version,status:'ready'})).status,409);
});
test('Cierre de caja calcula diferencia y registra movimientos',async()=>{
 assert.equal((await post('cash/movement',{type:'out',amount:500,reason:'Gasto'})).status,200);
 assert.equal((await post('cash/movement',{type:'out',amount:50000,reason:'Exceso'})).status,409);
 assert.equal((await post('cash/close',{counted:9400})).status,200);const s=(await state()).data;assert.equal(s.shift,null);assert.equal(s.shifts[0].expected,9500);assert.equal(s.shifts[0].difference,-100);
});
test('Marca propia y rechazo de archivos activos',async()=>{
 assert.equal((await post('settings',{name:'A renovado',logo:'data:image/svg+xml;base64,PHN2Zz4='})).status,400);
 assert.equal((await post('settings',{name:'A renovado'})).status,200);assert.equal((await state()).data.tenant.name,'A renovado');assert.equal((await request('t/b/state','GET',null,b)).data.tenant.name,'Restaurante B');
});
test('Suscripción no puede activarse desde la API del cliente',async()=>{
 assert.equal((await post('subscription',{status:'active'})).status,404);
 app.store.db.prepare("UPDATE tenants SET status='suspended' WHERE id=?").run(tenantA);assert.equal((await state()).status,403);
 app.store.db.prepare("UPDATE tenants SET status='active',expires_at='2000-01-01T00:00:00Z' WHERE id=?").run(tenantA);assert.equal((await state()).status,403);
 app.store.db.prepare("UPDATE tenants SET expires_at='2099-01-01T00:00:00Z' WHERE id=?").run(tenantA);
});
test('Persistencia en disco y rutas privadas no expuestas',async()=>{
 const copy=openStore(dir);assert.equal(copy.tenant(tenantA).prepare('SELECT stock FROM products WHERE id=?').get(product).stock,15);copy.close();
 const res=await fetch(url+'/.data/registry.sqlite');assert.equal(res.status,404);
});
test('Las ediciones obsoletas de producto no deshacen compras ni cobros',async()=>{
 const original={name:'Producto con revisión',category:'Pruebas',price:100,cost:0,stock:3,track_stock:true,active:true};
 const created=await post('products',original);const pid=created.data.id;assert.equal(created.data.version,1);
 let o=(await post('orders',{items:[{product_id:pid,quantity:1}]})).data;
 assert.equal((await post('purchases',{product_id:pid,quantity:2,total:100})).status,200);
 assert.equal((await post('products/'+pid,{...original,version:1})).status,409);
 let current=(await state()).data.products.find(p=>p.id===pid);assert.equal(current.stock,5);assert.equal(current.version,2);
 assert.equal((await post('products/'+pid,{...current,name:'Nombre nuevo',price:900,track_stock:false})).status,200);
 o=(await post('orders/'+o.id,o)).data;
 assert.equal(o.items[0].price,100);assert.equal(o.items[0].name,original.name);assert.equal(o.items[0].track_stock,true);
 assert.equal((await post('cash/open',{opening:0})).status,200);
 const paid=await post('checkout/'+o.id,{version:o.version,payments:[{method:'tarjeta',amount:100}]});assert.equal(paid.status,200);
 current=(await state()).data.products.find(p=>p.id===pid);assert.equal(current.stock,4);assert.equal(current.version,4);
 assert.equal((await post('products/'+pid,{...current,version:3,stock:5})).status,409);
 assert.equal((await post('void/'+paid.data.id,{reason:'Prueba de reposición'})).status,200);
 current=(await state()).data.products.find(p=>p.id===pid);assert.equal(current.stock,5);assert.equal(current.version,5);
});
test('Un fallo de stock revierte todos los descuentos y revisiones anteriores',async()=>{
 const first=(await post('products',{name:'A stock suficiente',category:'Pruebas',price:100,stock:5})).data.id;
 const second=(await post('products',{name:'B sin stock',category:'Pruebas',price:100,stock:0})).data.id;
 const o=(await post('orders',{items:[{product_id:first,quantity:1},{product_id:second,quantity:1}]})).data;
 assert.equal((await post('checkout/'+o.id,{version:o.version,payments:[{method:'tarjeta',amount:200}]})).status,409);
 const p=(await state()).data.products.find(p=>p.id===first);assert.equal(p.stock,5);assert.equal(p.version,1);
});
test('Un pedido con descuento del 100% puede cerrarse sin inventar un cobro',async()=>{
 const o=(await post('orders',{items:[{product_id:product,quantity:1}],discount:1250})).data;assert.equal(o.total,0);
 assert.equal((await post('checkout/'+o.id,{version:o.version,payments:[{method:'efectivo',amount:0,received:100}]})).status,400);
 assert.equal((await post('checkout/'+o.id,{version:o.version,payments:[{method:'efectivo',amount:0,received:0}]})).status,200);
});
test('La anulación no permite devolver efectivo que ya salió de caja',async()=>{
 const o=(await post('orders',{items:[{product_id:product,quantity:1}]})).data;
 const paid=await post('checkout/'+o.id,{version:o.version,payments:[{method:'efectivo',amount:1250}]});assert.equal(paid.status,200);
 assert.equal((await post('cash/movement',{type:'out',amount:1250,reason:'Salida para prueba'})).status,200);
 assert.equal((await post('void/'+paid.data.id,{reason:'Sin efectivo disponible'})).status,409);
 assert.equal((await state()).data.sales.find(s=>s.id===paid.data.id).status,'paid');
 assert.equal((await post('cash/movement',{type:'in',amount:1250,reason:'Reposición para devolución'})).status,200);
 assert.equal((await post('void/'+paid.data.id,{reason:'Devolución con efectivo disponible'})).status,200);
});
test('Solo caja y administración pueden leer tickets cobrados',async()=>{
 assert.equal((await request('t/a/receipt/'+order.id,'GET',null,waiter)).status,403);
 assert.equal((await request('t/a/receipt/'+order.id,'GET',null,a)).status,200);
 const open=(await state()).data.orders.find(o=>o.status==='open');assert.ok(open);
 assert.equal((await request('t/a/receipt/'+open.id,'GET',null,waiter)).status,200);
});
test('Validación de entradas malformadas devuelve errores de cliente',async()=>{
 assert.equal((await post('orders',{items:[null]})).status,400);
 assert.equal((await post('orders',{items:[{product_id:{malformed:true},quantity:1}]})).status,404);
 const o=(await post('orders',{items:[{product_id:product,quantity:1}]})).data;
 assert.equal((await post('checkout/'+o.id,{version:o.version,payments:[null]})).status,400);
 assert.equal((await post('checkout/'+o.id,{version:o.version,tip:Number.MAX_SAFE_INTEGER,payments:[{method:'tarjeta',amount:1250}]})).status,400);
});
test('Contraseñas con espacios y fechas inválidas no eluden autenticación',async()=>{
 const spaced='  Password with spaces  ';app.store.createUser('spaces@example.test','Espacios',spaced);
 assert.equal((await request('login','POST',{email:'spaces@example.test',password:spaced})).status,200);
 assert.equal((await request('login','POST',{email:'spaces@example.test',password:spaced.trim()})).status,401);
 assert.throws(()=>app.store.createTenant('invalid','Inválida','not-a-date'),/fecha/);
 app.store.db.prepare("UPDATE tenants SET expires_at='not-a-date' WHERE id=?").run(tenantA);assert.equal((await state()).status,403);
 app.store.db.prepare("UPDATE tenants SET expires_at='2099-01-01T00:00:00Z' WHERE id=?").run(tenantA);
 const names=(await request('me','GET',null,a)).data.tenants;assert.equal(names.find(t=>t.id===tenantA).name,'A renovado');
});
test('Sesión invalidada al salir',async()=>{assert.equal((await request('logout','POST',{},a)).status,200);assert.equal((await state()).status,401);});
