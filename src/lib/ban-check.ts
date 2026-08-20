/**
 * 统一用户风控检查函数
 * 
 * 逻辑说明：
 * 1. 永久禁用：is_active=false 且 locked_until=null（管理员手动禁用）
 * 2. 临时禁用：locked_until 在未来（连续失败20次自动封禁6小时，不修改 is_active）
 * 3. 自动解封：locked_until 已过期 → 自然解封，零 DB 写入
 * 4. 成功1次清零：只要成功生成一张图，failed_attempts 无条件重置为 0
 */

import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface BanCheckResult {
  isBanned: boolean;
  bannedUntil?: string;
  remainingMinutes?: number;
  error?: string;
  banType?: 'temporary' | 'permanent';
}

/**
 * 检查用户是否被禁用
 * 🚀 零写入：不会执行任何 DB UPDATE，仅读取判断
 * 
 * @param userId 用户ID
 * @returns BanCheckResult 禁用状态信息
 */
export async function checkUserBanned(userId: string): Promise<BanCheckResult> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client
      .from('users')
      .select('is_active, locked_until')
      .eq('id', userId)
      .single();

    if (error || !data) {
      // 用户不存在，不拦截
      return { isBanned: false };
    }

    const user = data as { is_active: boolean | null; locked_until: string | null };
    const now = Date.now();

    // 1. 永久禁用优先：is_active=false（管理员手动禁用），无论 locked_until 状态
    //    管理员禁用时 locked_until 可能有值也可能是 null，但 is_active=false 是确定性标记
    if (user.is_active === false) {
      console.log(`[BanCheck] 用户 ${userId} 被管理员永久禁用`);
      return {
        isBanned: true,
        error: '您的账号因连续异常操作已被锁定，请联系客服',
        banType: 'permanent',
      };
    }

    // 2. 临时禁用：locked_until 在未来（连续异常操作自动封禁，不修改 is_active）
    if (user.locked_until) {
      const lockedUntilTime = new Date(user.locked_until).getTime();
      if (now < lockedUntilTime) {
        // 仍在临时禁用期
        const remainingMinutes = Math.ceil((lockedUntilTime - now) / 60000);
        console.log(`[BanCheck] 用户 ${userId} 临时禁用中，还剩 ${remainingMinutes} 分钟`);
        return {
          isBanned: true,
          bannedUntil: user.locked_until,
          remainingMinutes,
          error: `您的账号因连续异常操作已被锁定，还剩 ${remainingMinutes} 分钟解封`,
          banType: 'temporary',
        };
      }
      // locked_until 已过期 → 自然解封，零 DB 写入！
      console.log(`[BanCheck] 用户 ${userId} locked_until 已过期，自然解封（零写入）`);
    }

    // 3. 正常用户
    return { isBanned: false };
  } catch (err) {
    console.error('[BanCheck] 检查禁用状态异常:', err);
    // 异常时放行，避免阻断正常用户
    return { isBanned: false };
  }
}

/**
 * 生成禁用响应（统一格式）
 * 供 route.ts 直接使用
 */
export function createBannedResponse(result: BanCheckResult): Response {
  return new Response(JSON.stringify({
    error: result.error || '您的账号因连续异常操作已被锁定',
    isBanned: true,
    bannedUntil: result.bannedUntil,
    banType: result.banType,
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}
