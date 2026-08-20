/**
 * 统一 Seedance 2.0 模型参数配置脚本
 * 
 * 功能：将 sdols-2.0 和 sdols-2.0-fast 的参数统一为完全一致
 * - 分辨率：480p, 720p, 1080p
 * - 时长：5秒, 10秒, 15秒
 * - 比例：21:9, 16:9, 4:3, 1:1, 3:4, 9:16, 9:21, adaptive
 * - 积分计费：videoPricing { 480p: 60/s, 720p: 80/s, 1080p: 100/s }
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.DEV_SUPABASE_URL || 'REDACTED_DEV_DB_URL';
const SUPABASE_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  console.log('========================================');
  console.log('统一 Seedance 2.0 模型参数配置');
  console.log('========================================\n');

  const unifiedParameters = {
    durations: [
      { label: '5秒', value: '5', credits: 300 },
      { label: '10秒', value: '10', credits: 600 },
      { label: '15秒', value: '15', credits: 900 },
    ],
    default_duration: 5,
    resolutions: [
      { size: '480p', credits: 60 },
      { size: '720p', credits: 80 },
      { size: '1080p', credits: 100 },
    ],
    resolution: ['480p', '720p', '1080p'],
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
    ratio: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21', 'adaptive'],
    default_ratio: '16:9',
    supportsImageInput: true,
    supportsVideoInput: false,
    supportsDuration: true,
    supportsUpsample: false,
    maxImages: 1,
    imageMode: 'first_last_frame',
    category: 'video',
    provider: 'T8Star',
    videoPricing: { '480p': 60, '720p': 80, '1080p': 100 },
  };

  // 更新 sdols-2.0
  console.log('[1/2] 更新 sdols-2.0...');
  const { data: data1, error: error1 } = await supabase
    .from('api_models')
    .update({
      credits_base: 80,
      description: '字节跳动 Seedance 2.0 标准版视频生成模型，支持文生视频和图生视频',
      parameters: unifiedParameters,
    })
    .eq('model_id', 'sdols-2.0')
    .select();

  if (error1) {
    console.error('更新 sdols-2.0 失败:', error1);
  } else {
    console.log('✅ sdols-2.0 已更新, credits_base=80');
  }

  // 更新 sdols-2.0-fast（参数完全一致，只是生成速度不同）
  console.log('[2/2] 更新 sdols-2.0-fast...');
  const { data: data2, error: error2 } = await supabase
    .from('api_models')
    .update({
      credits_base: 80,
      description: '字节跳动 Seedance 2.0 快速版视频生成模型，速度更快，参数与标准版完全一致',
      parameters: unifiedParameters,
    })
    .eq('model_id', 'sdols-2.0-fast')
    .select();

  if (error2) {
    console.error('更新 sdols-2.0-fast 失败:', error2);
  } else {
    console.log('✅ sdols-2.0-fast 已更新, credits_base=80');
  }

  // 验证
  console.log('\n[验证] 查询更新后的配置...');
  const { data: verifyModels, error: verifyError } = await supabase
    .from('api_models')
    .select('model_id, model_name, credits_base, is_active, parameters')
    .in('model_id', ['sdols-2.0', 'sdols-2.0-fast']);

  if (verifyError) {
    console.error('验证失败:', verifyError);
  } else {
    verifyModels?.forEach(m => {
      console.log(`\n  model_id: ${m.model_id}`);
      console.log(`  credits_base: ${m.credits_base}`);
      console.log(`  resolutions: ${m.parameters?.resolution?.join(', ')}`);
      console.log(`  durations: ${m.parameters?.durations?.map(d => d.label).join(', ')}`);
      console.log(`  aspectRatios: ${m.parameters?.aspectRatios?.map(r => r.value).join(', ')}`);
      console.log(`  videoPricing: ${JSON.stringify(m.parameters?.videoPricing)}`);
    });
  }

  console.log('\n========================================');
  console.log('配置完成！');
  console.log('========================================');
}

main().catch(console.error);
