import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';

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
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || anonKey;
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
 * 扣除或退回用户积分（原子操作，避免并发竞态条件）
 * 
 * ⚠️ 使用 REST API 直接操作，绕过 PostgREST schema cache 问题
 * 关键安全措施：
 * 1. 先查询当前积分
 * 2. 更新时带条件 credits=gte.${credits} 防止并发竞态
 * 3. 返回剩余积分
 * 4. 记录操作日志
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '请先登录',
        requireLogin: true 
      });
    }

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

    // ========================================
    // 使用 REST API 实现原子性积分操作
    // ========================================
    
    // 1. 查询当前积分
    const { status: getStatus, data: userData } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits`,
    });

    if (getStatus !== 200 || !userData || userData.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: '用户不存在' 
      });
    }

    const currentCredits = userData[0].credits || 0;

    if (isRefund) {
      // ===== 退回积分 =====
      const newCredits = currentCredits + absCredits;
      
      const { status: patchStatus, data: patchData } = await restRequest('users', {
        method: 'PATCH',
        query: `id=eq.${userId}`,
        body: { credits: newCredits, updated_at: new Date().toISOString() },
        prefer: 'return=representation',
      });

      if (patchStatus !== 200 || !patchData || patchData.length === 0) {
        console.error('[user/deduct-credits] 退款失败:', patchStatus);
        return NextResponse.json({ 
          success: false, 
          error: '退还积分失败' 
        });
      }

      const remainingCredits = patchData[0].credits;

      // 异步记录退款日志
      restRequest('credit_refund_logs', {
        method: 'POST',
        body: {
          user_id: userId,
          amount: absCredits,
          reason: '视频生成失败退款',
          created_at: new Date().toISOString(),
        },
      }).then(({ status }) => {
        if (status !== 201) console.error('[user/deduct-credits] 记录退款日志失败');
      });

      console.log(`[user/deduct-credits] 退款成功，剩余: ${remainingCredits}`);

      return NextResponse.json({
        success: true,
        message: '积分退回成功',
        remainingCredits: remainingCredits
      });

    } else {
      // ===== 扣除积分 =====
      
      // 检查积分是否足够
      if (currentCredits < absCredits) {
        return NextResponse.json({ 
          success: false, 
          error: `积分不足，当前积分: ${currentCredits}，需要: ${absCredits}`,
          currentCredits: currentCredits,
          requiredCredits: absCredits
        });
      }

      const newCredits = currentCredits - absCredits;

      // 更新积分（带条件防止并发）
      const { status: patchStatus, data: patchData } = await restRequest('users', {
        method: 'PATCH',
        query: `id=eq.${userId}&credits=gte.${absCredits}`,  // 条件：当前积分 >= 扣除数量
        body: { credits: newCredits, updated_at: new Date().toISOString() },
        prefer: 'return=representation',
      });

      if (patchStatus !== 200 || !patchData || patchData.length === 0) {
        // 可能是并发导致条件不满足，重新查询
        console.warn('[user/deduct-credits] 扣费失败，可能并发冲突');
        const { data: retryData } = await restRequest('users', {
          query: `id=eq.${userId}&select=credits`,
        });
        const retryCredits = retryData?.[0]?.credits || 0;
        
        return NextResponse.json({ 
          success: false, 
          error: `积分不足或操作冲突，当前积分: ${retryCredits}`,
          currentCredits: retryCredits,
          requiredCredits: absCredits
        });
      }

      const remainingCredits = patchData[0].credits;

      // 异步记录扣费日志
      restRequest('credit_logs', {
        method: 'POST',
        body: {
          user_id: userId,
          amount: -absCredits,
          type: 'deduct',
          balance_after: remainingCredits,
          description: '视频生成扣费',
          created_at: new Date().toISOString(),
        },
      }).then(({ status }) => {
        if (status !== 201) console.error('[user/deduct-credits] 记录扣费日志失败');
      });

      console.log(`[user/deduct-credits] 扣费成功，剩余: ${remainingCredits}`);

      return NextResponse.json({
        success: true,
        message: '积分扣除成功',
        remainingCredits: remainingCredits
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
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        credits: 0,
        isLoggedIn: false 
      });
    }

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
