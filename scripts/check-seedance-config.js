/**
 * 检查 T8Star-Veo-Video 配置的 service_type
 */
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.DEV_SUPABASE_URL || 'REDACTED_DEV_DB_URL';
const SUPABASE_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('api_configs')
    .select('id, name, service_type, is_active')
    .eq('id', 23)
    .single();

  if (error) {
    console.error('查询失败:', error);
  } else {
    console.log('T8Star-Veo-Video 配置:');
    console.log(JSON.stringify(data, null, 2));
  }

  // 同时检查 Seedance 模型
  const { data: models } = await supabase
    .from('api_models')
    .select('model_id, model_name, is_active, is_visible, config_id')
    .in('model_id', ['sdols-2.0', 'sdols-2.0-fast']);

  console.log('\nSeedance 模型:');
  models?.forEach(m => console.log(`  ${m.model_id}: is_active=${m.is_active}, is_visible=${m.is_visible}, config_id=${m.config_id}`));
}

main().catch(console.error);
