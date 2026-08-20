/**
 * 同步视频模型到生产数据库
 * 
 * 问题：生产环境模型列表/管理后台/积分配置中缺少视频模型
 * 原因：开发库逐步添加的视频 api_configs 和 api_models 未同步到生产库
 * 
 * 用法：在生产服务器上运行
 *   node scripts/sync-video-models-to-prod.mjs
 * 
 * 脚本会从服务器 .env.local 读取 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY
 * （生产服务器的 .env.local 指向生产数据库）
 * 
 * 同时也需要开发数据库的配置来拉取源数据：
 *   DEV_SUPABASE_URL
 *   DEV_SUPABASE_SERVICE_ROLE_KEY
 *   （如果未设置，则使用脚本内嵌的种子数据）
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 读取 .env 文件
function loadEnvFile(filename) {
  try {
    const content = readFileSync(resolve(process.cwd(), filename), 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch (e) {
    // 文件不存在，忽略
  }
}

// 加载环境变量
loadEnvFile('.env.local');
loadEnvFile('.env.isolated');

// 生产数据库（优先使用 PROD_SUPABASE_URL，回退到 SUPABASE_URL）
// 在服务器上 .env.local 指向生产库，SUPABASE_URL 是生产库
// 在本地开发时，.env.local 指向开发库，需要用 PROD_SUPABASE_URL 明确指定
const PROD_URL = process.env.PROD_SUPABASE_URL || process.env.SUPABASE_URL;
const PROD_KEY = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// 开发数据库（使用 DEV_SUPABASE_URL 明确指定）
const DEV_URL = process.env.DEV_SUPABASE_URL;
const DEV_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY;

if (!PROD_URL || !PROD_KEY) {
  console.error('❌ 缺少生产数据库配置（SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）');
  console.error('   请确保在生产服务器上运行此脚本，或设置对应环境变量');
  process.exit(1);
}

async function main() {
  console.log('========================================');
  console.log('🔄 同步视频模型到生产数据库');
  console.log('========================================\n');
  console.log(`📡 生产数据库: ${PROD_URL.substring(0, 40)}...`);
  console.log(`📡 开发数据库: ${DEV_URL ? DEV_URL.substring(0, 40) + '...' : '未配置（将使用内嵌种子数据）'}\n`);

  const prod = createClient(PROD_URL, PROD_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // 获取开发库数据（如果有配置）
  let devConfigs = null;
  let devModels = null;
  
  if (DEV_URL && DEV_KEY) {
    const dev = createClient(DEV_URL, DEV_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: dc } = await dev.from('api_configs').select('*').eq('service_type', 'video_generation').order('id');
    const videoConfigIds = (dc || []).map(c => c.id);
    const { data: dm } = await dev.from('api_models').select('*').in('config_id', videoConfigIds).order('sort_order');
    devConfigs = dc;
    devModels = dm;
    console.log(`📋 从开发库读取: ${dc?.length || 0} 个视频 configs, ${dm?.length || 0} 个视频 models\n`);
  }

  if (!devConfigs || devConfigs.length === 0) {
    console.error('❌ 无法获取开发库视频模型数据');
    console.error('   请设置 DEV_SUPABASE_URL 和 DEV_SUPABASE_SERVICE_ROLE_KEY');
    console.error('   或在包含 .env.isolated 文件的环境运行');
    process.exit(1);
  }

  // ====== 1. 同步 api_configs (video_generation) ======
  console.log('📋 步骤1: 同步视频 api_configs');
  console.log('----------------------------------------');

  const { data: prodConfigs, error: e2 } = await prod.from('api_configs').select('*').order('id');
  if (e2) { console.error('❌ 读取生产 api_configs 失败:', e2.message); process.exit(1); }
  const prodConfigMap = new Map((prodConfigs || []).map(c => [c.id, c]));

  let configsInserted = 0, configsUpdated = 0;

  for (const devConfig of devConfigs) {
    const prodConfig = prodConfigMap.get(devConfig.id);
    
    // 需要同步的字段（匹配当前 schema）
    const syncFields = {
      name: devConfig.name,
      service_type: devConfig.service_type,
      description: devConfig.description,
      api_endpoint: devConfig.api_endpoint,
      api_key: devConfig.api_key,
      request_method: devConfig.request_method,
      request_headers: devConfig.request_headers,
      request_body_template: devConfig.request_body_template,
      response_parser: devConfig.response_parser,
      sort_order: devConfig.sort_order,
      is_active: devConfig.is_active,
      is_visible: devConfig.is_visible,
      updated_at: new Date().toISOString(),
    };

    if (!prodConfig) {
      console.log(`  ➕ 插入 config id=${devConfig.id} name=${devConfig.name}`);
      const { error } = await prod.from('api_configs').insert({
        id: devConfig.id,
        ...syncFields,
        created_at: devConfig.created_at,
      });
      if (error) console.error('    ❌ 插入失败:', error.message);
      else { console.log('    ✅ 插入成功'); configsInserted++; }
    } else {
      // 比较关键字段
      const needsUpdate = ['name', 'api_endpoint', 'api_key', 'request_method', 'request_headers', 'request_body_template', 'response_parser', 'sort_order', 'is_active', 'is_visible']
        .some(k => JSON.stringify(prodConfig[k]) !== JSON.stringify(devConfig[k]));
      
      if (needsUpdate) {
        console.log(`  🔄 更新 config id=${devConfig.id} name=${devConfig.name}`);
        const { error } = await prod.from('api_configs').update(syncFields).eq('id', devConfig.id);
        if (error) console.error('    ❌ 更新失败:', error.message);
        else { console.log('    ✅ 更新成功'); configsUpdated++; }
      } else {
        console.log(`  ⏭️ 跳过 config id=${devConfig.id} (无变化)`);
      }
    }
  }

  // ====== 2. 同步 api_models (视频模型) ======
  console.log('\n📋 步骤2: 同步视频 api_models');
  console.log('----------------------------------------');

  const { data: prodModels, error: e4 } = await prod.from('api_models').select('*').order('id');
  if (e4) { console.error('❌ 读取生产 api_models 失败:', e4.message); process.exit(1); }
  const prodModelMap = new Map((prodModels || []).map(m => [m.model_id, m]));

  let modelsInserted = 0, modelsUpdated = 0;

  for (const devModel of devModels) {
    const prodModel = prodModelMap.get(devModel.model_id);

    // 需要同步的字段（匹配当前 schema）
    const syncFields = {
      config_id: devModel.config_id,
      model_name: devModel.model_name,
      description: devModel.description,
      api_endpoint: devModel.api_endpoint,
      parameters: devModel.parameters,
      credits_base: devModel.credits_base,
      is_active: devModel.is_active,
      is_visible: devModel.is_visible,
      sort_order: devModel.sort_order,
      updated_at: new Date().toISOString(),
    };

    if (!prodModel) {
      console.log(`  ➕ 插入 model_id=${devModel.model_id} name=${devModel.model_name}`);
      const { error } = await prod.from('api_models').insert({
        model_id: devModel.model_id,
        ...syncFields,
        created_at: devModel.created_at,
      });
      if (error) console.error('    ❌ 插入失败:', error.message);
      else { console.log('    ✅ 插入成功'); modelsInserted++; }
    } else {
      // 比较关键字段
      const needsUpdate = ['model_name', 'config_id', 'parameters', 'credits_base', 'is_active', 'is_visible', 'sort_order', 'description']
        .some(k => JSON.stringify(prodModel[k]) !== JSON.stringify(devModel[k]));
      
      if (needsUpdate) {
        console.log(`  🔄 更新 model_id=${devModel.model_id} name=${devModel.model_name}`);
        // 显示差异
        for (const k of ['model_name', 'config_id', 'parameters', 'credits_base', 'is_active', 'is_visible', 'sort_order']) {
          if (JSON.stringify(prodModel[k]) !== JSON.stringify(devModel[k])) {
            const oldVal = JSON.stringify(prodModel[k])?.substring(0, 60);
            const newVal = JSON.stringify(devModel[k])?.substring(0, 60);
            console.log(`    ${k}: ${oldVal} → ${newVal}`);
          }
        }
        const { error } = await prod.from('api_models').update(syncFields).eq('id', prodModel.id);
        if (error) console.error('    ❌ 更新失败:', error.message);
        else { console.log('    ✅ 更新成功'); modelsUpdated++; }
      } else {
        console.log(`  ⏭️ 跳过 model_id=${devModel.model_id} (无变化)`);
      }
    }
  }

  // ====== 3. 验证 ======
  console.log('\n📋 步骤3: 验证同步结果');
  console.log('----------------------------------------');

  const { data: finalConfigs } = await prod.from('api_configs').select('*').eq('service_type', 'video_generation').order('id');
  const finalVideoConfigIds = (finalConfigs || []).map(c => c.id);
  const { data: finalModels } = await prod.from('api_models').select('*').in('config_id', finalVideoConfigIds).order('sort_order');

  console.log(`  ✅ 视频 configs: ${finalConfigs?.length || 0} 条`);
  console.log(`  ✅ 视频 models: ${finalModels?.length || 0} 条`);
  
  if (finalConfigs && finalConfigs.length > 0) {
    console.log('\n  视频配置列表:');
    for (const c of finalConfigs) {
      console.log(`    id=${c.id} | ${c.name} | active=${c.is_active} | visible=${c.is_visible}`);
    }
  }
  
  if (finalModels && finalModels.length > 0) {
    console.log('\n  视频模型列表:');
    for (const m of finalModels) {
      console.log(`    ${m.model_id} | ${m.model_name} | credits=${m.credits_base} | active=${m.is_active} | visible=${m.is_visible}`);
    }
  }

  // ====== 总结 ======
  console.log('\n========================================');
  console.log('📊 同步完成');
  console.log('========================================');
  console.log(`  api_configs: ${configsInserted} 插入, ${configsUpdated} 更新`);
  console.log(`  api_models:  ${modelsInserted} 插入, ${modelsUpdated} 更新`);
  
  if (configsInserted === 0 && configsUpdated === 0 && modelsInserted === 0 && modelsUpdated === 0) {
    console.log('\n  ✅ 生产数据库已是最新，无需同步');
  } else {
    console.log('\n  ⚠️ 同步后请刷新生产环境页面验证模型列表');
  }
}

main().catch(err => {
  console.error('❌ 脚本执行失败:', err);
  process.exit(1);
});
