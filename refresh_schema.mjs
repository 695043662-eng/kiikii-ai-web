import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'REDACTED_PROD_DB_URL';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// 刷新 PostgREST schema cache
async function refreshSchema() {
  console.log('🔄 刷新 PostgREST schema cache...');
  
  const response = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: "NOTIFY pgrst, 'reload schema';"
    }),
  });
  
  const result = await response.json();
  console.log('结果:', JSON.stringify(result));
}

refreshSchema().catch(console.error);
