import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseClient, getSupabaseCredentials } from '@/storage/database/supabase-client';
import { signAuthToken } from '@/lib/auth-middleware';

// 默认头像 URL（从环境变量读取）
const DEFAULT_AVATAR_URL = process.env.NEXT_PUBLIC_DEFAULT_AVATAR_URL || '';

// 密码加密（使用环境变量中的盐值）
const PASSWORD_SALT = process.env.PASSWORD_SALT || '';

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + PASSWORD_SALT);
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
        avatar: DEFAULT_AVATAR_URL, // 设置默认头像
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

    // 🔧 #758 四次修复：使用 NextResponse 直接设置 Set-Cookie 头
    // Next.js 的 cookies().set() 在某些情况下可能不生效
    
    // 检测是否为 HTTPS 环境
    const isSecure = process.env.NODE_ENV === 'production' || 
                     process.env.COZE_PROJECT_ENV === 'PROD' ||
                     request.headers.get('x-forwarded-proto') === 'https' ||
                     process.env.COZE_PROJECT_DOMAIN_DEFAULT?.startsWith('https://');
    
    // 🔧 #758 五次修复：SameSite=Lax 对于同站请求更可靠
    // 🔧 #758 终极兼容版本（军师指令）
    // 生产环境：SameSite=Lax; Secure（防 CSRF）
    // 沙箱环境：SameSite=None; Secure（允许跨站调试，沙箱是 HTTPS 支持 Secure）
    
    // 签发 JWT Token
    const authToken = await signAuthToken(newUser.id, { phone, email });
    
    // 1. 判断是否是生产环境
    const isProduction = process.env.NODE_ENV === 'production';
    
    // 2. 动态生成 SameSite 策略：
    // 生产环境用 Lax 防 CSRF；沙箱环境用 None 允许跨站调试。
    const sameSitePolicy = isProduction ? 'Lax' : 'None';
    
    // 3. 生成终极 Cookie 后缀（注意：SameSite=None 必须配合 Secure，沙箱是 HTTPS 所以完美支持）
    const maxAge = 60 * 60 * 24 * 7;
    const cookieSuffix = `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSitePolicy}; Secure`;
    
    // 4. 应用到 Set-Cookie
    const authTokenCookie = `auth_token=${authToken}; ${cookieSuffix}`;
    const userIdCookie = `user_id=${newUser.id}; ${cookieSuffix}`;

    console.log('[Register] Cookie 设置（终极兼容版本）:', {
      isProduction,
      sameSitePolicy,
      userId: newUser.id,
      cookieSuffix,
    });

    console.log('[Register] 用户注册成功:', { userId: newUser.id, phone, email });

    // 创建响应并设置 Set-Cookie 头
    const response = NextResponse.json({
      success: true,
      data: {
        userId: newUser.id,
        phone: newUser.phone,
        email: newUser.email,
        credits: newUser.credits,
      },
      message: '注册成功',
    });
    
    response.headers.append('Set-Cookie', authTokenCookie);
    response.headers.append('Set-Cookie', userIdCookie);
    
    return response;
  } catch (error) {
    console.error('[Register] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
