D:/App-Istmina/
├── .github/                # Workflows para CI/CD (GitHub Actions)
├── docs/                   # Documentación técnica y Prompts de Gemini
│   └── architecture/       # Diagramas ER y Definiciones de Fase 1
├── app/                    # Frontend Universal (React Native + Expo)
│   ├── assets/             # Imágenes, Logos, Fuentes
│   ├── src/
│   │   ├── api/            # Cliente de Supabase y llamadas a API
│   │   │   └── supabaseClient.js
│   │   ├── components/      # Componentes UI Atómicos (Botones, Inputs)
│   │   │   ├── common/     # Reutilizables en todos los roles
│   │   │   ├── client/     # Solo para clientes
│   │   │   ├── business/   # Solo para negocios (Layouts reactivos)
│   │   │   └── driver/     # Solo para repartidores
│   │   ├── screens/        # Pantallas completas
│   │   │   ├── auth/       # Login, Registro, Recuperación
│   │   │   ├── client/     # Home, Carrito, Mis Pedidos
│   │   │   ├── business/   # Dashboard de Pedidos, Gestión Productos
│   │   │   └── driver/     # Pedidos Disponibles, Mapa de Entregas
│   │   ├── store/          # Estado Global (Zustand / Redux)
│   │   ├── hooks/          # Custom Hooks (useAuth, useOrders, useWallet)
│   │   ├── utils/          # Lógica de tiempos (T+5, T-5, D+5) y Formateo
│   │   └── navigation/      # Configuración de Stack y Tabs (Adaptativo)
│   ├── app.json            # Configuración de Expo
│   └── package.json
├── supabase/               # Infraestructura de Backend (Backend-as-a-Service)
│   ├── migrations/          # Archivos .sql con la creación de tablas y triggers
│   ├── functions/          # Supabase Edge Functions (Lógica de cobros y notificaciones)
│   └── seed.sql            # Datos de prueba para desarrollo inicial
├── tests/                  # Pruebas unitarias y de integración (Jest)
├── .gitignore              # Ignorar node_modules, .env, etc.
└── README.md                # Manual de inicio y despliegue
