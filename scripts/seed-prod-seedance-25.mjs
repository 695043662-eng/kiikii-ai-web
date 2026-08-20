/**
 * 生产库种子脚本：添加 topais-seedance-2-5 模型
 * 
 * 此脚本直接连接生产数据库 (kiikii-prod)
 * 使用方式（在生产服务器执行）:
 *   node scripts/seed-prod-seedance-25.mjs
 * 
 * 或在开发环境测试:
 *   PROD_SUPABASE_URL=xxx PROD_SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/seed-prod-seedance-25.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 解析环境变量文件
function parseEnvFile(filePath) {
  const env = {};
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch (e) {
    // 文件不存在时忽略，依赖环境变量
  }
  return env;
}

// 优先从环境变量读取，其次从 .env.isolated 读取
const fileEnv = parseEnvFile(resolve(process.cwd(), '.env.isolated'));
const PROD_URL = process.env.PROD_SUPABASE_URL || fileEnv.PROD_SUPABASE_URL;
const PROD_KEY = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || fileEnv.PROD_SUPABASE_SERVICE_ROLE_KEY;

if (!PROD_URL || !PROD_KEY) {
  console.error('缺少生产数据库配置：PROD_SUPABASE_URL 或 PROD_SUPABASE_SERVICE_ROLE_KEY');
  console.error('请确保 .env.isolated 文件存在且包含生产数据库配置');
  process.exit(1);
}

const prodClient = createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false } });

// 与开发库完全一致的模型数据
const MODEL_DATA = {
  config_id: 28,  // TOPAIS Veo3.1 配置（开发库与生产库 ID 一致，已验证）
  model_id: 'topais-seedance-2-5',
  model_name: 'Seedance 2.5',
  description: 'ToAPIs通道 字节跳动 Seedance 2.5 视频生成模型，支持文生/首帧/首尾帧/多模态参考生视频，支持视频编辑/延长，支持参考视频/音频输入',
  api_endpoint: null,
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
};

async function main() {
  console.log('========================================');
  console.log('生产库种子脚本: topais-seedance-2-5');
  console.log('========================================\n');

  // 1. 验证 config_id=28 在生产库存在
  const { data: config, error: configError } = await prodClient
    .from('api_configs')
    .select('id, name, api_endpoint, is_active')
    .eq('id', 28)
    .single();

  if (configError || !config) {
    console.error('生产库中未找到 api_configs id=28 (TOPAIS Veo3.1)');
    console.error('请先确保 TOPAIS 配置存在于生产库');
    process.exit(1);
  }

  console.log('找到 TOPAIS 接口配置:');
  console.log(`   ID: ${config.id}`);
  console.log(`   名称: ${config.name}`);
  console.log(`   端点: ${config.api_endpoint}`);
  console.log(`   状态: ${config.is_active ? '启用' : '禁用'}\n`);

  // 2. 检查模型是否已存在
  const { data: existing } = await prodClient
    .from('api_models')
    .select('id, model_id, model_name')
    .eq('model_id', 'topais-seedance-2-5')
    .single();

  if (existing) {
    console.log('topais-seedance-2-5 已存在于生产库:');
    console.log(`   ID: ${existing.id}`);
    console.log(`   名称: ${existing.model_name}`);
    console.log('\n如需更新，请先删除或使用管理后台修改。');
    return;
  }

  console.log('模型不存在，开始插入...\n');

  // 3. 插入模型
  const { data: model, error: modelError } = await prodClient
    .from('api_models')
    .insert(MODEL_DATA)
    .select()
    .single();

  if (modelError) {
    console.error('插入失败:', modelError.message);
    process.exit(1);
  }

  console.log('插入成功！');
  console.log(`   数据库 ID: ${model.id}`);
  console.log(`   model_id: ${model.model_id}`);
  console.log(`   名称: ${model.model_name}`);
  console.log(`   config_id: ${model.config_id}`);
  console.log(`   积分: ${model.credits_base}`);
  console.log(`   状态: ${model.is_active ? '启用' : '禁用'}\n`);

  console.log('========================================');
  console.log('生产库种子完成！');
  console.log('========================================');
  console.log('\n请刷新前端页面，在视频模型下拉列表中查看 "Seedance 2.5"');
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
