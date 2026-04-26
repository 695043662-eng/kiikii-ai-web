import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    console.log('[user/info] 请求收到, userId from cookie:', userId);

    if (!userId) {
      console.log('[user/info] 未找到 userId cookie');
      return NextResponse.json({ 
        success: false,
        user: null 
      });
    }

    const client = getSupabaseClient(undefined, true);

    const { data: user, error } = await client
      .from('users')
      .select('id, phone, email, nickname, avatar, credits, failed_attempts, created_at')
      .eq('id', userId)
      .single();

    console.log('[user/info] 查询结果:', { 
      userId, 
      userCredits: user?.credits, 
      failedAttempts: user?.failed_attempts,  // #301 打印违规计数
      error: error?.message 
    });

    if (error || !user) {
      console.log('[user/info] 用户查询失败:', error);
      return NextResponse.json({ 
        success: false,
        user: null 
      });
    }

    console.log('[user/info] 返回用户积分:', user.credits);
    return NextResponse.json({
      success: true,
      user,
    });

  } catch (error) {
    console.error('获取用户信息错误:', error);
    return NextResponse.json({ 
      success: false,
      user: null 
    });
  }
}
