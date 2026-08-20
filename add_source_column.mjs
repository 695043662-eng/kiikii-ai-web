import { createClient } from '@supabase/supabase-js';

const client = createClient(
  'REDACTED_DEV_DB_URL',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// 检查 source 列是否存在
const { data, error } = await client
  .from('generation_records')
  .select('source')
  .limit(1);

if (error && error.message.includes('column "source" does not exist')) {
  console.log('❌ source 列不存在，需要添加');
} else if (error) {
  console.log('查询错误:', error.message);
} else {
  console.log('✅ source 列已存在');
}
