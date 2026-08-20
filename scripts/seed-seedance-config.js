/**
 * Seedance 2.0 数据库配置脚本
 * 
 * 功能：在 api_configs 和 api_models 表中插入 Seedance 2.0 模型配置
 * 用法：node scripts/seed-seedance-config.js
 * 
 * 模型列表：
 * - sdols-2.0 (标准版)
 * - sdols-2.0-fast (快速版)
 */

const { createClient } = require('@supabase/supabase-js');

// 从 .env.isolated 读取开发数据库配置
const SUPABASE_URL = process.env.DEV_SUPABASE_URL || 'REDACTED_DEV_DB_URL';
const SUPABASE_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('========================================');
  console.log('Seedance 2.0 数据库配置脚本');
  console.log('========================================\n');

  // Step 1: 查找 T8 供应商的 api_config（复用现有 T8 视频网关配置）
  console.log('[Step 1] 查找 T8 视频网关配置...');
  const { data: existingConfigs, error: configError } = await supabase
    .from('api_configs')
    .select('*')
    .or('name.ilike.%T8%,name.ilike.%t8%,name.ilike.%veo%,name.ilike.%sora%')
    .eq('is_active', true);

  if (configError) {
    console.error('查询 api_configs 失败:', configError);
    process.exit(1);
  }

  console.log(`找到 ${existingConfigs?.length || 0} 个 T8 相关配置:`);
  existingConfigs?.forEach(c => {
    console.log(`  - id=${c.id}, name="${c.name}", endpoint="${c.api_endpoint?.substring(0, 60)}..."`);
  });

  // Step 2: 检查是否已存在 Seedance 配置
  console.log('\n[Step 2] 检查是否已存在 Seedance 配置...');
  const { data: existingSeedance, error: seedanceCheckError } = await supabase
    .from('api_models')
    .select('*')
    .in('model_id', ['sdols-2.0', 'sdols-2.0-fast']);

  if (seedanceCheckError) {
    console.error('查询 api_models 失败:', seedanceCheckError);
    process.exit(1);
  }

  if (existingSeedance && existingSeedance.length > 0) {
    console.log('已存在 Seedance 模型配置:');
    existingSeedance.forEach(m => {
      console.log(`  - model_id="${m.model_id}", name="${m.model_name}", active=${m.is_active}`);
    });
    console.log('\n跳过插入，如需更新请手动操作。');
    
    // 显示现有配置的详细信息
    console.log('\n现有 Seedance 模型详情:');
    for (const m of existingSeedance) {
      console.log(`\n  model_id: ${m.model_id}`);
      console.log(`  model_name: ${m.model_name}`);
      console.log(`  api_endpoint: ${m.api_endpoint}`);
      console.log(`  credits_base: ${m.credits_base}`);
      console.log(`  parameters: ${JSON.stringify(m.parameters, null, 2)}`);
      console.log(`  is_active: ${m.is_active}`);
    }
    return;
  }

  // Step 3: 查找可复用的 T8 配置
  // 优先找 T8Star 相关的 Sora/Veo 配置
  let t8Config = existingConfigs?.find(c => 
    c.name?.includes('T8Star') || c.name?.includes('t8star')
  );
  
  if (!t8Config && existingConfigs?.length > 0) {
    // 回退：使用第一个 T8 配置
    t8Config = existingConfigs[0];
  }

  if (!t8Config) {
    console.log('\n未找到 T8 配置，将创建新的 api_config...');
    
    // 查找任意视频类配置获取 API Key
    const { data: anyVideoConfig } = await supabase
      .from('api_configs')
      .select('*')
      .eq('is_active', true)
      .limit(5);

    const apiKey = anyVideoConfig?.[0]?.api_key || '';
    const apiEndpoint = anyVideoConfig?.[0]?.api_endpoint || '';

    // 创建新的 api_config
    const { data: newConfig, error: createError } = await supabase
      .from('api_configs')
      .insert({
        name: 'T8Star Seedance 视频生成',
        service_type: 'video',
        api_endpoint: apiEndpoint.replace(/\/v1\/.*$/, '/v2/videos/generations'),
        api_key: apiKey,
        request_method: 'POST',
        is_active: true,
        request_headers: {
          'Content-Type': 'application/json',
        },
      })
      .select()
      .single();

    if (createError) {
      console.error('创建 api_config 失败:', createError);
      process.exit(1);
    }
    
    t8Config = newConfig;
    console.log('已创建新的 api_config, id:', t8Config.id);
  }

  console.log(`\n使用 T8 配置: id=${t8Config.id}, name="${t8Config.name}"`);

  // Step 4: 插入 Seedance 模型配置
  console.log('\n[Step 3] 插入 Seedance 模型配置...');

  const seedanceModels = [
    {
      model_id: 'sdols-2.0',
      model_name: 'Seedance 2.0',
      description: '字节跳动 Seedance 2.0 标准版视频生成模型，支持文生视频和图生视频',
      api_endpoint: '/v2/videos/generations',  // 相对路径，会拼接 base URL
      config_id: t8Config.id,
      credits_base: 80,  // 默认720p每秒80积分
      parameters: {
        durations: [
          { label: '5秒', value: '5', credits: 400 },
          { label: '10秒', value: '10', credits: 800 },
          { label: '15秒', value: '15', credits: 1200 },
        ],
        default_duration: 5,
        resolutions: [
          { size: '480p', credits: 60 },
          { size: '720p', credits: 80 },
          { size: '1080p', credits: 100 },
        ],
        default_resolution: '720p',
        aspectRatios: [
          { value: '21:9', label: '21:9' },
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
          { value: '3:4', label: '3:4' },
          { value: '9:16', label: '9:16' },
          { value: '9:21', label: '9:21' },
          { value: 'adaptive', label: '自适应' },
        ],
        default_ratio: '16:9',
        supportsImageInput: true,
        supportsVideoInput: false,
        supportsDuration: true,
        maxImages: 1,
        category: 'video',
        provider: 'T8Star',
        videoPricing: { '480p': 60, '720p': 80, '1080p': 100 },
      },
      is_active: true,
    },
    {
      model_id: 'sdols-2.0-fast',
      model_name: 'Seedance 2.0 Fast',
      description: '字节跳动 Seedance 2.0 快速版视频生成模型，速度更快，参数与标准版完全一致',
      api_endpoint: '/v2/videos/generations',
      config_id: t8Config.id,
      credits_base: 80,  // 默认720p每秒80积分
      parameters: {
        durations: [
          { label: '5秒', value: '5', credits: 400 },
          { label: '10秒', value: '10', credits: 800 },
          { label: '15秒', value: '15', credits: 1200 },
        ],
        default_duration: 5,
        resolutions: [
          { size: '480p', credits: 60 },
          { size: '720p', credits: 80 },
          { size: '1080p', credits: 100 },
        ],
        default_resolution: '720p',
        aspectRatios: [
          { value: '21:9', label: '21:9' },
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
          { value: '3:4', label: '3:4' },
          { value: '9:16', label: '9:16' },
          { value: '9:21', label: '9:21' },
          { value: 'adaptive', label: '自适应' },
        ],
        default_ratio: '16:9',
        supportsImageInput: true,
        supportsVideoInput: false,
        supportsDuration: true,
        maxImages: 1,
        category: 'video',
        provider: 'T8Star',
        videoPricing: { '480p': 60, '720p': 80, '1080p': 100 },
      },
      is_active: true,
    },
  ];

  for (const model of seedanceModels) {
    const { data, error } = await supabase
      .from('api_models')
      .insert(model)
      .select()
      .single();

    if (error) {
      console.error(`插入模型 ${model.model_id} 失败:`, error);
    } else {
      console.log(`✅ 已插入模型: ${model.model_id} (id=${data.id})`);
    }
  }

  // Step 5: 验证
  console.log('\n[Step 4] 验证配置...');
  const { data: verifyModels, error: verifyError } = await supabase
    .from('api_models')
    .select('model_id, model_name, credits_base, is_active, api_endpoint')
    .in('model_id', ['sdols-2.0', 'sdols-2.0-fast']);

  if (verifyError) {
    console.error('验证失败:', verifyError);
  } else {
    console.log('验证成功，已配置的 Seedance 模型:');
    verifyModels?.forEach(m => {
      console.log(`  ✅ ${m.model_id}: name="${m.model_name}", credits=${m.credits_base}, endpoint="${m.api_endpoint}", active=${m.is_active}`);
    });
  }

  console.log('\n========================================');
  console.log('Seedance 2.0 配置完成！');
  console.log('========================================');
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
