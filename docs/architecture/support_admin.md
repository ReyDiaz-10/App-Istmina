# Soporte y métricas administrativas

La migración `supabase/migrations/0004_support_and_admin_dashboard.sql` añade `support_tickets`, con solicitante, categoría, pedido opcional, contexto, estado y respuesta administrativa. Las políticas RLS permiten que cada usuario cree y consulte sus propias solicitudes; solo SuperAdmin puede leer y actualizar la bandeja global.

La función `admin_dashboard_summary()` comprueba el rol `superadmin` en el servidor y devuelve métricas agregadas de usuarios y pedidos, actividad por negocio, entregas por repartidor y los clientes con más pedidos. La app no descarga todas las órdenes para calcular esos indicadores.

El panel está registrado como una pantalla de la app. El acceso administrativo visible en «Acerca de IstmiYa» conduce al inicio de sesión común y comprueba el rol después de autenticar. La protección real se aplica mediante RLS y la función SQL, no por ocultar la pantalla.

Las solicitudes de ayuda pueden asociarse con una orden y reciben una respuesta desde el panel. Cada solicitante ve sus propias solicitudes y la respuesta en la pantalla de soporte.
