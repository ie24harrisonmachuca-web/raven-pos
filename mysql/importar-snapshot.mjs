import {readFile,writeFile} from 'node:fs/promises';
// Converts an authorized snapshot to analytical SQL; excludes users and credentials.
const [source,target]=process.argv.slice(2);if(!source||!target)throw Error('Uso: node mysql/importar-snapshot.mjs copia.json salida.sql');
const data=JSON.parse(await readFile(source,'utf8'));if(data.format!=='raven-cloud-v1'||!Array.isArray(data.tenants))throw Error('Formato de copia no valido');
const str=v=>v==null?'NULL':`CONVERT(0x${Buffer.from(String(v)).toString('hex')} USING utf8mb4)`;
const num=v=>{if(!Number.isSafeInteger(v))throw Error('Importe o cantidad no entero');return String(v)};
const sql=['USE raven_analitica;','START TRANSACTION;'];
for(const {tenant,data:tables} of data.tenants){
 sql.push(`INSERT INTO empresas VALUES(${str(tenant.id)},${str(tenant.name)}) ON DUPLICATE KEY UPDATE nombre=VALUES(nombre);`);
 sql.push(`DELETE FROM ventas WHERE empresa_id=${str(tenant.id)};`,`DELETE FROM productos WHERE empresa_id=${str(tenant.id)};`);
 for(const p of tables.products)sql.push(`INSERT INTO productos VALUES(${str(tenant.id)},${str(p.id)},${str(p.name)},${num(p.stock)},${num(p.price)});`);
 for(const s of tables.sales)sql.push(`INSERT INTO ventas VALUES(${str(tenant.id)},${str(s.id)},${str(s.created_at.slice(0,10))},${num(s.total)},${str(s.status)});`);
}sql.push('COMMIT;');await writeFile(target,sql.join('\n'),{mode:0o600});console.log('SQL analitico generado sin cuentas ni secretos.');
