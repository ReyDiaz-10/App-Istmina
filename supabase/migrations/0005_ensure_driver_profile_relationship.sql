DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.drivers'::regclass
      AND confrelid = 'public.profiles'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.drivers'::regclass AND attname = 'profile_id')]
      AND confkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attname = 'id')]
  ) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_profile_id_fkey
      FOREIGN KEY (profile_id) REFERENCES public.profiles(id);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
