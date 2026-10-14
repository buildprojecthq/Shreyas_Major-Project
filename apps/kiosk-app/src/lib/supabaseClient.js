import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://svuzznupaozcjvtederc.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_bz0H5FFXcb_qQDz-vHWV9Q_q8GJ1GQg';

// Shared Supabase client instance for Kiosk app
export const supabase = createClient(supabaseUrl, supabaseKey);
