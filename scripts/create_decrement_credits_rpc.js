/**
 * P0 级数据库基建脚本：创建 decrement_credits RPC 函数
 * 使用 postgres.js 连接真实数据库
 */

const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

function parseEnv(filePath) {
  const result = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.substring(0, eq).trim();
      let value = trimmed.substring(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
}

const RPC_SQL = `
CREATE OR REPLACE FUNCTION public.decrement_credits(
  user_id_param UUID,
  deduct_amount_param INTEGER
)
RETURNS TABLE(new_credits INTEGER, success BOOLEAN)
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_credits INTEGER;
  v_success BOOLEAN := FALSE;
BEGIN
  UPDATE users
  SET credits = credits - deduct_amount_param,
      updated_at = NOW()
  WHERE id = user_id_param
    AND credits >= deduct_amount_param
  RETURNING users.credits INTO v_new_credits;

  IF v_new_credits IS NOT NULL THEN
    v_success := TRUE;
  ELSE
    SELECT credits INTO v_new_credits FROM users WHERE id = user_id_param;
    v_success := FALSE;
  END IF;

  RETURN QUERY SELECT v_new_credits, v_success;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_credits(UUID, INTEGER) TO postgres, anon, authenticated, service_role;
`;

async function executeOnDatabase(dbName, connectionString) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔗 连接 ${dbName}`);
  console.log(`${'='.repeat(60)}`);
  
  let sql;
  try {
    sql = postgres(connectionString, {
      ssl: { rejectUnauthorized: false },
      connect_timeout: 15,
      idle_timeout: 0,
      max: 1,
    });
    
    // 测试连接
    const [testResult] = await sql`SELECT 1 as ok`;
    console.log(`✅ ${dbName}: 连接成功`);
    
    // 执行 RPC 创建
    await sql.unsafe(RPC_SQL);
    console.log(`✅ ${dbName}: decrement_credits RPC 函数创建成功`);
    
    // 验证
    const verifyRows = await sql`
      SELECT routine_name, routine_type 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_name = 'decrement_credits'
    `;
    
    if (verifyRows.length > 0) {
      console.log(`✅ ${dbName}: 验证通过 -`, verifyRows[0]);
    } else {
      console.error(`❌ ${dbName}: 验证失败 - 函数不存在!`);
      await sql.end();
      return false;
    }
    
    // 验证函数签名
    const sigRows = await sql`
      SELECT pg_get_functiondef(oid) as definition
      FROM pg_proc 
      WHERE proname = 'decrement_credits' AND pronamespace = 'public'::regnamespace
    `;
    if (sigRows.length > 0) {
      console.log(`✅ ${dbName}: 函数签名验证通过`);
    }
    
    await sql.end();
    return true;
  } catch (error) {
    console.error(`❌ ${dbName}: 执行失败:`, error.message);
    if (sql) await sql.end().catch(() => {});
    return false;
  }
}

async function main() {
  console.log('🚀 P0 级数据库基建：创建 decrement_credits RPC 函数\n');
  
  const envPath = path.join(process.cwd(), '.env.isolated');
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env.isolated 文件不存在!');
    process.exit(1);
  }
  
  const env = parseEnv(envPath);
  
  const devRef = 'ozdlvxxoufkiazddvxys';
  const devPassword = env.DEV_SUPABASE_DB_PASSWORD;
  const prodRef = 'hrwoalchynrnwlcqdpxn';
  const prodPassword = env.PROD_SUPABASE_DB_PASSWORD;
  
  if (!devPassword || !prodPassword) {
    console.error('❌ 数据库密码缺失!');
    process.exit(1);
  }
  
  const results = [];
  
  // 开发数据库
  const devConnStr = `postgresql://postgres:${devPassword}@db.${devRef}.supabase.co:5432/postgres`;
  results.push({ db: '开发(kiikii-dev)', success: await executeOnDatabase('开发(kiikii-dev)', devConnStr) });
  
  // 生产数据库
  const prodConnStr = `postgresql://postgres:${prodPassword}@db.${prodRef}.supabase.co:5432/postgres`;
  results.push({ db: '生产(kiikii-prod)', success: await executeOnDatabase('生产(kiikii-prod)', prodConnStr) });
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 注入结果汇总:');
  for (const r of results) {
    console.log(`  ${r.success ? '✅' : '❌'} ${r.db}: ${r.success ? '成功' : '失败'}`);
  }
  console.log(`${'='.repeat(60)}`);
  
  if (results.every(r => r.success)) {
    console.log('\n🎉 双库 RPC 注入全部成功！');
  } else {
    console.error('\n⚠️ 部分数据库注入失败');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ 脚本执行异常:', err);
  process.exit(1);
});
