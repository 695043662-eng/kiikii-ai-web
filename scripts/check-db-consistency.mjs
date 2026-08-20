/**
 * #854 数据库一致性检查脚本
 * 检查 api_models 和 api_configs 两个表在开发库与生产库的一致性
 * 
 * 使用方式: node scripts/check-db-consistency.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// 解析 .env.isolated 文件
function parseEnvFile(filePath) {
  const env = {};
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
  return env;
}

const env = parseEnvFile(resolve(process.cwd(), '.env.isolated'));

const devClient = createClient(
  env.DEV_SUPABASE_URL,
  env.DEV_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const prodClient = createClient(
  env.PROD_SUPABASE_URL,
  env.PROD_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function checkTable(tableName) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 检查表: ${tableName}`);
  console.log(`${'='.repeat(80)}`);

  // 查询开发库
  const { data: devData, error: devError } = await devClient
    .from(tableName)
    .select('*')
    .order('id', { ascending: true });

  if (devError) {
    console.log(`❌ 开发库查询失败: ${devError.message}`);
  }

  // 查询生产库
  const { data: prodData, error: prodError } = await prodClient
    .from(tableName)
    .select('*')
    .order('id', { ascending: true });

  if (prodError) {
    console.log(`❌ 生产库查询失败: ${prodError.message}`);
  }

  if (!devData || !prodData) {
    console.log('⚠️ 数据获取不完整，跳过比较');
    return;
  }

  console.log(`\n开发库 (${tableName}): ${devData.length} 条记录`);
  console.log(`生产库 (${tableName}): ${prodData.length} 条记录`);

  // 提取关键字段进行比较
  const getKey = (row) => {
    if (tableName === 'api_models') {
      return row.model_id || `id:${row.id}`;
    } else if (tableName === 'api_configs') {
      return row.config_id || `id:${row.id}`;
    }
    return `id:${row.id}`;
  };

  const devKeys = new Set(devData.map(getKey));
  const prodKeys = new Set(prodData.map(getKey));

  // 找出开发库有但生产库没有的
  const onlyInDev = devData.filter(row => !prodKeys.has(getKey(row)));
  const onlyInProd = prodData.filter(row => !devKeys.has(getKey(row)));

  console.log(`\n--- 开发库独有 (${onlyInDev.length} 条) ---`);
  if (onlyInDev.length === 0) {
    console.log('  (无)');
  } else {
    for (const row of onlyInDev) {
      console.log(`  ⚠️  ${getKey(row)} | ${row.display_name || row.name || ''}`);
    }
  }

  console.log(`\n--- 生产库独有 (${onlyInProd.length} 条) ---`);
  if (onlyInProd.length === 0) {
    console.log('  (无)');
  } else {
    for (const row of onlyInProd) {
      console.log(`  ⚠️  ${getKey(row)} | ${row.display_name || row.name || ''}`);
    }
  }

  // 逐条比较共有记录的关键字段
  console.log(`\n--- 共有记录字段差异 ---`);
  let diffCount = 0;
  for (const devRow of devData) {
    const key = getKey(devRow);
    const prodRow = prodData.find(r => getKey(r) === key);
    if (!prodRow) continue;

    const importantFields = tableName === 'api_models'
      ? ['model_id', 'display_name', 'provider', 'is_active', 'config_id', 'supported_modes']
      : ['config_id', 'api_name', 'api_endpoint', 'is_active'];

    const diffs = [];
    for (const field of importantFields) {
      const devVal = JSON.stringify(devRow[field]);
      const prodVal = JSON.stringify(prodRow[field]);
      if (devVal !== prodVal) {
        diffs.push(`${field}: [DEV]${devVal} != [PROD]${prodVal}`);
      }
    }

    if (diffs.length > 0) {
      diffCount++;
      console.log(`  🔀 ${key}:`);
      for (const d of diffs) {
        console.log(`     ${d}`);
      }
    }
  }

  if (diffCount === 0) {
    console.log('  ✅ 共有记录字段完全一致');
  }

  // 特别检查 topais-minimax-h3
  if (tableName === 'api_models') {
    const devHas = devData.some(r => r.model_id === 'topais-minimax-h3');
    const prodHas = prodData.some(r => r.model_id === 'topais-minimax-h3');
    console.log(`\n--- 特别检查: topais-minimax-h3 ---`);
    console.log(`  开发库: ${devHas ? '✅ 存在' : '❌ 不存在'}`);
    console.log(`  生产库: ${prodHas ? '✅ 存在' : '❌ 不存在'}`);

    if (devHas) {
      const devRow = devData.find(r => r.model_id === 'topais-minimax-h3');
      console.log(`  开发库详情: config_id=${devRow.config_id}, provider=${devRow.provider}, is_active=${devRow.is_active}, supported_modes=${JSON.stringify(devRow.supported_modes)}`);
    }
    if (prodHas) {
      const prodRow = prodData.find(r => r.model_id === 'topais-minimax-h3');
      console.log(`  生产库详情: config_id=${prodRow.config_id}, provider=${prodRow.provider}, is_active=${prodRow.is_active}, supported_modes=${JSON.stringify(prodRow.supported_modes)}`);
    }
  }
}

async function main() {
  console.log('🚀 数据库一致性检查启动');
  console.log(`开发库: ${env.DEV_SUPABASE_URL}`);
  console.log(`生产库: ${env.PROD_SUPABASE_URL}`);

  await checkTable('api_configs');
  await checkTable('api_models');

  // 额外检查 video_generation_tasks 表是否存在且有正确字段
  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 检查表: video_generation_tasks (结构验证)');
  console.log(`${'='.repeat(80)}`);

  for (const [name, client] of [['开发库', devClient], ['生产库', prodClient]]) {
    const { data, error } = await client
      .from('video_generation_tasks')
      .select('task_id, status, provider_task_id, poll_url')
      .limit(1);

    if (error) {
      console.log(`❌ ${name}: ${error.message}`);
    } else {
      console.log(`✅ ${name}: 表存在且字段正常 (${data?.length ?? 0} 条样本)`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ 数据库一致性检查完成');
  console.log(`${'='.repeat(80)}`);
}

main().catch(err => {
  console.error('💥 脚本执行失败:', err);
  process.exit(1);
});
