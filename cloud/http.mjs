import {fail} from '../server/domain.mjs';
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
export function failure(error) { return json({ error: error.status ? error.message : 'No se pudo completar la operación. Actualiza la vista antes de reintentar.' }, error.status || 500); }
export async function readBody(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Se requiere JSON.');
  const reader = request.body?.getReader(); let size = 0; const chunks = [];
  if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 3000000) { await reader.cancel(); fail(413, 'El formulario supera el tamaño permitido.'); } chunks.push(value); }
  const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  let value; try { value = JSON.parse(new TextDecoder().decode(data) || '{}'); } catch { fail(400, 'JSON no válido.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Formulario no válido.');
  return value;
}
export function secureResponse(response, url) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY'); headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, headers });
}
