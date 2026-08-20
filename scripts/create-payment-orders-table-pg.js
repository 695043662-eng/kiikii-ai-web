/**
 * 创建 payment_orders 表（使用 PostgreSQL 直连）
 * 
 * ⚠️ 注意：需要数据库密码（从 Supabase Dashboard 获取）
 * Database Settings → Connection string → URI
 */

const { Client } = require('pg');
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

// Supabase Transaction Pooler 连接字符串格式
// postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
// 需要从 Supabase Dashboard → Database Settings 获取数据库密码

const SUPABASE_URL = process.env.SUPABASE_URL || localEnv.SUPABASE_URL;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || localEnv.SUPABASE_DB_PASSWORD;

// 从 SUPABASE_URL 解析 project-ref
const projectRef = SUPABASE_URL?.match(/\/\/([a-z]+)\.supabase\.co/)?.[1];

if (!SUPABASE_URL || !projectRef) {
  console.error('❌ 缺少 SUPABASE_URL 环境变量');
  process.exit(1);
}

if (!DB_PASSWORD) {
  console.error('❌ 缺少数据库密码 (SUPABASE_DB_PASSWORD)');
  console.error('\n请从 Supabase Dashboard 获取数据库密码：');
  console.error('1. 打开 https://supabase.com/dashboard/project/' + projectRef);
  console.error('2. 进入 Project Settings → Database');
  console.error('3. 复制 Database Password');
  console.error('4. 设置环境变量: SUPABASE_DB_PASSWORD=你的密码');
  console.error('\n或在 .env.local 中添加:');
  console.error('SUPABASE_DB_PASSWORD=你的密码');
  process.exit(1);
}

// 构建连接字符串（使用 Transaction Pooler，支持 PREPARE statements）
const connectionString = `postgres://postgres.${projectRef}:${DB_PASSWORD}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;

console.log(`🔗 连接数据库: postgres.${projectRef}@pooler.supabase.com:6543`);

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

async function createPaymentOrdersTable() {
  console.log('========================================');
  console.log('创建 payment_orders 表');
  console.log('========================================\n');

  try {
    await client.connect();
    console.log('✅ 数据库连接成功\n');

    // 检查表是否已存在
    console.log('📋 步骤1：检查表是否已存在...');
    const checkResult = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'payment_orders'
      );
    `);
    
    if (checkResult.rows[0].exists) {
      console.log('✅ payment_orders 表已存在，检查是否缺少列...');
      
      // #885 修复：表已存在时，检查并补充缺失的列（raw_notify, package_name 等）
      const existingColumns = await client.query(`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payment_orders';
      `);
      const columnNames = existingColumns.rows.map(r => r.column_name);
      
      const migrations = [
        { name: 'raw_notify', sql: 'ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS raw_notify JSONB;' },
        { name: 'package_name', sql: 'ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS package_name VARCHAR(200);' },
      ];
      
      for (const migration of migrations) {
        if (!columnNames.includes(migration.name)) {
          console.log(`  ➕ 补充缺失列: ${migration.name}`);
          await client.query(migration.sql);
          console.log(`  ✅ ${migration.name} 列添加成功`);
        } else {
          console.log(`  ✅ ${migration.name} 列已存在`);
        }
      }
      
      await client.end();
      return;
    }
    
    console.log('⚠️ 表不存在，开始创建...\n');

    // 创建表
    console.log('📋 步骤2：创建 payment_orders 表...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_orders (
        id BIGSERIAL PRIMARY KEY,
        out_trade_no VARCHAR(100) UNIQUE NOT NULL,
        user_id VARCHAR(100) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        credits INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
        trade_no VARCHAR(100),
        raw_notify JSONB,
        package_name VARCHAR(200),
        paid_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('✅ 表创建成功');

    // 创建索引
    console.log('\n📋 步骤3：创建索引...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
      CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_payment_orders_out_trade_no ON payment_orders(out_trade_no);
    `);
    console.log('✅ 索引创建成功');

    // 创建触发器函数
    console.log('\n📋 步骤4：创建触发器...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query(`
      DROP TRIGGER IF EXISTS update_payment_orders_updated_at ON payment_orders;
      CREATE TRIGGER update_payment_orders_updated_at
        BEFORE UPDATE ON payment_orders
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    `);
    console.log('✅ 触发器创建成功');

    // 验证表结构
    console.log('\n📋 步骤5：验证表结构...');
    const verifyResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'payment_orders'
      ORDER BY ordinal_position;
    `);
    
    console.log('\n表结构验证:');
    verifyResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? '可空' : '必填'})`);
    });

    await client.end();
    console.log('\n✅ payment_orders 表创建完成！');

  } catch (error) {
    console.error('\n❌ 执行失败:', error.message);
    await client.end();
    process.exit(1);
  }
}

createPaymentOrdersTable();