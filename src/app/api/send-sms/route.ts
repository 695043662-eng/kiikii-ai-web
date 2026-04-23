import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 生成6位随机验证码
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  try {
    console.log('========================================');
    console.log('=== 发送短信验证码 ===');
    console.log('========================================');

    const body = await request.json();
    const { phone, type = 'register' } = body;

    if (!phone) {
      return NextResponse.json({ error: '请输入手机号' }, { status: 400 });
    }

    // 验证手机号格式
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      return NextResponse.json({ error: '手机号格式不正确' }, { status: 400 });
    }

    const client = getSupabaseClient(undefined, true);

    // 如果是注册，检查手机号是否已注册
    if (type === 'register') {
      const { data: existingUser } = await client
        .from('users')
        .select('id')
        .eq('phone', phone)
        .single();

      if (existingUser) {
        return NextResponse.json({ error: '该手机号已注册' }, { status: 400 });
      }
    }

    // 删除该手机号之前未使用的验证码
    await client
      .from('sms_codes')
      .delete()
      .eq('phone', phone)
      .eq('type', type)
      .eq('is_used', false);

    // 生成新验证码
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5分钟后过期

    // 保存验证码到数据库
    const { error } = await client
      .from('sms_codes')
      .insert({
        phone,
        code,
        type,
        expires_at: expiresAt.toISOString(),
        is_used: false,
      });

    if (error) {
      console.error('保存验证码失败:', error);
      return NextResponse.json({ error: '发送验证码失败' }, { status: 500 });
    }

    // TODO: 在这里集成实际的短信发送服务
    // 例如：阿里云短信、腾讯云短信等
    // 目前先在控制台输出验证码，方便测试
    console.log(`========================================`);
    console.log(`📱 手机号: ${phone}`);
    console.log(`🔐 验证码: ${code}`);
    console.log(`⏰ 过期时间: 5分钟`);
    console.log(`📝 类型: ${type}`);
    console.log(`========================================`);

    // 开发环境：直接返回验证码（生产环境应该删除这行）
    const isDevelopment = process.env.NODE_ENV === 'development';

    console.log('========================================');
    console.log('=== 验证码发送成功 ===');
    console.log('========================================');

    return NextResponse.json({
      success: true,
      message: '验证码已发送',
      // 开发环境返回验证码，方便测试
      ...(isDevelopment && { code }),
    });

  } catch (error) {
    console.error('发送验证码错误:', error);
    return NextResponse.json({ 
      error: '发送验证码失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
}
