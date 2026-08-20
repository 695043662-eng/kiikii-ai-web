/**
 * 修复 Seedance 模型的 api_endpoint
 * 
 * 问题：model.api_endpoint = '/v2/videos/generations' 是相对路径
 *       getModelAPIConfigFull 优先用 model.api_endpoint，但只对 Gemini 自动拼接
 *       导致 Seedance 请求发送到 '/v2/videos/generations' 而不是完整 URL
 * 
 * 修复：将 model.api_endpoint 设为 null，让逻辑回退到 config.api_endpoint
 *       config.api_endpoint = 'https://ai.t8star.cn/v2/videos/generations' (完整 URL)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.DEV_SUPABASE_URL || 'REDACTED_DEV_DB_URL';
const SUPABASE_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('修复 Seedance 模型的 api_endpoint...');

  // 将 model.api_endpoint 设为 null，让逻辑回退到 config.api_endpoint
  const { data, error } = await supabase
    .from('api_models')
    .update({ api_endpoint: null })
    .in('model_id', ['sdols-2.0', 'sdols-2.0-fast'])
    .select('model_id, model_name, api_endpoint, config_id');

  if (error) {
    console.error('更新失败:', error);
    process.exit(1);
  }

  console.log('更新成功:');
  data?.forEach(m => {
    console.log(`  ✅ ${m.model_id}: api_endpoint=${m.api_endpoint} (null=使用config端点)`);
  });

  // 验证完整端点解析
  console.log('\n预期解析结果:');
  const { data: config } = await supabase
    .from('api_configs')
    .select('id, name, api_endpoint')
    .eq('id', 23)
    .single();

  console.log(`  config endpoint: ${config?.api_endpoint}`);
  console.log(`  model endpoint: null → 回退到 config endpoint`);
  console.log(`  最终 endpoint: ${config?.api_endpoint}`);
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
