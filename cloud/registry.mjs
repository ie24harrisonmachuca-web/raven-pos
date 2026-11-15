import {DurableObject} from 'cloudflare:workers';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {registrySchema} from '../server/schema.mjs';
import {uid,now,fail,text,hashPassword,verifyPassword,digest,permissions,transaction} from '../server/domain.mjs';
import {sqlDatabase} from './sql.mjs';
import {json,failure,readBody} from './http.mjs';
import {snapshot,insertSnapshot,registryTables} from './snapshots.mjs';

const future=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail(400,'Fecha de vencimiento no válida.');return new Date(value).toISOString();};
const validSlug=value=>{if(typeof value!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)||value.length>60)fail(400,'Identificador de empresa no válido.');return value;};
const internal=body=>new Request('https://tenant.internal/operate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export class AccountRegistry extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.ctx=ctx;this.env=env;this.db=sqlDatabase(ctx.storage);this.db.exec(registrySchema);
    this.db.exec('CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS login_expiry ON login_limits(until); CREATE TABLE IF NOT EXISTS pending_import(id TEXT PRIMARY KEY,status TEXT NOT NULL,imported INTEGER NOT NULL DEFAULT 0);');
  }
  log(action,tenant=null) {this.db.prepare('INSERT INTO platform_audit VALUES(?,?,?,?)').run(uid(),action,tenant,now());}
  createUser(email,name,password) {
    email=text(email,180).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Correo no válido.');
    if(typeof password!=='string'||password.length<12||password.length>200)fail(400,'La contraseña debe tener entre 12 y 200 caracteres.');
    const id=uid();this.db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,email,text(name),hashPassword(password));return id;
  }
  async tenantRequest(tenant,path,body={}) {
    const req=internal({...body,tenant});const url=new URL(req.url);url.pathname=path;
    return this.env.TENANTS.getByName(tenant.id).fetch(new Request(url,req));
  }
  authorizeOperator(request) {
    const expected=this.env.OPERATOR_SECRET,provided=request.headers.get('authorization')?.replace(/^Bearer /,'');
    if(!expected||expected.length<48||!provided||!timingSafeEqual(Buffer.from(digest(expected),'hex'),Buffer.from(digest(provided),'hex')))fail(403,'Administración no autorizada.');
  }
  async platform(request,body) {
    this.authorizeOperator(request);
    const db=this.db,action=body.action;
    if(action==='list')return json({tenants:db.prepare('SELECT * FROM tenants ORDER BY name').all()});
    if(action==='import-status')return json({pending:db.prepare('SELECT * FROM pending_import').all()});
    if(action==='export') {
      const tenants=[];for(const tenant of db.prepare('SELECT * FROM tenants').all()) {
        const result=await this.tenantRequest(tenant,'/export');if(!result.ok)fail(503,'No se completó la copia de una empresa.');tenants.push(await result.json());
      }
      return json({format:'raven-cloud-v1',created_at:now(),registry:snapshot(db,registryTables),tenants,bookmark:await this.ctx.storage.getCurrentBookmark()});
    }
    if(action==='import-registry') {
      if(db.prepare('SELECT COUNT(*) n FROM users').get().n||db.prepare('SELECT COUNT(*) n FROM tenants').get().n)fail(409,'El registro ya tiene datos. No se sobrescribe.');
      transaction(db,()=>{
        const original=body.registry;if(!original?.tenants?.length)fail(400,'La copia no contiene empresas.');
        const pending=structuredClone(original);pending.tenants.forEach(t=>t.status='suspended');insertSnapshot(db,registryTables,pending);
        for(const tenant of original.tenants)db.prepare('INSERT INTO pending_import(id,status) VALUES(?,?)').run(tenant.id,tenant.status);
        this.log('migration.registry');
      });return json({ok:true});
    }
    if(action==='import-tenant') {
      const tenant=db.prepare('SELECT * FROM tenants WHERE id=?').get(body.tenant_id);
      if(!tenant||!db.prepare('SELECT id FROM pending_import WHERE id=? AND imported=0').get(tenant.id))fail(409,'Empresa no pendiente de importar.');
      const result=await this.tenantRequest(tenant,'/import',{data:body.data});if(!result.ok)return result;
      db.prepare('UPDATE pending_import SET imported=1 WHERE id=?').run(tenant.id);return json({ok:true});
    }
    if(action==='finish-import') {
      if(db.prepare('SELECT id FROM pending_import WHERE imported=0').get())fail(409,'Todavía faltan bases de empresas.');
      transaction(db,()=>{for(const row of db.prepare('SELECT * FROM pending_import').all())db.prepare('UPDATE tenants SET status=? WHERE id=?').run(row.status,row.id);db.exec('DELETE FROM pending_import');this.log('migration.complete');});return json({ok:true});
    }
    if(action==='create') {
      const slug=validSlug(body.slug),name=text(body.name),email=text(body.email,180).toLowerCase(),expires=future(body.expires_at);
      if(db.prepare('SELECT id FROM tenants WHERE slug=?').get(slug))fail(409,'Ya existe esa empresa.');
      if(body.active!==undefined&&typeof body.active!=='boolean')fail(400,'active debe ser true o false.');
      if(body.active&&Date.parse(expires)<=Date.now())fail(400,'El vencimiento debe ser futuro.');
      const id=transaction(db,()=>{
        const owner=db.prepare('SELECT id FROM users WHERE email=?').get(email)?.id||this.createUser(email,body.owner_name,body.password),id=uid();
        db.prepare('INSERT INTO tenants VALUES(?,?,?,?,?)').run(id,slug,name,body.active?'active':'suspended',expires);db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(owner,id,'admin');this.log('tenant.create',id);return id;
      });return json({id,slug,active:!!body.active});
    }
    if(action==='reset-password') {
      const user=db.prepare('SELECT id FROM users WHERE email=?').get(text(body.email,180).toLowerCase());if(!user)fail(404,'Cuenta no encontrada.');
      if(typeof body.password!=='string'||body.password.length<12||body.password.length>200)fail(400,'La contraseña debe tener entre 12 y 200 caracteres.');
      transaction(db,()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password),user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);this.log('user.password-reset:'+user.id);});return json({ok:true});
    }
    if(['activate','suspend'].includes(action)) {
      const tenant=db.prepare('SELECT * FROM tenants WHERE slug=?').get(validSlug(body.slug));if(!tenant)fail(404,'Empresa no encontrada.');
      if(db.prepare('SELECT id FROM pending_import WHERE id=?').get(tenant.id))fail(409,'Completa la importación antes de activar.');
      const expiry=future(body.expires_at||tenant.expires_at);if(action==='activate'&&Date.parse(expiry)<=Date.now())fail(400,'El vencimiento debe ser futuro.');
      transaction(db,()=>{db.prepare('UPDATE tenants SET status=?,expires_at=? WHERE id=?').run(action==='activate'?'active':'suspended',expiry,tenant.id);this.log('tenant.'+action,tenant.id);});return json({ok:true});
    }
    fail(400,'Acción de administración no válida.');
  }
  async fetch(request) {
    try {
      const db=this.db,url=new URL(request.url),path=url.pathname,mutation=!['GET','HEAD'].includes(request.method),body=mutation?await readBody(request):{};
      if(path==='/api/platform'&&request.method==='POST')return await this.platform(request,body);
      if(path==='/api/login'&&request.method==='POST') {
        const email=text(body.email,180).toLowerCase(),password=body.password;
        if(typeof password!=='string'||!password.length||password.length>200)fail(400,'Contraseña no válida.');
        const time=Date.now(),ip=request.headers.get('CF-Connecting-IP')||'local',keys=[ip+':'+email,'ip:'+ip];
        db.prepare('DELETE FROM login_limits WHERE until<?').run(time);
        if(keys.some((key,index)=>(db.prepare('SELECT count FROM login_limits WHERE key=?').get(key)?.count||0)>=(index?100:8))||db.prepare('SELECT COUNT(*) n FROM login_limits').get().n>=10000)fail(429,'Demasiados intentos. Espera 15 minutos.');
        const user=db.prepare('SELECT * FROM users WHERE email=?').get(email),valid=verifyPassword(password,user?.password_hash);
        if(!user||!valid){for(const key of keys)db.prepare('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,time+900000);fail(401,'Correo o contraseña incorrectos.');}
        db.prepare('DELETE FROM login_limits WHERE key=?').run(keys[0]);db.prepare('DELETE FROM sessions WHERE expires<?').run(time);
        const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),user.id,csrf,time+8*3600000);
        return json({ok:true},200,{'Set-Cookie':`raven_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${url.protocol==='https:'?'; Secure':''}`});
      }
      const cookie=request.headers.get('cookie')||'',token=cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('raven_session='))?.slice(14)||'';
      const session=token?db.prepare('SELECT s.*,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').get(digest(token),Date.now()):null;
      if(!session)fail(401,'Inicia sesión para continuar.');
      if(mutation&&request.headers.get('X-CSRF-Token')!==session.csrf)fail(403,'La sesión del formulario no es válida. Actualiza la página.');
      if(path==='/api/me'&&request.method==='GET')return json({user:{id:session.user_id,email:session.email,name:session.name},csrf:session.csrf,tenants:db.prepare('SELECT t.*,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? ORDER BY t.name').all(session.user_id)});
      if(path==='/api/logout'&&request.method==='POST'){db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);return json({ok:true},200,{'Set-Cookie':`raven_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol==='https:'?'; Secure':''}`});}
      const match=/^\/api\/t\/([a-z0-9-]+)\/([a-z]+(?:\/[a-zA-Z0-9-]+)?)$/.exec(path);if(!match)fail(404,'Ruta no encontrada.');
      const tenant=db.prepare('SELECT t.*,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE t.slug=? AND m.user_id=?').get(match[1],session.user_id);
      if(!tenant)fail(404,'Empresa no disponible para esta cuenta.');
      if(tenant.status!=='active'||!Number.isFinite(Date.parse(tenant.expires_at))||Date.parse(tenant.expires_at)<=Date.now())fail(403,'Suscripción inactiva o vencida. Contacta con Raven para verificar tu pago.');
      if(request.method==='POST'&&match[2]==='users') {
        if(tenant.role!=='admin')fail(403,'Tu rol no permite esta operación.');
        const role=text(body.role);if(!Object.hasOwn(permissions,role))fail(400,'Rol no válido.');
        if(db.prepare('SELECT id FROM users WHERE email=?').get(String(body.email).trim().toLowerCase()))fail(409,'Ese correo ya tiene cuenta. La vinculación debe gestionarla el administrador de Raven.');
        const id=transaction(db,()=>{const id=this.createUser(body.email,body.name,body.password);db.prepare('INSERT INTO memberships VALUES(?,?,?)').run(id,tenant.id,role);this.log('user.create:'+session.user_id+':'+id,tenant.id);return id;});return json({id});
      }
      const members=db.prepare('SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE tenant_id=?').all(tenant.id);
      const response=await this.tenantRequest(tenant,'/operate',{method:request.method,path:match[2],body,user:session.user_id,role:tenant.role,members});
      if(response.ok&&request.method==='POST'&&match[2]==='settings')db.prepare('UPDATE tenants SET name=? WHERE id=?').run(body.name,tenant.id);
      return response;
    }catch(error){return failure(error);}
  }
}
