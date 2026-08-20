/**
 * 迁移脚本：更新 MiniMax-H3 模型配置
 * - 添加 768p 分辨率选项
 * - 启用 showResolution（显示分辨率选择器）
 * - 比例列表移除 adaptive（t2v不支持，r2v由ModelModeSwitcher动态添加）
 * 
 * 执行方式：node scripts/migrate-minimax-h3-config.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// 加载 .env.isolated
config({ path: '.env.isolated' });

const supabaseUrl = process.env.PROD_SUPABASE_URL;
const supabaseServiceKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ 缺少 PROD_SUPABASE_URL 或 PROD_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function migrate() {
  console.log('🔄 开始迁移 MiniMax-H3 模型配置...');

  // 1. 查询当前配置
  const { data: currentModel, error: fetchError } = await supabase
    .from('api_models')
    .select('id, model_id, parameters')
    .eq('model_id', 'topais-minimax-h3')
    .single();

  if (fetchError) {
    console.error('❌ 查询模型失败:', fetchError.message);
    process.exit(1);
  }

  if (!currentModel) {
    console.error('❌ 未找到 topais-minimax-h3 模型记录');
    process.exit(1);
  }

  console.log('📋 当前配置:', JSON.stringify(currentModel.parameters, null, 2));

  // 2. 更新 parameters
  const currentParams = currentModel.parameters || {};
  
  // 添加 768p 分辨率
  const newResolutions = [
    { label: '2K', value: '2K', credits: 100 },
    { label: '768P', value: '768p', credits: 50 },
  ];

  // 比例列表移除 adaptive（t2v不支持，r2v由前端ModelModeSwitcher动态添加）
  const currentRatios = currentParams.aspectRatios || [];
  const newRatios = currentRatios.filter(r => (r.value || r.label) !== 'adaptive');

  const updatedParams = {
    ...currentParams,
    resolutions: newResolutions,
    aspectRatios: newRatios,
    showResolution: true,  // 启用分辨率选择器
  };

  console.log('📝 新配置:', JSON.stringify(updatedParams, null, 2));

  // 3. 执行更新
  const { data: updatedModel, error: updateError } = await supabase
    .from('api_models')
    .update({ parameters: updatedParams })
    .eq('id', currentModel.id)
    .select()
    .single();

  if (updateError) {
    console.error('❌ 更新失败:', updateError.message);
    process.exit(1);
  }

  console.log('✅ 迁移完成！');
  console.log('📊 更新后的参数:', JSON.stringify(updatedModel.parameters, null, 2));
}

migrate().catch(err => {
  console.error('❌ 迁移异常:', err);
  process.exit(1);
});
