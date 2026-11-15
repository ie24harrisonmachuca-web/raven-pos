import {fail} from '../server/domain.mjs';
export const registryTables = ['users','tenants','memberships','platform_audit'];
export const tenantTables = ['settings','products','product_revisions','tables','contacts','orders','order_stock_reservations','shifts','sales','movements','purchases','audit'];
export function snapshot(db, tables) { return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()])); }
export function insertSnapshot(db, tables, data) {
  if (!data || tables.some(table => !Array.isArray(data[table]))) fail(400,'Copia incompleta.');
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const row of data[table]) {
      if (!row || typeof row !== 'object' || Object.keys(row).some(key => !columns.includes(key))) fail(400,'Columnas no válidas en la copia.');
      const keys = columns.filter(key => Object.hasOwn(row,key));
      if (!keys.length) fail(400,'Registro vacío.');
      db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(key=>row[key]));
    }
  }
}
