import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { signAuthToken } from '@/lib/auth-middleware';

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
    const { error: updateError } = await client
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('[Login] 更新最后登录时间失败:', updateError);
    } else {
      console.log('[Login] 更新最后登录时间成功:', {
        userId: user.id,
        last_login_at: new Date().toISOString(),
      });
    }

    // 🔧 #758 四次修复：使用 NextResponse 直接设置 Set-Cookie 头
    // Next.js 的 cookies().set() 在某些情况下可能不生效
    
    // 检测是否为 HTTPS 环境
    const isSecure = process.env.NODE_ENV === 'production' || 
                     process.env.COZE_PROJECT_ENV === 'PROD' ||
                     request.headers.get('x-forwarded-proto') === 'https' ||
                     process.env.COZE_PROJECT_DOMAIN_DEFAULT?.startsWith('https://');
    
    // 🔧 #758 终极兼容版本（军师指令）
    // 生产环境：SameSite=Lax; Secure（防 CSRF）
    // 沙箱环境：SameSite=None; Secure（允许跨站调试，沙箱是 HTTPS 支持 Secure）
    
    // 签发 JWT Token
    const authToken = await signAuthToken(user.id, { phone: user.phone, email: user.email });
    
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
    const userIdCookie = `user_id=${user.id}; ${cookieSuffix}`;

    console.log('[Login] Cookie 设置（终极兼容版本）:', {
      isProduction,
      sameSitePolicy,
      userId: user.id,
      cookieSuffix,
    });

    console.log('[Login] 用户登录成功:', {
      userId: user.id,
      phone: user.phone,
      email: user.email,
    });

    // 创建响应并设置 Set-Cookie 头
    const response = NextResponse.json({
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
    
    response.headers.append('Set-Cookie', authTokenCookie);
    response.headers.append('Set-Cookie', userIdCookie);
    
    return response;
  } catch (error) {
    console.error('[Login] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
