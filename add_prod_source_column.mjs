import { createClient } from '@supabase/supabase-js';

// ⚠️ 生产环境 Supabase 配置
const SUPABASE_URL = 'REDACTED_PROD_DB_URL';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  console.log('🔍 检查生产环境 generation_records 表结构...');
  
  // 1. 先检查 source 列是否存在
  try {
    const { data, error } = await client
      .from('generation_records')
      .select('source')
      .limit(1);
    
    if (error && error.message.includes('column "source" does not exist')) {
      console.log('❌ source 列不存在，需要添加');
    } else if (error) {
      console.log('⚠️ 其他错误:', error.message);
    } else {
      console.log('✅ source 列已存在！');
      return;
    }
  } catch(e) {
    console.log('查询结果:', e.message);
  }
  
  // 2. 尝试通过 pg/query 执行 ALTER TABLE
  console.log('\n📝 尝试执行 ALTER TABLE...');
  
  const response = await fetch(`${SUPABASE_URL}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: "ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'generate';"
    }),
  });
  
  const result = await response.json();
  console.log('pg/query 结果:', JSON.stringify(result));
}

main().catch(console.error);
