import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';

// Suporte para ambos os nomes de variável (anon key padrão ou publishable key)
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] ⚠️  Variáveis de ambiente não encontradas. Supabase desabilitado.');
} else {
  console.info('[Supabase] ✅ Conectado a:', supabaseUrl);
}

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
