/**
 * 创建 payment_orders 表 - 使用 Supabase RPC 方式
 * 
 * 执行方式：node scripts/create-payment-orders-table-rpc.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// 加载环境变量
function loadEnv() {
  const envFiles = ['.env.isolated', '.env.local', '.env.production'];
  const result = {};
  
  for (const file of envFiles) {
    try {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const key = trimmed.substring(0, eq).trim();
            let value = trimmed.substring(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (!result[key]) {
              result[key] = value;
            }
          }
        });
      }
    } catch (e) {
      // ignore
    }
  }
  return result;
}

async function main() {
  console.log('========================================');
  console.log('创建 payment_orders 表');
  console.log('========================================\n');
  
  const env = loadEnv();
  const url = process.env.SUPABASE_URL || env.SUPABASE_URL || env.DEV_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.DEV_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceRoleKey) {
    console.error('❌ 缺少环境变量: SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  console.log(`📡 数据库 URL: ${url.substring(0, 40)}...\n`);
  
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  // 1. 检查表是否已存在
  console.log('📋 步骤1：检查表是否已存在...');
  const { data: existing, error: checkError } = await supabase
    .from('payment_orders')
    .select('id')
    .limit(1);
  
  if (!checkError) {
    console.log('✅ payment_orders 表已存在，无需创建');
    process.exit(0);
  }
  
  if (checkError.code === '42P01' || checkError.message.includes('does not exist') || checkError.message.includes('relation')) {
    console.log('⚠️ 表不存在，开始创建...');
  } else {
    console.log('   检查结果:', checkError.message);
  }
  
  // 2. 尝试通过 RPC 执行 SQL
  console.log('\n📋 步骤2：尝试通过 RPC 执行 SQL...');
  
  const createTableSQL = `
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
    
    CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
    CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders(created_at);
    
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
    
    DROP TRIGGER IF EXISTS update_payment_orders_updated_at ON payment_orders;
    CREATE TRIGGER update_payment_orders_updated_at
      BEFORE UPDATE ON payment_orders
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  `;
  
  // 尝试调用 exec_sql RPC（如果存在）
  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('exec_sql', { sql: createTableSQL });
    
    if (rpcError) {
      console.log('   RPC 调用失败:', rpcError.message);
      
      // 尝试另一种方式：通过 HTTP 直接调用 Supabase SQL API
      console.log('\n📋 步骤3：尝试通过 HTTP API 执行 SQL...');
      
      const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sql: createTableSQL })
      });
      
      if (!response.ok) {
        const text = await response.text();
        console.log('   HTTP API 失败:', text);
        
        // 最终方案：使用 PostgreSQL 直连
        console.log('\n📋 步骤4：需要 PostgreSQL 直连密码...');
        console.log('\n========================================');
        console.log('请在 Supabase Dashboard 获取数据库密码：');
        console.log('1. 打开 https://supabase.com/dashboard');
        console.log('2. 选择项目 → Project Settings → Database');
        console.log('3. 复制 Connection string 中的密码');
        console.log('4. 执行: node scripts/create-payment-orders-table-pg.js');
        console.log('========================================\n');
        
        // 输出 SQL 文件
        console.log('或手动执行 SQL（复制到 Supabase SQL Editor）：');
        console.log(createTableSQL);
        
        process.exit(1);
      }
      
      console.log('✅ HTTP API 执行成功');
    } else {
      console.log('✅ RPC 执行成功:', rpcResult);
    }
  } catch (e) {
    console.log('   执行异常:', e.message);
  }
  
  // 3. 验证创建结果
  console.log('\n📋 步骤5：验证创建结果...');
  const { data: verify, error: verifyError } = await supabase
    .from('payment_orders')
    .select('id')
    .limit(1);
  
  if (!verifyError) {
    console.log('✅ payment_orders 表创建成功！');
  } else {
    console.log('❌ 表创建失败:', verifyError.message);
    process.exit(1);
  }
}

main().catch(console.error);