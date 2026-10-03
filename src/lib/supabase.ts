import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function fetchConfig(key: string) {
  const { data, error } = await supabase
    .from('configs')
    .select('value')
    .eq('key', key)
    .single();

  if (error) {
    console.error('Error fetching config:', error);
    return null;
  }
  return data?.value;
}
