# Módulo analítico MySQL de Raven POS

Complemento local del POS SQLite publicado; no reemplaza la base operativa.

1. Conectarse con MySQL Workbench a una instancia administrativa autorizada.
2. Ejecutar `mysql/esquema.sql` (MySQL 8.4 o posterior; comprobado en 9.4.0).
3. Exportar mediante `node scripts/backup-daily.mjs` con credencial operadora privada.
4. Convertir: `node mysql/importar-snapshot.mjs copia.json carga.private.sql`.
5. Ejecutar la carga en el esquema analítico y consultar mediante `CALL consultar_ventas_periodo(...)`.
6. Ejecutar `mysql/verificar.sql` para la prueba sintética positiva (revierte los registros de prueba).

La carga excluye cuentas y secretos, pero contiene datos comerciales: no debe publicarse. La información no se actualiza en tiempo real ni se propaga hacia el POS. No se debe ofrecer el esquema directamente a usuarios finales; el filtro de empresa no reemplaza la autorización.

El código implementa la vista `vista_ventas_diarias`, el procedimiento `consultar_ventas_periodo` y el disparador `validar_producto_importado`. Las pruebas negativas verifican SQLSTATE 45000 para un stock negativo y un intervalo invertido. El respaldo diario es una tarea del equipo operador, no un trabajo programado en Cloudflare.
