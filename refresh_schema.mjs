import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hrwoalchynrnwlcqdpxn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhyd29hbGNoeW5ybndsY3FkcHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODgwOTcsImV4cCI6MjA5MTY2NDA5N30.AvDAWvDvJKTdA5ZQQTRpEKXUOmCDxooiezJoigXBJHI';

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
