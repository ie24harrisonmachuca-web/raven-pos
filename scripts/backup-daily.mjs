import {cloudAdmin} from './cloud-admin.mjs';
import {mkdir,writeFile,readdir,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=new URL('../.cloud/backups/',import.meta.url);await mkdir(directory,{recursive:true});
const data=await cloudAdmin({action:'export'});if(data.format!=='raven-cloud-v1'||!Array.isArray(data.tenants))throw Error('Exportacion incompleta');
const stamp=new Date().toISOString().replaceAll(':','-'),content=JSON.stringify(data);
await writeFile(new URL(stamp+'.json',directory),content,{mode:0o600});
await writeFile(new URL(stamp+'.sha256',directory),createHash('sha256').update(content).digest('hex'),{mode:0o600});
const files=(await readdir(directory)).filter(n=>/^\d{4}.*\.json$/.test(n)).sort().reverse();
for(const f of files.slice(30)){await unlink(new URL(f,directory));await unlink(new URL(f.replace('.json','.sha256'),directory)).catch(()=>{});}
console.log('Respaldo remoto verificado; '+data.tenants.length+' empresas; retencion 30 exportaciones.');
