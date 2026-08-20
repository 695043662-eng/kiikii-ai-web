import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { addCredits } from '@/lib/credits';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 🔥 #883 防缓存：强制动态渲染，绝不允许回调被 CDN/Next.js 缓存吞掉
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// MD5签名生成函数（与发起支付一致）
function generateSign(params: Record<string, any>, key: string): string {
  const filteredParams = Object.entries(params)
    .filter(([k, v]) =>
      v !== '' &&
      v !== null &&
      v !== undefined &&
      k !== 'sign' &&
      k !== 'sign_type'
    )
    .sort(([a], [b]) => a.localeCompare(b));

  const stringA = filteredParams.map(([k, v]) => `${k}=${v}`).join('&');
  return crypto.createHash('md5').update(stringA + key).digest('hex');
}

// 🔥 #882 修复：易支付支持 POST 和 GET 两种回调方式
export async function POST(request: NextRequest) {
  return handleNotify(request);
}

export async function GET(request: NextRequest) {
  return handleNotify(request);
}

// 🔥 #882 修复：易支付 trade_status 多值兼容
// 不同易支付服务商/版本可能返回不同的成功状态值：
// - TRADE_SUCCESS（最常见）
// - SUCCESS（部分服务商）
// - success（小写变体）
// - TRADE_FINISHED（支付宝风格）
const SUCCESS_STATUS_VALUES = ['TRADE_SUCCESS', 'SUCCESS', 'success', 'TRADE_FINISHED'];

async function handleNotify(request: NextRequest) {
  // 🔥 #880 诊断日志：入口即记录，确保 pm2 logs 能捕捉到
  console.log('[Webhook接收] 收到支付回调, method:', request.method, 'url:', request.url);
  try {
    const url = new URL(request.url);
    let params: Record<string, any> = {};

    // 兼容多种入参方式
    if (request.method === 'GET') {
      url.searchParams.forEach((value, key) => {
        params[key] = value;
      });
      // 🔥 #882 GET回调专属诊断：记录完整查询参数
      console.log('[支付回调] GET回调参数:', JSON.stringify(params));
    } else {
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        params = await request.json();
      } else {
        const text = await request.text();
        const searchParams = new URLSearchParams(text);
        searchParams.forEach((value, key) => {
          params[key] = value;
        });
      }
      console.log('[支付回调] POST回调参数:', JSON.stringify(params));
    }

    // 🔥 #849 P0 修复：PAYMENT_KEY 存在性检查
    // 旧漏洞：如果 PAYMENT_KEY 未设置，key=undefined，generateSign 计算 md5(stringA + "undefined")
    // 这是一个可预测的固定值，攻击者可以计算出签名并伪造回调！
    const key = process.env.PAYMENT_KEY;
    if (!key) {
      console.error('[支付回调] 🚨 严重：PAYMENT_KEY 未配置，拒绝所有回调请求！');
      return new NextResponse('config_error', { status: 500 });
    }

    // ====== 1. 签名验证（最重要！） ======
    // 🔥 #849 P0 加固：使用 crypto.timingSafeEqual 防止时序攻击
    // 旧漏洞：receivedSign !== calculatedSign 使用普通字符串比较，存在时序侧信道
    // 攻击者可通过测量响应时间逐字符爆破签名
    const receivedSign = params.sign;
    const calculatedSign = generateSign(params, key);

    console.log('[支付回调] 签名比对:', {
      receivedSign: receivedSign ? `${receivedSign.substring(0, 6)}...` : '(空)',
      calculatedSign: `${calculatedSign.substring(0, 6)}...`,
      match: receivedSign === calculatedSign,
    });

    if (!receivedSign || typeof receivedSign !== 'string' ||
        !calculatedSign || typeof calculatedSign !== 'string' ||
        receivedSign.length !== calculatedSign.length ||
        !crypto.timingSafeEqual(Buffer.from(receivedSign), Buffer.from(calculatedSign))) {
      console.error('[支付回调] 签名验证失败! receivedSign:', receivedSign, 'calculatedSign:', calculatedSign);
      return new NextResponse('sign_error', { status: 400 });
    }

    console.log('[支付回调] 签名验证通过');

    // ====== 2. 支付状态检查 ======
    // 🔥 #882 修复：trade_status 多值兼容
    // 旧代码：严格 === 'TRADE_SUCCESS'，导致易支付某些版本返回 SUCCESS/success 时被误判为非成功
    // 返回 200 'success' 给服务商（阻止重发），但实际不执行加积分 → 用户付款后积分不到账！
    const tradeStatus = params.trade_status;
    console.log('[支付回调] trade_status 收到值:', JSON.stringify(tradeStatus), '类型:', typeof tradeStatus);

    if (!tradeStatus || !SUCCESS_STATUS_VALUES.includes(tradeStatus)) {
      console.log('[支付回调] 支付状态非成功:', tradeStatus, '→ 返回success阻止重发，但不加积分');
      // 非成功状态也返回 success，阻止平台重复发送
      return new NextResponse('success', { status: 200 });
    }

    const outTradeNo = params.out_trade_no;
    const tradeNo = params.trade_no;

    console.log('[支付回调] 支付成功! out_trade_no:', outTradeNo, 'trade_no:', tradeNo);

    // 🔥 #849 修复：使用单例客户端，避免每次回调创建新连接
    const supabase = getSupabaseClient(undefined, true);

    // ====== 3. 查询订单 ======
    const { data: order, error: queryError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('out_trade_no', outTradeNo)
      .single();

    if (queryError || !order) {
      console.error('[支付回调] 订单不存在:', outTradeNo, 'queryError:', queryError?.message);
      return new NextResponse('order_not_found', { status: 400 });
    }

    console.log('[支付回调] 订单查询成功:', { out_trade_no: order.out_trade_no, status: order.status, price: order.price, credits: order.credits });

    // ====== 4. 金额严格比对（容差比较法，防止 0.01 元白嫖 499 套餐） ======
    const receivedMoney = parseFloat(params.money);
    const expectedMoney = parseFloat(String(order.price));

    if (Math.abs(receivedMoney - expectedMoney) > 0.001) {
      console.error('[支付回调] 🚨 警告：回调金额与订单金额不符! 回调:', receivedMoney, '订单:', expectedMoney);
      return new NextResponse('money_mismatch', { status: 400 });
    }

    console.log('[支付回调] 金额验证通过:', receivedMoney);

    // ====== 5. 幂等控制（快速路径：已处理订单直接返回） ======
    if (order.status === 'paid') {
      console.log('[支付回调] 订单已处理，直接返回 success:', outTradeNo);
      return new NextResponse('success', { status: 200 });
    }

    // ====== 6. CAS 原子锁：更新订单状态（防并发刷单） ======
    // 🔒 关键：WHERE status='unpaid' 确保只有一个并发请求能成功更新
    // 如果 0 行被更新，说明另一个并发回调已抢先处理，直接返回 success
    // 🐛 #856 修复：create 路由插入 status='unpaid'，但旧代码写的是 'pending'，
    // 导致 CAS 永远匹配不到行，订单永远无法被更新为 paid，积分永远无法到账！
    const { data: updatedOrder, error: updateOrderError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        trade_no: tradeNo,
        paid_at: new Date().toISOString(),
        raw_notify: params,
      })
      .eq('out_trade_no', outTradeNo)
      .eq('status', 'unpaid')  // 🛡️ CAS 条件：只有 unpaid 状态才能被更新（与 create 路由一致）
      .select()
      .single();

    if (updateOrderError) {
      // 🔥 #885 致命修复：区分"数据库真实报错"和"CAS锁命中"
      // 旧漏洞：把所有 UPDATE 失败都当"CAS并发回调"处理 → 返回 'success' → 易支付不再重试
      // 真实场景：raw_notify 列不存在(42703)、连接超时等 → 积分永远不到账！
      const errorCode = (updateOrderError as any)?.code;
      const errorMessage = updateOrderError.message || '';
      
      // PGRST116 = ".single() 返回0行" = CAS 锁命中（另一个回调已更新此订单）
      if (errorCode === 'PGRST116' || errorMessage.includes('0 rows') || errorMessage.includes('no rows')) {
        console.log('[支付回调] CAS 锁命中，订单已被其他回调处理:', outTradeNo);
        return new NextResponse('success', { status: 200 });
      }
      
      // 其他所有错误 = 数据库真实报错！绝不能返回 'success'！
      console.error('[支付回调] 🚨 UPDATE 真实报错! 绝不能吞掉!', {
        out_trade_no: outTradeNo,
        errorCode,
        errorMessage,
        fullError: JSON.stringify(updateOrderError, null, 2),
      });
      // 返回非 success → 易支付会重试回调 → 等数据库修好后积分仍能到账
      return new NextResponse('db_error', { status: 500 });
    }
    
    if (!updatedOrder) {
      // 0 行匹配 = CAS 锁命中（安全路径）
      console.log('[支付回调] CAS 锁命中(0行匹配)，订单已被其他回调处理:', outTradeNo);
      return new NextResponse('success', { status: 200 });
    }

    console.log('[支付回调] CAS 锁获取成功，订单状态已原子更新为 paid');

    // ====== 7. 积分原子增加（复用 addCredits + 双式记账） ======
    // 🔒 订单级 CAS 已保证 addCredits 只会被调用一次（防并发刷单）
    // addCredits 内部完成 credits 递增 + credit_logs 流水记录
    const addResult = await addCredits(
      order.user_id,
      order.credits,
      'recharge',
      outTradeNo,
      `充值套餐 ${order.package_name || outTradeNo}，到账 ${order.credits} 积分`
    );

    if (!addResult.success) {
      console.error('[支付回调] 积分增加失败:', addResult.error);
      // 积分增加失败但订单已标记 paid → 不回滚订单状态（避免丢单）
      // 管理员可通过 credit_logs 排查，手动补单
      return new NextResponse('update_credits_error', { status: 500 });
    }

    // ====== 8. 记录日志并返回 success ======
    console.log(`[支付回调] ✅ 充值成功!`, {
      user_id: order.user_id,
      out_trade_no: outTradeNo,
      trade_no: tradeNo,
      price: order.price,
      credits_added: order.credits,
      remaining: addResult.remaining,
    });

    // 必须返回纯文本 "success"
    return new NextResponse('success', { status: 200 });

  } catch (error) {
    console.error('[支付回调] 处理异常:', error);
    return new NextResponse('error', { status: 500 });
  }
}
