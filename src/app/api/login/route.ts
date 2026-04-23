import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';
import { compare as bcryptCompare } from 'bcryptjs';

// 密码验证（支持 bcrypt、SHA-256 + 盐、旧 Base64 格式）
async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  // bcrypt 格式验证 ($2a$, $2b$, $2y$)
  if (hashedPassword.startsWith('$2')) {
    return bcryptCompare(password, hashedPassword);
  }
  // SHA-256 + 盐 格式验证（64字符十六进制）
  if (/^[a-f0-9]{64}$/i.test(hashedPassword)) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'kiikii-salt-2024');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const sha256Hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return sha256Hash === hashedPassword;
  }
  // 旧 Base64 格式验证（兼容旧数据）
  return Buffer.from(password).toString('base64') === hashedPassword;
}

export async function POST(request: NextRequest) {
  try {
    console.log('========================================');
    console.log('=== 用户登录 ===');
    console.log('========================================');

    const body = await request.json();
    const { phone, password } = body;

    // 参数验证
    if (!phone || !password) {
      return NextResponse.json({ error: '请输入手机号和密码' }, { status: 400 });
    }

    const client = getSupabaseClient(undefined, true);

    // 查询用户
    const { data: user, error } = await client
      .from('users')
      .select('*')
      .eq('phone', phone)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 401 });
    }

    // 验证密码
    if (!await verifyPassword(password, user.password)) {
      return NextResponse.json({ error: '密码错误' }, { status: 401 });
    }

    // 检查用户状态
    if (!user.is_active) {
      return NextResponse.json({ error: '账号已被禁用' }, { status: 403 });
    }

    // 设置登录状态（使用 cookie）
    const cookieStore = await cookies();
    cookieStore.set('user_id', user.id, {
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

    // 更新最后登录时间
    await client
      .from('users')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', user.id);

    console.log('========================================');
    console.log('=== 登录成功 ===');
    console.log('========================================');

    return NextResponse.json({
      success: true,
      message: '登录成功',
      user: {
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        avatar: user.avatar,
        credits: user.credits,
      },
    });

  } catch (error) {
    console.error('登录错误:', error);
    return NextResponse.json({ 
      error: '登录失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}
