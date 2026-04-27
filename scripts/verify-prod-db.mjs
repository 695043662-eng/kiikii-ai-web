/**
 * 生产环境数据库验证脚本
 * #军规 #6：使用 Node.js 脚本连接真实数据库
 */

import { createClient } from '@supabase/supabase-js';

// 生产环境配置（来自 MAINTENANCE_HANDBOOK.md）
const PROD_URL = 'https://hrwoalchynrnwlcqdpxn.supabase.co';
const PROD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhyd29hbGNoeW5ybndsY3FkcHhuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjA4ODA5NywiZXhwIjoyMDkxNjY0MDk3fQ.Hss10LcIsaL-DCRU5OjnY40qgbCZmQ9abOpavEfr2d0';

async function main() {
  console.log('========================================');
  console.log('🔍 生产环境数据库验证');
  console.log('========================================\n');
  
  console.log(`📡 数据库 URL: ${PROD_URL.substring(0, 40)}...\n`);
  
  const supabase = createClient(PROD_URL, PROD_KEY, {
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
        console.log(`   错误信息: ${insertError.message.substring(0, 80)}...\n`);
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
  
  const { count: userCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  
  console.log(`   总记录数: ${totalCount || 'N/A'}`);
  console.log(`   返还记录数: ${refundCount || 'N/A'}`);
  console.log(`   用户数: ${userCount || 'N/A'}`);
  
  console.log('\n========================================');
  console.log('🎉 生产环境验证完成');
  console.log('========================================');
}

main().catch(console.error);
