import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseClient, getSupabaseCredentials } from '@/storage/database/supabase-client';

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

// 验证密码强度
function isValidPassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 6) {
    return { valid: false, error: '密码至少6位' };
  }
  if (password.length > 20) {
    return { valid: false, error: '密码最多20位' };
  }
  return { valid: true };
}

/**
 * 注册接口
 * POST /api/auth/register
 * Body: { phone: string, email: string, code: string, password: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone, email, code, password } = body;

    // 验证参数
    if (!phone || !isValidPhone(phone)) {
      return NextResponse.json(
        { success: false, error: '请输入有效的手机号码' },
        { status: 400 }
      );
    }

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { success: false, error: '请输入有效的邮箱地址' },
        { status: 400 }
      );
    }

    if (!code || code.length !== 6) {
      return NextResponse.json(
        { success: false, error: '请输入6位验证码' },
        { status: 400 }
      );
    }

    const passwordCheck = isValidPassword(password);
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { success: false, error: passwordCheck.error },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true);

    // 检查手机号是否已注册
    const { data: existingPhone } = await client
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingPhone) {
      return NextResponse.json(
        { success: false, error: '该手机号码已被注册' },
        { status: 400 }
      );
    }

    // 检查邮箱是否已注册
    const { data: existingEmail } = await client
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingEmail) {
      return NextResponse.json(
        { success: false, error: '该邮箱已被注册' },
        { status: 400 }
      );
    }

    // 验证邮箱验证码（使用 PostgREST REST API 直接操作，绕过 schema cache 问题）
    const { url: supabaseUrl, anonKey } = getSupabaseCredentials();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const restUrl = `${supabaseUrl}/rest/v1/email_verification_codes`;
    const restHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    };

    const now = new Date().toISOString();
    const verifyRes = await fetch(
      `${restUrl}?email=eq.${encodeURIComponent(email)}&code=eq.${code}&type=eq.register&is_used=eq.false&expires_at=gt.${encodeURIComponent(now)}&select=id`,
      { headers: restHeaders }
    );

    if (!verifyRes.ok) {
      console.error('[Register] 验证码查询失败:', verifyRes.status);
      return NextResponse.json(
        { success: false, error: '验证码验证失败，请重试' },
        { status: 500 }
      );
    }

    const verifyData = await verifyRes.json();
    if (!Array.isArray(verifyData) || verifyData.length === 0) {
      return NextResponse.json(
        { success: false, error: '验证码错误或已过期' },
        { status: 400 }
      );
    }

    // 标记验证码已使用
    const codeId = verifyData[0].id;
    await fetch(`${restUrl}?id=eq.${codeId}`, {
      method: 'PATCH',
      headers: restHeaders,
      body: JSON.stringify({ is_used: true }),
    });

    // 加密密码
    const hashedPassword = await hashPassword(password);

    // 创建用户
    const { data: newUser, error: insertError } = await client
      .from('users')
      .insert({
        phone,
        email,
        password: hashedPassword,
        credits: 0,
        is_active: true,
        nickname: `用户${phone.slice(-4)}`,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Register] 创建用户失败:', insertError);
      return NextResponse.json(
        { success: false, error: '注册失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 设置 cookie
    const cookieStore = await cookies();
    cookieStore.set('user_id', newUser.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/',
    });

    console.log('[Register] 用户注册成功:', { userId: newUser.id, phone, email });

    return NextResponse.json({
      success: true,
      data: {
        userId: newUser.id,
        phone: newUser.phone,
        email: newUser.email,
        credits: newUser.credits,
      },
      message: '注册成功',
    });
  } catch (error) {
    console.error('[Register] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
