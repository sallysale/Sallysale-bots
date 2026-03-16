// bots/shared/supabaseClient.mjs
// לקוח Supabase משותף לכל הבוטים — משתמש ב-SERVICE_ROLE key

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY; // לעולם לא ב-frontend!

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ חסר SUPABASE_URL או SUPABASE_SERVICE_KEY ב-.env');
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  db:   { schema: 'public' },
});

export default supabase;
