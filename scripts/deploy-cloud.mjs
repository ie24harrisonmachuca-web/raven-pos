import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const secret=(await readFile(root+'.cloud/operator-token','utf8')).trim();
if(secret.length<48)throw Error('No se ha preparado la clave privada de administración.');
const secretsPath=root+'.cloud/deploy-secrets.json';
await writeFile(secretsPath,JSON.stringify({OPERATOR_SECRET:secret}),{mode:0o600});
const wrangler=root+'node_modules/wrangler/bin/wrangler.js';let output='';
const code=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[wrangler,'deploy','--secrets-file',secretsPath],{cwd:root,stdio:['inherit','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
  child.stderr.on('data',chunk=>process.stderr.write(chunk));child.on('error',reject);child.on('exit',resolve);
});
if(code!==0)process.exit(code||1);
const urls=[...output.matchAll(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/g)].map(m=>m[0]);
if(!urls.length)throw Error('El despliegue terminó, pero no devolvió una dirección workers.dev. Revisa su salida antes de reintentar.');
const url=urls.at(-1);let healthy=false;
for(let n=0;n<6;n++) {
  try{const r=await fetch(url+'/api/health');const result=await r.json();if(r.ok&&result.service==='raven-pos'){healthy=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,1000));
}
await writeFile(root+'.cloud/deployment.json',JSON.stringify({url,healthy,published_at:new Date().toISOString()},null,2));
if(!healthy)throw Error('El despliegue devolvió dirección, pero su comprobación de salud sigue pendiente. No vuelvas a desplegar sin revisar.');
console.log('Servidor publicado y comprobado: '+url);
