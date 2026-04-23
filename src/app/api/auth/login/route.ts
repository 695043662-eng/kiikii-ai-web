import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 密码加密
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'kiikii-salt-2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 验证手机号格式
function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

// 验证邮箱格式
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 登录接口
 * POST /api/auth/login
 * Body: { account: string, password: string }
 * account 可以是手机号或邮箱
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account, password } = body;

    // 验证参数
    if (!account) {
      return NextResponse.json(
        { success: false, error: '请输入手机号码或邮箱' },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json(
        { success: false, error: '请输入密码' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true);

    // 判断是手机号还是邮箱
    let query;
    if (isValidPhone(account)) {
      // 手机号登录
      query = client
        .from('users')
        .select('*')
        .eq('phone', account);
    } else if (isValidEmail(account)) {
      // 邮箱登录
      query = client
        .from('users')
        .select('*')
        .eq('email', account);
    } else {
      return NextResponse.json(
        { success: false, error: '请输入正确的手机号码或邮箱' },
        { status: 400 }
      );
    }

    const { data: user, error } = await query.single();

    if (error || !user) {
      return NextResponse.json(
        { success: false, error: '用户不存在' },
        { status: 401 }
      );
    }

    // 验证密码
    const hashedPassword = await hashPassword(password);
    if (user.password !== hashedPassword) {
      return NextResponse.json(
        { success: false, error: '密码错误' },
        { status: 401 }
      );
    }

    // 检查用户是否激活
    if (!user.is_active) {
      return NextResponse.json(
        { success: false, error: '账号已被禁用' },
        { status: 403 }
      );
    }

    // 更新最后登录时间
    await client
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    // 设置 cookie
    const cookieStore = await cookies();
    cookieStore.set('user_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/',
    });

    console.log('[Login] 用户登录成功:', {
      userId: user.id,
      phone: user.phone,
      email: user.email,
    });

    return NextResponse.json({
      success: true,
      data: {
        userId: user.id,
        phone: user.phone,
        email: user.email,
        credits: user.credits,
        nickname: user.nickname,
      },
      message: '登录成功',
    });
  } catch (error) {
    console.error('[Login] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
