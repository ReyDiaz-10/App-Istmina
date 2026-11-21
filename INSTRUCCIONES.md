# Instrucciones de IstmiYa

Guía para preparar el entorno local, configurar Supabase y Wompi, generar perfiles de prueba y desplegar la versión web.

> **Importante:** no compartas ni subas llaves privadas, contraseñas ni archivos `.env`. Los pasos para pagos y pedidos requieren un proyecto de Supabase configurado y las migraciones/funciones desplegadas.

## 1. Requisitos

- Node.js 20 o superior y npm.
- Un proyecto Supabase.
- Supabase CLI para aplicar migraciones y desplegar Edge Functions.
- Cuenta LiveKit para habilitar llamadas de voz; Expo Go no admite la integración nativa.
- Una cuenta Wompi y credenciales del ambiente de pruebas antes de habilitar pagos.

## 2. Variables de entorno de la aplicación

Crea `app/.env` con las variables públicas que utiliza la app:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=TU_CLAVE_ANON
```

La clave `anon` está diseñada para el cliente y debe protegerse mediante las políticas RLS de la base de datos. **Nunca** incluyas `SUPABASE_SERVICE_ROLE_KEY`, una llave privada de Wompi o el secreto del webhook en este archivo.

## 3. Ejecutar localmente

En Windows PowerShell:

```powershell
Set-Location 'D:\App-Istmina\app'
npm.cmd ci --legacy-peer-deps
npm.cmd run web
```

Expo mostrará la dirección local de la aplicación. Para ejecutar otras plataformas:

```powershell
npm.cmd run android
npm.cmd run ios
```

Android/iOS requieren los emuladores o herramientas de desarrollo correspondientes.

Para generar manualmente una exportación web estática:

```powershell
Set-Location 'D:\App-Istmina\app'
npx.cmd expo export --platform web
```

Expo escribe el resultado en `app/dist`.

## 4. Aplicar cambios de Supabase

Desde la raíz del repositorio, vincula el proyecto y publica las migraciones:

```powershell
Set-Location 'D:\App-Istmina'
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

Revisa el estado de la base antes de aplicar cambios. Las migraciones en `supabase/migrations/` definen los roles, estados, permisos, billetera, suscripciones, operaciones de pedidos, bandeja de soporte, perfiles pendientes de verificación y moderación del chat. `0006_role_onboarding_and_verification.sql` crea los datos asociados al registro y protege la aprobación; `0007_chat_moderation.sql` exige consentimiento para compartir números y agrega métricas del negocio; `0010_public_verified_business_lookup.sql` permite listar negocios aprobados sin conceder acceso público a los datos legales de verificación; `0011_customer_profile_username.sql` conserva el nombre de usuario legado; `0012_customer_profile_nickname.sql` agrega el apodo independiente que se usa en el saludo de bienvenida. Las migraciones anteriores a `0025` conservan referencias históricas a roles heredados; `0025_unify_user_roles.sql` las normaliza y deja como roles vigentes `cliente`, `negocio`, `repartidor` y `admin`. `0028_add_undelivered_order_status.sql` agrega el estado `no_entregado`; `0029_delivery_incidents_etas_and_participant_blocks.sql` agrega el registro y resolución de incidencias, los tiempos estimados reales y los bloqueos cliente-repartidor. Aplica estas migraciones en orden, primero en un proyecto Supabase desechable, y despliega la versión actualizada de `cancel-order`. No edites ni reapliques migraciones registradas en un entorno compartido y no ejecutes una migración manualmente en producción sin revisar su impacto y contar con respaldo.

La migración inicial declara cada tipo una sola vez para permitir crear un sandbox vacío. No vuelvas a editar ni reaplicar migraciones que ya estén registradas en un entorno compartido o de producción. Las migraciones `0013`–`0019` agregan tarifas, administración, pagos a repartidores y auditoría de pedidos bloqueados, y enlazan el usuario administrador existente con el rol interno `admin`. Las migraciones `0020`–`0022` agregan estados de entrega, dirección y cancelaciones con reembolsos, enlaces de pago idempotentes y liquidaciones semanales de ventas a comercios. La `0023_catalog_delivery_reconciliation.sql` agrega inventario, variantes/extras, número de pedido único, códigos de recogida/entrega, memoria privada del domicilio, conciliación administrativa, expiración de pedidos impagos y límite de intentos de verificación. La `0024_fix_payout_cron_http_schema.sql` corrige la llamada del cron de liquidaciones a la extensión `pg_net`. La `0025_unify_user_roles.sql` migra los perfiles y las reglas administrativas heredadas al conjunto final de cuatro roles. La `0026`–`0029` agregan horarios, cancelación por negocio, inventario diferido, incidencias de entrega, ETA por rol y bloqueos cliente-repartidor. La `0030_delivery_order_feedback.sql` agrega comentarios y calificaciones ligados a pedidos entregados, impide duplicados por autor/categoría, deja las quejas privadas para quien las escribió y administración, limita la bandeja del repartidor a elogios y sugerencias, exige respuestas predefinidas y restringe su lectura y escritura del chat después del cierre. La `0031_business_wallet_transfers_driver_withdrawal_exceptions_and_pickup.sql` añade propuestas de transferencias internas entre negocios, excepciones de retiro, pickup y pausa por demanda; **esta migración sigue en revisión y no debe aplicarse en producción ni en proyectos compartidos**. No consideres validada ninguna migración sin probarla en un proyecto desechable.

La 0031 aún no ha sido aplicada ni validada en PostgreSQL/Supabase. No se dispone aquí de un proyecto desechable confirmado, así que no configures credenciales, no ejecutes la suite financiera y no hagas `db push`. Primero crea un proyecto separado con datos y usuarios exclusivamente sintéticos, confirma que puede borrarse sin impacto, conecta explícitamente la CLI a ese proyecto y aplica allí las migraciones en orden. Verifica sintaxis, funciones, grants, RLS, triggers, estados y pruebas antes de actualizar la guía como validada. Nunca reutilices `.env.local`, credenciales de producción o un proyecto cuyo carácter descartable no esté confirmado.

Validación local de esta revisión: `npm.cmd test` pasó (11 pruebas; la suite financiera opt-in quedó omitida) y `npm.cmd run build:web` terminó correctamente. El lint dirigido de las pantallas, servicios y pruebas de transferencias, payout y pickup pasó. `npm.cmd run lint` global sigue fallando (28 errores y 1 warning) en otros archivos del workspace, incluidos imports Expo no resueltos bajo `src/a_p_p` y diagnósticos existentes en pantallas y componentes auxiliares. No se ejecutó SQL, no se aplicó 0031, no se ejecutó la suite financiera y no se validó ningún flujo real de Wompi.

### Permisos de la tabla de referencias PostGIS

En Supabase local, `public.spatial_ref_sys` pertenece a `supabase_admin`, no al rol `postgres` usado por `supabase db query`. Por eso una migración ejecutada como `postgres` no puede revocar sus permisos y puede terminar sin cambiar el ACL. Para limitar la escritura, ejecuta el SQL siguiente con el propietario de la tabla o un rol administrador que sí pueda modificar sus permisos; conserva `SELECT` para que PostGIS pueda consultar las referencias:

```sql
REVOKE ALL PRIVILEGES ON TABLE public.spatial_ref_sys FROM anon, authenticated;
GRANT SELECT ON TABLE public.spatial_ref_sys TO anon, authenticated;
```

No habilites RLS en esta tabla sin una política de lectura explícita. Verifica los permisos efectivos antes de considerar resuelto el hallazgo; la migración normal de la app no puede efectuar este cambio cuando el usuario de conexión no es el propietario.

Después de aplicar `0006` y `0007`, el registro de negocio/repartidor crea su perfil relacionado en el servidor. Los negocios quedan inactivos y los repartidores desconectados hasta la revisión administrativa. Los documentos del repartidor se guardan en buckets privados; la imagen del local se publica para mostrarla en el marketplace. Las migraciones `0018` y `0019` añaden `admin` como rol válido, permiten sus permisos en las políticas existentes y enlazan la cuenta Auth `neildiazusb@gmail.com` con `profiles.role = 'admin'`. Al aplicar `0025`, los perfiles heredados se convierten al rol `admin` y los permisos antiguos se eliminan del esquema activo.

## 5. Configurar y desplegar Wompi

Usa inicialmente las credenciales **Sandbox**. En Supabase, configura los secretos del servidor; reemplaza los valores de ejemplo por los secretos de tu ambiente:

```powershell
Set-Location 'D:\App-Istmina'
supabase secrets set WOMPI_ENVIRONMENT=sandbox WOMPI_PRIVATE_KEY=prv_test_REEMPLAZAR WOMPI_EVENTS_SECRET=REEMPLAZAR
```

Opcionalmente, configura los importes de recarga y suscripción (valores en pesos colombianos):

```powershell
supabase secrets set WOMPI_WALLET_TOPUP_AMOUNT_COP=50000 WOMPI_SUBSCRIPTION_AMOUNT_COP=35000
```

Despliega las funciones:

```powershell
supabase functions deploy create-wompi-payment
supabase functions deploy wompi-webhook --no-verify-jwt
supabase functions deploy cancel-order
```

El webhook desactiva la verificación JWT del gateway porque Wompi no envía un JWT de Supabase; la función valida la firma del evento antes de cambiar datos.

En el panel de Wompi, configura la URL de eventos de **Sandbox**:

```text
https://TU_PROJECT_REF.supabase.co/functions/v1/wompi-webhook
```

La suscripción mensual cuesta **$35.000 COP**; configura `WOMPI_SUBSCRIPTION_AMOUNT_COP=35000` para mantener el cobro alineado con la app. Cada pedido reutiliza su enlace de pago; si la creación de un enlace queda en estado incierto, no se genera otro hasta conciliarlo. El cliente puede cancelar antes del pago o durante los cinco minutos posteriores a la aprobación, siempre que el comercio no haya aceptado. El comercio puede rechazar un pedido pagado que aún no haya aceptado.

La cancelación de un pedido pagado solicita el reembolso total por la API de Wompi. El reembolso es asíncrono: solo `APPROVED` confirma que se devolvió el dinero; `PENDING`, errores y solicitudes inciertas deben conciliarse y no deben reenviarse automáticamente. Habilita los reembolsos en la cuenta Wompi y configura el webhook para recibir `refund.updated`.

Mantén Sandbox y Producción separados. Para pasar a producción, configura las llaves privadas y secreto de eventos de producción, usa `WOMPI_ENVIRONMENT=production` y registra la URL de eventos correspondiente al ambiente productivo. El webhook valida la firma y ambiente del evento antes de actualizar pedidos, pagos, billeteras, suscripciones o reembolsos.

Aplica migraciones solo en un proyecto desechable confirmado mientras se valida esta versión. El pedido a domicilio exige una dirección o indicaciones escritas y ubicación GPS para cotizar; no se exige un campo de barrio. La última dirección e indicaciones quedan guardadas en una tabla privada del perfil y se pueden confirmar o editar en el próximo pedido. El inventario controlado se reserva al crear el pedido. Un pedido pendiente sin pago o intento de pago incierto se cancela automáticamente tras 30 minutos y devuelve las existencias; transacciones pendientes, aprobadas o inciertas conservan la reserva para evitar vender stock comprometido. Los reintentos de pago pueden hacerse durante la ventana de 30 minutos. Un pago aprobado que llegue después de cancelar el pedido genera una solicitud para conciliación y reembolso manual. En el flujo de domicilio, los códigos de seis dígitos validan la recogida con el negocio y la entrega con el cliente; cinco códigos incorrectos bloquean esa verificación por 15 minutos.

Pickup, transferencias internas de billetera y excepciones de retiro requieren la migración 0031 y siguen sin validar. En pickup, el negocio no debe consultar el código antes de que el cliente lo presente; la app debe mostrarlo solo al cliente después del pago y el RPC debe verificarlo en el negocio. La pausa de pedidos solo bloquea órdenes nuevas y se puede revertir; no cambia estados ni cancela órdenes aceptadas. Las transferencias propuestas no descuentan saldo hasta la aceptación del receptor; el débito, crédito y ledger deben ocurrir una sola vez y en la misma transacción. Las excepciones no prueban un desembolso: el payout automático permanece limitado a cuentas bancarias por Wompi y su resultado final depende de un evento verificado o de la conciliación autenticada de la API. No se admiten métodos alternativos ni confirmaciones manuales de pago.

### Incidencias de entrega, tiempos estimados y bloqueos

- Al aceptar un pedido pagado, el negocio registra `T_negocio` en minutos (1-1440). El repartidor puede aceptar mientras el negocio lo prepara; su objetivo visible es `max(5, minutos_restantes - 5)`. El cliente ve el tiempo real restante de preparación más 5 minutos.
- Al iniciar la ruta al cliente, el repartidor registra `T_llegada` en minutos (1-1440). El cliente ve el tiempo restante más 10 minutos. Las columnas `business_prep_minutes` / `business_prep_eta_at` y `driver_arrival_minutes` / `driver_arrival_eta_at` guardan los valores reales; los márgenes solo existen en la presentación y no alteran métricas.
- Tras recoger, el repartidor puede registrar `no_entregado` con un motivo obligatorio. El estado impide usar el código de entrega y no crea liquidación. El repartidor devuelve el pedido al negocio; solo el negocio puede confirmar la devolución. Después puede reasignarlo —se rotan ambos códigos y no se permite que el repartidor de la incidencia vuelva a tomarlo— o cancelarlo mediante `cancel-order` para reutilizar el flujo existente de reembolso y conciliación.
- Cliente y repartidor pueden bloquearse desde un pedido asignado. El bloqueo impide nuevas asignaciones entre ese par y los mensajes directos del chat del pedido. Una asignación que ya estaba en curso puede terminarse; la resolución de una incidencia de entrega no se omite.
- Prueba estos casos únicamente en Sandbox/proyecto descartable. Ejecuta `cd app; npm.cmd test`; para integración financiera configura el entorno descrito en `app/tests/financialFlows.integration.test.mjs` y usa `ISTMIYA_TEST_CONFIRM_DISPOSABLE_SUPABASE=true`. Aplica las migraciones al proyecto de prueba antes de ejecutar; la compilación local no sustituye la validación del esquema, RLS ni la Edge Function.

## 6. Notificaciones de quejas por correo

Las quejas relacionadas con un pedido se notifican al correo que registró el negocio. Configura Resend como secreto de servidor y utiliza un remitente verificado en tu cuenta:

```powershell
Set-Location 'D:\App-Istmina'
supabase secrets set RESEND_API_KEY=re_REEMPLAZAR RESEND_FROM_EMAIL="IstmiYa <notificaciones@TU_DOMINIO_VERIFICADO>" SUPPORT_EMAIL=ecoalertapruebas@gmail.com
supabase functions deploy notify-business-complaint
```

La queja se guarda en Supabase aunque falle el envío; en ese caso, la app informa que el correo no pudo enviarse. No agregues `RESEND_API_KEY` a `app/.env`.

## 7. Llamadas de voz LiveKit

Las llamadas solo están disponibles entre cliente y negocio mientras el pedido está activo. Supabase Realtime transmite las invitaciones y LiveKit transporta el audio. Aplica la migración `0008_livekit_order_calls.sql`, configura las credenciales LiveKit como secretos y despliega la función que emite tokens:

```powershell
Set-Location 'D:\App-Istmina'
supabase secrets set LIVEKIT_URL=wss://TU_SERVIDOR_LIVEKIT LIVEKIT_API_KEY=TU_API_KEY LIVEKIT_API_SECRET=TU_API_SECRET
supabase functions deploy create-livekit-token
```

No agregues estas credenciales al archivo `app/.env`. Para iOS/Android, genera y ejecuta un development build de Expo con el plugin de LiveKit; Expo Go no incluye el módulo WebRTC requerido. En web, abre la llamada desde `localhost` o HTTPS y concede permiso al micrófono. La notificación de llamadas entrantes requiere que el destinatario tenga abierto el chat del pedido.

## 8. Crear cuentas de demostración

El script `app/src/scripts/seed-test-users.mjs` crea cuatro perfiles: cliente, negocio, repartidor y administrador. Genera contraseñas aleatorias y las guarda en `app/.env_test`; no incluye credenciales fijas. El script debe ejecutarse únicamente contra Supabase local o un proyecto dedicado a pruebas, después de aplicar las migraciones. Los perfiles de negocio y repartidor del seed se aprueban automáticamente para que puedan probar sus paneles; no reutilices esa aprobación para cuentas reales.

Para un Supabase local, inicia primero el stack local y ejecuta:

```powershell
Set-Location 'D:\App-Istmina\app'
$env:SUPABASE_URL='http://127.0.0.1:54321'
$env:SUPABASE_SECRET_KEY='CLAVE_SECRET_LOCAL'
$env:SEED_TEST_USERS='true'
node .\src\scripts\seed-test-users.mjs
Get-Content .\.env_test
```

El script rechaza el sembrado remoto de forma predeterminada. **Solo para un proyecto Supabase dedicado a pruebas**, habilítalo explícitamente:

```powershell
$env:SUPABASE_ALLOW_REMOTE_TEST_SEED='true'
node .\src\scripts\seed-test-users.mjs
Remove-Item Env:SUPABASE_ALLOW_REMOTE_TEST_SEED
```

El script restablece la contraseña de las cuentas demo si ya existen. Guarda las credenciales generadas de forma segura; no las envíes al repositorio ni las reutilices en producción.

### Provisionar la cuenta administradora

La cuenta inicial se crea en Supabase Auth mediante un proceso de servidor, nunca desde la app cliente. Configura temporalmente `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_INITIAL_PASSWORD` y `ADMIN_PHONE` en el entorno de PowerShell (preferiblemente desde un gestor de secretos) y ejecuta:

```powershell
Set-Location 'D:\App-Istmina\app'
node .\src\scripts\provision-admin.mjs
```

El correo inicial es `neildiazusb@gmail.com`; el script crea o actualiza el usuario y su perfil `admin` de forma repetible. Si el usuario Auth ya fue creado desde Supabase, aplica las migraciones hasta `0019` para enlazar su perfil. Si no hay teléfono en los metadatos, la migración deja un marcador `PENDIENTE-...`; actualízalo desde Mi perfil al primer ingreso. No guardes la clave service role ni la contraseña en archivos del repositorio. Cambia la contraseña inicial desde el perfil tras iniciar sesión.

## 9. Despliegue en Vercel

La configuración está en `vercel.json`. En el panel de Vercel:

1. Selecciona la raíz del repositorio como **Root Directory**.
2. Configura Node.js 20 o superior.
3. Añade `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` a las variables del proyecto.
4. Despliega. Vercel instalará las dependencias de `app/`, ejecutará la exportación web de Expo y publicará `app/dist`.

La configuración equivalente es:

```text
Install Command:  cd app && npm ci --legacy-peer-deps
Build Command:    cd app && npx expo export --platform web
Output Directory: app/dist
```

El comando `expo export --platform web` sustituye al comando antiguo `expo export:web`, que no es el formato recomendado para los SDK recientes de Expo.

## 10. Probar los flujos

### Validación local

Desde PowerShell, en un entorno Node.js 22:

```powershell
Set-Location 'D:\App-Istmina\app'
npm.cmd test
npm.cmd run lint
npm.cmd run build:web
```

`npm test` ejecuta las pruebas automatizadas unitarias del proyecto, incluidos filtros del marketplace, horarios y cálculos de ETA. El lint depende de ESLint y de que esté disponible la configuración Expo instalada; si falla por versión o herramienta ausente, conserva el error completo y no lo interpretes como una prueba aprobada.

La suite financiera es opt-in y crea pedidos, cambia estados en la base de datos y consume inventario. Ejecútala solo en un proyecto Supabase descartable con un cliente, un comercio con suscripción o saldo, un producto de prueba y dos repartidores aprobados/disponibles. Define estas variables en el entorno temporal de PowerShell (no las guardes en `.env` ni en Git):

- `ISTMIYA_TEST_CONFIRM_DISPOSABLE_SUPABASE=true`
- `ISTMIYA_TEST_SUPABASE_URL`, `ISTMIYA_TEST_SUPABASE_ANON_KEY` y `ISTMIYA_TEST_SUPABASE_SERVICE_ROLE_KEY`
- `ISTMIYA_TEST_CLIENT_EMAIL` / `ISTMIYA_TEST_CLIENT_PASSWORD`
- `ISTMIYA_TEST_BUSINESS_EMAIL` / `ISTMIYA_TEST_BUSINESS_PASSWORD`
- `ISTMIYA_TEST_RECIPIENT_BUSINESS_EMAIL` / `ISTMIYA_TEST_RECIPIENT_BUSINESS_PASSWORD`
- `ISTMIYA_TEST_RECIPIENT_BUSINESS_ID`
- `ISTMIYA_TEST_DRIVER_ONE_EMAIL` / `ISTMIYA_TEST_DRIVER_ONE_PASSWORD`
- `ISTMIYA_TEST_DRIVER_TWO_EMAIL` / `ISTMIYA_TEST_DRIVER_TWO_PASSWORD`
- `ISTMIYA_TEST_BUSINESS_ID`, `ISTMIYA_TEST_PRODUCT_ID`, `ISTMIYA_TEST_LATITUDE` y `ISTMIYA_TEST_LONGITUDE`
- Opcional: `ISTMIYA_TEST_OPTION_IDS` como arreglo JSON de IDs de opciones para probar una variante o extra obligatorios.

Con esas variables cargadas en la misma sesión de PowerShell:

```powershell
Set-Location 'D:\App-Istmina\app'
npm.cmd run test:financial
```

La prueba llama procedimientos de base de datos con eventos simulados: no compra en Wompi ni valida una firma real de webhook. También incluye los flujos recientes de transferencia y pickup, pero requiere que 0031 haya sido revisada y aplicada solo en un Sandbox desechable. El subtest de transferencia restaura saldos y elimina sus registros contables/de propuesta; el de pickup cancela el pedido para liberar stock y elimina su clave idempotente. Los pedidos cancelados y logs de auditoría se conservan. No uses credenciales de un proyecto productivo ni las compartas en la salida de comandos.

### Integración segura en Sandbox

1. Crea un proyecto Supabase desechable o usa el stack local; no conectes cuentas reales ni datos de producción.
2. Aplica las migraciones locales en orden hasta `0030` en el proyecto descartable. Confirma que `create_order_with_delivery_v2`, `driver_verify_order_pickup`, `driver_complete_order_with_code`, `submit_order_feedback`, `respond_to_delivery_feedback` y `admin_financial_exceptions` existen. Verifica también que `order_number` sea único, que RLS oculte `order_verification_secrets` y `customer_delivery_preferences`, y que el repartidor no pueda leer ni escribir mensajes después de cerrar una entrega.
3. Solo después de validar el resto del esquema en un proyecto dedicado que pueda eliminarse, revisa y aplica 0031 allí. Confirma aceptación/rechazo/reintentos concurrentes de transferencias, saldo insuficiente, wallets duplicadas, ledger balanceado, permisos por rol, evidencia privada y resolución de excepciones. En pickup comprueba variantes y extras requeridos, stock, comisión, pago, idempotencia con payload repetido y distinto, rechazo del auto-cierre por cliente, código disponible solo al cliente, cierre del negocio y bloqueo de asignación de repartidor. Comprueba los umbrales de demanda, cero repartidores disponibles, y que pausar impide pedidos nuevos sin afectar los existentes.
4. Configura únicamente llaves Sandbox de Wompi como secretos de Edge Functions, despliega las funciones de pago, cancelación y webhooks, y apunta los webhooks al proyecto de prueba. Confirma la firma y ambiente en los logs de Supabase.
5. Crea usuarios de prueba separados (cliente, comercio, repartidor y administrador), un negocio activo con suscripción o billetera con saldo suficiente, un producto con inventario conocido y una cuenta bancaria de prueba si Sandbox habilita Pagos a Terceros.
6. Ejecuta un pedido de prueba con inventario limitado. Revisa el subtotal y el número consecutivo; selecciona una variante y un extra. Un producto deshabilitado, una opción ajena al producto y una cantidad superior al stock deben ser rechazados. Cancela otro pedido y confirma que el inventario reservado se devuelve una sola vez.
7. Completa pagos aprobados y rechazados desde el checkout Sandbox. Repite el mismo evento firmado para comprobar idempotencia. Prueba un reintento tras rechazo, una cancelación antes y después del pago, un reembolso pendiente y un resultado incierto. Confirma que un caso incierto no se reenvíe automáticamente y que solo `APPROVED` confirme el reembolso. Verifica que un pedido impago se cancele al cumplir 30 minutos, que los pagos pendientes o inciertos conserven el stock y que un rechazo terminal permita expirar y restaurar el inventario.
8. Con dos repartidores disponibles, intenta aceptar el mismo pedido simultáneamente; solo una llamada debe completarse. Verifica que un código de recogida incorrecto no avance el estado y que el correcto sí lo haga. Repite con el código de entrega; tras cinco intentos incorrectos confirma que el código correcto queda bloqueado durante 15 minutos y que el pedido no avanza.
9. Tras entregar por código, prueba las pantallas posentrega: el cliente puede calificar, elogiar, sugerir, quejarse y bloquear al repartidor; el repartidor solo debe ver elogios y sugerencias. Verifica que no se admitan valoraciones duplicadas, que las quejas no sean visibles al repartidor y que solo pueda responder con las opciones cerradas correspondientes. Intenta leer y enviar mensajes de chat como repartidor después del cierre; ambas operaciones deben rechazarse sin afectar los mensajes previos.
10. Revisa el panel administrativo de conciliación con un caso de pago incierto, reembolso pendiente y liquidación fallida. Añade nota y marca revisado; confirma que esto **no** cambie el estado real de Wompi ni reenvíe dinero.
11. Para liquidaciones, configura en el proyecto descartable los secretos de Vault y Edge Functions documentados en [payouts_setup.md](./docs/payouts_setup.md), despliega `payout-banks`, `process-payouts` y `wompi-payouts-webhook`, valida el trabajo cron, y ejecuta la transferencia solo con las opciones Sandbox habilitadas por Wompi.
12. Guarda resultados, referencias y logs sin copiar credenciales. Si Sandbox no permite Pagos a Terceros, solicita su habilitación a Wompi antes de dar por validado ese flujo.

Los pasos que requieren conectividad con Wompi, secretos, un proyecto Supabase configurado y aprobación de Pagos a Terceros no se pueden verificar solo con la compilación local. No marques esas validaciones como hechas hasta completar el ciclo anterior.

1. Abre la app sin iniciar sesión: el inicio de cliente debe estar disponible como invitado.
2. Entra a un negocio, agrega un producto e intenta pagar para probar el paso de autenticación.
3. Inicia sesión con un perfil de demostración.
4. Con Supabase y Wompi configurados, completa un pago Sandbox y confirma que el webhook actualiza el pedido.
5. Comprueba que, tras confirmar el pago, se abra el chat en tiempo real. Prueba enviar un número sin consentimiento y confirma que el servidor pide autorización.
6. Revisa las fotos y datos en la cola de administración; los perfiles reales no deben activarse ni conectarse hasta su aprobación.
7. En el panel del negocio, revisa ventas, pedidos, quejas, comisión de billetera y exención por suscripción.
8. Inicia sesión como repartidor aprobado para probar disponibilidad, aceptación y entrega de un pedido listo.
9. En el panel de administración, revisa métricas, solicitudes de soporte y aprobaciones. Prueba también el enlace de ayuda en cada perfil.
10. Desde el chat del pedido, inicia una llamada de voz y comprueba la invitación, aceptación, permiso del micrófono y finalización en ambos participantes.

## 11. Acerca de la app, soporte y privacidad

Completa `app/src/constants/appInfo.js` con el nombre del creador y los correos oficiales de soporte y privacidad. Sin esos datos, la app muestra que el contacto está pendiente de configuración.

La pantalla de privacidad es un borrador funcional, no un documento aprobado. Antes de publicar, define la identidad y dirección del responsable, finalidades exactas, proveedores y transferencias, plazos de conservación, canal y procedimiento para consultas/reclamos, y versión/fecha de vigencia. Valida el texto con asesoría competente bajo el régimen colombiano de protección de datos. No solicites a usuarios que acepten el borrador como si fuera la política definitiva.

Al lanzar una versión, actualiza `version` en `app/app.json` y `app/package.json`. La pantalla «Acerca de» lee la versión desde `app/app.json`.

Las preferencias locales se guardan con AsyncStorage. El idioma inicial se define en `expo.extra.defaultLanguage` de `app/app.json`; actualmente están disponibles Español (Latinoamérica) y Español (Colombia). La apariencia automática usa modo claro entre las 06:00 y 17:59 y modo oscuro el resto del día; también se puede elegir modo día, noche o seguir el sistema.

La pantalla **Mi perfil** permite editar nombre completo, apodo y teléfono; el apodo aparece en el saludo. Los cambios de correo se solicitan por separado y pueden requerir confirmación desde el nuevo correo, según la configuración de autenticación de Supabase. Aplica todas las migraciones pendientes, incluida `0025`, con `supabase db push` antes de publicar esta versión. Vercel despliega la aplicación, pero no aplica migraciones de Supabase.

Los iconos del marketplace se generan desde `app/scripts/generate-marketplace-icon.ps1`. El script crea recursos nuevos en `app/assets/images`; los iconos Expo anteriores se conservan.

Si un flujo remoto no responde, verifica primero las migraciones aplicadas, las políticas RLS, los secretos de las Edge Functions, el ambiente de Wompi y la URL de eventos.
