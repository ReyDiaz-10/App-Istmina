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
| **Cliente** | Explorar promociones y negocios, revisar productos, gestionar el carrito, pagar mediante Wompi, seguir pedidos y conversar con el negocio. |
| **Negocio** | Administrar productos y pedidos, revisar su billetera y suscripción, aceptar pedidos y coordinar su preparación y entrega. |
| **Repartidor** | Cambiar su disponibilidad, ver pedidos listos para recoger, aceptar una entrega y marcarla como completada. |
| **SuperAdmin** | Consultar el panel administrativo y gestionar la moderación de cuentas. Su rol se asigna desde un proceso de servidor; no se puede seleccionar en el registro público. |

## 🧭 Cómo se usa

1. **Explora como invitado.** Revisa los banners y abre un negocio sin crear una cuenta.
2. **Elige productos.** Consulta el detalle del local y agrega productos al carrito.
3. **Inicia sesión para pedir.** La app conserva el destino solicitado para que puedas continuar con la compra después de autenticarte.
4. **Paga con Wompi.** El pedido queda pendiente hasta que el webhook verificado confirme la transacción.
5. **Coordina la entrega.** Tras confirmar el pago, se abre el chat en tiempo real con el negocio. El cliente también puede consultar el estado del pedido.
6. **Recibe tu pedido.** El negocio prepara la orden; un repartidor disponible puede tomarla y marcarla como entregada.

## ✨ Funcionalidades principales

- **Navegación guest-first:** escaparate y negocios accesibles antes del login.
- **Interfaz adaptada al perfil:** paletas de color para cliente, negocio y repartidor.
- **Botones animados:** efecto de presión con variantes de navegación Atrás e Inicio.
- **Promociones y catálogo:** carrusel de banners y listado de negocios/productos cargados desde Supabase.
- **Flujo de pedidos:** seguimiento visual de pago, preparación, pedido listo, trayecto y entrega.
- **Chat por pedido:** mensajes de cliente y negocio sincronizados mediante Supabase Realtime una vez confirmado el pago.
- **Herramientas para comercios:** billetera recargable o suscripción mensual. En el modelo de billetera se cobra una comisión del 10 % al aceptar un pedido; una suscripción vigente exime de esa comisión.
- **Pagos Wompi:** creación de enlaces de pago y verificación del webhook en el servidor.
- **Centro de control SuperAdmin:** métricas agregadas de usuarios, pedidos, negocios y entregas; bandeja de soporte para revisar, responder y resolver solicitudes.
- **Ayuda por perfil:** clientes, negocios, repartidores y administración pueden reportar problemas desde su flujo; los reportes pueden relacionarse con un pedido.
- **Acerca de IstmiYa:** información de la app, versión, contacto y accesos a soporte y privacidad; el ingreso administrativo valida el rol en la sesión y en Supabase.
- **Preferencias de la app:** idioma Español (Latinoamérica) predeterminado, opción regional de Español (Colombia), y apariencia día, noche o sincronizada con el sistema. Las preferencias se guardan en el dispositivo.
- **Identidad de marketplace:** icono de bolsa de compras con productos, y lema visible en el inicio.
- **Privacidad:** se incluye un borrador de política accesible desde la app. Completa los datos del responsable y sométela a revisión legal antes de publicar.
- **Perfiles de prueba:** script opcional que crea cuentas de demostración y genera contraseñas aleatorias localmente.

> **Estado de integración:** los flujos que requieren transacciones, permisos y datos en tiempo real dependen de aplicar las migraciones de Supabase, desplegar las Edge Functions y configurar las credenciales de Wompi. Consulta [INSTRUCCIONES.md](./INSTRUCCIONES.md) antes de habilitarlos en un entorno real.

## 🧰 Tecnologías

- **Aplicación:** React Native, Expo SDK 58 y React Navigation.
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
│   └── functions/             # Pagos y webhook de Wompi
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
- No publiques archivos `.env`, `.env_test` ni credenciales de demostración.
- Usa un proyecto de Supabase de pruebas para generar cuentas demo; el script reemplaza las contraseñas de las cuentas de prueba existentes.

## 📚 Documentación

- [Instrucciones de instalación, Supabase, Wompi y Vercel](./INSTRUCCIONES.md)
- [Esquema de base de datos](./docs/architecture/database_schema.md)

El creador y los correos de soporte y privacidad se configuran en `app/src/constants/appInfo.js`. Deben completarse antes del despliegue público. La versión visible se toma de `app/app.json`; actualiza también `app/package.json` al preparar cada lanzamiento.
