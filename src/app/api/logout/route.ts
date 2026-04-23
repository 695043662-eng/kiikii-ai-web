import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
  try {
    console.log('========================================');
    console.log('=== 用户注销 ===');
    console.log('========================================');

    const cookieStore = await cookies();
    
    // 删除登录状态的 cookies
    cookieStore.delete('user_id');
    cookieStore.delete('user_phone');

    console.log('========================================');
    console.log('=== 注销成功 ===');
    console.log('========================================');

    return NextResponse.json({
      success: true,
      message: '注销成功',
    });

  } catch (error) {
    console.error('注销错误:', error);
    return NextResponse.json({ 
      error: '注销失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}
