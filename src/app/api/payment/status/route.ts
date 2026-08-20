import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 🔥 #883 防缓存：强制动态渲染，禁止 Next.js/CF 缓存此路由（否则 404 被缓存死锁）
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const outTradeNo = url.searchParams.get('out_trade_no');

    if (!outTradeNo) {
      return NextResponse.json(
        { success: false, error: '缺少订单号' },
        { status: 400 }
      );
    }

    console.log('[支付状态查询] 查询订单号:', outTradeNo);

    // 🔥 #849 修复：使用连接池单例，防止连接池雪崩
    // 🔥 #879 修复：使用 serviceRole 绕过 RLS，防止 anon key SELECT 被 RLS 拦截
    const supabase = getSupabaseClient(undefined, true);

    const { data: order, error } = await supabase
      .from('payment_orders')
      .select('status, credits, paid_at, price, out_trade_no')
      .eq('out_trade_no', outTradeNo)
      .single();

    if (error || !order) {
      // 🔥 #881 诊断日志：详细输出查询失败原因，帮助定位 404 根因
      console.error('[支付状态查询] 订单未找到!', {
        out_trade_no: outTradeNo,
        supabaseError: error ? { message: error.message, code: error.code, details: error.details } : null,
        orderFound: !!order,
      });
      return NextResponse.json(
        { success: false, error: '订单不存在' },
        { status: 404 }
      );
    }

    console.log('[支付状态查询] 查询成功:', { out_trade_no: order.out_trade_no, status: order.status });

    return NextResponse.json({
      success: true,
      data: {
        status: order.status,
        credits: order.credits,
        price: order.price,
        paid_at: order.paid_at,
      },
    });

  } catch (error) {
    console.error('[支付状态查询] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
