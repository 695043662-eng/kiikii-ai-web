/**
 * 修复视频模型配置 - 仅恢复被错误修改的 veo/sora 配置
 * 
 * 问题：之前统一修改了所有视频模型的 durations/aspectRatios/resolutions，
 *       但只应该修改 Seedance 模型
 * 
 * 修复内容：
 * 1. Veo 模型：移除 durations 字段（Veo 不支持用户选择时长，supportsDuration: false）
 * 2. Sora-2：恢复原始 durations（5秒/10秒）和 aspectRatios（9:16/16:9/1:1/auto）
 * 3. Seedance 模型：保持 4-15 秒（每个整数）不变 ✅
 */

const { createClient } = require('@supabase/supabase-js');
const url = 'REDACTED_DEV_DB_URL';
const key = 'REDACTED_SUPABASE_KEY';
const supabase = createClient(url, key);

// ====== Sora-2 原始配置 ======
const SORA2_ORIGINAL_DURATIONS = [
  { label: '5秒', value: '5' },
  { label: '10秒', value: '10' },
];

const SORA2_ORIGINAL_ASPECT_RATIOS = [
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
  { value: 'auto', label: '自适应' },
];

async function main() {
  console.log('========================================');
  console.log('🔧 修复视频模型配置（仅恢复 veo/sora）');
  console.log('========================================\n');

  // ====== 1. 查看当前所有视频模型 ======
  const { data: models, error } = await supabase
    .from('api_models')
    .select('id, model_id, model_name, parameters')
    .in('model_id', ['veo3.1-fast', 'veo3.1', 'veo3.1-components', 'veo3.1-pro', 'sora-2', 'sdols-2.0', 'sdols-2.0-fast'])
    .order('id');

  if (error) { console.error('❌ 查询失败:', error); process.exit(1); }

  console.log('📊 修复前状态：\n');
  models.forEach(m => {
    const p = m.parameters || {};
    console.log(`  ${m.model_id} (id:${m.id})`);
    console.log(`    durations: ${p.durations ? p.durations.length + '项' : '无'}`);
    console.log(`    aspectRatios: ${p.aspectRatios ? p.aspectRatios.length + '项' : '无'}`);
    console.log(`    supportsDuration: ${p.supportsDuration}`);
  });

  // ====== 2. 修复 Veo 模型：移除 durations ======
  console.log('\n🔧 修复 Veo 模型（移除 durations，因为 supportsDuration: false）...\n');

  const veoModels = models.filter(m => m.model_id.startsWith('veo'));
  for (const m of veoModels) {
    const params = { ...m.parameters };
    const hadDurations = !!params.durations;
    delete params.durations;
    
    const { error: updateError } = await supabase
      .from('api_models')
      .update({ parameters: params })
      .eq('id', m.id);

    if (updateError) {
      console.error(`  ❌ ${m.model_id} 更新失败:`, updateError.message);
    } else {
      console.log(`  ✅ ${m.model_id} 已移除 durations（原来有${hadDurations ? `${(m.parameters.durations || []).length}项` : '0项'}）`);
    }
  }

  // ====== 3. 修复 Sora-2：恢复原始 durations 和 aspectRatios ======
  console.log('\n🔧 修复 Sora-2（恢复原始 durations 和 aspectRatios）...\n');

  const soraModel = models.find(m => m.model_id === 'sora-2');
  if (soraModel) {
    const params = { ...soraModel.parameters };
    const oldDurations = params.durations?.length || 0;
    const oldAspectRatios = params.aspectRatios?.length || 0;
    
    params.durations = SORA2_ORIGINAL_DURATIONS;
    params.aspectRatios = SORA2_ORIGINAL_ASPECT_RATIOS;

    const { error: updateError } = await supabase
      .from('api_models')
      .update({ parameters: params })
      .eq('id', soraModel.id);

    if (updateError) {
      console.error(`  ❌ sora-2 更新失败:`, updateError.message);
    } else {
      console.log(`  ✅ sora-2 已恢复:`);
      console.log(`    durations: ${oldDurations}项 → ${SORA2_ORIGINAL_DURATIONS.length}项 (5秒/10秒)`);
      console.log(`    aspectRatios: ${oldAspectRatios}项 → ${SORA2_ORIGINAL_ASPECT_RATIOS.length}项 (9:16/16:9/1:1/自适应)`);
    }
  } else {
    console.log('  ⚠️ 未找到 sora-2 模型');
  }

  // ====== 4. 验证 Seedance 未被改动 ======
  console.log('\n🔍 验证 Seedance 模型未被改动...\n');

  const seedanceModels = models.filter(m => m.model_id.startsWith('sdols'));
  for (const m of seedanceModels) {
    const p = m.parameters || {};
    const durationsCount = p.durations?.length || 0;
    const firstDur = p.durations?.[0]?.value;
    const lastDur = p.durations?.[durationsCount - 1]?.value;
    
    if (durationsCount === 12 && firstDur === '4' && lastDur === '15') {
      console.log(`  ✅ ${m.model_id} 未被改动 (durations: 4-15, ${durationsCount}项)`);
    } else {
      console.log(`  ⚠️ ${m.model_id} durations 异常: ${durationsCount}项, 首项=${firstDur}, 末项=${lastDur}`);
    }
  }

  // ====== 5. 最终验证 ======
  console.log('\n📊 修复后状态：\n');

  const { data: finalModels } = await supabase
    .from('api_models')
    .select('id, model_id, model_name, parameters')
    .in('model_id', ['veo3.1-fast', 'veo3.1', 'veo3.1-components', 'veo3.1-pro', 'sora-2', 'sdols-2.0', 'sdols-2.0-fast'])
    .order('id');

  finalModels.forEach(m => {
    const p = m.parameters || {};
    const durInfo = p.durations 
      ? `${p.durations.length}项 [${p.durations.map(function(d) { return d.label; }).join(', ')}]`
      : '无（supportsDuration: false）';
    const ratioInfo = p.aspectRatios 
      ? `${p.aspectRatios.length}项 [${p.aspectRatios.map(function(r) { return r.value || r; }).join(', ')}]`
      : '无';
    console.log(`  ${m.model_id} (id:${m.id})`);
    console.log(`    durations: ${durInfo}`);
    console.log(`    aspectRatios: ${ratioInfo}`);
    console.log(`    supportsDuration: ${p.supportsDuration}`);
  });

  console.log('\n========================================');
  console.log('✅ 修复完成！');
  console.log('========================================');
}

main().catch(console.error);
