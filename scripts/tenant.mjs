import {openStore,now,uid,fail,text,hashPassword,transaction} from '../server/store.mjs';
import {root} from '../server/index.mjs';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';

// Platform administration only. Input is JSON on stdin, never password arguments.
// This tool has direct database access: do not expose it as a public HTTP endpoint.
let store;
try {
  let input;
  try { input=JSON.parse(readFileSync(0,'utf8').replace(/^\uFEFF/,'')); }
  catch { fail(400,'Envía un objeto JSON válido por stdin.'); }
  if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Se requiere un objeto JSON.');
  const actions=['create','activate','suspend','reset-password'];
  if(!actions.includes(input.action))fail(400,'Acción: create, activate, suspend o reset-password.');
  store=openStore(process.env.DATA_DIR||join(root,'.data'));
  const expiry=value=>{
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail(400,'Indica expires_at con fecha, hora y zona, por ejemplo 2027-01-01T05:00:00Z.');
    return new Date(value).toISOString();
  };
  if(input.action==='create') {
    const slug=text(input.slug,60),name=text(input.name),email=text(input.email,180).toLowerCase();
    const expiresAt=expiry(input.expires_at);
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail(400,'El identificador admite letras minúsculas, números y guiones.');
    if(store.db.prepare('SELECT id FROM tenants WHERE slug=?').get(slug))fail(409,'Ya existe una empresa con ese identificador.');
    if(input.active!==undefined&&typeof input.active!=='boolean')fail(400,'active debe ser true o false.');
    if(input.active&&Date.parse(expiresAt)<=Date.now())fail(400,'Para activar el acceso indica un vencimiento futuro.');
    transaction(store.db,()=>{
      let user=store.db.prepare('SELECT id FROM users WHERE email=?').get(email)?.id;
      if(!user)user=store.createUser(email,input.owner_name,input.password);
      const id=store.createTenant(slug,name,expiresAt,input.active?'active':'suspended');
      store.db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(user,id,'admin');
      store.db.prepare('INSERT INTO platform_audit VALUES(?,?,?,?)').run(uid(),'tenant.create',id,now());
    });
    console.log('Empresa creada: '+slug+'. '+(input.active?'Acceso activo.':'Acceso suspendido hasta verificar el pago.'));
  } else if(input.action==='reset-password') {
    const email=text(input.email,180).toLowerCase(),password=input.password;
    if(typeof password!=='string'||password.length<12||password.length>200)fail(400,'La contraseña debe tener entre 12 y 200 caracteres.');
    const user=store.db.prepare('SELECT id FROM users WHERE email=?').get(email);
    if(!user)fail(404,'Cuenta no encontrada.');
    transaction(store.db,()=>{
      store.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),user.id);
      store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      store.db.prepare('INSERT INTO platform_audit VALUES(?,?,?,?)').run(uid(),'user.password-reset:'+user.id,null,now());
    });
    console.log('Contraseña actualizada y sesiones anteriores cerradas.');
  } else {
    const tenant=store.db.prepare('SELECT * FROM tenants WHERE slug=?').get(text(input.slug,60));
    if(!tenant)fail(404,'Empresa no encontrada.');
    const expiresAt=expiry(input.expires_at||tenant.expires_at);
    if(input.action==='activate'&&Date.parse(expiresAt)<=Date.now())fail(400,'Indica un vencimiento futuro para activar la empresa.');
    transaction(store.db,()=>{
      store.db.prepare('UPDATE tenants SET status=?,expires_at=? WHERE id=?').run(input.action==='activate'?'active':'suspended',expiresAt,tenant.id);
      store.db.prepare('INSERT INTO platform_audit VALUES(?,?,?,?)').run(uid(),'tenant.'+input.action,tenant.id,now());
    });
    console.log('Suscripción '+(input.action==='activate'?'activada hasta '+expiresAt:'suspendida')+'.');
  }
} catch(error) {
  console.error(error.status?error.message:'No se completó la administración. Revisa el registro local y los permisos de archivos.');
  process.exitCode=1;
} finally { store?.close(); }
