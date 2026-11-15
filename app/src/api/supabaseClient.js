import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const normalizedUrl = typeof supabaseUrl === 'string' ? supabaseUrl.trim() : '';
const normalizedAnonKey = typeof supabaseAnonKey === 'string' ? supabaseAnonKey.trim() : '';

const missingVariables = [];
if (!normalizedUrl) missingVariables.push('EXPO_PUBLIC_SUPABASE_URL');
if (!normalizedAnonKey) missingVariables.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');

let supabase = null;
let supabaseConfigError = null;

if (missingVariables.length > 0) {
  supabaseConfigError = new Error(
    `Faltan variables de configuración de Supabase: ${missingVariables.join(', ')}.`
  );
} else {
  try {
    supabase = createClient(normalizedUrl, normalizedAnonKey);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    supabaseConfigError = new Error(`No se pudo inicializar Supabase: ${details}`);
  }
}

if (supabaseConfigError) {
  console.error(`[Supabase] ${supabaseConfigError.message}`);
}

export { supabase, supabaseConfigError };
