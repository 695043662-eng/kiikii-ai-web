/**
 * #669 任务三：修复 T8 Seedance 模型的 config_id 断链问题
 * 
 * 问题：T8 模型在管理后台"API 配置中心"显示为 0 个，因为 api_models 表中对应记录的 config_id 为 null 或不匹配
 * 
 * 解决方案：
 * 1. 确保存在 T8 视频生成配置（api_configs）
 * 2. 将所有 sdols 模型的 config_id 绑定到正确的视频配置
 * 
 * 执行方式：node scripts/fix-t8-config-id.js
 */

const { createClient } = require('@supabase/supabase-js');

// 从环境变量获取数据库连接信息
const supabaseUrl = process.env.SUPABASE_URL || process.env.PROD_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 缺少数据库连接信息，请设置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixT8ConfigId() {
  console.log('========================================');
  console.log('#669 任务三：修复 T8 Seedance config_id');
  console.log('========================================\n');

  // 1. 查看现有的视频生成配置
  console.log('📋 步骤1：查看现有视频生成配置...');
  const { data: videoConfigs, error: configError } = await supabase
    .from('api_configs')
    .select('id, name, service_type')
    .eq('service_type', 'video_generation');

  if (configError) {
    console.error('❌ 查询配置失败:', configError.message);
    return;
  }

  console.log(`   找到 ${videoConfigs?.length || 0} 个视频生成配置:`);
  videoConfigs?.forEach(c => console.log(`   - id=${c.id} | ${c.name}`));

  // 2. 确定目标 config_id
  let targetConfigId = null;

  // 查找 T8 或 LingYa 相关的配置
  const t8Config = videoConfigs?.find(c => 
    c.name?.toLowerCase().includes('t8') || 
    c.name?.toLowerCase().includes('lingya') ||
    c.name?.toLowerCase().includes('seedance')
  );

  if (t8Config) {
    targetConfigId = t8Config.id;
    console.log(`\n✅ 找到 T8/LingYa 配置: id=${targetConfigId} (${t8Config.name})`);
  } else if (videoConfigs && videoConfigs.length > 0) {
    targetConfigId = videoConfigs[0].id;
    console.log(`\n⚠️ 未找到 T8 专属配置，使用第一个视频配置: id=${targetConfigId}`);
  } else {
    console.log('\n❌ 没有视频生成配置，需要先创建配置！');
    return;
  }

  // 3. 查看现有的 sdols 模型
  console.log('\n📋 步骤2：查看现有 sdols 模型...');
  const { data: allModels, error: modelError } = await supabase
    .from('api_models')
    .select('id, model_id, model_name, config_id, is_active');

  if (modelError) {
    console.error('❌ 查询模型失败:', modelError.message);
    return;
  }

  const sdolsModels = allModels?.filter(m => m.model_id?.toLowerCase().includes('sdols'));
  console.log(`   找到 ${sdolsModels?.length || 0} 个 sdols 模型:`);
  sdolsModels?.forEach(m => console.log(`   - model_id=${m.model_id} | config_id=${m.config_id} | active=${m.is_active}`));

  if (!sdolsModels || sdolsModels.length === 0) {
    console.log('\n⚠️ 数据库中没有 sdols 模型，需要先创建模型记录！');
    console.log('   提示：可以在管理后台手动添加，model_id 为 sdols-01-pro 和 sdols-01-lite');
    return;
  }

  // 4. 修复 config_id
  const modelsToFix = sdolsModels.filter(m => m.config_id !== targetConfigId);
  if (modelsToFix.length === 0) {
    console.log('\n✅ 所有 sdols 模型的 config_id 已正确配置，无需修复！');
    return;
  }

  console.log(`\n📋 步骤3：修复 ${modelsToFix.length} 个模型的 config_id...`);
  
  for (const model of modelsToFix) {
    const { error: updateError } = await supabase
      .from('api_models')
      .update({ config_id: targetConfigId, updated_at: new Date().toISOString() })
      .eq('id', model.id);

    if (updateError) {
      console.error(`   ❌ 修复 ${model.model_id} 失败:`, updateError.message);
    } else {
      console.log(`   ✅ 修复 ${model.model_id}: config_id ${model.config_id} → ${targetConfigId}`);
    }
  }

  // 5. 验证修复结果
  console.log('\n📋 步骤4：验证修复结果...');
  const { data: fixedModels } = await supabase
    .from('api_models')
    .select('id, model_id, config_id, is_active')
    .ilike('model_id', '%sdols%');

  console.log('   修复后的 sdols 模型:');
  fixedModels?.forEach(m => console.log(`   - model_id=${m.model_id} | config_id=${m.config_id} | active=${m.is_active}`));

  console.log('\n========================================');
  console.log('✅ 修复完成！');
  console.log('========================================');
}

fixT8ConfigId().catch(console.error);
