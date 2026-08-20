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
 * POST /api/credits/refund
 * 退还用户积分（原子操作，避免并发问题）
 * 
 * ⚠️ 使用 REST API 直接操作，绕过 PostgREST schema cache 问题
 * 使用场景：任务失败时的积分补偿
 * 
 * #156 防重复机制：检查 taskId 是否已退还过
 */
export async function POST(request: NextRequest) {
  try {
    // 安全加固：积分返还需要登录
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { userId, credits, taskId, reason } = body;

    if (!userId) {
      return NextResponse.json(
        { error: '缺少用户ID' },
        { status: 400 }
      );
    }

    if (!credits || credits <= 0) {
      return NextResponse.json(
        { error: '积分数量无效' },
        { status: 400 }
      );
    }

    console.log(`[credits/refund] 用户 ${userId} 退还 ${credits} 积分, taskId=${taskId}, reason=${reason}`);

    // ========================================
    // #156 防重复机制：检查 taskId 是否已退还过
    // ========================================
    if (taskId) {
      const { status: checkStatus, data: existingLogs } = await restRequest('credit_refund_logs', {
        query: `task_id=eq.${taskId}&select=id`,
      });

      if (checkStatus === 200 && existingLogs && existingLogs.length > 0) {
        console.log(`[credits/refund] #156 防重复: taskId=${taskId} 已退还过，跳过`);
        return NextResponse.json({
          success: true,
          remaining: null,
          message: '该任务已退还过积分（防重复）',
        });
      }
    }

    // ========================================
    // 使用 REST API 实现积分退还
    // ========================================
    
    // 1. 查询当前积分
    const { status: getStatus, data: userData } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits`,
    });

    if (getStatus !== 200 || !userData || userData.length === 0) {
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    const currentCredits = userData[0].credits || 0;
    const newCredits = currentCredits + credits;

    // 2. 更新积分
    const { status: patchStatus, data: patchData } = await restRequest('users', {
      method: 'PATCH',
      query: `id=eq.${userId}`,
      body: { credits: newCredits, updated_at: new Date().toISOString() },
      prefer: 'return=representation',
    });

    if (patchStatus !== 200 || !patchData || patchData.length === 0) {
      console.error('[credits/refund] 更新积分失败:', patchStatus);
      return NextResponse.json(
        { error: '退还积分失败' },
        { status: 500 }
      );
    }

    const remainingCredits = patchData[0].credits;

    // 3. 异步记录补偿日志
    restRequest('credit_refund_logs', {
      method: 'POST',
      body: {
        user_id: userId,
        task_id: taskId || null,
        amount: credits,
        reason: reason || '积分退还',
        created_at: new Date().toISOString(),
      },
    }).then(({ status }) => {
      if (status !== 201) console.error('[credits/refund] 记录补偿日志失败');
    });

    console.log(`[credits/refund] 退还成功: 剩余 ${remainingCredits} 积分`);

    return NextResponse.json({
      success: true,
      remaining: remainingCredits,
    });

  } catch (error: any) {
    console.error('[credits/refund] 服务器错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
