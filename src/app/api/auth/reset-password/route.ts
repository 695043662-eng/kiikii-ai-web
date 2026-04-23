import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getSupabaseCredentials } from '@/storage/database/supabase-client';

// 密码加密
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'kiikii-salt-2024');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 重置密码接口
 * POST /api/auth/reset-password
 * Body: { email: string, code: string, password: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { email, code, password } = await request.json();

    console.log('[重置密码] 请求:', { email, code: code ? '***' : null, password: password ? '***' : null });

    // 验证参数
    if (!email || !code || !password) {
      return NextResponse.json({ error: '参数不完整' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少6位' }, { status: 400 });
    }

    const client = getSupabaseClient(undefined, true);

    // 验证验证码（使用 PostgREST REST API 直接操作，绕过 schema cache 问题）
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
      `${restUrl}?email=eq.${encodeURIComponent(email)}&code=eq.${code}&type=eq.reset_password&is_used=eq.false&expires_at=gt.${encodeURIComponent(now)}&select=id`,
      { headers: restHeaders }
    );

    if (!verifyRes.ok) {
      console.log('[重置密码] 验证码查询失败:', verifyRes.status);
      return NextResponse.json({ error: '验证码验证失败，请重试' }, { status: 500 });
    }

    const verifyData = await verifyRes.json();
    if (!Array.isArray(verifyData) || verifyData.length === 0) {
      console.log('[重置密码] 验证码无效或已过期');
      return NextResponse.json({ error: '验证码无效或已过期' }, { status: 400 });
    }

    // 标记验证码已使用
    const codeId = verifyData[0].id;
    await fetch(`${restUrl}?id=eq.${codeId}`, {
      method: 'PATCH',
      headers: restHeaders,
      body: JSON.stringify({ is_used: true }),
    });

    // 查找用户
    const { data: user, error: userError } = await client
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (userError || !user) {
      console.log('[重置密码] 用户不存在:', userError?.message || '');
      return NextResponse.json({ error: '该邮箱未注册' }, { status: 400 });
    }

    // 加密新密码
    const hashedPassword = await hashPassword(password);

    // 更新用户密码
    const { error: updateError } = await client
      .from('users')
      .update({ password: hashedPassword, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (updateError) {
      console.log('[重置密码] 更新密码失败:', updateError.message);
      return NextResponse.json({ error: '重置密码失败' }, { status: 500 });
    }

    console.log('[重置密码] 成功，用户:', email);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[重置密码] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
