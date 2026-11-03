import {uid,now,fail,text,integer,transaction,audit,permissions} from './store.mjs';
const one=(db,sql,...p)=>db.prepare(sql).get(...p);
const all=(db,sql,...p)=>db.prepare(sql).all(...p);
const run=(db,sql,...p)=>db.prepare(sql).run(...p);
function requireRole(ctx,permission){if(!permissions[ctx.role]?.includes(permission))fail(403,'Tu rol no permite esta operación.');}
function record(db,table,id){if(!['products','tables','contacts','orders','sales'].includes(table))throw Error('table');if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))fail(404,'Registro no encontrado en esta empresa.');const row=one(db,`SELECT * FROM ${table} WHERE id=?`,id);if(!row)fail(404,'Registro no encontrado en esta empresa.');return row;}
function openShift(db){const row=one(db,"SELECT * FROM shifts WHERE status='open'");if(!row)fail(409,'Abre la caja antes de realizar esta operación.');return row;}
function expected(db,s){return s.opening+one(db,'SELECT COALESCE(SUM(amount),0) n FROM movements WHERE shift_id=?',s.id).n;}
function parseOrder(row){return {...row,items:JSON.parse(row.items)};}
function nextNumber(db,table){return one(db,`SELECT COALESCE(MAX(number),0)+1 n FROM ${table}`).n;}
function productVersion(db,id){return one(db,'SELECT version FROM product_revisions WHERE product_id=?',id)?.version??1;}
function bumpProduct(db,id){run(db,'INSERT INTO product_revisions(product_id,version) VALUES(?,2) ON CONFLICT(product_id) DO UPDATE SET version=version+1',id);}
function flag(value,defaultValue=1){if(value===undefined)return defaultValue;if(value===true||value===1)return 1;if(value===false||value===0)return 0;fail(400,'Estado de activación no válido.');}
export function operate(ctx,method,path,b={}){
 const {db,user,store,tenant,role}=ctx;
 const get=method==='GET';const action=path.split('/')[0];const id=path.split('/')[1];
 if(get&&path==='state'){
 const can=p=>permissions[role].includes(p);
 const shift=can('cash')?one(db,"SELECT * FROM shifts WHERE status='open'"):null;
 return {tenant:{...tenant,...one(db,'SELECT * FROM settings WHERE id=1'),id:tenant.id},role,permissions:permissions[role],products:all(db,'SELECT p.*,COALESCE(r.version,1) version FROM products p LEFT JOIN product_revisions r ON r.product_id=p.id ORDER BY p.name').map(p=>can('products')?p:{...p,cost:undefined}),tables:all(db,'SELECT * FROM tables ORDER BY area,name'),contacts:role==='cocina'?[]:all(db,'SELECT * FROM contacts ORDER BY name'),orders:can('orders')||can('kitchen')?all(db,role==='cocina'?"SELECT * FROM orders WHERE status='open' AND kitchen!='draft' ORDER BY number":"SELECT * FROM orders WHERE status IN ('open','quote') ORDER BY number").map(parseOrder):[],sales:can('reports')?all(db,'SELECT s.*,o.items,o.discount,o.customer_id,o.table_id FROM sales s JOIN orders o ON o.id=s.order_id ORDER BY s.created_at DESC LIMIT 500').map(s=>({...s,items:JSON.parse(s.items),payments:JSON.parse(s.payments)})):[],purchases:can('purchases')?all(db,'SELECT * FROM purchases ORDER BY created_at DESC LIMIT 200'):[],shift:shift?{...shift,expected:expected(db,shift)}:null,shifts:can('cash')?all(db,'SELECT * FROM shifts ORDER BY opened_at DESC LIMIT 50'):[],movements:can('cash')?all(db,'SELECT * FROM movements ORDER BY created_at DESC LIMIT 200'):[],audit:role==='admin'?all(db,'SELECT * FROM audit ORDER BY created_at DESC LIMIT 100'):[],users:can('users')?all(store.db,'SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE tenant_id=?',tenant.id):[]};
 }
 if(get&&action==='receipt'){
 requireRole(ctx,'orders');const order=parseOrder(record(db,'orders',id));if(!['open','quote'].includes(order.status)&&!permissions[role].includes('reports'))fail(403,'Tu rol solo permite consultar precuentas de pedidos abiertos.');const sale=one(db,'SELECT * FROM sales WHERE order_id=?',id);return {settings:one(db,'SELECT * FROM settings WHERE id=1'),order,sale:sale?{...sale,payments:JSON.parse(sale.payments)}:null,customer:order.customer_id?record(db,'contacts',order.customer_id):null};
 }
 if(method!=='POST')fail(404,'Operación no encontrada.');
 const permission={products:'products',tables:'tables',contacts:'contacts',orders:'orders',checkout:'checkout',void:'void',cash:'cash',purchases:'purchases',settings:'settings',users:'users',kitchen:'kitchen'}[action];
 if(!permission)fail(404,'Operación no encontrada.');requireRole(ctx,permission);
 if(action==='users'){
   const targetRole=text(b.role);if(!Object.hasOwn(permissions,targetRole))fail(400,'Rol no válido.');
   // Existing accounts must be linked by platform administration, never silently claimed.
   if(one(store.db,'SELECT id FROM users WHERE email=?',String(b.email).toLowerCase().trim()))fail(409,'Ese correo ya tiene cuenta. La vinculación debe gestionarla el administrador de Raven.');
   const created=transaction(store.db,()=>{const newId=store.createUser(b.email,b.name,b.password);run(store.db,'INSERT INTO memberships VALUES(?,?,?)',newId,tenant.id,targetRole);return newId;});audit(db,user,'user.create',created,targetRole);return {id:created};
 }
 return transaction(db,()=>{
  if(action==='products'){
   const pid=id||uid();if(id){record(db,'products',id);if(integer(b.version,1)!==productVersion(db,id))fail(409,'El producto o su stock cambió. Actualiza la vista antes de guardar.');}
   const stock=integer(b.stock);const price=integer(b.price);const cost=integer(b.cost??0);const active=flag(b.active);const track=flag(b.track_stock);
   const image=['burger','coffee','salad','pizza',''].includes(b.image)?b.image:'';
   run(db,'INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,price=excluded.price,cost=excluded.cost,stock=excluded.stock,track_stock=excluded.track_stock,active=excluded.active,image=excluded.image',pid,text(b.name),text(b.category,60),price,cost,stock,track,active,image);
   if(id)bumpProduct(db,id);audit(db,user,id?'product.update':'product.create',pid,JSON.stringify({stock,price,active}));return {id:pid,version:productVersion(db,pid)};
  }
  if(action==='tables'){
   const tid=id||uid();if(id)record(db,'tables',id);const active=flag(b.active);if(!active&&one(db,"SELECT id FROM orders WHERE table_id=? AND status='open'",tid))fail(409,'La mesa tiene un pedido abierto.');
   run(db,'INSERT INTO tables VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,area=excluded.area,capacity=excluded.capacity,active=excluded.active',tid,text(b.name,40),text(b.area,60),integer(b.capacity,1,100),active);audit(db,user,'table.save',tid);return{id:tid};
  }
  if(action==='contacts'){
   const cid=id||uid();if(id)record(db,'contacts',id);const type=['cliente','proveedor','ambos'].includes(b.type)?b.type:'cliente';const docType=['DNI','RUC','CE','SIN DOCUMENTO'].includes(b.document_type)?b.document_type:'SIN DOCUMENTO';const doc=text(b.document??'',20,false);if((docType==='DNI'&&!/^\d{8}$/.test(doc))||(docType==='RUC'&&!/^\d{11}$/.test(doc)))fail(400,'Revisa la cantidad de dígitos del documento.');
   run(db,'INSERT INTO contacts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,document_type=excluded.document_type,document=excluded.document,address=excluded.address,email=excluded.email,phone=excluded.phone',cid,text(b.name),type,docType,doc,text(b.address??'',250,false),text(b.email??'',180,false),text(b.phone??'',30,false));audit(db,user,'contact.save',cid);return{id:cid};
  }
  if(action==='orders'){
   const old=id?record(db,'orders',id):null;if(old&&!['open','quote'].includes(old.status))fail(409,'Este pedido ya está cerrado.');if(old&&integer(b.version,1)!==old.version)fail(409,'Otro usuario modificó el pedido. Recarga antes de guardar.');
   if(b.cancel===true){if(!old)fail(400,'Pedido requerido.');const reason=text(b.reason,500);run(db,"UPDATE orders SET status='cancelled',version=version+1,updated_at=? WHERE id=?",now(),id);audit(db,user,'order.cancel',id,reason);return{id};}
   const status=b.status==='quote'?'quote':'open';let tableId=b.table_id||null;
   if(tableId){if(!record(db,'tables',tableId).active)fail(409,'La mesa está desactivada.');if(status==='quote')fail(400,'Una cotización no ocupa mesa.');if(one(db,"SELECT id FROM orders WHERE table_id=? AND status='open' AND id!=?",tableId,id||''))fail(409,'La mesa ya tiene un pedido abierto.');}
   if(b.customer_id&&record(db,'contacts',b.customer_id).type==='proveedor')fail(400,'Selecciona un contacto de tipo cliente.');
   if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail(400,'Agrega entre 1 y 100 productos.');
   const seen=new Set();const previous=old?JSON.parse(old.items):[];
   const items=b.items.map(line=>{if(!line||typeof line!=='object'||Array.isArray(line))fail(400,'Línea de pedido no válida.');if(seen.has(line.product_id))fail(400,'No repitas un producto: modifica su cantidad.');seen.add(line.product_id);const p=record(db,'products',line.product_id);if(!p.active)fail(409,'Uno de los productos está desactivado.');const prior=previous.find(i=>i.product_id===p.id);const price=prior?.price??p.price;return{product_id:p.id,name:prior?.name??p.name,price,quantity:integer(line.quantity,1,999),track_stock:prior?.track_stock??!!p.track_stock,note:text(line.note??'',250,false)};});
   const subtotal=items.reduce((s,i)=>s+i.price*i.quantity,0);integer(subtotal,0,100000000);const discount=integer(b.discount??0,0,subtotal);if(!permissions[role].includes('checkout')&&discount!==(old?.discount??0))fail(403,'Solo caja o administración puede aplicar descuentos.');
   const oid=id||uid(),time=now();const notes=text(b.notes??'',1000,false);const guests=integer(b.guests??1,1,100);const kitchen=status==='quote'?'draft':b.send_kitchen?'received':old?.kitchen||'draft';
   if(old)run(db,'UPDATE orders SET table_id=?,customer_id=?,status=?,items=?,total=?,discount=?,notes=?,guests=?,version=version+1,kitchen=?,updated_at=? WHERE id=?',tableId,b.customer_id||null,status,JSON.stringify(items),subtotal-discount,discount,notes,guests,kitchen,time,oid);
   else run(db,'INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',oid,nextNumber(db,'orders'),tableId,b.customer_id||null,status,JSON.stringify(items),subtotal-discount,discount,notes,guests,1,kitchen,user,time,time);
   audit(db,user,'order.save',oid);return parseOrder(record(db,'orders',oid));
  }
  if(action==='kitchen'){
   const o=record(db,'orders',id);if(o.status!=='open'||o.kitchen==='draft')fail(409,'Pedido no disponible en cocina.');if(integer(b.version,1)!==o.version)fail(409,'El pedido cambió. Actualiza la vista.');const transitions={received:'preparing',preparing:'ready',ready:'served'};if(transitions[o.kitchen]!==b.status)fail(409,'Transición de cocina no válida.');run(db,'UPDATE orders SET kitchen=?,version=version+1,updated_at=? WHERE id=?',b.status,now(),id);audit(db,user,'kitchen.'+b.status,id);return{id};
  }
  if(action==='checkout'){
   const o=record(db,'orders',id);if(o.status!=='open')fail(409,'El pedido ya fue cobrado o no está abierto.');if(integer(b.version,1)!==o.version)fail(409,'El pedido cambió. Actualiza antes de cobrar.');const shift=openShift(db);
   const tip=integer(b.tip??0,0,10000000);const due=o.total+tip;if(!Array.isArray(b.payments)||!b.payments.length||b.payments.length>10)fail(400,'Registra al menos un pago.');
   const payments=b.payments.map(p=>{if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'Pago no válido.');if(!['efectivo','tarjeta','yape','plin','transferencia'].includes(p.method))fail(400,'Medio de pago no válido.');const amount=integer(p.amount,due===0?0:1);const received=integer(p.received??amount,amount);if(p.method!=='efectivo'&&received!==amount)fail(400,'El vuelto solo corresponde a efectivo.');if(due===0&&(received!==0||b.payments.length!==1))fail(400,'Para un pedido gratuito registra un único pago de importe cero.');return{method:p.method,amount,received,change:received-amount};});
   if(payments.reduce((s,p)=>s+p.amount,0)!==due)fail(400,'La suma de los pagos debe coincidir con el total más la propina.');
   for(const line of JSON.parse(o.items)){if(line.track_stock){const p=record(db,'products',line.product_id);if(p.stock<line.quantity)fail(409,'Stock insuficiente: '+p.name);run(db,'UPDATE products SET stock=stock-? WHERE id=?',line.quantity,p.id);bumpProduct(db,p.id);}}
   const sid=uid(),time=now();run(db,'INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?)',sid,nextNumber(db,'sales'),id,shift.id,o.total,tip,JSON.stringify(payments),'paid',user,time,null);
   run(db,"UPDATE orders SET status='paid',version=version+1,updated_at=? WHERE id=?",time,id);
   const cash=payments.filter(p=>p.method==='efectivo').reduce((s,p)=>s+p.amount,0);if(cash)run(db,'INSERT INTO movements VALUES(?,?,?,?,?,?,?)',uid(),shift.id,cash,'Venta interna '+o.number,'sale:'+sid,user,time);
   audit(db,user,'sale.create',sid);return{id:sid,order_id:id};
  }
  if(action==='void'){
   const sale=record(db,'sales',id);if(sale.status!=='paid')fail(409,'La venta ya está anulada.');const reason=text(b.reason,500);const shift=openShift(db);if(shift.id!==sale.shift_id)fail(409,'La venta pertenece a una caja cerrada. Requiere un proceso de devolución posterior.');const order=record(db,'orders',sale.order_id);
   const cash=JSON.parse(sale.payments).filter(p=>p.method==='efectivo').reduce((s,p)=>s+p.amount,0);if(expected(db,shift)<cash)fail(409,'El saldo de caja no alcanza para devolver el efectivo. Registra primero el ingreso correspondiente.');
   for(const line of JSON.parse(order.items))if(line.track_stock){run(db,'UPDATE products SET stock=stock+? WHERE id=?',line.quantity,line.product_id);bumpProduct(db,line.product_id);}
   if(cash)run(db,'INSERT INTO movements VALUES(?,?,?,?,?,?,?)',uid(),shift.id,-cash,'Anulación: '+reason,'void:'+id,user,now());
   run(db,"UPDATE sales SET status='void',void_reason=? WHERE id=?",reason,id);run(db,"UPDATE orders SET status='void',version=version+1,updated_at=? WHERE id=?",now(),sale.order_id);audit(db,user,'sale.void',id,reason);return{id};
  }
  if(action==='cash'){
   if(id==='open'){if(one(db,"SELECT id FROM shifts WHERE status='open'"))fail(409,'Ya existe una caja abierta.');const sid=uid();run(db,'INSERT INTO shifts VALUES(?,?,?,?,?,?,?,?,?)',sid,'open',integer(b.opening),null,null,null,user,now(),null);return {id:sid};}
   const shift=openShift(db);
   if(id==='movement'){const amount=integer(b.amount,1);if(!['in','out'].includes(b.type))fail(400,'Tipo no válido.');const signed=b.type==='out'?-amount:amount;if(expected(db,shift)+signed<0)fail(409,'La salida supera el saldo en efectivo.');const mid=uid();run(db,'INSERT INTO movements VALUES(?,?,?,?,?,?,?)',mid,shift.id,signed,text(b.reason,300),'manual',user,now());audit(db,user,'cash.movement',mid);return{id:mid};}
   if(id==='close'){const balance=expected(db,shift);const counted=integer(b.counted);run(db,"UPDATE shifts SET status='closed',expected=?,counted=?,difference=?,closed_at=? WHERE id=?",balance,counted,counted-balance,now(),shift.id);audit(db,user,'cash.close',shift.id,JSON.stringify({balance,counted}));return{id:shift.id};}
   fail(404,'Acción de caja desconocida.');
  }
  if(action==='purchases'){
   const product=record(db,'products',b.product_id);const quantity=integer(b.quantity,1,100000);const total=integer(b.total,1);if(b.supplier_id){const contact=record(db,'contacts',b.supplier_id);if(contact.type==='cliente')fail(400,'Selecciona un proveedor.');}
   const pid=uid();run(db,'INSERT INTO purchases VALUES(?,?,?,?,?,?,?,?)',pid,b.supplier_id||null,product.id,quantity,total,text(b.reference??'',100,false),user,now());run(db,'UPDATE products SET stock=stock+? WHERE id=?',quantity,product.id);bumpProduct(db,product.id);audit(db,user,'purchase.create',pid);return{id:pid};
  }
  if(action==='settings'){
   let logo=text(b.logo??'',2800000,false);if(logo){const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(logo);if(!match)fail(400,'Usa una imagen PNG, JPEG o WebP.');const bytes=Buffer.from(match[2],'base64');if(bytes.length>2000000||bytes.length<12)fail(400,'El logo debe ocupar menos de 2 MB.');const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';if(!valid)fail(400,'El contenido no coincide con el formato de imagen.');}
   run(db,'UPDATE settings SET name=?,legal_name=?,document=?,address=?,logo=? WHERE id=1',text(b.name),text(b.legal_name??'',180,false),text(b.document??'',20,false),text(b.address??'',250,false),logo);audit(db,user,'settings.update',tenant.id);return{ok:true};
  }
 });
}
