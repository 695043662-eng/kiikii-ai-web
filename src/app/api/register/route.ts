import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';
import crypto from 'crypto';

// 密码加密（与 login/route.ts 保持一致：SHA-256 + salt）
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + 'kiikii-salt-2024').digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    console.log('========================================');
    console.log('=== 用户注册 ===');
    console.log('========================================');

    const body = await request.json();
    const { phone, password, code } = body;

    // 参数验证
    if (!phone || !password || !code) {
      return NextResponse.json({ error: '请填写完整信息' }, { status: 400 });
    }

    // 验证手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return NextResponse.json({ error: '手机号格式不正确' }, { status: 400 });
    }

    // 验证密码强度
    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少需要6位' }, { status: 400 });
    }

    const client = getSupabaseClient(undefined, true);

    // 验证验证码
    const { data: smsCode, error: smsError } = await client
      .from('sms_codes')
      .select('*')
      .eq('phone', phone)
      .eq('code', code)
      .eq('type', 'register')
      .eq('is_used', false)
      .single();

    if (smsError || !smsCode) {
      return NextResponse.json({ error: '验证码错误或已过期' }, { status: 400 });
    }

    // 检查验证码是否过期
    const expiresAt = new Date(smsCode.expires_at);
    if (expiresAt < new Date()) {
      return NextResponse.json({ error: '验证码已过期' }, { status: 400 });
    }

    // 检查手机号是否已注册
    const { data: existingUser } = await client
      .from('users')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existingUser) {
      return NextResponse.json({ error: '该手机号已注册' }, { status: 400 });
    }

    // 创建用户
    const hashedPassword = hashPassword(password);
    const { data: newUser, error: createError } = await client
      .from('users')
      .insert({
        phone,
        password: hashedPassword,
        nickname: `用户${phone.substring(7)}`,
        credits: 10, // 新用户赠送10积分
        is_active: true,
      })
      .select()
      .single();

    if (createError) {
      console.error('创建用户失败:', createError);
      return NextResponse.json({ error: '注册失败' }, { status: 500 });
    }

    // 标记验证码为已使用
    await client
      .from('sms_codes')
      .update({ is_used: true })
      .eq('id', smsCode.id);

    // 设置登录状态（使用 cookie）
    const cookieStore = await cookies();
    cookieStore.set('user_id', newUser.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7天
    });

    cookieStore.set('user_phone', phone, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });

    console.log('========================================');
    console.log('=== 注册成功 ===');
    console.log('========================================');

    return NextResponse.json({
      success: true,
      message: '注册成功',
      user: {
        id: newUser.id,
        phone: newUser.phone,
        nickname: newUser.nickname,
        credits: newUser.credits,
      },
    });

  } catch (error) {
    console.error('注册错误:', error);
    return NextResponse.json({ 
      error: '注册失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}
