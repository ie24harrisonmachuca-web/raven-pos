# Raven POS · Sistema independiente

Aplicación web local para evaluar la operación de un POS con la identidad de Raven. Está separada de la web comercial: tiene su propio servidor, acceso, archivos y bases de datos. La instalación de esta carpeta **no está hospedada en Internet ni conectada al botón de acceso de la web comercial**.

La estructura de trabajo toma como referencia las capturas de SUSII aportadas por el propietario. Esta implementación es propia y todavía no ofrece todas las funciones de ese servicio. Es una versión de evaluación con operaciones persistentes; necesita completar el despliegue, las integraciones y las comprobaciones operativas antes de utilizarse con clientes de pago.

## Iniciar en este equipo

Requiere **Node.js 24.14 o superior**. No hay dependencias npm que instalar: el servidor usa HTTP y SQLite de Node.js. Desde PowerShell, en esta carpeta:

```powershell
npm run setup
npm start
```

Abre [Raven POS local](http://127.0.0.1:4180). Deja la consola abierta; `Ctrl+C` detiene el servidor. Los datos permanecen después de cerrarlo.

También puedes ejecutar el iniciador:

```powershell
pwsh -File .\scripts\Start-Local.ps1
```

Si PowerShell impide ejecutar scripts, utiliza los dos comandos npm anteriores. Para otro puerto: `pwsh -File .\scripts\Start-Local.ps1 -Port 4182`.

`setup` crea, únicamente en una instalación vacía:

- Una cuenta de evaluación `admin@raven.local` con contraseña aleatoria.
- Dos empresas de prueba, Don Teobaldo y Pin Pon, con bases independientes, doce mesas y seis productos cada una.
- Acceso de evaluación durante noventa días desde la creación.
- El archivo privado `.data/ACCESO-LOCAL.txt` con la contraseña y la URL local. La contraseña no se muestra en la consola.

Si ya hay usuarios, `setup` no reemplaza datos ni contraseñas. Los nombres de los negocios y las fotografías sirven para evaluar el sistema; esta instalación no contiene la actividad del POS de SUSII.

## Flujo disponible

1. Iniciar sesión y elegir una empresa autorizada.
2. Abrir caja con el fondo inicial.
3. Elegir una mesa o crear un pedido de mostrador; añadir productos y cantidades.
4. Guardar el pedido y enviarlo a cocina cuando corresponda.
5. Actualizar la comanda por los estados recibido, preparando, listo y entregado.
6. Registrar el pago recibido, incluido pago dividido y vuelto de efectivo. El total se valida en el servidor.
7. Consultar o imprimir el ticket interno. El cobro libera la mesa, descuenta existencias y registra el efectivo en caja.
8. Registrar entradas y salidas manuales y cerrar caja con el efectivo contado.

También se incluyen catálogo, control básico de existencias, recepción de compras, clientes y proveedores, cotizaciones convertibles a pedidos, resumen de ventas, exportación CSV, creación de integrantes, auditoría e identidad del negocio. El nombre y el logo se configuran por empresa; admite PNG, JPEG o WebP de hasta 2 MB.

Los pedidos controlan su versión para detectar cambios hechos desde otro equipo. Una mesa tiene como máximo un pedido abierto. El servidor calcula los precios, verifica el stock al cobrar y rechaza un segundo cobro del mismo pedido. La anulación conserva el historial y repone existencias; en esta versión solo se permite si la caja original sigue abierta.

## Datos independientes por empresa

```text
.data/
  registry.sqlite          Cuentas, pertenencia a empresas, sesiones y suscripciones
  tenants/
    <identificador>.sqlite Productos, mesas, pedidos, ventas y demás datos de una empresa
    <otro-id>.sqlite       Datos de otra empresa
  ACCESO-LOCAL.txt         Credencial inicial de evaluación
```

El servidor verifica en cada petición la cuenta, su pertenencia a la empresa, el rol y la vigencia de la suscripción. El cliente no elige rutas de archivos ni puede activar su propia suscripción. SQLite almacena también archivos auxiliares `-wal` y `-shm` mientras trabaja; no copies solo el archivo principal de una base abierta para hacer una copia manual.

Los nombres de empresa de la interfaz no son el límite de seguridad: los datos operativos están en archivos distintos y la autorización se aplica en el backend. La instalación predeterminada utiliza un administrador de prueba con acceso a las dos empresas para facilitar la comparación; crea cuentas separadas al evaluar la separación entre propietarios.

## Roles

| Rol | Operaciones principales |
| --- | --- |
| Administrador | Configuración de empresa y equipo; catálogo; operación; caja; reportes y anulaciones. |
| Cajero | Pedidos, pagos, contactos, caja y reportes. |
| Mesero | Mesas, pedidos y contactos; sin cobros ni administración del catálogo. |
| Cocina | Consulta y avance de comandas. |
| Almacén | Productos, compras y contactos. |

Los permisos se comprueban en el servidor. Ocultar un botón no sustituye esa comprobación.

## Activación manual después del pago

La administración de suscripciones pertenece al operador de Raven y se realiza mediante `scripts/tenant.mjs`, con acceso local a los archivos del servidor. La CLI recibe un objeto JSON por **stdin**. No publiques esta herramienta como ruta HTTP ni entregues acceso a la carpeta de datos a los clientes.

Crear una empresa suspendida hasta verificar el pago, solicitando la contraseña sin escribirla en el historial de comandos:

```powershell
$secret = Read-Host 'Contraseña inicial (mínimo 12 caracteres)' -AsSecureString
$request = @{
  action = 'create'
  slug = 'restaurante-kilbol'
  name = 'Restaurante Kilbol'
  email = 'propietario@ejemplo.com'
  owner_name = 'Propietario'
  password = [Net.NetworkCredential]::new('', $secret).Password
  active = $false
  expires_at = [DateTime]::UtcNow.AddMonths(1).ToString('o')
}
$request | ConvertTo-Json -Compress | node scripts/tenant.mjs
Remove-Variable request, secret
```

Usa correos y datos reales del propietario cuando hagas el alta. Si el correo ya existe, se vincula esa cuenta a la nueva empresa sin cambiar su contraseña. Por eso esta acción corresponde únicamente al operador de Raven.

Después de verificar el pago, activar o renovar durante un mes:

```powershell
@{
  action = 'activate'
  slug = 'restaurante-kilbol'
  expires_at = [DateTime]::UtcNow.AddMonths(1).ToString('o')
} | ConvertTo-Json -Compress | node scripts/tenant.mjs
```

Suspender el acceso sin borrar la información:

```powershell
@{ action = 'suspend'; slug = 'restaurante-kilbol' } |
  ConvertTo-Json -Compress | node scripts/tenant.mjs
```

El vencimiento se evalúa también en el servidor. Cambiar el reloj o los campos del navegador no renueva el acceso.

## Recuperar una cuenta

La recuperación actual la realiza el operador local, después de verificar la identidad del titular. No hay envío de correos de recuperación.

```powershell
$secret = Read-Host 'Nueva contraseña (mínimo 12 caracteres)' -AsSecureString
$request = @{
  action = 'reset-password'
  email = 'propietario@ejemplo.com'
  password = [Net.NetworkCredential]::new('', $secret).Password
}
$request | ConvertTo-Json -Compress | node scripts/tenant.mjs
Remove-Variable request, secret
```

Este comando cambia el hash de la contraseña y cierra todas las sesiones anteriores de la cuenta, incluidas sus sesiones en otras empresas. No guarda la nueva contraseña en un archivo ni la imprime.

## Copias y restauración

Para una instantánea coordinada de todas las empresas, detén el servidor y ejecuta:

```powershell
npm run backup
```

Cada copia se guarda en una carpeta con fecha dentro de `backups/`. La herramienta usa la API de copia de SQLite, comprueba cada archivo con `PRAGMA quick_check` y escribe `manifest.json` al completar todas las verificaciones. Una carpeta parcial sin manifiesto no es una copia verificada.

Con el servicio abierto, la copia es consistente por archivo, pero los archivos pueden corresponder a instantes distintos. Las copias incluyen datos de negocio y cuentas: mantenlas privadas y guarda otra copia fuera del equipo. El archivo con la contraseña inicial no forma parte de la copia.

Para ensayar una restauración sin reemplazar la instalación actual:

1. Detén el servidor.
2. Copia `registry.sqlite` y la carpeta `tenants` de una copia verificada a **otra carpeta vacía**, por ejemplo `C:\Raven\restore-check`.
3. Indica esa carpeta antes de arrancar:

```powershell
$env:DATA_DIR = 'C:\Raven\restore-check'
npm start
```

4. Comprueba acceso, empresas, pedidos, ventas y saldos. La prueba no debe limitarse a comprobar que los archivos existen.
5. Al volver a la instalación original, detén el servidor y ejecuta `Remove-Item Env:DATA_DIR` antes de arrancarlo otra vez.

No mezcles el registro central de una copia con las bases de otra. No sobrescribas archivos de una instalación que esté funcionando.

## Configuración del servidor

| Variable | Predeterminado | Uso |
| --- | --- | --- |
| `PORT` | `4180` | Puerto HTTP. |
| `HOST` | `127.0.0.1` | Escucha local. Exponer otra dirección requiere configurar un origen HTTPS. |
| `PUBLIC_ORIGIN` | `http://127.0.0.1:<puerto>` | Origen exacto utilizado por los controles de las solicitudes. Incluye esquema y puerto si corresponde. |
| `DATA_DIR` | `.data` junto al proyecto | Directorio persistente con el registro y las bases de empresas. |
| `BACKUP_DIR` | `backups` junto al proyecto | Destino de `npm run backup`. |

El servidor incorpora cookies HttpOnly, SameSite y controles CSRF/origen; las cookies Secure se activan al configurar un origen HTTPS. Para publicar faltan la provisión del alojamiento persistente, el proxy TLS, copias externas programadas, gestión operativa de cuentas y una revisión de seguridad y carga del entorno elegido. No basta con subir `public/`: el POS necesita ejecutar su backend y conservar sus bases.

## Alcance y diferencias con el sistema de referencia

- Los pagos se **registran después de recibirlos**. Elegir tarjeta, Yape, Plin o transferencia no hace un cargo ni confirma una transacción bancaria.
- Solo se emiten tickets y precuentas internos. No hay emisión electrónica de boletas o facturas SUNAT, consulta RUC/DNI, firma digital ni comunicación con PSE/OSE.
- La impresión abre el diálogo del navegador; no hay conexión directa con impresoras de cocina ni controladores de hardware.
- El inventario es por producto y unidades enteras. No hay recetas, insumos fraccionados, lotes, valorización contable ni conciliación bancaria.
- Los pedidos y las comandas se actualizan al consultar el servidor; no hay garantía de trabajo sin conexión ni sincronización entre locales desconectados.
- La vista de ventas y sus resúmenes usan hasta las 500 ventas recientes; compras, movimientos, cierres y auditoría también tienen límites de consulta. No constituyen un libro contable completo ni una exportación fiscal.
- Las cotizaciones se guardan y se convierten a pedidos. Todavía faltan flujos avanzados como división por comensal, devolución después del cierre, edición fiscal y todas las opciones presentes en SUSII.
- La creación inicial de empresas y la renovación se realizan en la CLI. No hay cobro de suscripciones, alta pública automática ni portal comercial integrado.

## Hosting gratuito y publicación posterior

Actualmente puedes probarlo sin coste de hosting en tu equipo. Para ofrecerlo por Internet se necesita un alojamiento persistente compatible con este backend.

Cloudflare ofrece Durable Objects con almacenamiento SQLite en su plan gratuito, sujeto a límites. Ese entorno requiere **adaptar** este backend Node a Workers/Durable Objects; los archivos SQLite locales no se ejecutan allí directamente. Render gratuito utiliza un sistema de archivos efímero, por lo que no conserva de forma adecuada estas bases locales entre reinicios. Antes de elegir una plataforma, verifica sus condiciones y límites vigentes: [Cloudflare](https://developers.cloudflare.com/durable-objects/platform/limits/) · [Render](https://render.com/docs/free).

Cuando el POS tenga alojamiento HTTPS, la web comercial podrá enlazarlo desde su opción de acceso. Esa integración no debe copiar los datos privados del POS al sitio comercial ni eliminar los controles de suscripción y pertenencia a la empresa.

## Verificación

La actualización visual de noviembre conserva la identidad de Raven (naranja, ambos temas, cristal con reflejos) y organiza el módulo Ventas según el recorrido observado en la sesión de referencia de SUSII: Mesas, Ventas, Comprobantes y Cotizaciones. El pedido tiene dos columnas, notas por producto y cocina, catálogo en lista/cuadrícula, pagos divididos y cálculo visible de pendientes/vuelto. No implica equivalencia de todas las funciones de SUSII.

Se completaron 22 pruebas del backend. La revisión de navegador se hizo con bases independientes de evaluación: cobro completo con vuelto y ticket, guardado de observaciones, edición de producto con versión, filtros de ambiente y estado. Las pantallas administrativas se revisaron a 375 y 1440 px en claro/oscuro; se corrigieron los nombres accesibles de filtros y la navegación de tablas con teclado. La auditoría automática posterior no detectó infracciones en las vistas corregidas ni en el formulario móvil de pago. La CSP se omitió únicamente en las respuestas del navegador de pruebas para inyectar axe; el servidor conserva su política.

```powershell
npm test
```

Las pruebas de integración crean bases desechables en un directorio temporal y comprueban autenticación, permisos, acceso cruzado, cálculos, concurrencia de pedidos, cobros, stock, caja, marca y vigencia de la suscripción. No se ejecutan contra `.data` ni certifican seguridad o aptitud de producción.

Los scripts operativos se comprobaron también en datos temporales: creación, activación y suspensión; restablecimiento con revocación de sesiones; vencimiento relativo del setup; rechazo de altas incompletas; copia SQLite verificada. La revisión visual de la interfaz se realiza por separado.

## Recursos

La marca utiliza el cuervo aportado por el propietario. Manrope se sirve localmente; su licencia está en `public/assets/Manrope-OFL.txt`. Las fotografías de productos se heredaron de la web comercial como recursos ilustrativos; no representan inventario o productos reales de un negocio. Esta aplicación no utiliza el logotipo ni los recursos de marca de SUSII.
