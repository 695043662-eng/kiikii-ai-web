import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getSupabaseCredentials } from '@/storage/database/supabase-client';
import { sendEmail, generateVerificationEmailHtml, generateVerificationEmailText } from '@/services/email.service';
import { checkIpRateLimit, recordIpAccess, extractClientIp } from '@/lib/ip-rate-limit';

// 验证码有效期（分钟）
const VERIFICATION_CODE_EXPIRE_MINUTES = 10;

// 生成6位数字验证码
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 验证邮箱格式
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 发送邮箱验证码
 * POST /api/auth/send-code
 * Body: { email: string, type: 'register' | 'reset_password' }
 * 
 * ⚠️ 由于 PostgREST schema cache 不刷新，无法使用 .rpc() 和 .from('email_verification_codes')
 * 所以改用 Supabase SQL Editor 的方式：通过 REST API 直接执行 SQL
 * 实际方案：用 supabase 客户端的 from() 操作验证码表，如果失败则用 fetch 直接调用 PostgREST
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, type } = body;

    // 验证参数
    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { success: false, error: '请输入有效的邮箱地址' },
        { status: 400 }
      );
    }

    if (!type || !['register', 'reset_password'].includes(type)) {
      return NextResponse.json(
        { success: false, error: '无效的验证码类型' },
        { status: 400 }
      );
    }

    // ====== IP 频率限制检查 ======
    const clientIp = extractClientIp(request);
    console.log('[Send Code] 客户端 IP:', clientIp);

    const rateLimitResult = await checkIpRateLimit(clientIp, 'email_verification');
    
    if (!rateLimitResult.allowed) {
      console.log('[Send Code] IP 频率限制触发:', {
        ip: clientIp,
        hourlyCount: rateLimitResult.hourlyCount,
        dailyCount: rateLimitResult.dailyCount,
      });
      
      return NextResponse.json(
        { 
          success: false, 
          error: rateLimitResult.error,
          rateLimit: {
            hourlyCount: rateLimitResult.hourlyCount,
            dailyCount: rateLimitResult.dailyCount,
            hourlyLimit: rateLimitResult.hourlyLimit,
            dailyLimit: rateLimitResult.dailyLimit,
          }
        },
        { status: 429 }
      );
    }

    const client = getSupabaseClient(undefined, true);

    // 检查邮箱是否已存在（注册时）
    if (type === 'register') {
      const { data: existingUser } = await client
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

      if (existingUser) {
        return NextResponse.json(
          { success: false, error: '该邮箱已被注册' },
          { status: 400 }
        );
      }
    }

    // ====== 使用 PostgREST REST API 直接操作验证码表 ======
    // PostgREST schema cache 不刷新，supabase-js 的 .from() 可能也报 PGRST205
    // 所以直接用 fetch 调 PostgREST REST API，加上 Prefer 头
    const { url: supabaseUrl, anonKey } = getSupabaseCredentials();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const restUrl = `${supabaseUrl}/rest/v1/email_verification_codes`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    };

    // 清理过期验证码
    const now = new Date().toISOString();
    await fetch(`${restUrl}?email=eq.${encodeURIComponent(email)}&is_used=eq.false&expires_at=lt.${encodeURIComponent(now)}`, {
      method: 'DELETE',
      headers,
    });

    // 检查发送频率（60秒内不能重复发送）
    const checkRes = await fetch(
      `${restUrl}?email=eq.${encodeURIComponent(email)}&is_used=eq.false&expires_at=gt.${encodeURIComponent(now)}&order=created_at.desc&limit=1`,
      { headers }
    );
    
    if (checkRes.ok) {
      const recentCodes = await checkRes.json();
      if (Array.isArray(recentCodes) && recentCodes.length > 0) {
        const createdAt = new Date(recentCodes[0].created_at);
        const diffSeconds = (Date.now() - createdAt.getTime()) / 1000;
        if (diffSeconds < 60) {
          return NextResponse.json(
            { success: false, error: `请 ${Math.ceil(60 - diffSeconds)} 秒后再试` },
            { status: 429 }
          );
        }
      }
    }

    // 生成新验证码
    const code = generateCode();
    const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRE_MINUTES * 60 * 1000);

    // 保存验证码到数据库
    const insertRes = await fetch(restUrl, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        email,
        code,
        type,
        is_used: false,
        expires_at: expiresAt.toISOString(),
      }),
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      console.error('[Send Code] 保存验证码失败:', insertRes.status, errText);
      return NextResponse.json(
        { success: false, error: '发送失败，请稍后重试' },
        { status: 500 }
      );
    }

    // 发送邮件
    const emailResult = await sendEmail({
      toEmail: email,
      subject: type === 'register' ? '【Kiikii AI】注册验证码' : '【Kiikii AI】重置密码验证码',
      htmlBody: generateVerificationEmailHtml(code, type),
      textBody: generateVerificationEmailText(code, type),
      code: code,
    });

    if (!emailResult.success) {
      // 删除保存的验证码
      await fetch(`${restUrl}?email=eq.${encodeURIComponent(email)}&code=eq.${code}`, {
        method: 'DELETE',
        headers,
      });

      console.error('[Send Code] 邮件发送失败:', emailResult.error);
      return NextResponse.json(
        { success: false, error: '邮件发送失败，请检查邮箱地址是否正确' },
        { status: 500 }
      );
    }

    console.log('[Send Code] 验证码已发送:', { email, type, messageId: emailResult.messageId });

    // 记录 IP 访问（用于频率限制）
    await recordIpAccess(clientIp, 'email_verification');

    return NextResponse.json({
      success: true,
      message: '验证码已发送',
      expiresIn: VERIFICATION_CODE_EXPIRE_MINUTES * 60,
    });
  } catch (error) {
    console.error('[Send Code] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
