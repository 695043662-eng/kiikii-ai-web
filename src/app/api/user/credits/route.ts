import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// 新用户初始积分
const DEFAULT_CREDITS = 0;

/**
 * 获取用户积分（无感开户）
 * GET /api/user/credits
 * 
 * 返回格式：{ credits: number, user_id: string }
 * 
 * 🔥 核心逻辑：用户不存在时自动创建（初始积分 50），绝不报错！
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        credits: 0,
        user_id: null,
      });
    }

    const client = getSupabaseClient(undefined, true);

    // 1. 查询用户
    const { data: user, error } = await client
      .from('users')
      .select('id, credits')
      .eq('id', userId)
      .single();

    // 2. 🔥 用户不存在时，自动创建（无感开户）
    if (error || !user) {
      console.log(`[/api/user/credits] 用户不存在，自动开户: ${userId}`);
      
      const { data: newUser, error: insertError } = await client
        .from('users')
        .upsert({
          id: userId,
          credits: DEFAULT_CREDITS,
          created_at: new Date().toISOString(),
        }, {
          onConflict: 'id',
        })
        .select('id, credits')
        .single();

      if (insertError || !newUser) {
        console.error('[/api/user/credits] 自动开户失败:', insertError);
        // 开户失败也返回 0，不踢人
        return NextResponse.json({ 
          credits: 0,
          user_id: userId,
        });
      }

      console.log(`[/api/user/credits] 自动开户成功: ${userId}, 积分: ${newUser.credits}`);
      return NextResponse.json({
        credits: newUser.credits || 0,
        user_id: String(newUser.id),
        is_new_user: true, // 标记为新用户
      });
    }

    // 3. 用户存在，返回积分
    return NextResponse.json({
      credits: user.credits || 0,
      user_id: String(user.id),
    });

  } catch (error) {
    console.error('[/api/user/credits] 异常:', error);
    return NextResponse.json({ 
      credits: 0,
      user_id: null,
    });
  }
}
