import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

/**
 * #837 读风暴修复：添加服务端内存缓存，10秒 TTL
 * user/info 被 useCanvasCore 每 30 秒轮询一次 + 每次 creditsChanged 事件
 * 同一 userId 10 秒内直接返回缓存，避免短时间重复打 DB
 */
const userInfoCache = new Map<string, { data: any; timestamp: number }>();
const USER_INFO_CACHE_TTL = 10 * 1000; // 10 秒（比前端轮询间隔 30s 更短，保证积分及时刷新）

export async function GET(request: NextRequest) {
  try {
    // ====== 开发环境白名单兜底逻辑（军师方案：上帝模式）======
    const isProduction = process.env.NODE_ENV === 'production';
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    // 🔥 #886 修复：检查 nocache 参数，支付成功后强制跳过服务端缓存
    const url = new URL(request.url);
    const skipCache = url.searchParams.get('nocache') === '1';

    if (!isProduction && !userId) {
      // 开发环境白名单，不走缓存
      const adminPhone = process.env.NEXT_PUBLIC_ADMIN_PHONE || '13824085362';
      const adminUserId = '5bb66162-29de-4839-8726-54d217663506';
      return NextResponse.json({
        success: true,
        user: {
          id: adminUserId,
          phone: adminPhone,
          email: "sandbox@test.com",
          nickname: "沙箱测试管理员",
          avatar: null,
          credits: 99999,
          failed_attempts: 0,
          is_active: true,
          locked_until: null,
          created_at: new Date().toISOString(),
          role: "admin"
        }
      });
    }
    // ====== 开发环境白名单结束 ======

    if (!userId) {
      return NextResponse.json({ 
        success: false,
        user: null 
      });
    }

    // #837 检查缓存（同一 userId 10秒内不重复查 DB）
    // 🔥 #886 修复：nocache=1 时跳过服务端缓存（支付成功后强制拉取最新积分）
    if (!skipCache) {
      const cached = userInfoCache.get(userId);
      if (cached && Date.now() - cached.timestamp < USER_INFO_CACHE_TTL) {
        return NextResponse.json(cached.data);
      }
    }

    const client = getSupabaseClient(undefined, true);

    const { data: user, error } = await client
      .from('users')
      .select('id, phone, email, nickname, avatar, credits, failed_attempts, is_active, locked_until, created_at')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ 
        success: false,
        user: null 
      });
    }

    // 开发环境积分兜底
    const finalCredits = (!isProduction && (user.credits === null || user.credits < 100)) ? 99999 : user.credits;

    const responseData = {
      success: true,
      user: {
        ...user,
        credits: finalCredits,
      },
    };

    // #837 写入缓存
    userInfoCache.set(userId, { data: responseData, timestamp: Date.now() });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('获取用户信息错误:', error);
    return NextResponse.json({ 
      success: false,
      user: null 
    });
  }
}
