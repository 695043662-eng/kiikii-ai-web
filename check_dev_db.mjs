import { createClient } from '@supabase/supabase-js';

// 开发环境
const client = createClient(
  'REDACTED_DEV_DB_URL',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const { data, error } = await client.from('generation_records').select('source').limit(1);
console.log('开发环境:', error ? `❌ ${error.message}` : '✅ 正常');
