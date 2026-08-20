/**
 * 修复 Seedance 2.0 的 config_id 指向正确的 T8Star-Veo-Video 配置
 * 
 * 问题：之前脚本错误地将 config_id 指向了 T8Star-GPT-Image-2 (id=3)
 * 修复：将 config_id 更新为 T8Star-Veo-Video (id=23)
 * 原因：Seedance 使用与 Veo 相同的视频网关端点 /v2/videos/generations
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.DEV_SUPABASE_URL || 'REDACTED_DEV_DB_URL';
const SUPABASE_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('修复 Seedance 模型的 config_id...');

  // 1. 确认 T8Star-Veo-Video 配置 id
  const { data: veoConfig } = await supabase
    .from('api_configs')
    .select('id, name, api_endpoint')
    .eq('name', 'T8Star-Veo-Video')
    .single();

  if (!veoConfig) {
    console.error('未找到 T8Star-Veo-Video 配置！');
    process.exit(1);
  }

  console.log(`找到 Veo 视频网关: id=${veoConfig.id}, name="${veoConfig.name}"`);

  // 2. 更新 Seedance 模型的 config_id
  const { data, error } = await supabase
    .from('api_models')
    .update({ config_id: veoConfig.id })
    .in('model_id', ['sdols-2.0', 'sdols-2.0-fast'])
    .select('model_id, model_name, config_id');

  if (error) {
    console.error('更新失败:', error);
    process.exit(1);
  }

  console.log('更新成功:');
  data?.forEach(m => {
    console.log(`  ✅ ${m.model_id}: config_id=${m.config_id}`);
  });

  // 3. 验证完整配置链路
  console.log('\n验证配置链路:');
  for (const m of data || []) {
    const { data: fullModel } = await supabase
      .from('api_models')
      .select('model_id, model_name, api_endpoint, config_id, api_configs(id, name, api_endpoint)')
      .eq('model_id', m.model_id)
      .single();

    if (fullModel) {
      console.log(`  ${fullModel.model_id}:`);
      console.log(`    model endpoint: ${fullModel.api_endpoint}`);
      console.log(`    config: "${fullModel.api_configs?.name}" endpoint: ${fullModel.api_configs?.api_endpoint?.substring(0, 60)}...`);
    }
  }
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
