/**
 * #242 添加 reference_image_md5s 字段到 generation_records 表
 * 
 * 执行方式：npx tsx scripts/add-reference-image-md5s-column.ts
 */

const SUPABASE_URL = 'https://ozdlvxxoufkiazddvxys.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk';

async function addColumn() {
  // SQL 语句：添加 reference_image_md5s 字段
  const sql = `ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS reference_image_md5s TEXT[] DEFAULT '{}';`;
  
  console.log('执行 SQL:', sql);
  
  // 方法1：尝试 /pg/query 端点
  const url1 = `${SUPABASE_URL}/pg/query`;
  let response = await fetch(url1, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  
  let result = await response.json();
  console.log('/pg/query 结果:', JSON.stringify(result, null, 2));
  
  if (!result.error) {
    console.log('✅ 字段添加成功！');
    return;
  }
  
  // 方法2：尝试 /rest/v1/rpc/exec_sql
  console.log('\n尝试方法2: /rest/v1/rpc...');
  const url2 = `${SUPABASE_URL}/rest/v1/rpc/exec`;
  response = await fetch(url2, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  
  result = await response.json();
  console.log('/rest/v1/rpc 结果:', JSON.stringify(result, null, 2));
  
  if (result.error) {
    console.log('\n❌ 自动执行失败。');
    console.log('\n请手动在 Supabase Dashboard 中执行以下 SQL：');
    console.log('```sql');
    console.log(sql);
    console.log('```');
    console.log('\nSupabase Dashboard: https://ozdlvxxoufkiazddvxys.supabase.co/project/ozdlvxxoufkiazddvxys/sql');
  }
}

addColumn().catch(console.error);
