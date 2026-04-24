// 详细对比两个数据库的表结构和内容
import { createClient } from '@supabase/supabase-js';

// 生产环境
const prodClient = createClient(
  'https://hrwoalchynrnwlcqdpxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhyd29hbGNoeW5ybndsY3FkcHhuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA4ODA5NywiZXhwIjoyMDkxNjY0MDk3fQ.Hss10LcIsaL-DCRU5OjnY40qgbCZmQ9abOpavEfr2d0'
);

// 开发环境
const devClient = createClient(
  'https://ozdlvxxoufkiazddvxys.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk'
);

async function main() {
  console.log('========================================');
  console.log('   数据库完整对比分析报告');
  console.log('========================================\n');

  // ====== 1. 表列表对比 ======
  console.log('【一、表列表对比】\n');
  
  const knownTables = [
    'users', 'user_settings', 'user_cache',
    'generation_records', 'generation_tasks',
    'api_keys', 'api_models', 'api_configs',
    'recharge_packages', 'recharge_orders',
    'email_verification_codes', 'feedback',
    'model_credits_config',
  ];

  console.log('| 表名 | 生产环境 | 开发环境 | 状态 |');
  console.log('|------|---------|---------|------|');

  for (const table of knownTables) {
    const prodCount = await getCount(prodClient, table);
    const devCount = await getCount(devClient, table);
    
    let status = '';
    if (prodCount === -1 && devCount === -1) status = '⚠️ 两边都不存在';
    else if (prodCount === -1) status = '🔴 生产缺失';
    else if (devCount === -1) status = '🟡 开发缺失';
    else if (prodCount === devCount) status = '✅ 一致';
    else if (prodCount > devCount) status = '🔴 生产多';
    else status = '🟡 开发多';
    
    console.log(`| ${table} | ${prodCount === -1 ? '不存在' : prodCount} | ${devCount === -1 ? '不存在' : devCount} | ${status} |`);
  }

  // ====== 2. api_models 详细对比 ======
  console.log('\n========================================');
  console.log('【二、api_models 表详细对比】');
  console.log('========================================\n');

  const { data: prodModels } = await prodClient
    .from('api_models')
    .select('*')
    .order('sort_order');
  
  const { data: devModels } = await devClient
    .from('api_models')
    .select('*')
    .order('sort_order');

  console.log('--- 生产环境 api_models ---');
  prodModels?.forEach((m: any) => {
    console.log(`  [${m.model_id}] ${m.model_name} | config_id=${m.config_id} | credits=${m.credits_base} | active=${m.is_active} | visible=${m.is_visible}`);
  });

  console.log('\n--- 开发环境 api_models ---');
  devModels?.forEach((m: any) => {
    console.log(`  [${m.model_id}] ${m.model_name} | config_id=${m.config_id} | credits=${m.credits_base} | active=${m.is_active} | visible=${m.is_visible}`);
  });

  // 差异分析
  const prodModelIds = new Set(prodModels?.map((m: any) => m.model_id) || []);
  const devModelIds = new Set(devModels?.map((m: any) => m.model_id) || []);

  console.log('\n--- 差异分析 ---');
  const missingInProd = [...devModelIds].filter(id => !prodModelIds.has(id));
  const extraInProd = [...prodModelIds].filter(id => !devModelIds.has(id));

  if (missingInProd.length > 0) {
    console.log('🔴 生产环境缺失的模型:', missingInProd.join(', '));
  }
  if (extraInProd.length > 0) {
    console.log('🟡 生产环境独有的模型:', extraInProd.join(', '));
  }

  // ====== 3. api_configs 详细对比 ======
  console.log('\n========================================');
  console.log('【三、api_configs 表详细对比】');
  console.log('========================================\n');

  const { data: prodConfigs } = await prodClient
    .from('api_configs')
    .select('*')
    .order('id');
  
  const { data: devConfigs } = await devClient
    .from('api_configs')
    .select('*')
    .order('id');

  console.log('--- 生产环境 api_configs ---');
  prodConfigs?.forEach((c: any) => {
    const hasKey = c.api_key ? '✅有Key' : '❌无Key';
    const hasWebhook = c.request_body_template?.webHook || '无';
    const webhookStatus = hasWebhook && hasWebhook !== '-1' ? '✅已配置' : '❌未配置';
    console.log(`  [${c.id}] ${c.name} | ${hasKey} | webhook=${webhookStatus} | active=${c.is_active}`);
  });

  console.log('\n--- 开发环境 api_configs ---');
  devConfigs?.forEach((c: any) => {
    const hasKey = c.api_key ? '✅有Key' : '❌无Key';
    const hasWebhook = c.request_body_template?.webHook || '无';
    const webhookStatus = hasWebhook && hasWebhook !== '-1' ? '✅已配置' : '❌未配置';
    console.log(`  [${c.id}] ${c.name} | ${hasKey} | webhook=${webhookStatus} | active=${c.is_active}`);
  });

  // 差异分析
  const prodConfigIds = new Set(prodConfigs?.map((c: any) => c.id) || []);
  const devConfigIds = new Set(devConfigs?.map((c: any) => c.id) || []);

  console.log('\n--- 差异分析 ---');
  const missingConfigsInProd = [...devConfigIds].filter(id => !prodConfigIds.has(id));
  const extraConfigsInProd = [...prodConfigIds].filter(id => !devConfigIds.has(id));

  if (missingConfigsInProd.length > 0) {
    console.log('🔴 生产环境缺失的配置ID:', missingConfigsInProd.join(', '));
  }
  if (extraConfigsInProd.length > 0) {
    console.log('🟡 生产环境独有的配置ID:', extraConfigsInProd.join(', '));
  }

  // ====== 4. users 详细对比 ======
  console.log('\n========================================');
  console.log('【四、users 表详细对比】');
  console.log('========================================\n');

  const { data: prodUsers } = await prodClient
    .from('users')
    .select('id, phone, nickname, credits, role, created_at')
    .order('created_at');
  
  const { data: devUsers } = await devClient
    .from('users')
    .select('id, phone, nickname, credits, role, created_at')
    .order('created_at');

  console.log('--- 生产环境用户 ---');
  prodUsers?.forEach((u: any) => {
    console.log(`  [${u.id}] ${u.phone || u.nickname || '无名'} | 积分=${u.credits} | 角色=${u.role} | ${u.created_at?.substring(0, 10)}`);
  });

  console.log('\n--- 开发环境用户 ---');
  devUsers?.forEach((u: any) => {
    console.log(`  [${u.id}] ${u.phone || u.nickname || '无名'} | 积分=${u.credits} | 角色=${u.role} | ${u.created_at?.substring(0, 10)}`);
  });

  // ====== 5. generation_records 详细对比 ======
  console.log('\n========================================');
  console.log('【五、generation_records 表详细对比】');
  console.log('========================================\n');

  const { count: prodRecordsCount } = await prodClient
    .from('generation_records')
    .select('*', { count: 'exact', head: true });
  
  const { count: devRecordsCount } = await devClient
    .from('generation_records')
    .select('*', { count: 'exact', head: true });

  console.log(`生产环境记录数: ${prodRecordsCount}`);
  console.log(`开发环境记录数: ${devRecordsCount}`);

  // 按模型统计
  console.log('\n生产环境按模型统计:');
  const { data: allProdRecords } = await prodClient.from('generation_records').select('model');
  const prodStats: Record<string, number> = {};
  allProdRecords?.forEach((r: any) => {
    prodStats[r.model] = (prodStats[r.model] || 0) + 1;
  });
  Object.entries(prodStats).sort((a, b) => b[1] - a[1]).forEach(([model, count]) => {
    console.log(`  ${model}: ${count}`);
  });

  console.log('\n开发环境按模型统计:');
  const { data: allDevRecords } = await devClient.from('generation_records').select('model');
  const devStats: Record<string, number> = {};
  allDevRecords?.forEach((r: any) => {
    devStats[r.model] = (devStats[r.model] || 0) + 1;
  });
  Object.entries(devStats).sort((a, b) => b[1] - a[1]).forEach(([model, count]) => {
    console.log(`  ${model}: ${count}`);
  });

  // ====== 6. recharge_packages 对比 ======
  console.log('\n========================================');
  console.log('【六、recharge_packages 表详细对比】');
  console.log('========================================\n');

  const { data: prodPackages } = await prodClient
    .from('recharge_packages')
    .select('*')
    .order('sort_order');
  
  const { data: devPackages } = await devClient
    .from('recharge_packages')
    .select('*')
    .order('sort_order');

  console.log('--- 生产环境充值套餐 ---');
  prodPackages?.forEach((p: any) => {
    const price = (p.price / 100).toFixed(2);
    console.log(`  [${p.id}] ${p.name} | ¥${price} | ${p.credits}积分 | ${p.tag || '无标签'} | ${p.is_active ? '启用' : '禁用'}`);
  });

  console.log('\n--- 开发环境充值套餐 ---');
  devPackages?.forEach((p: any) => {
    const price = (p.price / 100).toFixed(2);
    console.log(`  [${p.id}] ${p.name} | ¥${price} | ${p.credits}积分 | ${p.tag || '无标签'} | ${p.is_active ? '启用' : '禁用'}`);
  });

  // ====== 7. 废弃数据检查 ======
  console.log('\n========================================');
  console.log('【七、可能废弃的数据检查】');
  console.log('========================================\n');

  // 检查 api_models 中禁用的模型
  console.log('--- 已禁用的模型 ---');
  const disabledModels = [...(prodModels || []), ...(devModels || [])]
    .filter((m: any) => !m.is_active);
  
  if (disabledModels.length > 0) {
    disabledModels.forEach((m: any) => {
      console.log(`  [${m.model_id}] ${m.model_name} - 可废弃`);
    });
  } else {
    console.log('  无');
  }

  // 检查 api_configs 中禁用的配置
  console.log('\n--- 已禁用的配置 ---');
  const disabledConfigs = [...(prodConfigs || []), ...(devConfigs || [])]
    .filter((c: any) => !c.is_active);
  
  if (disabledConfigs.length > 0) {
    disabledConfigs.forEach((c: any) => {
      console.log(`  [${c.id}] ${c.name} - 可废弃`);
    });
  } else {
    console.log('  无');
  }

  // 检查无引用的 api_configs
  console.log('\n--- 无模型引用的 api_configs ---');
  const usedConfigIds = new Set([...(prodModels || []), ...(devModels || [])].map((m: any) => m.config_id));
  const unusedConfigs = [...(prodConfigs || []), ...(devConfigs || [])]
    .filter((c: any) => !usedConfigIds.has(c.id));
  
  if (unusedConfigs.length > 0) {
    unusedConfigs.forEach((c: any) => {
      console.log(`  [${c.id}] ${c.name} - 无模型引用，可废弃`);
    });
  } else {
    console.log('  无');
  }

  // 检查开发环境测试用户
  console.log('\n--- 开发环境可能的测试用户 ---');
  const testUsers = devUsers?.filter((u: any) => 
    u.phone?.includes('123456') || 
    u.phone?.includes('测试') ||
    u.nickname?.includes('测试') ||
    u.role === 'test'
  );
  
  if (testUsers && testUsers.length > 0) {
    testUsers.forEach((u: any) => {
      console.log(`  [${u.id}] ${u.phone || u.nickname} - 测试用户，可清理`);
    });
  } else {
    // 手动列出所有开发用户
    console.log('  开发环境所有用户（需人工判断）:');
    devUsers?.forEach((u: any) => {
      console.log(`    [${u.id}] ${u.phone || u.nickname} - 积分: ${u.credits}`);
    });
  }

  // ====== 8. 字段差异检查 ======
  console.log('\n========================================');
  console.log('【八、字段差异检查】');
  console.log('========================================\n');

  // 检查 api_configs 字段
  const prodConfigFields = prodConfigs?.[0] ? Object.keys(prodConfigs[0]).sort() : [];
  const devConfigFields = devConfigs?.[0] ? Object.keys(devConfigs[0]).sort() : [];

  console.log('api_configs 字段对比:');
  console.log('  生产环境:', prodConfigFields.join(', '));
  console.log('  开发环境:', devConfigFields.join(', '));

  const missingFieldsInProd = devConfigFields.filter(f => !prodConfigFields.includes(f));
  const extraFieldsInProd = prodConfigFields.filter(f => !devConfigFields.includes(f));

  if (missingFieldsInProd.length > 0) {
    console.log('  🔴 生产环境缺失字段:', missingFieldsInProd.join(', '));
  }
  if (extraFieldsInProd.length > 0) {
    console.log('  🟡 生产环境多余字段:', extraFieldsInProd.join(', '));
  }

  // ====== 9. 总结 ======
  console.log('\n========================================');
  console.log('【九、总结报告】');
  console.log('========================================\n');

  console.log('【需要同步到生产环境的数据】');
  if (missingInProd.length > 0) {
    console.log(`  1. api_models 缺失模型: ${missingInProd.join(', ')}`);
  }
  if (missingConfigsInProd.length > 0) {
    console.log(`  2. api_configs 缺失配置ID: ${missingConfigsInProd.join(', ')}`);
  }
  if (missingFieldsInProd.length > 0) {
    console.log(`  3. api_configs 缺失字段: ${missingFieldsInProd.join(', ')}`);
  }

  console.log('\n【可以废弃的数据】');
  if (disabledModels.length > 0) {
    console.log(`  1. 已禁用的模型: ${disabledModels.map((m: any) => m.model_id).join(', ')}`);
  }
  if (disabledConfigs.length > 0) {
    console.log(`  2. 已禁用的配置: ${disabledConfigs.map((c: any) => c.id).join(', ')}`);
  }
  if (unusedConfigs.length > 0) {
    console.log(`  3. 无引用的配置: ${unusedConfigs.map((c: any) => c.id).join(', ')}`);
  }

  console.log('\n【建议保留的测试数据】');
  console.log(`  开发环境 generation_records: ${devRecordsCount} 条（测试记录可保留）`);
  console.log(`  开发环境 users: ${devUsers?.length || 0} 个（测试用户可保留）`);
}

async function getCount(client: any, table: string): Promise<number> {
  try {
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) return -1;
    return count || 0;
  } catch {
    return -1;
  }
}

main().catch(console.error);
