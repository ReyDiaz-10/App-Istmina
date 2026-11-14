import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const email = (process.env.ADMIN_EMAIL || 'neildiazusb@gmail.com').trim().toLowerCase();
const password = process.env.ADMIN_INITIAL_PASSWORD;
const phone = process.env.ADMIN_PHONE?.trim();
const fullName = process.env.ADMIN_FULL_NAME?.trim() || 'Administrador';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey || !password || !phone) {
  console.error('Configura SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_INITIAL_PASSWORD y ADMIN_PHONE en el entorno.');
  process.exit(1);
}
if (password.length < 8 || !email.includes('@') || phone.length < 7) {
  console.error('El correo, la contraseña (mínimo 8 caracteres) o el teléfono no son válidos.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: users, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;
let user = users.users.find((candidate) => candidate.email?.toLowerCase() === email);

if (user) {
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
    user_metadata: { ...user.user_metadata, role: 'admin', full_name: fullName, phone },
    app_metadata: { ...user.app_metadata, role: 'admin' },
  });
  if (error) throw error;
  user = data.user;
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // The auth trigger creates a regular profile first; the trusted upsert below promotes it.
    user_metadata: { role: 'cliente', full_name: fullName, phone },
    app_metadata: { role: 'admin' },
  });
  if (error) throw error;
  user = data.user;
}

const { error: profileError } = await supabase.from('profiles').upsert({
  id: user.id,
  full_name: fullName,
  nickname: fullName,
  phone,
  role: 'admin',
}, { onConflict: 'id' });
if (profileError) throw profileError;

console.log(`Cuenta administradora lista: ${email} (id ${user.id}). Cambia la contraseña inicial tras el primer acceso.`);
