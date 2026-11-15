import {DurableObject} from 'cloudflare:workers';
import {tenantSchema} from '../server/schema.mjs';
import {operate} from '../server/operations.mjs';
import {fail,permissions,transaction,digest} from '../server/domain.mjs';
import {sqlDatabase,memberDirectory} from './sql.mjs';
import {json,failure,readBody} from './http.mjs';
import {snapshot,insertSnapshot,tenantTables} from './snapshots.mjs';

export class TenantDatabase extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.ctx=ctx;this.env=env;this.db=sqlDatabase(ctx.storage);
    this.db.exec(tenantSchema);
    this.db.exec('CREATE TABLE IF NOT EXISTS tenant_identity(id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS import_fingerprint(value TEXT PRIMARY KEY);');
  }
  initialize(tenant) {
    const existing=this.db.prepare('SELECT id FROM tenant_identity').get();
    if(existing&&existing.id!==tenant.id)fail(409,'Identidad de empresa no válida.');
    this.db.prepare('INSERT OR IGNORE INTO tenant_identity VALUES(?)').run(tenant.id);
    this.db.prepare('INSERT OR IGNORE INTO settings(id,name) VALUES(1,?)').run(tenant.name);
  }
  async fetch(request) {
    try {
      const body=await readBody(request),path=new URL(request.url).pathname;
      if(path==='/import') {
        const fingerprint=digest(JSON.stringify(body.data));
        if(this.db.prepare('SELECT id FROM tenant_identity').get()) {
          if(this.db.prepare('SELECT value FROM import_fingerprint WHERE value=?').get(fingerprint))return json({ok:true,already_imported:true});
          fail(409,'La empresa ya tiene datos. No se sobrescriben.');
        }
        transaction(this.db,()=>{insertSnapshot(this.db,tenantTables,body.data);this.initialize(body.tenant);this.db.prepare('INSERT INTO import_fingerprint VALUES(?)').run(fingerprint);});
        return json({ok:true});
      }
      this.initialize(body.tenant);
      if(path==='/export')return json({tenant:body.tenant,data:snapshot(this.db,tenantTables),bookmark:await this.ctx.storage.getCurrentBookmark()});
      if(path!=='/operate'||!Object.hasOwn(permissions,body.role))fail(404,'Operación no encontrada.');
      if(body.path==='users')fail(404,'La administración de cuentas pertenece al registro central.');
      if(body.path==='settings'&&typeof body.body?.logo==='string'&&body.body.logo.length>1000000)fail(400,'Para el alojamiento en línea usa un logo de hasta 700 KB.');
      const context={db:this.db,tenant:body.tenant,user:body.user,role:body.role,store:{db:memberDirectory(body.members)}};
      return json(operate(context,body.method,body.path,body.body));
    } catch(error) {return failure(error);}
  }
}
