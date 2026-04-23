import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ozdlvxxoufkiazddvxys.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk';

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
