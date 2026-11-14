# Configuración de desembolsos de IstmiYa

## Alcance

- El desembolso automático usa las ganancias de repartidores registradas en `driver_wallet_entries` y retiros de `driver_withdrawals`.
- La billetera de negocio actual representa prepago de comisiones; no se debita ni se trata como saldo de ventas para retirar.
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

1. Aplica migraciones `0013`, `0014` y `0015` en orden. `0015` usa `pgcrypto`, `pg_cron`, `pg_net` y Supabase Vault.
2. Configura los secretos. No habilites producción antes de probar el sandbox y el webhook.
3. Despliega `payout-banks`, `process-payouts` y `wompi-payouts-webhook`.
4. Registra el webhook público `https://<proyecto>.supabase.co/functions/v1/wompi-payouts-webhook` en Wompi, en sandbox y/o producción según el ambiente.
5. Verifica en `cron.job` el trabajo `istmiya-daily-payouts-3am-bogota`: está programado para las 08:00 UTC, equivalentes a las 03:00 de Bogotá.
6. Ejecuta retiros de prueba en sandbox y comprueba evento, monto, referencia e idempotencia antes de procesar dinero real. La referencia idempotente vence a las 24 horas; si Wompi no entrega un estado final o hay un error incierto, el retiro queda para conciliación y no se reenvía automáticamente para evitar un pago duplicado.

La pantalla de Finanzas es de consulta: los retiros pasan al histórico cuando la transacción individual llega como `APPROVED` al webhook firmado. Un estado final de lote (`TOTAL_PAYMENT` o `PARTIAL_PAYMENT`) no basta para marcar una transacción individual como pagada. Configura Wompi para emitir `transaction.updated` además de los eventos del lote. El webhook puede conciliar la transacción mediante la referencia o, si el evento no la incluye, mediante el ID del lote guardado.

La migración necesita aplicarse y validarse en el proyecto Supabase real. El sistema prepara y envía el lote diario a Wompi a las 03:00 de Bogotá, sujeto a fondos, habilitación y ciclos bancarios; no equivale a garantizar la acreditación exactamente a esa hora. No habilites producción hasta configurar y verificar credenciales, cuenta de origen, Vault, firma del webhook y aprobaciones requeridas por Wompi. La API necesita Pagos a Terceros activado por Wompi y exige la llave API y el ID de usuario principal; revisa [la guía oficial de Pagos a Terceros](https://docs.wompi.co/docs/colombia/introduccion-pagos-a-terceros/) y [sus eventos](https://docs.wompi.co/docs/colombia/eventos-pagos-a-terceros/).
