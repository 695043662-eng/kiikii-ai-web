import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'REDACTED_DEV_DB_URL';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function addColumn() {
  const url = `${SUPABASE_URL}/pg/query`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: "ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'generate';"
    }),
  });
  
  const result = await response.json();
  console.log('Result:', JSON.stringify(result));
}

addColumn().catch(console.error);
