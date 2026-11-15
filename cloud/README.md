# Raven POS en Cloudflare

El Worker sirve el cliente del POS y su API en el mismo origen HTTPS. AccountRegistry conserva cuentas, pertenencias, sesiones y suscripciones en un Durable Object SQLite. TenantDatabase utiliza otro objeto y otra base SQLite por empresa. El código de pedidos, stock, cocina, caja y cobros se comparte con la instalación Node local.

## Estado de preparación

La adaptación compila con Wrangler 4.157.0 y se probó en el runtime real de Workers de desarrollo. Pasaron las 44 pruebas del sistema local y nueve escenarios de integración Cloudflare: autenticación, origen/CSRF, permisos, aislamiento, caja, concurrencia, stock, cobros, anulación, suspensión, copia y cierre de sesiones. La migración de las dos bases locales se ensayó sin modificar el origen; todas las tablas y las cuentas coincidieron. También se verificó el inicio de sesión del navegador con las credenciales existentes.

Publicar requiere autorizar una cuenta propia de Cloudflare. No se publica automáticamente por haber compilado o probado. `.cloud/deployment.json`, cuando exista, registra la URL devuelta por el despliegue y si respondió a la comprobación de salud.

## Publicar y migrar

1. `npx wrangler login` y verificar la cuenta en `npx wrangler whoami`.
2. `node scripts/deploy-cloud.mjs`: publica el Worker y su secreto de administración. No imprime la clave.
3. Detener el POS local y ejecutar `npm run cloud:export` para una copia coordinada. La copia y su manifiesto quedan privados dentro de `.cloud/exports/`.
4. `npm run cloud:import`: carga el registro con las empresas suspendidas, importa cada base y habilita sus estados originales al completar todas. Es reanudable y no sobrescribe otras empresas.
5. Probar el acceso HTTPS y actualizar los enlaces de la web comercial con la URL obtenida. El cliente comercial puede seguir alojado en Netlify; el POS operativo se abre en el origen de Cloudflare y conserva allí su cookie segura.

No se necesita exponer la computadora local ni copiar `.data` a Netlify. El despliegue incluye solo `public/`, los módulos del Worker y sus reglas de negocio. Las copias, credenciales, tokens y archivos SQLite están excluidos de Git y del directorio público.

## Administración y copias

`npm run cloud:admin` recibe un JSON por stdin, con acciones `create`, `activate`, `suspend`, `reset-password`, `list` o `export`. Las altas permanecen suspendidas salvo activación explícita del operador. Solo la clave privada de Raven puede administrar suscripciones; las cuentas de clientes no reciben esa clave. El reinicio de contraseña revoca las sesiones anteriores.

Ejemplo para guardar una copia privada de todas las empresas y las cuentas:

```powershell
@{ action='export' } | ConvertTo-Json | npm run cloud:admin
```

Se guarda en `.cloud/backups/` sin imprimir los hashes de las cuentas. Conserva otra copia cifrada fuera de este equipo. No se ha configurado una copia externa automática. Cloudflare ofrece recuperación por puntos en el tiempo para SQLite Durable Objects; su disponibilidad y retención dependen del plan. Consulta la documentación vigente antes de realizar una restauración.

Las copias excluyen sesiones activas. La importación en un destino vacío requiere volver a iniciar sesión. No se permite sobrescribir un registro operativo con una copia; una restauración debe ensayarse en otro despliegue antes de cambiar el acceso.

## Límites

El plan gratuito tiene cuotas de solicitudes, almacenamiento y operaciones. No equivale a capacidad ilimitada ni garantiza los requisitos de un negocio crítico. No activar facturación ni un plan de pago sin autorización del propietario. En esta adaptación, los logos en línea se limitan a 700 KB para respetar el tamaño de fila del almacenamiento; la interfaz local conserva su límite original.

Fuentes: [SQLite y transacciones](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), [límites](https://developers.cloudflare.com/durable-objects/platform/limits/), [precios](https://developers.cloudflare.com/durable-objects/platform/pricing/).
