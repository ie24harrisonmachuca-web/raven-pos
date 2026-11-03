import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
export const uid=()=>randomUUID();
export const now=()=>new Date().toISOString();
export const digest=s=>createHash('sha256').update(s).digest('hex');
export function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
const dummy=hashPassword('not-a-real-account-password');
export function verifyPassword(password,hash=dummy){const [salt,key]=hash.split(':');const expected=Buffer.from(key||'','hex');const actual=scryptSync(password,salt,64);return expected.length===actual.length&&timingSafeEqual(actual,expected);}
export function fail(status,message){throw Object.assign(new Error(message),{status});}
export function text(v,max=150,required=true){if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))fail(400,'Revisa los campos obligatorios y su longitud.');return v.trim();}
export function integer(v,min=0,max=100000000){if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,'Cantidad o importe no válido.');return v;}
export function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}
export function openStore(directory){
 const root=resolve(directory);mkdirSync(join(root,'tenants'),{recursive:true});
 const db=new DatabaseSync(join(root,'registry.sqlite'));db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS tenants(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'suspended',expires_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS memberships(user_id TEXT REFERENCES users(id),tenant_id TEXT REFERENCES tenants(id),role TEXT NOT NULL,PRIMARY KEY(user_id,tenant_id));
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS platform_audit(id TEXT PRIMARY KEY,action TEXT NOT NULL,tenant_id TEXT,created_at TEXT NOT NULL);`);
 const cache=new Map();
 function tenant(id){if(!/^[a-f0-9-]{36}$/.test(id)||!db.prepare('SELECT id FROM tenants WHERE id=?').get(id))fail(404,'Empresa no encontrada.');if(cache.has(id))return cache.get(id);
 const t=new DatabaseSync(join(root,'tenants',id+'.sqlite'));t.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL,legal_name TEXT NOT NULL DEFAULT '',document TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',logo TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,price INTEGER NOT NULL CHECK(price>=0),cost INTEGER NOT NULL DEFAULT 0,stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),track_stock INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,image TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS product_revisions(product_id TEXT PRIMARY KEY REFERENCES products(id),version INTEGER NOT NULL DEFAULT 1 CHECK(version>0));
 CREATE TABLE IF NOT EXISTS tables(id TEXT PRIMARY KEY,name TEXT NOT NULL,area TEXT NOT NULL,capacity INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,document_type TEXT NOT NULL,document TEXT NOT NULL,address TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,number INTEGER UNIQUE NOT NULL,table_id TEXT REFERENCES tables(id),customer_id TEXT REFERENCES contacts(id),status TEXT NOT NULL,items TEXT NOT NULL,total INTEGER NOT NULL,discount INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',guests INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1,kitchen TEXT NOT NULL DEFAULT 'draft',created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_table ON orders(table_id) WHERE status='open' AND table_id IS NOT NULL;
 CREATE TABLE IF NOT EXISTS shifts(id TEXT PRIMARY KEY,status TEXT NOT NULL,opening INTEGER NOT NULL,expected INTEGER,counted INTEGER,difference INTEGER,opened_by TEXT NOT NULL,opened_at TEXT NOT NULL,closed_at TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts(status) WHERE status='open';
 CREATE TABLE IF NOT EXISTS sales(id TEXT PRIMARY KEY,number INTEGER UNIQUE NOT NULL,order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),shift_id TEXT NOT NULL REFERENCES shifts(id),total INTEGER NOT NULL,tip INTEGER NOT NULL,payments TEXT NOT NULL,status TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,void_reason TEXT);
 CREATE TABLE IF NOT EXISTS movements(id TEXT PRIMARY KEY,shift_id TEXT REFERENCES shifts(id),amount INTEGER NOT NULL,reason TEXT NOT NULL,source TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS purchases(id TEXT PRIMARY KEY,supplier_id TEXT REFERENCES contacts(id),product_id TEXT NOT NULL REFERENCES products(id),quantity INTEGER NOT NULL,total INTEGER NOT NULL,reference TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT,detail TEXT NOT NULL,created_at TEXT NOT NULL);`);
 t.prepare('INSERT OR IGNORE INTO settings(id,name) VALUES(1,?)').run(db.prepare('SELECT name FROM tenants WHERE id=?').get(id).name);cache.set(id,t);return t;}
 function createUser(email,name,password){email=text(email,180).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Correo no válido.');if(typeof password!=='string'||password.length<12||password.length>200)fail(400,'La contraseña debe tener entre 12 y 200 caracteres.');const id=uid();db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id,email,text(name),hashPassword(password));return id;}
 function createTenant(slug,name,expiresAt,status='active'){if(typeof slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>60)fail(400,'Identificador de empresa no válido.');if(!['active','suspended'].includes(status)||!Number.isFinite(Date.parse(expiresAt)))fail(400,'Estado o fecha de suscripción no válidos.');const id=uid();db.prepare('INSERT INTO tenants VALUES(?,?,?,?,?)').run(id,slug,text(name),status,new Date(expiresAt).toISOString());tenant(id);return id;}
 return {root,db,tenant,createUser,createTenant,close(){for(const d of cache.values())d.close();db.close();}};
}
export function audit(db,user,action,id,detail=''){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(uid(),user,action,id,text(detail,2000,false),now());}
export const permissions={admin:['read','orders','checkout','products','tables','contacts','purchases','cash','reports','settings','users','kitchen','void'],cajero:['read','orders','checkout','contacts','cash','reports'],mesero:['read','orders','contacts'],cocina:['read','kitchen'],almacen:['read','products','purchases','contacts']};
