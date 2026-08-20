/**
 * 添加 TOPAIS Seedance 2.5 视频模型配置
 * 
 * 功能：
 * 1. 在 api_models 表中添加 topais-seedance-2-5 模型记录
 * 2. 关联到现有的 TOPAIS api_configs (config_id=28)
 * 
 * 使用方法：
 * npx tsx scripts/add-topais-seedance-25.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// 加载 .env.local 文件
config({ path: resolve(__dirname, '../.env.local') });

import { getSupabaseClient } from '../src/storage/database/supabase-client';

async function main() {
  console.log('========================================');
  console.log('添加 TOPAIS Seedance 2.5 视频模型配置');
  console.log('========================================\n');

  // 使用 service role 绕过 RLS
  const supabase = getSupabaseClient(undefined, true);

  // 1. 检查模型是否已存在
  const { data: existingModel } = await supabase
    .from('api_models')
    .select('id, model_id, model_name')
    .eq('model_id', 'topais-seedance-2-5')
    .single();

  if (existingModel) {
    console.log('topais-seedance-2-5 模型已存在：');
    console.log('   ID:', existingModel.id);
    console.log('   名称:', existingModel.model_name);
    console.log('\n如需更新，请删除后重新添加，或使用管理后台修改。');
    return;
  }

  // 2. 查找 TOPAIS api_configs（使用 TOPAIS Veo3.1 的 config_id=28，共享端点）
  const { data: topaisConfig } = await supabase
    .from('api_configs')
    .select('id, name, api_endpoint')
    .eq('id', 28)
    .single();

  if (!topaisConfig) {
    console.log('未找到 TOPAIS api_configs (id=28)，请检查数据库');
    process.exit(1);
  }

  const configId = topaisConfig.id;
  console.log('关联到 TOPAIS 接口配置：');
  console.log('   ID:', topaisConfig.id);
  console.log('   名称:', topaisConfig.name);
  console.log('   端点:', topaisConfig.api_endpoint, '\n');

  // 3. 创建模型配置
  console.log('步骤 1: 创建模型配置...');
  const { data: model, error: modelError } = await supabase
    .from('api_models')
    .insert({
      config_id: configId,
      model_id: 'topais-seedance-2-5',
      model_name: 'Seedance 2.5',
      description: 'ToAPIs通道 字节跳动 Seedance 2.5 视频生成模型，支持文生/首帧/首尾帧/多模态参考生视频，支持视频编辑/延长，支持参考视频/音频输入',
      parameters: {
        // 4-30秒
        durations: Array.from({ length: 27 }, (_, i) => ({ label: `${i + 4}秒`, value: String(i + 4) })),
        aspectRatios: [
          { label: '21:9', value: '21:9' },
          { label: '16:9', value: '16:9' },
          { label: '4:3', value: '4:3' },
          { label: '1:1', value: '1:1' },
          { label: '3:4', value: '3:4' },
          { label: '9:16', value: '9:16' },
          { label: '自适应', value: 'adaptive' },
        ],
        resolutions: [
          { label: '480P', value: '480p', credits: 60 },
          { label: '720P', value: '720p', credits: 80 },
        ],
        default_resolution: '720p',
        default_duration: 5,
        default_ratio: '16:9',
        maxImages: 30,
        maxVideos: 10,
        maxAudios: 10,
        imageMode: 'flexible',
        supportsDuration: true,
        showDuration: true,
        showResolution: true,
        supportsUpsample: false,
      },
      credits_base: 80,
      is_active: true,
      is_visible: true,
      sort_order: 40,
    })
    .select()
    .single();

  if (modelError) {
    console.log('创建模型配置失败：', modelError.message);
    process.exit(1);
  }
  console.log('模型配置创建成功，ID:', model.id, '\n');

  // 4. 完成
  console.log('========================================');
  console.log('配置完成！');
  console.log('========================================');
  console.log('\n模型配置：');
  console.log('  - model_id:', model.model_id);
  console.log('  - 名称:', model.model_name);
  console.log('  - 积分:', model.credits_base);
  console.log('  - config_id:', model.config_id);
  console.log('\n请刷新前端页面，在视频模型下拉列表中查看 "Seedance 2.5"');
}

main().catch(console.error);
