# Raven POS · Sistema independiente

La adaptación para Cloudflare Workers y bases SQLite independientes por empresa está preparada y probada. La guía de publicación, migración y copias está en [cloud/README.md](cloud/README.md). La publicación real requiere autorizar la cuenta de alojamiento; el desarrollo local sigue disponible.

Aplicación web local para evaluar la operación de un POS con la identidad de Raven. Conserva su propio servidor, acceso, archivos y bases de datos. La web comercial ya utiliza este cliente para el acceso local y la demostración; **el backend operativo y sus bases todavía no están hospedados en Internet**.

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

## Integración con la web comercial

Mantén `npm start` ejecutándose en esta carpeta. En otra consola, abre `C:\Users\Harrison ML\Downloads\Reven pos`, ejecuta `npm run build` y después `npm start`. Entra en `http://127.0.0.1:4173/acceso/` con las credenciales existentes del POS. La web sirve el cliente público y reenvía `/pos/api/` a `/api/` del servidor local en 4180, conservando cookie y CSRF; el proxy valida el origen de la web antes de enviar el origen esperado por el backend. No necesitas cambiar el `PUBLIC_ORIGIN` predeterminado del POS para este proxy.

El build comercial ejecuta `scripts/sync-pos.mjs` para actualizar `public/pos/` con esta interfaz, estilos y recursos públicos. No copia `.data`, usuarios, sesiones, contraseñas ni código del servidor. La ruta de acceso usa la autenticación y los controles de suscripción reales, sin registro público automático.

La demostración `?demo=1` reutiliza las mismas pantallas con `public/demo-api.js`: datos ficticios en memoria por instancia de la pestaña, sin credenciales ni peticiones a la API. Recargar o «Reiniciar demostración» elimina esos cambios. El flujo simula apertura de caja, pedidos, stock, cocina, pagos y reportes; no modifica la instalación operativa.

Sites publica actualmente solo la web estática y la demo. Allí el acceso informa que el servidor está pendiente de conexión. Para ofrecer el POS por Internet todavía falta alojar su backend y almacenamiento persistente; después se podrá configurar una URL HTTPS en `loginUrl` de la web comercial. Esa configuración no sustituye la autorización del servidor.

## Flujo disponible

1. Iniciar sesión y elegir una empresa autorizada.
2. Abrir caja con el fondo inicial.
3. Elegir una mesa o crear un pedido de mostrador; añadir productos y cantidades.
4. Guardar el pedido y enviarlo a cocina cuando corresponda.
5. Actualizar la comanda por los estados recibido, preparando, listo y entregado.
6. Registrar el pago recibido, incluido pago dividido y vuelto de efectivo. El total se valida en el servidor.
7. Consultar o imprimir el ticket interno. El cobro libera la mesa y registra el efectivo en caja; las existencias ya se descontaron al guardar el pedido.
8. Registrar entradas y salidas manuales y cerrar caja con el efectivo contado.

También se incluyen catálogo, control básico de existencias, recepción de compras, clientes y proveedores, cotizaciones convertibles a pedidos, resumen de ventas, exportación CSV, creación de integrantes, auditoría e identidad del negocio. El nombre y el logo se configuran por empresa; admite PNG, JPEG o WebP de hasta 2 MB.

Los pedidos controlan su versión para detectar cambios hechos desde otro equipo. Una mesa tiene como máximo un pedido abierto. El servidor calcula los precios, verifica y descuenta el stock al guardar el pedido y rechaza un segundo cobro del mismo pedido. La anulación conserva el historial y repone existencias; en esta versión solo se permite si la caja original sigue abierta.

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
- La creación inicial de empresas y la renovación se realizan en la CLI. El acceso comercial local está integrado; no hay cobro de suscripciones ni alta pública automática.

## Hosting gratuito y publicación posterior

Actualmente puedes probarlo sin coste de hosting en tu equipo. Para ofrecerlo por Internet se necesita un alojamiento persistente compatible con este backend.

La elección de una opción gratuita queda para la siguiente etapa: debe comprobarse su compatibilidad con Node y SQLite, la persistencia de los datos y sus límites vigentes. Un servicio que publique solo archivos estáticos no ejecutará este backend. Cualquier cambio de plataforma debe conservar la separación entre empresas, las copias y los controles de suscripción.

## Movimiento y compatibilidad de navegador

`public/motion.js` utiliza la misma clave `raven-motion` y las mismas opciones de la web comercial: Automático (`auto`), Animaciones completas (`full`) y Reducidas (`reduced`). El control está en la pantalla de acceso y en la barra superior del espacio de trabajo. Automático sigue la preferencia del equipo; si esta reduce el movimiento, se ofrece la opción de activar las animaciones. Una selección explícita de animaciones completas se conserva aunque el equipo solicite reducirlas. Si el almacenamiento está bloqueado, la elección sigue funcionando durante la visita.

Las demostraciones incrustadas reciben los cambios de movimiento desde la página comercial sin modificar datos de empresas ni las reglas de acceso. Las cintas, entradas y respuestas de los controles utilizan la preferencia efectiva; reducir movimiento conserva el contenido y la navegación. Al exportar el cliente a la web, el build versiona sus referencias JS/CSS y fuentes para evitar archivos antiguos de caché.

Se comprobó el funcionamiento en Brave 154, Edge 151, Chrome for Testing 151 y Firefox 153. La comparación visual de Control y Planes en la web confirmó el desenfoque en Firefox y Brave, con las capas decorativas excluidas del árbol accesible. Esta corrección modifica la presentación y sus preferencias, sin cambios en el backend.

## Verificación

La actualización visual de noviembre conserva la identidad de Raven (naranja, ambos temas, cristal con reflejos) y organiza el módulo Ventas según el recorrido observado en la sesión de referencia de SUSII: Mesas, Ventas, Comprobantes y Cotizaciones. El pedido tiene dos columnas, notas por producto y cocina, catálogo en lista/cuadrícula, pagos divididos y cálculo visible de pendientes/vuelto. No implica equivalencia de todas las funciones de SUSII.

Se completaron **44 pruebas: 38 de backend y 6 de la demo en memoria**. Las nuevas pruebas de acceso comprueban cuentas inválidas, ausencia de alta pública, revocación de pertenencia, suspensión/vencimiento con una sesión ya iniciada y recuperación manual con cierre de sesiones anteriores. Las pruebas de demo comprueban su aislamiento y las reglas de caja, stock y pago simulados.

```powershell
npm test
```

Las pruebas de integración crean bases desechables en un directorio temporal y comprueban autenticación, permisos, acceso cruzado, cálculos, concurrencia de pedidos, cobros, stock, caja, marca y vigencia de la suscripción. No se ejecutan contra `.data` ni certifican seguridad o aptitud de producción.

Los scripts operativos se comprobaron también en datos temporales: creación, activación y suspensión; restablecimiento con revocación de sesiones; vencimiento relativo del setup; rechazo de altas incompletas; copia SQLite verificada. La revisión visual de la interfaz se realiza por separado.

## Recursos

La marca utiliza el cuervo aportado por el propietario. Manrope, Space Grotesk e IBM Plex Mono se sirven localmente con sus licencias OFL en `public/assets/`. `public/refinement.css` unifica tamaños, tipografía y contraste entre claro y oscuro. Las fotografías de productos se heredaron de la web comercial como recursos ilustrativos; no representan inventario o productos reales de un negocio. Esta aplicación no utiliza el logotipo ni los recursos de marca de SUSII.

## Reglas de caja, responsabilidad y stock

- El servidor exige caja abierta para crear, editar o cancelar pedidos y cotizaciones. La configuración inicial y el catálogo se pueden preparar antes de abrir caja.
- El primer usuario que guarda el pedido de una mesa conserva su responsabilidad. Otro mesero puede consultarlo pero no modificarlo ni cancelarlo. Cajero y administrador pueden editar cualquier pedido, sin reasignar silenciosamente su creador.
- Guardar un pedido abierto descuenta las unidades controladas. Editar aplica solo las diferencias; quitar productos, reducir cantidades o cancelar devuelve unidades. Cobrar no descuenta dos veces; anular devuelve el stock una sola vez.
- Las cotizaciones no reservan stock; convertirlas en pedido sí lo hace. Los pedidos abiertos anteriores a esta actualización reservan al siguiente guardado o cobro. La migración no altera automáticamente los saldos existentes.
- Los permisos y el stock se validan en transacciones del servidor. La interfaz informa responsable y consulta los cambios de otras sesiones cada tres segundos mientras está visible, sin reemplazar cambios sin guardar. Una edición que quedó obsoleta necesita actualizarse antes de guardarse.
- `public/daylight.css` y `public/order-rules.css` añaden el modo claro crema/ámbar, cristal y cintas de luz originales inspiradas en las referencias. Los movimientos siguen la preferencia efectiva del control Movimiento descrito arriba.

Los datos operativos siguen en este servidor independiente aunque la interfaz se abra desde la web comercial. Las comprobaciones automáticas no certifican seguridad ni aptitud de producción; la revisión visual y las pruebas del alojamiento elegido se realizan por separado.
