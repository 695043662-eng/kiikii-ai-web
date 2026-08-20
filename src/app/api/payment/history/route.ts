import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

// 🔥 #886 修复：强制动态渲染 + 反缓存，防止 Next.js 缓存导致充值记录永远为空
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * 获取当前用户的在线充值订单记录
 * 
 * 🔥 #886 修复：前端"充值记录"弹窗原来调用 /api/redeem 查的是 exchange_records 表（兑换码），
 * 不是 payment_orders 表（支付订单），导致数据库有订单但前端显示为空。
 * 
 * 🔥 #887 安全加固：IDOR 越权防御
 * - userId 必须通过 requireAuth() 从服务端 JWT Cookie 解析获取
 * - 绝对禁止从 URL searchParams 读取前端传入的明文 userId（IDOR 漏洞）
 * - 使用 Service Role 绕过 RLS 是安全的，因为 WHERE 条件绑定了服务端鉴权的 userId
 */
export async function GET(request: NextRequest) {
  try {
    // 🔥 #887 安全加固：防御性检查 — 如果 URL 中包含 userId 参数，直接拒绝
    // 防止未来开发者误加 URL 参数导致 IDOR 越权漏洞
    const urlUserId = request.nextUrl.searchParams.get('userId');
    if (urlUserId) {
      console.warn('[payment/history] ⚠️ 检测到 URL 中包含 userId 参数，已拒绝（IDOR 防御）');
      return NextResponse.json(
        { success: false, error: '非法请求参数' },
        { status: 400 }
      );
    }

    // 1. 鉴权：从服务端 JWT Cookie 解析 userId（不是 URL 参数！）
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    // 2. 使用 Service Role 绕过 RLS，查询当前用户的支付订单
    const supabase = getSupabaseClient(undefined, true);
    
    // 🔥 #887 性能加固：限制返回最近 50 条，防止数据量过大拖慢接口
    const { data, error } = await supabase
      .from('payment_orders')
      .select('id, out_trade_no, user_id, price, credits, status, trade_no, package_name, paid_at, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.error('[payment/history] 查询失败:', error.message);
      return NextResponse.json(
        { success: false, error: '获取充值记录失败' },
        { status: 500 }
      );
    }

    console.log(`[payment/history] 用户 ${userId} 查询到 ${data?.length || 0} 条充值记录`);

    return NextResponse.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    console.error('[payment/history] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
