/**
 * 修复 Seedance 模型的 parameters.aspectRatios 格式
 * 
 * 问题：aspectRatios 使用了简单的字符串数组 ['16:9', ...]
 *       但前端代码期望对象数组 [{ value: '16:9' }, ...]
 *       导致前端解析出 [undefined, undefined, ...]
 * 
 * 修复：将 aspectRatios 改为对象数组格式
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.DEV_SUPABASE_URL || 'REDACTED_DEV_DB_URL';
const SUPABASE_SERVICE_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || 'REDACTED_SUPABASE_KEY';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 将字符串数组转为对象数组
const ratioStrings = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'];
const aspectRatios = ratioStrings.map(r => ({ value: r, label: r }));

// Seedance 支持的时长配置
const durations = [
  { label: '5秒', value: '5s', credits: 10 },
  { label: '10秒', value: '10s', credits: 20 },
];

const fastDurations = [
  { label: '5秒', value: '5s', credits: 5 },
  { label: '10秒', value: '10s', credits: 10 },
];

async function main() {
  console.log('修复 Seedance parameters 格式...');

  // sdols-2.0 标准版
  const { data: d1, error: e1 } = await supabase
    .from('api_models')
    .update({
      parameters: {
        duration: [5, 10],
        default_duration: 5,
        resolution: ['480p', '720p', '1080p'],
        default_resolution: '720p',
        ratio: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21', 'adaptive'],
        default_ratio: '16:9',
        aspectRatios,
        supportsDuration: true,
        supportsUpsample: false,
        maxImages: 1,
        imageMode: 'first_last_frame',
        supportsImageInput: true,
        supportsVideoInput: false,
        category: 'video',
        provider: 'T8Star',
        durations,
      },
    })
    .eq('model_id', 'sdols-2.0')
    .select('model_id, parameters')
    .single();

  if (e1) {
    console.error('更新 sdols-2.0 失败:', e1);
  } else {
    console.log('✅ sdols-2.0 已更新');
    console.log('   aspectRatios:', JSON.stringify(d1.parameters.aspectRatios));
    console.log('   durations:', JSON.stringify(d1.parameters.durations));
  }

  // sdols-2.0-fast 快速版
  const { data: d2, error: e2 } = await supabase
    .from('api_models')
    .update({
      parameters: {
        duration: [5, 10],
        default_duration: 5,
        resolution: ['480p', '720p'],
        default_resolution: '480p',
        ratio: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21', 'adaptive'],
        default_ratio: '16:9',
        aspectRatios,
        supportsDuration: true,
        supportsUpsample: false,
        maxImages: 1,
        imageMode: 'first_last_frame',
        supportsImageInput: true,
        supportsVideoInput: false,
        category: 'video',
        provider: 'T8Star',
        durations: fastDurations,
      },
    })
    .eq('model_id', 'sdols-2.0-fast')
    .select('model_id, parameters')
    .single();

  if (e2) {
    console.error('更新 sdols-2.0-fast 失败:', e2);
  } else {
    console.log('✅ sdols-2.0-fast 已更新');
    console.log('   aspectRatios:', JSON.stringify(d2.parameters.aspectRatios));
    console.log('   durations:', JSON.stringify(d2.parameters.durations));
  }
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
