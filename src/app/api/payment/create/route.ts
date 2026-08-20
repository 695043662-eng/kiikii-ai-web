import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 🔥 #883 防缓存：强制动态渲染，禁止 Next.js 静态缓存此路由
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// 价格到积分的映射表（写死在后端，防篡改）
// 同时支持 '9.9' 和 '9.90' 两种格式
const PRICE_TO_CREDITS: Record<string, number> = {
  '9.9': 800,
  '9.90': 800,
  '29.9': 2750,
  '29.90': 2750,
  '59.9': 5550,
  '59.90': 5550,
  '99.9': 9300,
  '99.90': 9300,
  '199': 18800,
  '199.00': 18800,
  '499': 47500,
  '499.00': 47500,
};

// MD5签名生成函数
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { price, userId } = body;

    if (!price || !userId) {
      return NextResponse.json(
        { success: false, error: '缺少必要参数' },
        { status: 400 }
      );
    }

    const credits = PRICE_TO_CREDITS[price];
    if (!credits) {
      return NextResponse.json(
        { success: false, error: '无效的价格档位' },
        { status: 400 }
      );
    }

    // 生成唯一订单号
    const outTradeNo = `PAY${Date.now()}${Math.random().toString(36).substring(2, 8)}`;

    // 🔥 #849 修复：使用连接池单例，防止连接池雪崩
    // 🔥 #879 修复：使用 serviceRole 绕过 RLS，否则 anon key 的 INSERT 会被 RLS 策略拦截返回 42501
    const supabase = getSupabaseClient(undefined, true);

    // 订单落库
    const { error: dbError } = await supabase.from('payment_orders').insert({
      out_trade_no: outTradeNo,
      user_id: userId,
      price: parseFloat(price),
      credits: credits,
      status: 'unpaid',
    });

    if (dbError) {
      console.error('[支付] 创建订单失败:', dbError);
      return NextResponse.json(
        { success: false, error: '创建订单失败' },
        { status: 500 }
      );
    }

    console.log(`[支付] 订单创建成功: ${outTradeNo}, 用户: ${userId}, 金额: ${price}, 积分: ${credits}`);

    // 🔥 #881 诊断日志：插入后立即回查确认落库成功
    const { data: verifyOrder, error: verifyError } = await supabase
      .from('payment_orders')
      .select('out_trade_no, status')
      .eq('out_trade_no', outTradeNo)
      .single();

    if (verifyError || !verifyOrder) {
      console.error('[支付] ⚠️ 落库验证失败! 插入成功但查询不到:', {
        out_trade_no: outTradeNo,
        verifyError: verifyError ? { message: verifyError.message, code: verifyError.code } : null,
      });
      // 🔥 #883 致命修复：落库验证失败 = 幽灵订单！绝不返回QR码！
      // 旧漏洞：验证失败仅打日志但继续返回 QR 码 → 用户扫码付款 → notify 找不到订单 → 积分不到账！
      return NextResponse.json(
        { success: false, error: '订单落库失败，请稍后重试' },
        { status: 500 }
      );
    }

    console.log('[支付] ✅ 落库验证通过:', verifyOrder);

    // 读取环境变量
    const pid = process.env.PAYMENT_PID;
    const key = process.env.PAYMENT_KEY;
    const apiUrl = process.env.PAYMENT_API_URL;

    if (!pid || !key || !apiUrl) {
      console.error('[支付] 缺少支付环境变量配置', { pid: !!pid, key: !!key, apiUrl: !!apiUrl });
      return NextResponse.json(
        { success: false, error: '服务器支付配置缺失' },
        { status: 500 }
      );
    }

    // 🔥 #879 修复：COZE_PROJECT_DOMAIN_DEFAULT 缺失时用 request.origin 兜底
    // 生产服务器可能没有 Coze 沙箱注入此变量，但完全可以从请求 URL 中获取域名
    const baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT || request.nextUrl.origin;
    if (!baseUrl) {
      console.error('[支付] 域名配置缺失且无法从请求中推断');
      return NextResponse.json(
        { success: false, error: '服务器域名配置缺失' },
        { status: 500 }
      );
    }

    const notifyUrl = `${baseUrl}/api/payment/notify`;
    const returnUrl = `${baseUrl}/records?payment=success`;

    // 拼装支付参数
    const params: Record<string, any> = {
      pid: pid,
      type: 'wxpay',
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      return_url: returnUrl,
      name: '购买积分',
      money: parseFloat(price).toFixed(2),
    };

    // 生成签名
    params.sign = generateSign(params, key);
    params.sign_type = 'MD5';

    console.log('[支付] 请求支付平台参数:', JSON.stringify(params, null, 2));

    // 发起支付请求
    const formData = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => formData.append(k, String(v)));

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const result = await response.json();
    console.log('[支付] 支付平台返回:', JSON.stringify(result, null, 2));

    if (result.code !== 1) {
      console.error('[支付] 平台返回错误:', result);
      return NextResponse.json(
        { success: false, error: result.msg || '支付请求失败' },
        { status: 500 }
      );
    }

    // 返回二维码或跳转链接给前端
    return NextResponse.json({
      success: true,
      data: {
        out_trade_no: outTradeNo,
        qrcode: result.qrcode,
        payurl: result.payurl,
        urlscheme: result.urlscheme,
      },
    });

  } catch (error: any) {
    console.error('[支付] 发起异常:', error);
    return NextResponse.json(
      { success: false, error: error?.message || '服务器内部错误' },
      { status: 500 }
    );
  }
}
