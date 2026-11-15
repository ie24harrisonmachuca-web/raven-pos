import {json,failure,secureResponse} from './http.mjs';
export {AccountRegistry} from './registry.mjs';
export {TenantDatabase} from './tenant.mjs';
export default {
  async fetch(request,env) {
    const url=new URL(request.url);let response;
    try {
      if(url.pathname==='/cloud-config.js')response=new Response('window.ravenWebsiteUrl='+JSON.stringify(env.WEBSITE_URL||'/')+';',{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
      else if(url.pathname==='/api/health')response=json({ok:true,service:'raven-pos',storage:'durable-sqlite'});
      else if(url.pathname.startsWith('/api/')) {
        if(!['GET','POST'].includes(request.method))response=json({error:'Método no permitido.'},405);
        else if(request.method==='POST'&&url.pathname!=='/api/platform'&&request.headers.get('Origin')!==url.origin)response=json({error:'Origen de la solicitud no permitido.'},403);
        else response=await env.REGISTRY.getByName('accounts').fetch(request);
      }else if(['GET','HEAD'].includes(request.method)) {
        if(url.pathname==='/acceso/'||url.pathname==='/acceso')response=Response.redirect(new URL('/'+url.search,url).href,302);
        else response=await env.ASSETS.fetch(request);
      }else response=json({error:'Método no permitido.'},405);
    }catch(error){response=failure(error);}
    return secureResponse(response,url);
  },
};
