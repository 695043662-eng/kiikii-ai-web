/**
 * 数据库验证脚本 - 检查唯一索引和重复记录
 * #军规 #6：使用 Node.js 脚本连接真实数据库，禁止使用 exec_sql 工具
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// 加载环境变量
function loadEnv() {
  const envFiles = ['.env.local', '.env.production'];
  const result = {};
  
  for (const file of envFiles) {
    try {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        content.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const key = trimmed.substring(0, eq).trim();
            let value = trimmed.substring(eq + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (!result[key]) {
              result[key] = value;
            }
          }
        });
      }
    } catch (e) {
      // ignore
    }
  }
  return result;
}

async function main() {
  console.log('========================================');
  console.log('🔍 数据库验证脚本');
  console.log('========================================\n');
  
  const env = loadEnv();
  const url = process.env.SUPABASE_URL || env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceRoleKey) {
    console.error('❌ 缺少环境变量: SUPABASE_URL 或 SUPABABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  console.log(`📡 数据库 URL: ${url.substring(0, 40)}...\n`);
  
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  // 1. 测试数据库连接
  console.log('📋 测试数据库连接...');
  const { data: checkData, error: checkError } = await supabase
    .from('credit_logs')
    .select('id')
    .limit(1);
  
  if (checkError) {
    console.error('❌ 数据库连接失败:', checkError.message);
    process.exit(1);
  }
  
  console.log('✅ 数据库连接成功\n');
  
  // 2. 检查是否有重复记录
  console.log('📋 检查重复记录...');
  
  const { data: allRecords, error: recordsError } = await supabase
    .from('credit_logs')
    .select('id, reference_id, type')
    .not('reference_id', 'is', null)
    .order('reference_id', { ascending: true })
    .limit(10000);
  
  if (recordsError) {
    console.error('❌ 查询记录失败:', recordsError.message);
    process.exit(1);
  }
  
  // 在内存中检测重复
  const seen = new Map();
  const duplicates = [];
  
  for (const record of allRecords || []) {
    const key = `${record.reference_id}|${record.type}`;
    if (seen.has(key)) {
      duplicates.push({
        reference_id: record.reference_id,
        type: record.type,
        first_id: seen.get(key),
        duplicate_id: record.id
      });
    } else {
      seen.set(key, record.id);
    }
  }
  
  console.log(`   检查了 ${allRecords?.length || 0} 条有 reference_id 的记录`);
  
  if (duplicates.length > 0) {
    console.log(`❌ 发现 ${duplicates.length} 条重复记录！`);
    console.log('   前 5 条:');
    duplicates.slice(0, 5).forEach(d => {
      console.log(`   - reference_id: ${d.reference_id}, type: ${d.type}, IDs: ${d.first_id}, ${d.duplicate_id}`);
    });
  } else {
    console.log('✅ 没有发现重复记录\n');
  }
  
  // 3. 测试唯一索引（尝试插入重复记录）
  console.log('📋 测试唯一索引...');
  
  if (allRecords && allRecords.length > 0) {
    const testRecord = allRecords[0];
    const { error: insertError } = await supabase
      .from('credit_logs')
      .insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        amount: 0,
        type: testRecord.type,
        reference_id: testRecord.reference_id,
        description: 'TEST - SHOULD FAIL'
      });
    
    if (insertError) {
      if (insertError.code === '23505' || insertError.message.includes('duplicate') || insertError.message.includes('unique')) {
        console.log('✅ 唯一索引正常工作（插入重复记录被拒绝）');
        console.log(`   错误信息: ${insertError.message.substring(0, 100)}...\n`);
      } else {
        console.log('⚠️ 插入失败，但原因不明:', insertError.code, insertError.message);
      }
    } else {
      console.log('❌ 唯一索引可能不存在（重复记录插入成功）');
      // 清理测试数据
      await supabase
        .from('credit_logs')
        .delete()
        .eq('description', 'TEST - SHOULD FAIL');
    }
  }
  
  // 4. 统计信息
  console.log('📋 统计信息...');
  const { count: totalCount } = await supabase
    .from('credit_logs')
    .select('*', { count: 'exact', head: true });
  
  const { count: refundCount } = await supabase
    .from('credit_logs')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'refund');
  
  console.log(`   总记录数: ${totalCount || 'N/A'}`);
  console.log(`   返还记录数: ${refundCount || 'N/A'}`);
  
  console.log('\n========================================');
  console.log('🎉 验证完成');
  console.log('========================================');
}

main().catch(console.error);
