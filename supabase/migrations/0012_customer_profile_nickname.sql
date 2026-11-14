ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nickname TEXT;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_nickname_length;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_nickname_length
  CHECK (nickname IS NULL OR char_length(btrim(nickname)) BETWEEN 1 AND 40);

GRANT UPDATE (full_name, nickname, phone)
  ON public.profiles TO authenticated;

UPDATE public.profiles
SET nickname = COALESCE(NULLIF(BTRIM(username), ''), full_name)
WHERE nickname IS NULL;
