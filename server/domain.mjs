import {randomUUID,randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
export const uid=()=>randomUUID();
export const now=()=>new Date().toISOString();
export const digest=s=>createHash('sha256').update(s).digest('hex');
export function hashPassword(password){const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');}
let dummy;
export function verifyPassword(password,hash){hash??=(dummy??=hashPassword("not-a-real-account-password"));const [salt,key]=hash.split(':');const expected=Buffer.from(key||'','hex');const actual=scryptSync(password,salt,64);return expected.length===actual.length&&timingSafeEqual(actual,expected);}
export function fail(status,message){throw Object.assign(new Error(message),{status});}
export function text(v,max=150,required=true){if(typeof v!=='string'||v.trim().length>max||(required&&!v.trim()))fail(400,'Revisa los campos obligatorios y su longitud.');return v.trim();}
export function integer(v,min=0,max=100000000){if(!Number.isSafeInteger(v)||v<min||v>max)fail(400,'Cantidad o importe no válido.');return v;}
export function transaction(db,fn){if(db.transactionSync)return db.transactionSync(fn);db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}
export function audit(db,user,action,id,detail=''){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?)').run(uid(),user,action,id,text(detail,2000,false),now());}
export const permissions={admin:['read','orders','checkout','products','tables','contacts','purchases','cash','reports','settings','users','kitchen','void'],cajero:['read','orders','checkout','contacts','cash','reports'],mesero:['read','orders','contacts'],cocina:['read','kitchen'],almacen:['read','products','purchases','contacts']};
