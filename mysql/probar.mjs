import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [config,output]=process.argv.slice(2);
if(!config)throw Error('Uso: node mysql/probar.mjs cliente.cnf [resultados.txt]');
const exe=process.env.MYSQL_EXE||'mysql';
const run=sql=>spawnSync(exe,['--defaults-extra-file='+config,'--batch','--raw'],{input:sql,encoding:'utf8'});
let r=run(await readFile(new URL('esquema.sql',import.meta.url),'utf8'));assert.equal(r.status,0,r.stderr);
r=run(await readFile(new URL('verificar.sql',import.meta.url),'utf8'));assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/MYSQL01\s+CONFORME/);assert.match(r.stdout,/2026-11-15\s+1\s+200/);
const lines=['MYSQL01: conforme; vista devuelve 200 centimos para la empresa A.','MYSQL02: conforme; procedimiento devuelve fecha, cantidad 1 e importe 200.'];
for(const [id,sql,expected] of [
 ['MYSQL03',"USE raven_analitica; START TRANSACTION; INSERT INTO empresas VALUES('qa-negative','Prueba'); INSERT INTO productos VALUES('qa-negative','p','Prueba',-1,100);",'Stock y precio'],
 ['MYSQL04',"USE raven_analitica; CALL consultar_ventas_periodo('qa-a','2026-12-01','2026-11-01');",'Periodo de consulta']]){
 r=run(sql);assert.notEqual(r.status,0);assert.ok(r.stderr.includes(expected),r.stderr);assert.match(r.stderr,/45000/);lines.push(id+': conforme; rechazo esperado SQLSTATE 45000.');
}
lines.push('Fecha UTC: '+new Date().toISOString(),'Las transacciones sinteticas no se confirman.');
if(output)await writeFile(output,lines.join('\n'));console.log(lines.join('\n'));
