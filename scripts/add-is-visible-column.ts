/**
 * 添加 is_visible 字段到 api_models 表
 * 
 * 使用方法：
 * npx tsx scripts/add-is-visible-column.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

import { getSupabaseClient } from '../src/storage/database/supabase-client';

async function main() {
  console.log('========================================');
  console.log('添加 is_visible 字段');
  console.log('========================================\n');

  const supabase = getSupabaseClient(undefined, true);

  // 检查字段是否已存在
  const { data: testData, error: testError } = await supabase
    .from('api_models')
    .select('id, is_visible')
    .limit(1);

  if (!testError && testData) {
    console.log('✅ is_visible 字段已存在！');
    
    // 更新所有记录的 is_visible 为 true
    const { error: updateError } = await supabase
      .from('api_models')
      .update({ is_visible: true })
      .is('is_visible', null);
    
    if (updateError) {
      console.log('警告：更新默认值失败:', updateError.message);
    } else {
      console.log('✅ 已将所有记录的 is_visible 设置为 true');
    }
    return;
  }

  console.log('❌ is_visible 字段不存在');
  console.log('\n请在 Supabase 控制台执行以下 SQL:');
  console.log('----------------------------------------');
  console.log('ALTER TABLE api_models ADD COLUMN is_visible BOOLEAN DEFAULT TRUE;');
  console.log('----------------------------------------');
  console.log('\n执行地址：');
  console.log('https://ozdlvxxoufkiazddvxys.supabase.co/project/ozdlvxxoufkiazddvxys/sql/new');
}

main().catch(console.error);
