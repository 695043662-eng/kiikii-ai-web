import { createClient } from '@supabase/supabase-js';

const client = createClient(
  'REDACTED_DEV_DB_URL',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// 使用 Supabase 内置的 SQL 执行函数（如果有的话）
// 尝试调用 pg_catalog
const response = await fetch('REDACTED_DEV_DB_URL/rest/v1/', {
  method: 'POST',
  headers: {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: "ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'generate';" })
});
console.log('Response:', await response.text());
