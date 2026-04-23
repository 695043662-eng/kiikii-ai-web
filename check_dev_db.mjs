import { createClient } from '@supabase/supabase-js';

// 开发环境
const client = createClient(
  'https://ozdlvxxoufkiazddvxys.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk'
);

const { data, error } = await client.from('generation_records').select('source').limit(1);
console.log('开发环境:', error ? `❌ ${error.message}` : '✅ 正常');
