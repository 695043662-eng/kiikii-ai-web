import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

// 通用 REST API 请求函数
async function restRequest(
  table: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    query?: string;
    body?: any;
    prefer?: string;
  }
): Promise<{ status: number; data: any }> {
  const { method = 'GET', query = '', body, prefer } = options;

  // 延迟获取配置，避免构建时报错
  const { url: SUPABASE_URL, anonKey } = getSupabaseCredentials();
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE_KEY) {
    throw new Error('[安全] SUPABASE_SERVICE_ROLE_KEY 环境变量未配置，拒绝降级到 anonKey');
  }
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
  };
  
  if (prefer) {
    headers['Prefer'] = prefer;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { status: res.status, data };
}

/**
 * POST /api/user/deduct-credits
 * 扣除或退回用户积分（CAS 乐观锁原子递减，根除脏读漏洞）
 * 
 * 🔥🔥🔥 P0 收口：扣除路径直接调用 credits.ts 的 deductCredits()，
 * 退回路径直接调用 credits.ts 的 refundCredits()。
 * 所有积分操作统一走 CAS 乐观锁循环，根除脏读漏洞。
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) {
      return NextResponse.json({
        success: false,
        error: '请先登录',
        requireLogin: true,
      });
    }
    const { userId } = auth;

    const body = await request.json();
    const { credits, isRefund = false } = body;

    if (credits === undefined || credits === 0) {
      return NextResponse.json({ 
        success: false, 
        error: '积分数量无效' 
      });
    }

    const absCredits = Math.abs(credits);

    console.log(`[user/deduct-credits] 用户 ${userId} ${isRefund ? '退回' : '扣除'} ${absCredits} 积分`);

    // 🔥 统一收口：调用 credits.ts 的 CAS 版函数
    const { deductCredits, refundCredits } = await import('@/lib/credits');

    if (isRefund) {
      // ===== 退回积分 =====
      const result = await refundCredits(userId, absCredits, `refund-${Date.now()}`, '视频生成失败退款');

      if (!result.success) {
        console.error('[user/deduct-credits] 退款失败:', result.error);
        return NextResponse.json({ 
          success: false, 
          error: result.error || '退还积分失败'
        });
      }

      console.log(`[user/deduct-credits] 退款成功，剩余: ${result.remaining}`);

      return NextResponse.json({
        success: true,
        message: '积分退回成功',
        remainingCredits: result.remaining
      });

    } else {
      // ===== 扣除积分 =====
      const result = await deductCredits(userId, absCredits);

      if (!result.success) {
        const errorMsg = result.error === '积分不足' 
          ? `积分不足，当前积分: ${result.remaining}，需要: ${absCredits}`
          : result.error || '积分扣除失败';
        
        return NextResponse.json({ 
          success: false, 
          error: errorMsg,
          currentCredits: result.remaining,
          requiredCredits: absCredits
        });
      }

      console.log(`[user/deduct-credits] 扣费成功，剩余: ${result.remaining}`);

      return NextResponse.json({
        success: true,
        message: '积分扣除成功',
        remainingCredits: result.remaining
      });
    }

  } catch (error) {
    console.error('积分操作错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误' 
    });
  }
}

// 获取用户当前积分
export async function GET() {
  try {
    const auth = await requireAuth();
    if (auth instanceof NextResponse) {
      return NextResponse.json({ 
        success: false, 
        credits: 0,
        isLoggedIn: false 
      });
    }
    const { userId } = auth;

    const { status, data } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits`,
    });

    if (status !== 200 || !data || data.length === 0) {
      return NextResponse.json({ 
        success: false, 
        credits: 0 
      });
    }

    return NextResponse.json({
      success: true,
      credits: data[0].credits
    });

  } catch (error) {
    console.error('获取积分错误:', error);
    return NextResponse.json({ 
      success: false, 
      credits: 0 
    });
  }
}
