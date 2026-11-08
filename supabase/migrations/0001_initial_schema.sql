-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Habilitar extensión para UUIDs y mapas (PostGIS)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Enum types
CREATE TYPE user_role AS ENUM ('cliente', 'negocio', 'repartidor');

-- Enum types
CREATE TYPE user_role AS ENUM ('cliente', 'negocio', 'repartidor');
CREATE TYPE business_status AS ENUM ('activo', 'inactivo', 'fuera_de_servicio');
CREATE TYPE order_status AS ENUM ('pendiente', 'pagado', 'preparando', 'en_camino', 'entregado', 'cancelado');
CREATE TYPE payment_method AS ENUM ('nequi', 'llave', 'qr', 'efectivo');

-- 1. Profiles
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    full_name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    role user_role NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Businesses
CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID REFERENCES profiles(id),
    store_name TEXT NOT NULL,
    address TEXT NOT NULL,
    prep_time_t INT NOT NULL DEFAULT 15,
    status business_status DEFAULT 'activo',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Wallets
CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id),
    balance DECIMAL(12,2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Subscriptions
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT false
);

-- 5. Drivers
CREATE TABLE drivers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id UUID REFERENCES profiles(id),
    vehicle_type TEXT,
    is_available BOOLEAN DEFAULT true,
    current_location GEOGRAPHY(POINT)
);

-- 6. Products
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id),
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(12,2) NOT NULL,
    category TEXT,
    image_url TEXT
);

-- 7. Orders
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID REFERENCES profiles(id),
    business_id UUID REFERENCES businesses(id),
    driver_id UUID REFERENCES drivers(id),
    total_amount DECIMAL(12,2) NOT NULL,
    payment_method payment_method,
    status order_status DEFAULT 'pendiente',
    delivery_time_d INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Order Items
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id),
    product_id UUID REFERENCES products(id),
    quantity INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL
);

-- 9. Chats
CREATE TABLE chats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id),
    sender_id UUID REFERENCES profiles(id),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRIGGERS Y FUNCIONES
-- Trigger para verificar y descontar de la billetera virtual si aplica
CREATE OR REPLACE FUNCTION process_wallet_deduction()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'pagado' AND OLD.status != 'pagado' THEN
        IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE business_id = NEW.business_id AND is_active = true) THEN
           UPDATE wallets SET balance = balance - (NEW.total_amount * 0.10), updated_at = NOW() WHERE business_id = NEW.business_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_deduct_wallet
AFTER UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION process_wallet_deduction();

-- Trigger para bloquear el negocio si su saldo en la billetera es igual o menor a 0
CREATE OR REPLACE FUNCTION update_business_status_on_wallet_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.balance <= 0 THEN
        UPDATE businesses SET status = 'fuera_de_servicio' WHERE id = NEW.business_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_business_status
AFTER UPDATE ON wallets
FOR EACH ROW
EXECUTE FUNCTION update_business_status_on_wallet_balance();