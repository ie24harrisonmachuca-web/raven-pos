import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {openStore,uid} from '../server/store.mjs';
import {root} from '../server/index.mjs';
const store=openStore(process.env.DATA_DIR||join(root,'.data'));
if(store.db.prepare('SELECT COUNT(*) n FROM users').get().n){console.log('La instalación ya tiene usuarios. No se reemplazaron datos.');store.close();process.exit(0);}
const password=randomBytes(15).toString('base64url');
const admin=store.createUser('admin@raven.local','Administrador de prueba',password);
const expiresAt=new Date(Date.now()+90*24*60*60*1000).toISOString();
for(const [slug,name]of [['don-teobaldo','Don Teobaldo'],['pin-pon','Pin Pon']]){
 const tenantId=store.createTenant(slug,name,expiresAt);store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(admin,tenantId,'admin');const db=store.tenant(tenantId);
 for(let n=1;n<=12;n++)db.prepare('INSERT INTO tables VALUES(?,?,?,?,1)').run(uid(),String(n).padStart(2,'0'),n<=8?'Salón principal':'Terraza',n%3===0?6:4);
 for(const [name,category,price,stock,image]of [['Hamburguesa de la casa','Platos',2400,50,'burger'],['Café americano','Bebidas',700,100,'coffee'],['Ensalada fresca','Entradas',1800,40,'salad'],['Pizza artesanal','Platos',3500,30,'pizza'],['Limonada','Bebidas',1000,80,''],['Helado artesanal','Postres',1200,40,'']])db.prepare('INSERT INTO products(id,name,category,price,cost,stock,track_stock,active,image) VALUES(?,?,?,?,?,?,?,?,?)').run(uid(),name,category,price,Math.round(price*.4),stock,1,1,image);
}
const accessPath=join(store.root,'ACCESO-LOCAL.txt');
const localUrl=process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${process.env.PORT||4180}`;
writeFileSync(accessPath,`Raven POS · instalación local de evaluación\nURL: ${localUrl}\nCorreo: admin@raven.local\nContraseña: ${password}\n\nDos empresas con datos ficticios. Acceso de evaluación hasta ${expiresAt}.\nNo publiques estas cuentas ni esta carpeta.\n`,{mode:0o600});
console.log('Dos empresas de prueba creadas en bases independientes. Acceso guardado en '+accessPath);store.close();
