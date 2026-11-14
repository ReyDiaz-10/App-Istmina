-- Reserved compatibility migration. The current administrator role is `admin`;
-- account/profile linking is handled by 0019_admin_role_and_profile.sql.
DO $$ BEGIN
  RAISE NOTICE 'Administrator account linking is handled by migration 0019.';
END $$;
