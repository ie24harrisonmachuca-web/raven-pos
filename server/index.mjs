import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,verifyPassword,digest,fail,text,now} from './store.mjs';
import {operate} from './operations.mjs';
export const root=fileURLToPath(new URL('../',import.meta.url));
export function createApp({dataDir=join(root,'.data'),origin='http://127.0.0.1:4180',secure=false}={}){
 const store=openStore(dataDir), attempts=new Map();const publicRoot=join(root,'public');
 function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
 async function body(req){let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>3000000)fail(413,'El archivo o formulario supera el tamaño permitido.');chunks.push(chunk);}if(!String(req.headers['content-type']).startsWith('application/json'))fail(415,'Se requiere JSON.');try{const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!b||Array.isArray(b)||typeof b!=='object')fail(400,'Formulario no válido.');return b;}catch{fail(400,'JSON no válido.');}}
 const server=http.createServer(async(req,res)=>{
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
   res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
   if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
   try{
    const url=new URL(req.url,origin);const path=url.pathname;const mutation=!['GET','HEAD'].includes(req.method);
    if(path.startsWith('/api/')){
      if(mutation&&req.headers.origin!==origin)fail(403,'Origen de la solicitud no permitido.');
      const b=mutation?await body(req):{};
      if(path==='/api/login'&&req.method==='POST'){
       const email=text(b.email,180).toLowerCase();if(typeof b.password!=='string'||!b.password.length||b.password.length>200)fail(400,'Contraseña no válida.');const password=b.password;const key=req.socket.remoteAddress+':'+email;const ipKey='ip:'+req.socket.remoteAddress;const time=Date.now();for(const [k,v]of attempts)if(v.until<time)attempts.delete(k);const current=attempts.get(key),ip=attempts.get(ipKey);if(current?.count>=8||ip?.count>=100||attempts.size>=10000)fail(429,'Demasiados intentos. Espera 15 minutos.');
       const account=store.db.prepare('SELECT * FROM users WHERE email=?').get(email);const valid=verifyPassword(password,account?.password_hash);if(!account||!valid){attempts.set(key,{count:(current?.count||0)+1,until:current?.until||time+900000});attempts.set(ipKey,{count:(ip?.count||0)+1,until:ip?.until||time+900000});fail(401,'Correo o contraseña incorrectos.');}attempts.delete(key);
       const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');store.db.prepare('DELETE FROM sessions WHERE expires<?').run(time);store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),account.id,csrf,time+8*3600000);
       res.setHeader('Set-Cookie',`raven_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure?'; Secure':''}`);return json(res,200,{ok:true});
      }
      const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('raven_session='))?.slice(14)||'';
      const session=token?store.db.prepare('SELECT s.*,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.hash=? AND s.expires>?').get(digest(token),Date.now()):null;if(!session)fail(401,'Inicia sesión para continuar.');
      if(mutation&&req.headers['x-csrf-token']!==session.csrf)fail(403,'La sesión del formulario no es válida. Actualiza la página.');
      if(path==='/api/me'&&req.method==='GET')return json(res,200,{user:{id:session.user_id,name:session.name,email:session.email},csrf:session.csrf,tenants:store.db.prepare('SELECT t.*,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? ORDER BY t.name').all(session.user_id).map(t=>({...t,name:store.tenant(t.id).prepare('SELECT name FROM settings WHERE id=1').get().name}))});
      if(path==='/api/logout'&&req.method==='POST'){store.db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);res.setHeader('Set-Cookie','raven_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json(res,200,{ok:true});}
      const match=/^\/api\/t\/([a-z0-9-]+)\/([a-z]+(?:\/[a-zA-Z0-9-]+)?)$/.exec(path);if(!match)fail(404,'Ruta no encontrada.');
      const tenant=store.db.prepare('SELECT t.*,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE t.slug=? AND m.user_id=?').get(match[1],session.user_id);if(!tenant)fail(404,'Empresa no disponible para esta cuenta.');
      if(tenant.status!=='active'||!Number.isFinite(Date.parse(tenant.expires_at))||Date.parse(tenant.expires_at)<=Date.now())fail(403,'Suscripción inactiva o vencida. Contacta con Raven para verificar tu pago.');
      const result=operate({store,db:store.tenant(tenant.id),tenant,user:session.user_id,role:tenant.role},req.method,match[2],b);return json(res,200,result);
    }
    if(!['GET','HEAD'].includes(req.method))fail(405,'Método no permitido.');
    const filePath=path==='/'?join(publicRoot,'index.html'):resolve(publicRoot,'.'+decodeURIComponent(path));if(!filePath.startsWith(publicRoot+sep))fail(404,'Recurso no encontrado.');
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.svg':'image/svg+xml'}[extname(filePath)];if(!mime)fail(404,'Recurso no encontrado.');let content;try{content=await readFile(filePath);}catch{fail(404,'Recurso no encontrado.');}res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:content);
   }catch(error){const status=error.status||500;if(!error.status)console.error('Request failed:',error.code||error.message);json(res,status,{error:status===500?'No se pudo completar la operación. Actualiza la vista y verifica su estado antes de reintentar.':error.message});}
 });server.requestTimeout=15000;server.headersTimeout=10000;return {server,store};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4180),host=process.env.HOST||'127.0.0.1';const origin=process.env.PUBLIC_ORIGIN||`http://127.0.0.1:${port}`;if(host!=='127.0.0.1'&&!origin.startsWith('https://'))throw Error('Para exponer el servidor configura PUBLIC_ORIGIN con HTTPS y un proxy TLS.');
 const app=createApp({dataDir:process.env.DATA_DIR||join(root,'.data'),origin,secure:origin.startsWith('https://')});app.server.listen(port,host,()=>console.log('Raven POS: '+origin));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(()=>{app.store.close();process.exit(0);}));
}
