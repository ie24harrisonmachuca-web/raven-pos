import {backup,DatabaseSync} from 'node:sqlite';
import {readdirSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {root} from '../server/index.mjs';

const source=resolve(process.env.DATA_DIR||join(root,'.data'));
const destination=resolve(process.env.BACKUP_DIR||join(root,'backups'));
const out=join(destination,new Date().toISOString().replaceAll(':','-'));
try {
  if(!existsSync(join(source,'registry.sqlite'))||!existsSync(join(source,'tenants')))throw Error('No existe una instalación en DATA_DIR.');
  const files=['registry.sqlite',...readdirSync(join(source,'tenants')).filter(n=>n.endsWith('.sqlite')).map(n=>'tenants/'+n)];
  mkdirSync(join(out,'tenants'),{recursive:true});
  for(const name of files) {
    const sourceDb=new DatabaseSync(join(source,name),{readOnly:true});
    try { await backup(sourceDb,join(out,name)); } finally { sourceDb.close(); }
    const copy=new DatabaseSync(join(out,name),{readOnly:true});
    try { if(copy.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Falló la verificación de la copia '+name); }
    finally { copy.close(); }
  }
  writeFileSync(join(out,'manifest.json'),JSON.stringify({created_at:new Date().toISOString(),files,sqlite_quick_check:'ok',scope:'Consistente por archivo; detener el servicio para una instantánea coordinada.'},null,2));
  console.log('Copia verificada: '+out+'\nPara coordinar todas las empresas, ejecuta con el servicio detenido.');
} catch(error) {
  console.error('No se completó la copia: '+error.message+'\nUna carpeta parcial sin manifest.json no debe utilizarse como copia verificada.');
  process.exitCode=1;
}
