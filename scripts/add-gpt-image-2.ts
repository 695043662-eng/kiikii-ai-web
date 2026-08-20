/**
 * 添加 gpt-image-2 模型配置
 * 
 * 功能：
 * 1. 创建 GRS 通用生图接口配置（api_configs）
 * 2. 创建 gpt-image-2 模型配置（api_models）
 * 
 * 使用方法：
 * npx tsx scripts/add-gpt-image-2.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// 加载 .env.local 文件
config({ path: resolve(__dirname, '../.env.local') });

import { getSupabaseClient } from '../src/storage/database/supabase-client';

async function main() {
  console.log('========================================');
  console.log('添加 gpt-image-2 模型配置');
  console.log('========================================\n');

  // 使用 service role 绕过 RLS
  const supabase = getSupabaseClient(undefined, true);

  // 1. 检查是否已存在
  const { data: existingModel } = await supabase
    .from('api_models')
    .select('id, model_id, model_name')
    .eq('model_id', 'gpt-image-2')
    .single();

  if (existingModel) {
    console.log('❌ gpt-image-2 模型已存在：');
    console.log('   ID:', existingModel.id);
    console.log('   名称:', existingModel.model_name);
    console.log('\n如需更新，请删除后重新添加，或使用管理后台修改。');
    return;
  }

  // 2. 检查是否已有 GRS-通用生图接口
  const { data: existingConfig } = await supabase
    .from('api_configs')
    .select('id, name, api_endpoint')
    .eq('api_endpoint', 'https://grsai.dakka.com.cn/v1/draw/completions')
    .single();

  let configId: number;

  if (existingConfig) {
    console.log('✅ 复用现有接口配置：');
    console.log('   ID:', existingConfig.id);
    console.log('   名称:', existingConfig.name);
    console.log('   端点:', existingConfig.api_endpoint, '\n');
    configId = existingConfig.id;
  } else {
    // 3. 从环境变量获取 API Key
    const apiKey = process.env.GRS_API_KEY || process.env.NEXT_PUBLIC_DEFAULT_API_KEY;
    if (!apiKey) {
      console.log('❌ 未配置 API Key！');
      console.log('   请设置环境变量：GRS_API_KEY 或 NEXT_PUBLIC_DEFAULT_API_KEY');
      process.exit(1);
    }
    console.log('✅ API Key:', apiKey.substring(0, 15) + '...\n');

    // 4. 创建 API 配置
    console.log('步骤 1: 创建 API 接口配置...');
    
    // 获取当前最大 ID，手动指定新 ID
    const { data: maxIdResult } = await supabase
      .from('api_configs')
      .select('id')
      .order('id', { ascending: false })
      .limit(1);
    const nextId = (maxIdResult?.[0]?.id || 0) + 1;
    console.log('   使用 ID:', nextId);
    
    const { data: config, error: configError } = await supabase
      .from('api_configs')
      .insert({
        id: nextId,
        name: 'GRS-通用生图接口',
        service_type: 'image_generation',
        description: 'GRS AI 通用生图接口，支持 GPT Image 2 等模型',
        api_endpoint: 'https://grsai.dakka.com.cn/v1/draw/completions',
        request_method: 'POST',
        request_headers: {
          'Content-Type': 'application/json',
        },
        request_body_template: {
          model: '${model}',
          prompt: '${prompt}',
          aspectRatio: '${aspectRatio}',
          urls: '${urls}',
        },
        response_parser: {
          taskIdPath: 'data.taskId',
          statusPath: 'data.status',
          imageUrlPath: 'data.results[0].url',
          errorPath: 'data.error',
        },
        api_key: apiKey,
        is_active: true,
        sort_order: 10,
      })
      .select()
      .single();

    if (configError) {
      console.log('❌ 创建接口配置失败：', configError.message);
      process.exit(1);
    }
    console.log('✅ 接口配置创建成功，ID:', config.id, '\n');
    configId = config.id;
  }

  // 5. 创建模型配置
  console.log('步骤 2: 创建模型配置...');
  const { data: model, error: modelError } = await supabase
    .from('api_models')
    .insert({
      config_id: configId,
      model_id: 'gpt-image-2',
      model_name: 'GPT Image 2',
      description: 'OpenAI GPT Image 2 模型 (GRS)，高质量通用生图',
      parameters: {
        aspectRatios: [
          { label: '自动', value: 'auto' },
          { label: '1:1', value: '1:1' },
          { label: '3:2', value: '3:2' },
          { label: '2:3', value: '2:3' },
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
          { label: '5:4', value: '5:4' },
          { label: '4:5', value: '4:5' },
          { label: '4:3', value: '4:3' },
          { label: '3:4', value: '3:4' },
          { label: '21:9', value: '21:9' },
          { label: '9:21', value: '9:21' },
          { label: '1:3', value: '1:3' },
          { label: '3:1', value: '3:1' },
          { label: '2:1', value: '2:1' },
          { label: '1:2', value: '1:2' },
        ],
      },
      credits_base: 15,
      is_active: true,
      sort_order: 1,
    })
    .select()
    .single();

  if (modelError) {
    console.log('❌ 创建模型配置失败：', modelError.message);
    process.exit(1);
  }
  console.log('✅ 模型配置创建成功，ID:', model.id, '\n');

  // 6. 完成
  console.log('========================================');
  console.log('✅ 配置完成！');
  console.log('========================================');
  console.log('\n模型配置：');
  console.log('  - ID:', model.model_id);
  console.log('  - 名称:', model.model_name);
  console.log('  - 积分:', model.credits_base);
  console.log('  - 宽高比:', (model.parameters as any).aspectRatios.length, '种');
  console.log('\n请刷新前端页面，在模型下拉列表中查看 "GPT Image 2"');
}

main().catch(console.error);
