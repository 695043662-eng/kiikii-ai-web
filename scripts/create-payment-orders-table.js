/**
 * 创建 payment_orders 表（支付订单表）
 * 
 * 执行方式：node scripts/create-payment-orders-table.js
 * 
 * ⚠️ 注意：Supabase 客户端不支持直接执行 SQL 创建表
 * 本脚本会输出 SQL 供您手动在 Supabase Dashboard 执行
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 加载环境变量
function loadEnv() {
  const envFiles = ['.env.production', '.env.local'];
  const result = {};
  
  for (const file of envFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.substring(0, eq).trim();
          let value = trimmed.substring(eq + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || 
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!result[key]) {
            result[key] = value;
          }
        }
      }
    }
  }
  return result;
}

const localEnv = loadEnv();

// 从环境变量获取数据库连接信息
const supabaseUrl = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 缺少数据库连接信息，请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

console.log(`🔗 连接数据库: ${supabaseUrl.substring(0, 40)}...`);
const supabase = createClient(supabaseUrl, supabaseKey);

async function createPaymentOrdersTable() {
  console.log('========================================');
  console.log('创建 payment_orders 表');
  console.log('========================================\n');

  // 检查表是否已存在
  console.log('📋 步骤1：检查表是否已存在...');
  const { data, error } = await supabase
    .from('payment_orders')
    .select('id')
    .limit(1);
  
  if (!error) {
    console.log('✅ payment_orders 表已存在，无需创建');
    console.log('   查询结果:', data);
    return;
  }
  
  if (error.code === '42P01' || error.message.includes('does not exist') || error.message.includes('relation')) {
    console.log('⚠️ 表不存在，需要手动创建');
  } else {
    console.log('   查询结果:', error.message);
  }

  // Supabase 客户端不支持直接执行 SQL 创建表
  // 需要手动在 Supabase Dashboard 执行
  console.log('\n========================================');
  console.log('⛔ Supabase 客户端不支持直接执行 SQL 创建表');
  console.log('========================================');
  console.log('\n请手动执行以下步骤：');
  console.log('\n1. 打开 Supabase Dashboard');
  console.log('   https://supabase.com/dashboard/project/ozdlvxxoufkiazddvxys');
  console.log('\n2. 进入 SQL Editor');
  console.log('   左侧菜单 → SQL Editor → New query');
  console.log('\n3. 复制粘贴以下 SQL 并执行：');
  console.log('\n----------------------------------------');
  console.log(`
-- 创建支付订单表
CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGSERIAL PRIMARY KEY,
  out_trade_no VARCHAR(100) UNIQUE NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  credits INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  trade_no VARCHAR(100),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_orders_out_trade_no ON payment_orders(out_trade_no);

-- 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_payment_orders_updated_at ON payment_orders;
CREATE TRIGGER update_payment_orders_updated_at
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
`);
  console.log('----------------------------------------');
  console.log('\n4. 执行后验证：');
  console.log('   SELECT * FROM payment_orders LIMIT 1;');
  
  // SQL 文件已创建
  console.log('\n📄 SQL 文件已保存到: scripts/create-payment-orders-table.sql');
}

createPaymentOrdersTable()
  .then(() => {
    console.log('\n✅ 脚本执行完成');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 脚本执行失败:', error);
    process.exit(1);
  });