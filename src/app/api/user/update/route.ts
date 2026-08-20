import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

/**
 * 更新当前登录用户的信息
 * 支持更新：昵称、头像
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const body = await request.json();
    const { nickname, avatar } = body;

    // 至少需要一个更新字段
    if (!nickname && !avatar) {
      return NextResponse.json({ 
        success: false,
        error: '没有需要更新的内容' 
      }, { status: 400 });
    }

    // 验证昵称
    if (nickname !== undefined) {
      if (typeof nickname !== 'string' || nickname.trim().length === 0) {
        return NextResponse.json({ 
          success: false,
          error: '昵称不能为空' 
        }, { status: 400 });
      }
      if (nickname.length > 20) {
        return NextResponse.json({ 
          success: false,
          error: '昵称最多20个字符' 
        }, { status: 400 });
      }
    }

    // 验证头像 URL
    if (avatar !== undefined && avatar !== null) {
      if (typeof avatar !== 'string') {
        return NextResponse.json({ 
          success: false,
          error: '头像格式错误' 
        }, { status: 400 });
      }
    }

    const client = getSupabaseClient(undefined, true);

    // 构建更新数据
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    
    if (nickname !== undefined) {
      updateData.nickname = nickname.trim();
    }
    if (avatar !== undefined) {
      updateData.avatar = avatar;
    }

    // 更新用户信息
    const { data: updatedUser, error } = await client
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, phone, nickname, avatar, credits, created_at')
      .single();

    if (error) {
      console.error('更新用户信息失败:', error);
      return NextResponse.json({ 
        success: false,
        error: '更新失败，请稍后重试' 
      }, { status: 500 });
    }

    if (!updatedUser) {
      return NextResponse.json({ 
        success: false,
        error: '用户不存在' 
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      user: updatedUser,
    });

  } catch (error) {
    console.error('更新用户信息错误:', error);
    return NextResponse.json({ 
      success: false,
      error: '服务器错误' 
    }, { status: 500 });
  }
}
