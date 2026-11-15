import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),privatePath=root+'.cloud/';
// Public OAuth client identifier from the official Netlify CLI; this is not a secret.
const client='d6f37de6614df7ae58664cfca524744d73807a377f5ee71f1a254f78412e3750';
const api='https://api.netlify.com/api/v1';
async function request(path,{token,method='GET',body,raw}={}) {
  const r=await fetch(api+path,{method,redirect:'error',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(raw?{'Content-Type':'application/octet-stream'}:body?{'Content-Type':'application/json'}:{})},body:raw||body&&JSON.stringify(body)});
  if(!r.ok)throw Error('Netlify respondió HTTP '+r.status+' en '+path.split('?')[0]);
  return r.status===204?{}:r.json();
}
async function authenticate() {
  try{return JSON.parse(await readFile(privatePath+'netlify-auth.json','utf8')).access_token;}catch{}
  const ticket=JSON.parse(await readFile(privatePath+'netlify-ticket.json','utf8'));
  const state=await request('/oauth/tickets/'+ticket.id);if(!state.authorized)throw Error('La autorización de Netlify sigue pendiente.');
  const result=await request('/oauth/tickets/'+ticket.id+'/exchange',{method:'POST'});
  if(!result.access_token)throw Error('Netlify no devolvió la autorización.');
  await writeFile(privatePath+'netlify-auth.json',JSON.stringify(result),{mode:0o600});return result.access_token;
}
try {
  const action=process.argv[2]||'check';
  if(action==='request') {
    const ticket=await request('/oauth/tickets?client_id='+client,{method:'POST',body:{message:'Raven POS: conectar el ingreso con Cloudflare'}});
    await writeFile(privatePath+'netlify-ticket.json',JSON.stringify(ticket),{mode:0o600});console.log('https://app.netlify.com/authorize?response_type=ticket&ticket='+ticket.id);
  }else {
    const token=await authenticate();let site;
    for(let page=1;page<=10&&!site;page++){
      const sites=await request('/sites?per_page=100&page='+page,{token});
      site=sites.find(s=>[s.ssl_url,s.url].some(value=>value&&new URL(value).hostname==='ravenpos.netlify.app'));
      if(sites.length<100)break;
    }
    if(!site)throw Error('La cuenta autorizada no tiene el sitio ravenpos.netlify.app.');
    await writeFile(privatePath+'netlify-site.json',JSON.stringify({id:site.id,url:site.ssl_url||site.url}),{mode:0o600});
    if(action==='check')console.log('Netlify autorizado. Sitio identificado: '+(site.ssl_url||site.url));
    else if(action==='deploy') {
      const cloud=JSON.parse(await readFile(privatePath+'deployment.json','utf8'));
      const health=await fetch(cloud.url+'/api/health');if(!health.ok||(await health.json()).service!=='raven-pos')throw Error('El servidor del POS debe responder antes de conectar la web.');
      const directory=resolve(process.argv[3]||join(root,'../Reven pos/dist'));
      const config=await readFile(join(directory,'config.js'),'utf8');if(!config.includes(cloud.url))throw Error('Compila primero la web con el acceso al servidor publicado.');
      const files={},uploads=new Map();
      async function collect(folder) {for(const item of await readdir(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isDirectory())await collect(path);else if(item.isFile()){const name='/'+relative(directory,path).replaceAll('\\','/'),data=await readFile(path),hash=createHash('sha1').update(data).digest('hex');files[name]=hash;uploads.set(hash,{name,data});}}}
      await collect(directory);
      const deploy=await request('/sites/'+site.id+'/deploys?production=true&title='+encodeURIComponent('Raven POS · acceso a Cloudflare'),{token,method:'POST',body:{files,draft:false,async:false}});
      await writeFile(privatePath+'netlify-deploy.json',JSON.stringify({id:deploy.id,site:site.id,state:deploy.state}),{mode:0o600});
      for(const hash of deploy.required||[]){const file=uploads.get(hash);if(!file)throw Error('Netlify solicitó un archivo ajeno al manifiesto.');await request('/deploys/'+deploy.id+'/files/'+file.name.slice(1).split('/').map(encodeURIComponent).join('/'),{token,method:'PUT',raw:file.data});}
      let final;
      for(let n=0;n<45;n++){final=await request('/deploys/'+deploy.id,{token});if(final.state==='ready')break;if(['error','rejected'].includes(final.state))throw Error('Netlify no publicó la versión. Revisa el despliegue '+deploy.id);await new Promise(resolve=>setTimeout(resolve,1000));}
      await writeFile(privatePath+'netlify-deploy.json',JSON.stringify({id:deploy.id,site:site.id,state:final.state,url:site.ssl_url||site.url}),{mode:0o600});
      if(final.state!=='ready')throw Error('El despliegue está en curso; continúa con su ID antes de publicar otra versión.');
      console.log('Web publicada y conectada: '+(site.ssl_url||site.url));
    }else throw Error('Acción: request, check o deploy.');
  }
}catch(error){console.error(error.message);process.exitCode=1;}
