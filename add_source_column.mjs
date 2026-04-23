import { createClient } from '@supabase/supabase-js';

const client = createClient(
  'https://ozdlvxxoufkiazddvxys.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk'
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
