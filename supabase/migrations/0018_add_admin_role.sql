-- Add admin as the application's current administrative role. Keep legacy
-- superadmin rows readable until they are migrated by 0019.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'admin';
