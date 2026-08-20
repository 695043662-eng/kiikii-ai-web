/**
 * 同步 DEV 数据库的 api_models 和 api_configs 到 PROD
 * 
 * 用法：在生产服务器上运行
 *   node scripts/sync-dev-to-prod.mjs
 * 
 * 需要设置环境变量：
 *   DEV_SUPABASE_URL - 开发数据库 URL
 *   DEV_SUPABASE_SERVICE_ROLE_KEY - 开发数据库密钥
 *   PROD_SUPABASE_URL - 生产数据库 URL
 *   PROD_SUPABASE_SERVICE_ROLE_KEY - 生产数据库密钥
 * 
 * 或者在项目根目录有 .env.local 和 .env.production 文件
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
loadEnvFile('.env.production');

const DEV_URL = process.env.DEV_SUPABASE_URL || process.env.SUPABASE_URL;
const DEV_KEY = process.env.DEV_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = process.env.PROD_SUPABASE_URL || 'REDACTED_PROD_DB_URL';
const PROD_KEY = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;

if (!DEV_URL || !DEV_KEY) {
  console.error('❌ 缺少 DEV 数据库配置（DEV_SUPABASE_URL / DEV_SUPABASE_SERVICE_ROLE_KEY）');
  process.exit(1);
}
if (!PROD_URL || !PROD_KEY) {
  console.error('❌ 缺少 PROD 数据库配置（PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY）');
  process.exit(1);
}

async function main() {
  console.log('========================================');
  console.log('🔄 DEV → PROD 数据同步');
  console.log('========================================\n');
  
  const dev = createClient(DEV_URL, DEV_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const prod = createClient(PROD_URL, PROD_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  
  // ====== 1. 同步 api_configs ======
  console.log('📋 步骤1: 同步 api_configs');
  console.log('----------------------------------------');
  
  const { data: devConfigs, error: e1 } = await dev.from('api_configs').select('*').order('id');
  if (e1) { console.error('❌ 读取 DEV api_configs 失败:', e1.message); process.exit(1); }
  
  const { data: prodConfigs, error: e2 } = await prod.from('api_configs').select('*').order('id');
  if (e2) { console.error('❌ 读取 PROD api_configs 失败:', e2.message); process.exit(1); }
  
  const prodConfigMap = new Map(prodConfigs.map(c => [c.id, c]));
  
  for (const devConfig of devConfigs) {
    const prodConfig = prodConfigMap.get(devConfig.id);
    
    if (!prodConfig) {
      // PROD 不存在，插入
      console.log(`  ➕ 插入 api_config id=${devConfig.id} name=${devConfig.name}`);
      const { error } = await prod.from('api_configs').insert({
        id: devConfig.id,
        name: devConfig.name,
        supplier: devConfig.supplier,
        api_endpoint: devConfig.api_endpoint,
        api_key_env: devConfig.api_key_env,
        request_template: devConfig.request_template,
        response_format: devConfig.response_format,
        image_url_path: devConfig.image_url_path,
        aspect_ratios: devConfig.aspect_ratios,
        models_count: devConfig.models_count,
        created_at: devConfig.created_at,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error('    ❌ 插入失败:', error.message);
      else console.log('    ✅ 插入成功');
    } else {
      // PROD 已存在，检查是否需要更新
      const needsUpdate = JSON.stringify(prodConfig) !== JSON.stringify({
        ...prodConfig,
        name: devConfig.name,
        supplier: devConfig.supplier,
        api_endpoint: devConfig.api_endpoint,
        api_key_env: devConfig.api_key_env,
        request_template: devConfig.request_template,
        response_format: devConfig.response_format,
        image_url_path: devConfig.image_url_path,
        aspect_ratios: devConfig.aspect_ratios,
        models_count: devConfig.models_count,
      });
      
      if (needsUpdate) {
        console.log(`  🔄 更新 api_config id=${devConfig.id} name=${devConfig.name}`);
        const { error } = await prod.from('api_configs').update({
          name: devConfig.name,
          supplier: devConfig.supplier,
          api_endpoint: devConfig.api_endpoint,
          api_key_env: devConfig.api_key_env,
          request_template: devConfig.request_template,
          response_format: devConfig.response_format,
          image_url_path: devConfig.image_url_path,
          aspect_ratios: devConfig.aspect_ratios,
          models_count: devConfig.models_count,
          updated_at: new Date().toISOString(),
        }).eq('id', devConfig.id);
        if (error) console.error('    ❌ 更新失败:', error.message);
        else console.log('    ✅ 更新成功');
      } else {
        console.log(`  ⏭️ 跳过 api_config id=${devConfig.id} (无变化)`);
      }
    }
  }
  
  // ====== 2. 同步 api_models ======
  console.log('\n📋 步骤2: 同步 api_models');
  console.log('----------------------------------------');
  
  const { data: devModels, error: e3 } = await dev.from('api_models').select('*').order('id');
  if (e3) { console.error('❌ 读取 DEV api_models 失败:', e3.message); process.exit(1); }
  
  const { data: prodModels, error: e4 } = await prod.from('api_models').select('*').order('id');
  if (e4) { console.error('❌ 读取 PROD api_models 失败:', e4.message); process.exit(1); }
  
  const prodModelMap = new Map(prodModels.map(m => [m.model_id, m]));
  
  let inserted = 0, updated = 0, skipped = 0;
  
  for (const devModel of devModels) {
    const prodModel = prodModelMap.get(devModel.model_id);
    
    // 提取关键字段用于比较
    const keyFields = {
      model_name: devModel.model_name,
      description: devModel.description,
      config_id: devModel.config_id,
      parameters: devModel.parameters,
      credits_base: devModel.credits_base,
      is_active: devModel.is_active,
      sort_order: devModel.sort_order,
      is_visible: devModel.is_visible,
    };
    
    if (!prodModel) {
      // PROD 不存在，插入
      console.log(`  ➕ 插入 model_id=${devModel.model_id} name=${devModel.model_name}`);
      const { error } = await prod.from('api_models').insert({
        model_id: devModel.model_id,
        ...keyFields,
        created_at: devModel.created_at,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error('    ❌ 插入失败:', error.message);
      else { console.log('    ✅ 插入成功'); inserted++; }
    } else {
      // PROD 已存在，检查是否需要更新
      const prodKeyFields = {
        model_name: prodModel.model_name,
        description: prodModel.description,
        config_id: prodModel.config_id,
        parameters: prodModel.parameters,
        credits_base: prodModel.credits_base,
        is_active: prodModel.is_active,
        sort_order: prodModel.sort_order,
        is_visible: prodModel.is_visible,
      };
      
      if (JSON.stringify(prodKeyFields) !== JSON.stringify(keyFields)) {
        console.log(`  🔄 更新 model_id=${devModel.model_id} name=${devModel.model_name}`);
        // 显示差异
        for (const [k, v] of Object.entries(keyFields)) {
          if (JSON.stringify(prodKeyFields[k]) !== JSON.stringify(v)) {
            console.log(`    ${k}: ${JSON.stringify(prodKeyFields[k]).substring(0, 60)} → ${JSON.stringify(v).substring(0, 60)}`);
          }
        }
        const { error } = await prod.from('api_models').update({
          ...keyFields,
          updated_at: new Date().toISOString(),
        }).eq('id', prodModel.id);
        if (error) console.error('    ❌ 更新失败:', error.message);
        else { console.log('    ✅ 更新成功'); updated++; }
      } else {
        console.log(`  ⏭️ 跳过 model_id=${devModel.model_id} (无变化)`);
        skipped++;
      }
    }
  }
  
  // ====== 3. 验证同步结果 ======
  console.log('\n📋 步骤3: 验证同步结果');
  console.log('----------------------------------------');
  
  const { data: finalProdModels, error: e5 } = await prod.from('api_models').select('*').order('id');
  if (e5) { console.error('❌ 验证失败:', e5.message); process.exit(1); }
  
  console.log(`PROD api_models 总数: ${finalProdModels.length}`);
  finalProdModels.forEach(m => {
    const ratios = m.parameters?.aspectRatios?.length || 0;
    const resolutions = m.parameters?.resolutions?.length || 0;
    console.log(`  ${m.model_id} (${m.model_name}) - ${ratios}个比例, ${resolutions}个分辨率, active=${m.is_active}`);
  });
  
  console.log('\n========================================');
  console.log('✅ 同步完成！');
  console.log(`   插入: ${inserted} | 更新: ${updated} | 跳过: ${skipped}`);
  console.log('========================================');
}

main().catch(console.error);
