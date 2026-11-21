<div align="center">

# 🛍️ IstmiYa

### El comercio local de Istmina, a un clic.

Marketplace móvil y web para conectar clientes, comercios y repartidores en una sola experiencia.

<br />

![Expo SDK 58](https://img.shields.io/badge/Expo-SDK%2058-000020?logo=expo&logoColor=white)
![React Native 0.88](https://img.shields.io/badge/React%20Native-0.88-20232A?logo=react&logoColor=61DAFB)
![Supabase](https://img.shields.io/badge/Supabase-Auth%20%7C%20Postgres%20%7C%20Realtime-3FCF8E?logo=supabase&logoColor=white)
![Wompi](https://img.shields.io/badge/Pagos-Wompi-6B4EFF)
![Vercel](https://img.shields.io/badge/Web-Vercel-000000?logo=vercel&logoColor=white)

</div>

---

## 🌟 ¿Qué es IstmiYa?

IstmiYa es un marketplace inspirado en las aplicaciones de entrega bajo demanda. Permite descubrir negocios locales, hacer pedidos y seguir su preparación y entrega desde una aplicación construida con React Native y Expo.

La experiencia comienza **sin iniciar sesión**: cualquier visitante puede explorar el inicio, ver promociones y consultar los negocios disponibles. La autenticación se solicita al avanzar con una acción que requiere una cuenta, como realizar un pedido.

## 👥 Experiencia según el perfil

| Perfil | Qué puede hacer |
| --- | --- |
| **Cliente** | Explorar promociones y negocios, revisar productos, gestionar el carrito, pagar mediante Wompi, seguir pedidos, conversar con el negocio y valorar la entrega al cerrarse correctamente. |
| **Negocio** | Completar su información legal, registrar un correo para quejas, configurar horarios por día, consultar métricas, gestionar productos y pedidos, y revisar su billetera o suscripción. Solo puede operar tras la aprobación de un administrador. |
| **Repartidor** | Registrar vehículo y placa, cargar fotos privadas para revisión y, después de la aprobación, conectarse, aceptar entregas, cerrarlas con código y responder elogios o sugerencias mediante opciones predefinidas. |
| **Administrador** | Consultar métricas, responder solicitudes, revisar perfiles y conciliar excepciones financieras. Su rol se asigna desde un proceso de servidor; no se puede seleccionar en el registro público. |

## 🧭 Cómo se usa

1. **Explora como invitado.** Revisa los banners y abre un negocio sin crear una cuenta.
2. **Elige productos.** Consulta el detalle del local y agrega productos al carrito.
3. **Inicia sesión para pedir.** La app conserva el destino solicitado para que puedas continuar con la compra después de autenticarte.
4. **Paga con Wompi.** El pedido queda pendiente hasta que el webhook verificado confirme la transacción.
5. **Coordina la entrega.** Tras confirmar el pago, se abre el chat en tiempo real con el negocio. El cliente también puede consultar el estado del pedido.
6. **Sigue la preparación y la entrega.** El negocio registra un tiempo real estimado al aceptar; el repartidor puede aceptar mientras se prepara y ve su objetivo de llegada, mientras el cliente ve estimaciones de preparación y entrega con márgenes de presentación separados de los datos reales.
7. **Resuelve una entrega fallida.** El repartidor registra el motivo y devuelve el pedido al negocio. El negocio confirma la devolución y luego puede reasignar (con nuevos códigos de seguridad) o cancelar para gestionar reembolso/conciliación.

## ✨ Funcionalidades principales

- **Navegación guest-first:** escaparate y negocios accesibles antes del login.
- **Saludo y perfil de cliente:** saludo con el nombre elegido según la hora local y edición de nombre, usuario único, teléfono y correo (con confirmación de Supabase).
- **Interfaz adaptada al perfil:** paletas de color para cliente, negocio y repartidor.
- **Botones animados:** efecto de presión con variantes de navegación Atrás e Inicio.
- **Promociones y catálogo:** carrusel de banners y listado de negocios/productos cargados desde Supabase.
- **Búsqueda y categorías:** filtra los negocios por nombre, dirección y productos reales disponibles; las categorías se derivan de las categorías de producto del catálogo.
- **Catálogo de negocio:** alta, edición y eliminación de productos; disponibilidad, inventario, variantes y extras con precio y selección obligatoria. La base valida disponibilidad y stock al crear el pedido, bloquea existencias concurrentes y las devuelve al cancelar o expirar un pedido impago.
- **Flujo de pedidos:** seguimiento visual de pago, preparación, pedido listo, trayecto y entrega.
- **Incidencias de entrega:** `no_entregado` es distinto de `entregado`; requiere motivo y confirmación de devolución antes de reasignar o cancelar. Los pedidos no entregados no generan liquidación de venta.
- **Tiempos por rol:** los minutos reales del negocio y repartidor se guardan en la orden; los márgenes de presentación (+5, -5 y +10) solo se aplican al mostrarlos y nunca se guardan como métricas reales.
- **Bloqueo cliente-repartidor:** cualquiera de los dos puede bloquear al otro desde un pedido asignado. Se impiden futuras asignaciones y mensajes directos; la entrega actualmente asignada puede terminarse sin chat.
- **Dirección habitual:** el último domicilio e indicaciones se guardan al crear el pedido y pueden confirmarse con un toque o editarse para el siguiente.
- **Identificación y entrega seguras:** cada pedido conserva su UUID como clave primaria y recibe además un número consecutivo único para mostrar. El negocio valida la recogida con su código; el repartidor valida la entrega con el código que recibe el cliente. Cinco verificaciones incorrectas bloquean ese código durante 15 minutos. La animación indica el trayecto al negocio o a la casa sin compartir una ubicación GPS en vivo con el cliente.
- **Experiencia posentrega:** después del cierre correcto por código, cliente y repartidor acceden a una pantalla ligada al pedido para calificar y dejar el comentario permitido para su rol. El cliente puede enviar elogios, sugerencias o quejas y bloquear al repartidor; las quejas no se muestran al repartidor. Este solo ve elogios y sugerencias, y puede responder con tres opciones predefinidas por categoría, sin chat libre después de la entrega.
- **Chat por pedido:** mensajes de cliente y negocio sincronizados mediante Supabase Realtime una vez confirmado el pago.
- **Llamadas de voz por pedido:** cliente y negocio pueden iniciar, responder o rechazar llamadas desde el chat; Supabase Realtime coordina la invitación y LiveKit transporta el audio.
- **Compartir teléfono con consentimiento:** el servidor detecta números en el chat y solicita autorización explícita antes de enviarlos; los números autorizados aparecen como enlace telefónico.
- **Verificación manual de perfiles:** la información legal del negocio y las fotos privadas del repartidor se revisan desde el panel de administración antes de habilitar operación o conexión.
- **Panel del negocio:** resumen de pedidos, ventas entregadas y quejas asociadas a sus pedidos.
- **Notificación de quejas:** las quejas asociadas a un pedido se envían al correo registrado por el negocio cuando Resend está configurado.
- **Herramientas para comercios:** billetera recargable o suscripción mensual. En el modelo de billetera se cobra una comisión del 10 % al aceptar un pedido; una suscripción vigente exime de esa comisión.
- **Transferencias entre negocios:** una propuesta de saldo prepago no debita la billetera; solo la aceptación explícita del negocio receptor aplica el débito, crédito, ledger y auditoría. Una propuesta puede cancelarse o rechazarse y el saldo se valida de nuevo al aceptar.
- **Retiros de repartidores:** las excepciones pueden incluir evidencia privada, entidad consultada y folio. Una revisión administrativa no simula un desembolso: el estado final depende de un evento verificado o de la conciliación autenticada con Wompi.
- **Retiro en tienda:** el cliente puede elegir pickup cuando el negocio lo habilita. El pedido no se asigna a repartidores; el cliente conserva el código de reclamación y el negocio valida el código que presenta el cliente.
- **Demanda alta:** los umbrales de pedidos abiertos y oferta de repartidores se configuran desde Finanzas. La pausa reversible bloquea pedidos nuevos sin cambiar los pedidos ya existentes.
- **Pagos Wompi:** creación de enlaces de pago y verificación del webhook en el servidor.
- **Centro de control administrativo:** métricas agregadas, bandeja de soporte y panel para revisar pagos inciertos, reembolsos y liquidaciones fallidas o demoradas, dejando evidencia de la conciliación.
- **Ayuda por perfil:** clientes, negocios, repartidores y administración pueden reportar problemas desde su flujo; los reportes pueden relacionarse con un pedido.
- **Acerca de IstmiYa:** información de la app, versión, contacto y accesos a soporte y privacidad; el ingreso administrativo valida el rol en la sesión y en Supabase.
- **Preferencias de la app:** idioma Español (Latinoamérica) predeterminado, apariencia automática por hora local (modo claro de 06:00 a 17:59, modo oscuro el resto del día) y tamaño de letra ajustable entre 80 % y 140 %, guardado localmente.
- **Identidad de marketplace:** icono de bolsa de compras con productos, y lema visible en el inicio.
- **Privacidad:** se incluye un borrador de política accesible desde la app. Completa los datos del responsable y sométela a revisión legal antes de publicar.
- **Perfiles de prueba:** script opcional que crea cuentas de demostración y genera contraseñas aleatorias localmente.

> **Estado de integración:** `0031_business_wallet_transfers_driver_withdrawal_exceptions_and_pickup.sql` y los flujos que introduce siguen en revisión y **no están validados ni listos para aplicarse**. No la apliques en producción ni en un proyecto compartido. Valídala primero en un proyecto Supabase/PostgreSQL descartable, junto con RLS, permisos, integración Wompi, idempotencia y pruebas financieras. Las migraciones anteriores también deben validarse según [INSTRUCCIONES.md](./INSTRUCCIONES.md) antes de habilitar los flujos. Despliega `cancel-order` solo cuando el proyecto de prueba esté configurado. Las llamadas requieren desplegar la función de tokens y configurar LiveKit; en móvil necesitan un development build (no Expo Go). Las notificaciones por correo requieren configurar Resend.

## 💳 Cancelaciones, reembolsos y liquidaciones

- El pago de un pedido solo se confirma con el webhook de Wompi validado. Los eventos repetidos son idempotentes; un segundo pago aprobado para la misma orden se registra para reembolso y no vuelve a marcar el pedido como pagado.
- Cliente y negocio pueden cancelar/rechazar dentro de las reglas del flujo. Un reembolso aprobado por Wompi se muestra como confirmado; solicitudes pendientes, inciertas o fallidas requieren conciliación y no se reenvían automáticamente.
- El stock queda reservado al crear el pedido. Un pedido pendiente sin pago ni intento incierto se cancela a los 30 minutos y libera sus existencias; una transacción pendiente, aprobada o incierta conserva la reserva para evitar vender stock comprometido. Los reintentos están permitidos dentro de la ventana. Un pago aprobado que llegue después de cancelar el pedido se registra para conciliación y reembolso.
- Las liquidaciones de ventas de comercios son distintas de los retiros de repartidores. Se reservan los lunes desde $50.000 COP, sujetas a cuenta bancaria válida, secretos de servidor, funciones desplegadas, cron activo y Pagos a Terceros habilitado por Wompi. No se garantiza el abono bancario a una hora exacta.
- El panel de Finanzas permite documentar revisiones sin alterar estados de proveedor. Los retiros automáticos solo contemplan cuentas bancarias y dependen de la disponibilidad de Pagos a Terceros en Wompi; no se habilitan desembolsos por otros métodos. Solo un evento verificado o la conciliación autenticada con Wompi confirma el resultado de un payout.
- Las transferencias prepago de negocio son movimientos internos entre billeteras; no son transferencias bancarias ni pagos Wompi. La propuesta queda pendiente y no reserva ni debita saldo.
- La animación de seguimiento comunica el tramo del repartidor. No sustituye la dirección ni las indicaciones que necesita el repartidor para llegar.

## 🧪 Pruebas y validación

Desde `app/`, ejecuta `npm test` para las pruebas automatizadas unitarias. Ejecuta también `npm run lint` y `npm run build:web`.

La suite financiera y de entrega requiere un proyecto Supabase desechable, credenciales Sandbox y `ISTMIYA_RUN_FINANCIAL_INTEGRATION=true`; nunca la ejecutes contra producción. Incluye pagos duplicados, reserva y liberación de inventario, entrega con código, reseñas y visibilidad por rol, excepciones de retiro, transferencia de saldo, y creación idempotente y controles de seguridad de pickup. Los subtests nuevos restauran los saldos de billetera, cancelan el pedido pickup para liberar stock y limpian sus claves idempotentes; los logs de auditoría se conservan. La migración 0031 y sus pruebas aún no se han validado en un Sandbox. Consulta las instrucciones de configuración en [INSTRUCCIONES.md](./INSTRUCCIONES.md) y [payouts_setup.md](./docs/payouts_setup.md).

## 🤖 Builds Android automáticos con EAS

Cada `git push` a `main` inicia un build Android de perfil `preview` en EAS. El APK queda disponible en el enlace del build de Expo; también se puede iniciar manualmente desde GitHub Actions con `workflow_dispatch`. El perfil incrementa automáticamente el `versionCode` remoto.

La configuración canónica de Expo/EAS está en `app/app.json` y `app/eas.json`; ejecuta los comandos de EAS desde `app/`. No uses archivos `app.json` o `eas.json` en la raíz.

Antes del primer build automático:

1. Crea un token en la cuenta Expo que tenga acceso al proyecto IstmiYa y guárdalo en GitHub como secreto de Actions llamado `EXPO_TOKEN` (Settings → Secrets and variables → Actions). No lo agregues al repositorio.
2. Verifica que `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY` estén definidas en el entorno `preview` de EAS; actualmente ambas aparecen configuradas.
3. Desde `app/`, consulta el contador remoto con `eas build:version:get --platform android --profile preview`. Actualmente es `2`; `autoIncrement` lo aumentará en el siguiente build.
4. Confirma y sube a `main` el workflow `.github/workflows/eas-android-apk.yml` y la configuración `app/eas.json`.

Los siguientes pushes a `main` generarán un APK nuevo con un `versionCode` mayor. EAS no instala el APK automáticamente en los teléfonos: comparte el enlace del nuevo build para que los usuarios lo instalen. Estos APK son para distribución interna; Google Play requiere un perfil de producción de tipo App Bundle (AAB).

## 🧰 Tecnologías

- **Aplicación:** React Native, Expo SDK 58 y React Navigation (el contenedor principal está en `app/App.js`).
- **Estado:** Zustand.
- **Backend:** Supabase Auth, PostgreSQL, Realtime y Edge Functions.
- **Pagos:** Wompi.
- **Publicación web:** exportación estática de Expo y Vercel.

## 🗂️ Estructura del proyecto

```text
.
├── app/
│   ├── App.js                 # Entrada y navegación principal
│   └── src/
│       ├── components/        # Botones, chat, billetera y estados
│       ├── screens/           # Vistas por perfil
│       ├── services/          # Operaciones del dominio
│       ├── store/             # Estado de autenticación y carrito
│       └── api/               # Cliente de Supabase
├── supabase/
│   ├── migrations/            # Esquema y reglas de negocio
│   └── functions/             # Pagos, webhook y notificaciones
├── docs/                      # Documentación técnica
├── vercel.json                # Build y publicación web
└── INSTRUCCIONES.md           # Configuración, ejecución y despliegue
```

## 🚀 Inicio rápido

Para configurar las variables de entorno, instalar dependencias, ejecutar la app o preparar Supabase/Wompi, sigue la guía de [INSTRUCCIONES.md](./INSTRUCCIONES.md).

En Windows PowerShell, una vez configurado el proyecto:

```powershell
Set-Location 'D:\App-Istmina\app'
npm.cmd run web
```

## 🔐 Seguridad

- La llave `service_role` de Supabase y las llaves privadas/secretos de Wompi deben permanecer en el servidor.
- El cliente móvil solo utiliza `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Las fotos del rostro y documentos del repartidor se guardan en buckets privados; el acceso se limita al propietario, administradores y participantes autorizados de una entrega activa. La foto del local es pública para mostrar el negocio.
- Resend se invoca desde una Edge Function; nunca pongas su API key en la app.
- No publiques archivos `.env`, `.env_test` ni credenciales de demostración.
- Usa un proyecto de Supabase de pruebas para generar cuentas demo; el script reemplaza las contraseñas de las cuentas de prueba existentes.

## 📚 Documentación

- [Instrucciones de instalación, Supabase, Wompi y Vercel](./INSTRUCCIONES.md)
- [Esquema de base de datos](./docs/architecture/database_schema.md)
- [Configuración y conciliación de liquidaciones](./docs/payouts_setup.md)

El creador y los correos de soporte y privacidad se configuran en `app/src/constants/appInfo.js`. Deben completarse antes del despliegue público. La versión visible se toma de `app/app.json`; actualiza también `app/package.json` al preparar cada lanzamiento.
