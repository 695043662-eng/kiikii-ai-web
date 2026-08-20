/**
 * 检查 T8Star API 配置
 * 用于验证域名是否需要更新
 */

import { createClient } from '@supabase/supabase-js';

// 从环境变量或 .env.local 读取
const SUPABASE_URL = process.env.SUPABASE_URL || 'REDACTED_DEV_DB_URL';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function checkT8StarConfig() {
  console.log('========================================');
  console.log('检查 T8Star API 配置');
  console.log('========================================\n');

  // 1. 查询所有包含 t8star 的配置
  const { data: t8starConfigs, error: queryError } = await supabase
    .from('api_configs')
    .select('config_id, name, api_endpoint, api_key')
    .or('api_endpoint.ilike.%t8star%,name.ilike.%T8Star%');

  if (queryError) {
    console.error('❌ 查询失败:', queryError);
    return;
  }

  console.log('📋 当前 T8Star 配置:\n');
  console.table(t8starConfigs?.map(c => ({
    config_id: c.config_id,
    name: c.name,
    api_endpoint: c.api_endpoint,
    needs_update: c.api_endpoint?.includes('ai.t8star.cn') ? '⚠️ 需要更新' : '✅ 已是新域名'
  })));

  // 2. 检查需要更新的数量
  const needsUpdate = t8starConfigs?.filter(c => c.api_endpoint?.includes('ai.t8star.cn')) || [];
  
  console.log('\n========================================');
  if (needsUpdate.length === 0) {
    console.log('✅ 所有 T8Star 配置已是新域名，无需更新');
  } else {
    console.log(`⚠️ 发现 ${needsUpdate.length} 条配置需要更新`);
    console.log('\n需要更新的配置:');
    needsUpdate.forEach(c => {
      console.log(`  - [${c.config_id}] ${c.name}`);
      console.log(`    旧: ${c.api_endpoint}`);
      console.log(`    新: ${c.api_endpoint?.replace('ai.t8star.cn', 'ai.t8star.org')}`);
    });
  }
  console.log('========================================\n');

  // 3. 查询所有生图模型配置（确保不影响）
  const { data: imageConfigs, error: imageError } = await supabase
    .from('api_configs')
    .select('config_id, name, api_endpoint')
    .not('api_endpoint', 'ilike', '%t8star%')
    .limit(10);

  if (!imageError && imageConfigs) {
    console.log('📋 其他模型配置（不受影响）:');
    console.table(imageConfigs.map(c => ({
      config_id: c.config_id,
      name: c.name,
      api_endpoint: c.api_endpoint?.substring(0, 50) + '...'
    })));
  }
}

checkT8StarConfig().then(() => {
  console.log('\n✅ 检查完成');
  process.exit(0);
}).catch(err => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
