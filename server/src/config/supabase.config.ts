import { createClient } from '@supabase/supabase-js';
import config from './env.ts';

/**
 * Supabase Admin client initialized with the service role key.
 * Bypasses Row Level Security for server-side operations.
 * Never expose this client or its key to the browser.
 */
export const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
