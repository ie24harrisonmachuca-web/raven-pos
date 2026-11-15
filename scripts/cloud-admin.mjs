import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function cloudAdmin(input,{origin,token}={}) {
  if(!origin){const saved=JSON.parse(await readFile(root+'.cloud/deployment.json','utf8'));origin=saved.url;}
  const url=new URL(origin);
  if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))throw Error('La administración remota requiere HTTPS.');
  token||=process.env.RAVEN_OPERATOR_TOKEN||(await readFile(root+'.cloud/operator-token','utf8')).trim();
  const response=await fetch(new URL('/api/platform',url),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(input)});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'No se completó la administración.'),{status:response.status});
  return result;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw.replace(/^\uFEFF/,''));
    const result=await cloudAdmin(input,{origin:process.env.RAVEN_CLOUD_ORIGIN});
    if(input.action==='export') {
      await mkdir(root+'.cloud/backups',{recursive:true});const target=root+'.cloud/backups/'+new Date().toISOString().replaceAll(':','-')+'.json';
      await writeFile(target,JSON.stringify(result),{mode:0o600});console.log('Copia privada guardada en '+target);
    }else console.log(JSON.stringify(result));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
