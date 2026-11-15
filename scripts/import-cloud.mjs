import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cloudAdmin} from './cloud-admin.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const manifest=JSON.parse(await readFile(root+'.cloud/export-manifest.json','utf8')),content=await readFile(manifest.path,'utf8');
  if(createHash('sha256').update(content).digest('hex')!==manifest.sha256)throw Error('La copia no coincide con su manifiesto.');
  const data=JSON.parse(content),options={origin:process.env.RAVEN_CLOUD_ORIGIN};
  const current=await cloudAdmin({action:'list'},options);
  if(!current.tenants.length)await cloudAdmin({action:'import-registry',registry:data.registry},options);
  else if(JSON.stringify(current.tenants.map(t=>t.id).sort())!==JSON.stringify(data.registry.tenants.map(t=>t.id).sort()))throw Error('El destino contiene otras empresas. No se sobrescriben datos.');
  const {pending}=await cloudAdmin({action:'import-status'},options);
  if(!pending.length){console.log('Las empresas de esta copia ya están importadas. No se sobrescribieron datos.');process.exit(0);}
  for(const item of data.tenants)if(pending.some(p=>p.id===item.tenant.id&&!p.imported))await cloudAdmin({action:'import-tenant',tenant_id:item.tenant.id,data:item.data},options);
  await cloudAdmin({action:'finish-import'},options);
  console.log('Importación completada y empresas habilitadas según su estado original. Inicia sesión de nuevo.');
}catch(error){console.error(error.message);process.exitCode=1;}
