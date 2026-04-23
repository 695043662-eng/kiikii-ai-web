/**
 * IP 频率限制工具
 * 用于防止验证码接口被恶意刷取
 * 
 * 限制规则：
 * - 1 小时内最多发送 RATE_LIMIT_HOURLY 次（默认 5 次）
 * - 24 小时内最多发送 RATE_LIMIT_DAILY 次（默认 10 次）
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';

// 环境变量配置（可配置）
const RATE_LIMIT_HOURLY = parseInt(process.env.RATE_LIMIT_HOURLY || '5', 10);
const RATE_LIMIT_DAILY = parseInt(process.env.RATE_LIMIT_DAILY || '10', 10);

// Supabase 客户端（延迟初始化，避免构建时报错）
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const { url, anonKey } = getSupabaseCredentials();
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const key = serviceRoleKey || anonKey;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

export interface RateLimitResult {
  allowed: boolean;
  error?: string;
  hourlyCount?: number;
  dailyCount?: number;
  hourlyLimit?: number;
  dailyLimit?: number;
}

/**
 * 检查 IP 频率限制
 * @param ip 客户端 IP 地址
 * @param actionType 操作类型，默认 'email_verification'
 * @returns 是否允许访问
 */
export async function checkIpRateLimit(
  ip: string,
  actionType: string = 'email_verification'
): Promise<RateLimitResult> {
  if (!ip || ip === 'unknown') {
    // 无法获取 IP 时允许通过（但记录警告）
    console.warn('[IP Rate Limit] 无法获取客户端 IP');
    return { allowed: true };
  }

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const supabase = getSupabase();
    // 查询 1 小时内的次数
    const { count: hourlyCount, error: hourlyError } = await supabase
      .from('ip_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .eq('action_type', actionType)
      .gte('created_at', oneHourAgo.toISOString());

    if (hourlyError) {
      console.error('[IP Rate Limit] 查询小时计数失败:', hourlyError);
      // 数据库错误时允许通过，避免影响正常用户
      return { allowed: true };
    }

    // 查询 24 小时内的次数
    const { count: dailyCount, error: dailyError } = await supabase
      .from('ip_rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('ip', ip)
      .eq('action_type', actionType)
      .gte('created_at', twentyFourHoursAgo.toISOString());

    if (dailyError) {
      console.error('[IP Rate Limit] 查询日计数失败:', dailyError);
      return { allowed: true };
    }

    // 检查是否超过限制
    if ((hourlyCount || 0) >= RATE_LIMIT_HOURLY) {
      console.log(`[IP Rate Limit] IP ${ip} 触发小时限制: ${hourlyCount}/${RATE_LIMIT_HOURLY}`);
      return {
        allowed: false,
        error: `操作过于频繁，1 小时内最多发送 ${RATE_LIMIT_HOURLY} 次验证码`,
        hourlyCount: hourlyCount || 0,
        dailyCount: dailyCount || 0,
        hourlyLimit: RATE_LIMIT_HOURLY,
        dailyLimit: RATE_LIMIT_DAILY,
      };
    }

    if ((dailyCount || 0) >= RATE_LIMIT_DAILY) {
      console.log(`[IP Rate Limit] IP ${ip} 触发日限制: ${dailyCount}/${RATE_LIMIT_DAILY}`);
      return {
        allowed: false,
        error: `今日发送次数已达上限（${RATE_LIMIT_DAILY} 次），请明天再试`,
        hourlyCount: hourlyCount || 0,
        dailyCount: dailyCount || 0,
        hourlyLimit: RATE_LIMIT_HOURLY,
        dailyLimit: RATE_LIMIT_DAILY,
      };
    }

    return {
      allowed: true,
      hourlyCount: hourlyCount || 0,
      dailyCount: dailyCount || 0,
      hourlyLimit: RATE_LIMIT_HOURLY,
      dailyLimit: RATE_LIMIT_DAILY,
    };
  } catch (error) {
    console.error('[IP Rate Limit] 检查失败:', error);
    // 异常时允许通过，避免影响正常用户
    return { allowed: true };
  }
}

/**
 * 记录 IP 访问
 * @param ip 客户端 IP 地址
 * @param actionType 操作类型，默认 'email_verification'
 */
export async function recordIpAccess(
  ip: string,
  actionType: string = 'email_verification'
): Promise<void> {
  if (!ip || ip === 'unknown') {
    return;
  }

  try {
    const supabase = getSupabase();
    await supabase
      .from('ip_rate_limits')
      .insert({
        ip,
        action_type: actionType,
        created_at: new Date().toISOString(),
      });
    
    console.log(`[IP Rate Limit] 记录访问: ${ip} - ${actionType}`);
  } catch (error) {
    console.error('[IP Rate Limit] 记录失败:', error);
  }
}

/**
 * 清理过期的 IP 访问记录（可定期执行）
 * 保留 24 小时内的记录
 */
export async function cleanupExpiredIpRecords(): Promise<number> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('ip_rate_limits')
      .delete()
      .lt('created_at', twentyFourHoursAgo.toISOString())
      .select('id');

    if (error) {
      console.error('[IP Rate Limit] 清理失败:', error);
      return 0;
    }

    const deletedCount = data?.length || 0;
    console.log(`[IP Rate Limit] 清理了 ${deletedCount} 条过期记录`);
    return deletedCount;
  } catch (error) {
    console.error('[IP Rate Limit] 清理异常:', error);
    return 0;
  }
}

/**
 * 从请求中提取客户端 IP
 */
export function extractClientIp(request: Request): string {
  // 按优先级获取真实 IP
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for 可能包含多个 IP，取第一个
    return forwarded.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }

  return 'unknown';
}
