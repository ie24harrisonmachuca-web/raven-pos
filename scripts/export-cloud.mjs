import {DatabaseSync} from 'node:sqlite';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {snapshot,registryTables,tenantTables} from '../cloud/snapshots.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function exportLocal(directory=join(root,'.data')) {
  const db=new DatabaseSync(join(directory,'registry.sqlite'),{readOnly:true});
  let registry;try{db.exec('BEGIN');registry=snapshot(db,registryTables);db.exec('COMMIT');}finally{db.close();}
  const tenants=[];
  for(const tenant of registry.tenants) {
    const db=new DatabaseSync(join(directory,'tenants',tenant.id+'.sqlite'),{readOnly:true});
    try{
      db.exec('BEGIN');if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('La base no superó la comprobación.');
      const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t=>t.name));
      const optional=new Set(['product_revisions','order_stock_reservations']);
      const data=Object.fromEntries(tenantTables.map(table=>{
        if(!tables.has(table)&&optional.has(table))return[table,[]];
        return[table,db.prepare(`SELECT * FROM ${table}`).all()];
      }));
      tenants.push({tenant,data});db.exec('COMMIT');
    }finally{db.close();}
  }
  return {format:'raven-cloud-v1',created_at:new Date().toISOString(),registry,tenants};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  try {
    let running=false;try{await fetch('http://127.0.0.1:4180/api/me',{signal:AbortSignal.timeout(1000)});running=true;}catch{}
    if(running)throw Error('Detén el servidor local del POS antes de exportar una copia coordinada.');
    const data=await exportLocal(process.env.DATA_DIR);const content=JSON.stringify(data),id=new Date().toISOString().replaceAll(':','-');
    await mkdir(root+'.cloud/exports',{recursive:true});const path=root+'.cloud/exports/'+id+'.json';await writeFile(path,content,{mode:0o600});
    await writeFile(root+'.cloud/export-manifest.json',JSON.stringify({path,sha256:createHash('sha256').update(content).digest('hex'),companies:data.tenants.length,accounts:data.registry.users.length}),{mode:0o600});
    console.log('Copia privada preparada: '+data.tenants.length+' empresas, '+data.registry.users.length+' cuentas. Los datos originales no se modificaron.');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
