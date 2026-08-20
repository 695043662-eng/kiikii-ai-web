import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { checkIpRateLimit, recordIpAccess, extractClientIp } from '@/lib/ip-rate-limit';

// 生成6位随机验证码
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * 🛡️ 手机号维度频率限制（内存 Map，进程级防刷）
 * 限制：同一手机号 60 秒内只能发送 1 次，1 小时内最多 5 次，24 小时内最多 10 次
 * 
 * 为什么用内存 Map 而不是数据库：
 * 1. 手机号限流是高频读低频写，内存查询 O(1) 远快于数据库查询
 * 2. 与 IP 限流（ip_rate_limits 表）形成双保险：IP 换号刷不了，换 IP 同号刷不了
 * 3. 进程重启后 Map 清空是可接受的（重启后限制自然解除）
 */
interface PhoneRateEntry {
  timestamps: number[];  // 每次发送的时间戳
}

const phoneRateMap = new Map<string, PhoneRateEntry>();

// 限流配置
const PHONE_RATE_MINUTE = 1;      // 60秒内最多1次
const PHONE_RATE_HOURLY = 5;      // 1小时内最多5次
const PHONE_RATE_DAILY = 10;      // 24小时内最多10次
const PHONE_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;  // 24小时窗口

/**
 * 检查手机号频率限制
 */
function checkPhoneRateLimit(phone: string): { allowed: boolean; error?: string; retryAfterMs?: number } {
  const now = Date.now();
  const entry = phoneRateMap.get(phone);

  if (!entry) {
    return { allowed: true };
  }

  // 清理超过 24 小时的记录
  const recentTimestamps = entry.timestamps.filter(t => now - t < PHONE_RATE_WINDOW_MS);

  // 60秒限制
  const oneMinuteAgo = now - 60 * 1000;
  const minuteCount = recentTimestamps.filter(t => t > oneMinuteAgo).length;
  if (minuteCount >= PHONE_RATE_MINUTE) {
    const oldestInMinute = recentTimestamps.filter(t => t > oneMinuteAgo)[0];
    const retryAfterMs = 60000 - (now - oldestInMinute);
    return { allowed: false, error: '发送过于频繁，请60秒后再试', retryAfterMs };
  }

  // 1小时限制
  const oneHourAgo = now - 60 * 60 * 1000;
  const hourlyCount = recentTimestamps.filter(t => t > oneHourAgo).length;
  if (hourlyCount >= PHONE_RATE_HOURLY) {
    return { allowed: false, error: `1小时内最多发送${PHONE_RATE_HOURLY}次验证码` };
  }

  // 24小时限制
  if (recentTimestamps.length >= PHONE_RATE_DAILY) {
    return { allowed: false, error: `今日发送次数已达上限（${PHONE_RATE_DAILY}次），请明天再试` };
  }

  return { allowed: true };
}

/**
 * 记录手机号发送
 */
function recordPhoneAccess(phone: string): void {
  const now = Date.now();
  const entry = phoneRateMap.get(phone);

  if (!entry) {
    phoneRateMap.set(phone, { timestamps: [now] });
  } else {
    // 清理过期记录并添加新记录
    entry.timestamps = entry.timestamps.filter(t => now - t < PHONE_RATE_WINDOW_MS);
    entry.timestamps.push(now);
  }

  // 🛡️ 防止 Map 无限增长：超过 10000 条目时清理最旧的
  if (phoneRateMap.size > 10000) {
    const entries = Array.from(phoneRateMap.entries());
    entries.sort((a, b) => {
      const aLast = a[1].timestamps[a[1].timestamps.length - 1] || 0;
      const bLast = b[1].timestamps[b[1].timestamps.length - 1] || 0;
      return aLast - bLast;
    });
    // 删除最旧的 50%
    const toDelete = Math.floor(entries.length / 2);
    for (let i = 0; i < toDelete; i++) {
      phoneRateMap.delete(entries[i][0]);
    }
    console.log(`[SMS Rate Limit] Map 清理: 删除 ${toDelete} 条旧记录，剩余 ${phoneRateMap.size}`);
  }
}

// 🛡️ #848 防内存泄漏：周期清理 stale 条目（不依赖请求触发）
const MAX_PHONE_ENTRIES = 10000;
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [phone, entry] of phoneRateMap.entries()) {
      // 清理超过 24 小时的记录
      entry.timestamps = entry.timestamps.filter(t => now - t < PHONE_RATE_WINDOW_MS);
      // 如果该手机号没有任何有效记录，删除整个条目
      if (entry.timestamps.length === 0) {
        phoneRateMap.delete(phone);
      }
    }
    // 二次防线：清理后仍超上限，淘汰最旧的一半
    if (phoneRateMap.size > MAX_PHONE_ENTRIES) {
      const entries = Array.from(phoneRateMap.entries());
      entries.sort((a, b) => {
        const aLast = a[1].timestamps[a[1].timestamps.length - 1] || 0;
        const bLast = b[1].timestamps[b[1].timestamps.length - 1] || 0;
        return aLast - bLast;
      });
      const cut = phoneRateMap.size - Math.floor(MAX_PHONE_ENTRIES / 2);
      for (let i = 0; i < cut; i++) {
        phoneRateMap.delete(entries[i][0]);
      }
      console.warn(`[SMS Rate Limit] 周期清理后仍超限，强制淘汰${cut}条`);
    }
  }, 10 * 60 * 1000);  // 每 10 分钟清理一次
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

    // ====== 🛡️ IP 频率限制（数据库级，跨实例共享）======
    const clientIp = extractClientIp(request);
    console.log('[SMS] 客户端 IP:', clientIp);

    const ipRateResult = await checkIpRateLimit(clientIp, 'sms_verification');
    if (!ipRateResult.allowed) {
      console.log('[SMS] IP 频率限制触发:', {
        ip: clientIp,
        hourlyCount: ipRateResult.hourlyCount,
        dailyCount: ipRateResult.dailyCount,
      });
      return NextResponse.json(
        { error: ipRateResult.error },
        { status: 429 }
      );
    }

    // ====== 🛡️ 手机号频率限制（内存级，单进程防刷）======
    const phoneRateResult = checkPhoneRateLimit(phone);
    if (!phoneRateResult.allowed) {
      console.log('[SMS] 手机号频率限制触发:', { phone });
      return NextResponse.json(
        { error: phoneRateResult.error },
        { status: 429 }
      );
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

    // 🛡️ 记录 IP + 手机号访问（用于频率限制）
    await recordIpAccess(clientIp, 'sms_verification');
    recordPhoneAccess(phone);

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
    console.error('发送短信验证码错误:', error);
    return NextResponse.json({ 
      error: '发送验证码失败，请稍后重试'  // 🔒 P0 脱敏
    }, { status: 500 });
  }
}
