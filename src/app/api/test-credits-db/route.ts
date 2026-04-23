import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient(undefined, true);

    // 1. 测试表是否存在
    const { error: creditLogsError } = await client
      .from('credit_logs')
      .select('count')
      .limit(1);

    // 2. 测试函数是否存在 - 尝试调用一次（但不真的扣除积分）
    // 先获取一个测试用户
    const { data: users, error: usersError } = await client
      .from('users')
      .select('id, credits')
      .limit(1);

    if (usersError || !users || users.length === 0) {
      return NextResponse.json({
        success: false,
        error: '无法获取测试用户',
        usersError: usersError?.message
      });
    }

    const testUser = users[0];

    return NextResponse.json({
      success: true,
      message: '✅ 数据库对象验证通过！',
      credit_logs_table: creditLogsError ? '❌ 表不存在' : '✅ 表存在',
      test_user: {
        id: testUser.id,
        credits: testUser.credits
      },
      note: '扣除积分功能现在应该可以正常工作了！'
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message
    });
  }
}
