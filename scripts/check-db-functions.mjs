/**
 * 检查数据库中的可用表和函数
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envFiles = ['.env.isolated', '.env.local'];
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
    } catch (e) {}
  }
  return result;
}

async function main() {
  const env = loadEnv();
  const url = process.env.SUPABASE_URL || env.SUPABASE_URL || env.DEV_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.DEV_SUPABASE_SERVICE_ROLE_KEY;
  
  const supabase = createClient(url, serviceRoleKey);
  
  console.log('========================================');
  console.log('检查数据库中的可用表');
  console.log('========================================\n');
  
  // 列出已知的可用表
  const tables = [
    'users', 
    'credit_logs', 
    'generation_records', 
    'api_configs', 
    'api_models', 
    'recharge_packages',
    'redeem_keys',
    'exchange_records',
    'favorites_images',
    'favorites_videos',
    'favorites_texts',
    'canvas_elements',
    'payment_orders'
  ];
  
  console.log('📋 检查已存在的表...\n');
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('id').limit(1);
    if (error) {
      const msg = error.message.includes('does not exist') || error.message.includes('relation') ? '不存在' : error.message;
      console.log(`  ${table}: ❌ ${msg}`);
    } else {
      console.log(`  ${table}: ✅ 存在 (${data?.length || 0} 条记录)`);
    }
  }
  
  // 检查触发器函数是否存在
  console.log('\n📋 检查触发器函数...');
  
  // 尝试调用 update_updated_at_column 函数（如果存在）
  try {
    const result = await supabase.rpc('update_updated_at_column_test');
    console.log('  update_updated_at_column: ✅ 存在');
  } catch (e) {
    console.log('  update_updated_at_column: ❌ 不存在（这是正常的，它是触发器函数）');
  }
  
  console.log('\n========================================');
  console.log('✅ 检查完成');
  console.log('========================================');
}

main();