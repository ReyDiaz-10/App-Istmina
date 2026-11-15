import { spawnSync } from 'node:child_process';

const required = [
  'ISTMIYA_TEST_CONFIRM_DISPOSABLE_SUPABASE',
  'ISTMIYA_TEST_SUPABASE_URL',
  'ISTMIYA_TEST_SUPABASE_ANON_KEY',
  'ISTMIYA_TEST_SUPABASE_SERVICE_ROLE_KEY',
  'ISTMIYA_TEST_CLIENT_EMAIL',
  'ISTMIYA_TEST_CLIENT_PASSWORD',
  'ISTMIYA_TEST_BUSINESS_EMAIL',
  'ISTMIYA_TEST_BUSINESS_PASSWORD',
  'ISTMIYA_TEST_DRIVER_ONE_EMAIL',
  'ISTMIYA_TEST_DRIVER_ONE_PASSWORD',
  'ISTMIYA_TEST_DRIVER_TWO_EMAIL',
  'ISTMIYA_TEST_DRIVER_TWO_PASSWORD',
  'ISTMIYA_TEST_BUSINESS_ID',
  'ISTMIYA_TEST_PRODUCT_ID',
  'ISTMIYA_TEST_LATITUDE',
  'ISTMIYA_TEST_LONGITUDE',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing financial integration configuration: ${missing.join(', ')}`);
  process.exitCode = 1;
} else if (process.env.ISTMIYA_TEST_CONFIRM_DISPOSABLE_SUPABASE !== 'true') {
  console.error('Refusing to run: set ISTMIYA_TEST_CONFIRM_DISPOSABLE_SUPABASE=true only for a disposable Supabase project.');
  process.exitCode = 1;
} else {
  const result = spawnSync(
    process.execPath,
    ['--test', './tests/financialFlows.integration.test.mjs'],
    {
      cwd: process.cwd(),
      env: { ...process.env, ISTMIYA_RUN_FINANCIAL_INTEGRATION: 'true' },
      stdio: 'inherit',
    },
  );
  process.exitCode = result.status ?? 1;
}
