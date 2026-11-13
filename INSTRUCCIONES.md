# Instrucciones de IstmiYa

Guía para preparar el entorno local, configurar Supabase y Wompi, generar perfiles de prueba y desplegar la versión web.

> **Importante:** no compartas ni subas llaves privadas, contraseñas ni archivos `.env`. Los pasos para pagos y pedidos requieren un proyecto de Supabase configurado y las migraciones/funciones desplegadas.

## 1. Requisitos

- Node.js 20 o superior y npm.
- Un proyecto Supabase.
- Supabase CLI para aplicar migraciones y desplegar Edge Functions.
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

Revisa el estado de la base antes de aplicar cambios. Las migraciones en `supabase/migrations/` definen los roles, estados, permisos, billetera, suscripciones, operaciones de pedidos y la bandeja de soporte. La migración `0004_support_and_admin_dashboard.sql` añade tickets con RLS y una función agregada reservada a SuperAdmin. No ejecutes una migración manualmente en producción sin revisar primero su impacto y contar con respaldo.

> **Atención al esquema inicial:** `0001_initial_schema.sql` declara el tipo `user_role` dos veces. Si vas a inicializar una base vacía, revisa y corrige esa duplicación antes de ejecutar `supabase db push`; no edites una migración que ya se haya aplicado en un entorno compartido o de producción.

## 5. Configurar y desplegar Wompi

Usa inicialmente las credenciales **Sandbox**. En Supabase, configura los secretos del servidor; reemplaza los valores de ejemplo por los secretos de tu ambiente:

```powershell
Set-Location 'D:\App-Istmina'
supabase secrets set WOMPI_ENVIRONMENT=sandbox WOMPI_PRIVATE_KEY=prv_test_REEMPLAZAR WOMPI_EVENTS_SECRET=REEMPLAZAR
```

Opcionalmente, configura los importes de recarga y suscripción (valores en pesos colombianos):

```powershell
supabase secrets set WOMPI_WALLET_TOPUP_AMOUNT_COP=50000 WOMPI_SUBSCRIPTION_AMOUNT_COP=30000
```

Despliega las funciones:

```powershell
supabase functions deploy create-wompi-payment
supabase functions deploy wompi-webhook --no-verify-jwt
```

En el panel de Wompi, configura la URL de eventos de **Sandbox**:

```text
https://TU_PROJECT_REF.supabase.co/functions/v1/wompi-webhook
```

Mantén Sandbox y Producción separados. Para pasar a producción, configura las llaves privadas y secreto de eventos de producción, usa `WOMPI_ENVIRONMENT=production` y registra la URL de eventos correspondiente al ambiente productivo. El webhook valida la firma y ambiente del evento antes de actualizar la orden, billetera o suscripción.

## 6. Crear cuentas de demostración

El script `app/src/scripts/seed-test-users.mjs` crea cuatro perfiles: cliente, negocio, repartidor y SuperAdmin. Genera contraseñas aleatorias y las guarda en `app/.env_test`; no incluye credenciales fijas.

Para un Supabase local, inicia primero el stack local y ejecuta:

```powershell
Set-Location 'D:\App-Istmina\app'
$env:SUPABASE_URL='http://127.0.0.1:54321'
$env:SUPABASE_SERVICE_ROLE_KEY='CLAVE_SERVICE_ROLE_LOCAL'
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

## 7. Despliegue en Vercel

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

## 8. Probar los flujos

1. Abre la app sin iniciar sesión: el inicio de cliente debe estar disponible como invitado.
2. Entra a un negocio, agrega un producto e intenta pagar para probar el paso de autenticación.
3. Inicia sesión con un perfil de demostración.
4. Con Supabase y Wompi configurados, completa un pago Sandbox y confirma que el webhook actualiza el pedido.
5. Comprueba el chat en tiempo real, el cambio de estados, y en el panel del negocio la comisión de billetera o la exención por suscripción.
6. Inicia sesión como repartidor y prueba disponibilidad, aceptación y entrega de un pedido listo.
7. Inicia sesión con una cuenta SuperAdmin creada por un proceso de servidor y revisa métricas y solicitudes de soporte. Prueba también el enlace de ayuda en cada perfil.

## 9. Acerca de la app, soporte y privacidad

Completa `app/src/constants/appInfo.js` con el nombre del creador y los correos oficiales de soporte y privacidad. Sin esos datos, la app muestra que el contacto está pendiente de configuración.

La pantalla de privacidad es un borrador funcional, no un documento aprobado. Antes de publicar, define la identidad y dirección del responsable, finalidades exactas, proveedores y transferencias, plazos de conservación, canal y procedimiento para consultas/reclamos, y versión/fecha de vigencia. Valida el texto con asesoría competente bajo el régimen colombiano de protección de datos. No solicites a usuarios que acepten el borrador como si fuera la política definitiva.

Al lanzar una versión, actualiza `version` en `app/app.json` y `app/package.json`. La pantalla «Acerca de» lee la versión desde `app/app.json`.

Las preferencias locales se guardan con AsyncStorage. El idioma inicial se define en `expo.extra.defaultLanguage` de `app/app.json`; actualmente están disponibles Español (Latinoamérica) y Español (Colombia). La apariencia admite modo día, noche y sistema.

Los iconos del marketplace se generan desde `app/scripts/generate-marketplace-icon.ps1`. El script crea recursos nuevos en `app/assets/images`; los iconos Expo anteriores se conservan.

Si un flujo remoto no responde, verifica primero las migraciones aplicadas, las políticas RLS, los secretos de las Edge Functions, el ambiente de Wompi y la URL de eventos.
