import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (process.env.SEED_TEST_USERS !== 'true') {
  throw new Error('Set SEED_TEST_USERS=true to explicitly enable demo-account seeding.');
}

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

if (
  !/^(http:\/\/localhost|http:\/\/127\.0\.0\.1)/i.test(supabaseUrl) &&
  process.env.SUPABASE_ALLOW_REMOTE_TEST_SEED !== 'true'
) {
  throw new Error(
    'Remote seeding is disabled. Set SUPABASE_ALLOW_REMOTE_TEST_SEED=true only for a dedicated test project.',
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const demoUsers = [
  { role: 'cliente', email: 'cliente.demo@example.com', name: 'Cliente de Prueba' },
  { role: 'negocio', email: 'negocio.demo@example.com', name: 'Negocio de Prueba' },
  { role: 'repartidor', email: 'repartidor.demo@example.com', name: 'Repartidor de Prueba' },
  { role: 'superadmin', email: 'superadmin.demo@example.com', name: 'SuperAdmin de Prueba' },
];

const throwIfError = (error) => {
  if (error) throw error;
};

const getExistingUser = async (email) => {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    throwIfError(error);
    const user = data.users.find((candidate) => candidate.email === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
};

const ensureUser = async ({ email, name, role }) => {
  const password = randomBytes(24).toString('base64url');
  const existing = await getExistingUser(email);
  const result = existing
    ? await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role },
    })
    : await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name, role },
    });

  throwIfError(result.error);
  const user = result.data.user;
  if (!user) throw new Error(`Supabase did not return the user for ${email}.`);

  const { error: profileError } = await supabase.from('profiles').upsert({
    id: user.id,
    full_name: name,
    phone: `+5730000${randomBytes(3).toString('hex').slice(0, 6)}`,
    role,
    status: 'activo',
  }, { onConflict: 'id' });
  throwIfError(profileError);

  return { id: user.id, email, password, role };
};

const ensureBusiness = async (profileId) => {
  const { data: current, error: findError } = await supabase
    .from('businesses')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle();
  throwIfError(findError);

  const businessResult = current
    ? await supabase.from('businesses').update({
      store_name: 'IstmiYa Demo',
      address: 'Calle de Prueba 100, Istmina',
      prep_time_t: 20,
      status: 'activo',
    }).eq('id', current.id).select('id').single()
    : await supabase.from('businesses').insert({
      profile_id: profileId,
      store_name: 'IstmiYa Demo',
      address: 'Calle de Prueba 100, Istmina',
      prep_time_t: 20,
      status: 'activo',
    }).select('id').single();
  throwIfError(businessResult.error);
  const businessId = businessResult.data.id;

  const { data: wallet, error: walletFindError } = await supabase
    .from('wallets')
    .select('id')
    .eq('business_id', businessId)
    .order('id')
    .limit(1)
    .maybeSingle();
  throwIfError(walletFindError);
  const walletResult = wallet
    ? await supabase.from('wallets')
      .update({ balance: 100000, updated_at: new Date().toISOString() })
      .eq('id', wallet.id)
    : await supabase.from('wallets').insert({ business_id: businessId, balance: 100000 });
  throwIfError(walletResult.error);

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: subscription, error: subscriptionFindError } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('business_id', businessId)
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwIfError(subscriptionFindError);
  const subscriptionResult = subscription
    ? await supabase.from('subscriptions').update({
      start_date: yesterday,
      end_date: yesterday,
      is_active: false,
    }).eq('id', subscription.id)
    : await supabase.from('subscriptions').insert({
      business_id: businessId,
      start_date: yesterday,
      end_date: yesterday,
      is_active: false,
    });
  throwIfError(subscriptionResult.error);
};

const ensureDriver = async (profileId) => {
  const { data: driver, error: findError } = await supabase
    .from('drivers')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle();
  throwIfError(findError);

  const result = driver
    ? await supabase.from('drivers').update({
      vehicle_type: 'Moto',
      plate_number: 'DEMO-001',
      is_available: true,
    }).eq('id', driver.id)
    : await supabase.from('drivers').insert({
      profile_id: profileId,
      vehicle_type: 'Moto',
      plate_number: 'DEMO-001',
      is_available: true,
    });
  throwIfError(result.error);
};

const createdUsers = [];
for (const account of demoUsers) {
  const user = await ensureUser(account);
  if (user.role === 'negocio') await ensureBusiness(user.id);
  if (user.role === 'repartidor') await ensureDriver(user.id);
  createdUsers.push(user);
}

const credentialsPath = fileURLToPath(new URL('../../.env_test', import.meta.url));
const credentials = [
  '# Demo credentials. Generated locally; never use these accounts in production.',
  ...createdUsers.flatMap(({ role, email, password }) => [
    `TEST_${role.toUpperCase()}_EMAIL=${email}`,
    `TEST_${role.toUpperCase()}_PASSWORD=${password}`,
  ]),
  '',
].join('\n');

await writeFile(credentialsPath, credentials, { mode: 0o600 });
console.log(`Seeded four demo roles. Credentials were written to ${credentialsPath}`);
