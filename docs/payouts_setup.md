# Configuración de desembolsos de IstmiYa

## Alcance

- Los retiros de repartidores usan `driver_wallet_entries` y `driver_withdrawals`.
- Las liquidaciones de comercios se registran aparte en `business_settlement_items` y `business_payouts`. Solo se incorporan ventas con pedido entregado. El valor liquidable es el subtotal de productos: la comisión continúa debitándose de la billetera prepago y no se descuenta otra vez.
- Las liquidaciones de comercios se procesan los lunes a las 03:00 de Bogotá, con mínimo de $50.000 COP por transferencia. El saldo inferior al mínimo permanece disponible para la siguiente semana.
- Cada retiro queda reservado en `payout_transactions`. El lote aceptado queda pendiente y se actualiza con eventos Wompi firmados; un retiro solo se marca pagado al confirmarse la transacción `APPROVED`.
- Se requiere habilitar Pagos a Terceros en Wompi, una cuenta de origen activa y configuración de usuarios/roles de preparación y aprobación. La función diaria crea el lote; la ejecución efectiva depende de la aprobación de Wompi y ciclos bancarios.

## Secretos de Edge Functions

Configura en Supabase Dashboard > Edge Functions > Secrets, o con `supabase secrets set`; no los incluyas en el cliente Expo:

- `WOMPI_PAYOUT_API_KEY`
- `WOMPI_PAYOUT_PRINCIPAL_ID`
- `WOMPI_PAYOUT_ACCOUNT_ID` (id de cuenta de origen activa)
- `WOMPI_PAYOUT_ENV` (`sandbox` para pruebas; `production` para el entorno habilitado)
- `WOMPI_PAYOUT_PAYMENT_TYPE` (`OTHER`, `PAYROLL` o `PROVIDERS`, según el comercio)
- `WOMPI_PAYOUT_EVENT_SECRET` (secreto de firma de eventos de Pagos a Terceros)
- `PAYOUT_CRON_SECRET` (secreto aleatorio largo, compartido solo con Vault)

Agrega en Supabase Vault con estos nombres exactos los secretos usados por Postgres:

- `istmiya_project_url`
- `istmiya_supabase_secret_key` (service role/secret key)
- `istmiya_payout_cron_secret` (mismo valor que `PAYOUT_CRON_SECRET`)
- `istmiya_payout_encryption_key` (frase aleatoria fuerte y estable para cifrar cuentas)

SQL de ejemplo por secreto: `select vault.create_secret('<valor>', '<nombre>');`. No compartas valores. Conserva la clave de cifrado: rotarla exige recifrar datos existentes.

## Despliegue

1. Aplica todas las migraciones pendientes en orden. `0015` usa `pgcrypto`, `pg_cron`, `pg_net` y Supabase Vault; `0022` agrega el ledger de ventas entregadas y liquidaciones semanales; `0023` agrega la conciliación administrativa, la lógica de inventario y códigos de entrega, y programa la expiración de pedidos impagos cada cinco minutos.
2. Configura los secretos. No habilites producción antes de probar el sandbox y el webhook.
3. Despliega `payout-banks`, `process-payouts` y `wompi-payouts-webhook`.
4. Registra el webhook público `https://<proyecto>.supabase.co/functions/v1/wompi-payouts-webhook` en Wompi, en sandbox y/o producción según el ambiente.
5. Verifica en `cron.job` los trabajos `istmiya-daily-payouts-3am-bogota` e `istmiya-expire-unpaid-orders-every-5m`. El primero está programado para las 08:00 UTC, equivalentes a las 03:00 de Bogotá; la función diaria solo reserva liquidaciones de comercios los lunes y los retiros programados de repartidores mantienen su calendario actual. El segundo expira pedidos impagos después de 30 minutos, salvo que haya pagos pendientes, aprobados o inciertos. La pestaña **Liquidaciones** muestra el saldo, la cuenta registrada y el historial de transferencias.
6. Ejecuta retiros de prueba en sandbox y comprueba evento, monto, referencia e idempotencia antes de procesar dinero real. La referencia idempotente vence a las 24 horas; si Wompi no entrega un estado final o hay un error incierto, el retiro queda para conciliación y no se reenvía automáticamente para evitar un pago duplicado.

## Panel administrativo de excepciones

La migración `0023_catalog_delivery_reconciliation.sql` agrega `admin_financial_exceptions()` y `admin_review_financial_exception()`. El panel **Finanzas y retiros** de SuperAdmin lista:

- Enlaces de pago de pedido en estado `reconciliation_required`.
- Reembolsos solicitados, pendientes, inciertos, con error o rechazados.
- Liquidaciones comerciales fallidas/en revisión y procesos que lleven más de 24 horas sin actualización.

El administrador debe consultar la referencia y el estado del recurso directamente en Wompi antes de registrar una nota y marcar el caso revisado. La revisión se audita, pero no cambia importes, no marca como exitoso el pago y no reenvía una transferencia o reembolso. Los estados financieros finales siguen dependiendo del webhook con firma válida. Si una transacción aparece como incierta, no vuelvas a solicitarla hasta comprobar que Wompi no la procesó.

Las ventas, los retiros de repartidores y las liquidaciones de comercios son ledgers diferentes. El panel existente de retiros de repartidores se conserva; las liquidaciones solo pasan a `success` cuando se confirma la transacción individual aprobada, no por el estado final agregado del lote.

La pantalla de Finanzas es de consulta: los retiros pasan al histórico cuando la transacción individual llega como `APPROVED` al webhook firmado. Un estado final de lote (`TOTAL_PAYMENT` o `PARTIAL_PAYMENT`) no basta para marcar una transacción individual como pagada. Configura Wompi para emitir `transaction.updated` además de los eventos del lote. El webhook puede conciliar la transacción mediante la referencia o, si el evento no la incluye, mediante el ID del lote guardado.

La migración necesita aplicarse y validarse en el proyecto Supabase real. El sistema prepara y envía el lote diario a Wompi a las 03:00 de Bogotá, sujeto a fondos, habilitación y ciclos bancarios; no equivale a garantizar la acreditación exactamente a esa hora. No habilites producción hasta configurar y verificar credenciales, cuenta de origen, Vault, firma del webhook y aprobaciones requeridas por Wompi. La API necesita Pagos a Terceros activado por Wompi y exige la llave API y el ID de usuario principal; revisa [la guía oficial de Pagos a Terceros](https://docs.wompi.co/docs/colombia/introduccion-pagos-a-terceros/) y [sus eventos](https://docs.wompi.co/docs/colombia/eventos-pagos-a-terceros/).
