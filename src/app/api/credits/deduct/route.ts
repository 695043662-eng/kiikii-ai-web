import { NextRequest, NextResponse } from 'next/server';
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
 * GET /api/credits/deduct
 * 检查用户积分是否足够
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const credits = parseInt(searchParams.get('credits') || '0');

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

    console.log(`[credits/deduct GET] 检查用户 ${userId} 的积分 (需要 ${credits})`);

    // 使用 REST API 查询用户积分
    const { status, data } = await restRequest('users', {
      query: `id=eq.${userId}&select=credits`,
    });

    if (status !== 200 || !data || data.length === 0) {
      console.error('[credits/deduct GET] 查询用户失败:', status, data);
      return NextResponse.json(
        { error: '用户不存在' },
        { status: 404 }
      );
    }

    const currentCredits = data[0].credits || 0;
    const sufficient = currentCredits >= credits;

    console.log(`[credits/deduct GET] 当前=${currentCredits}, 需要=${credits}, 足够=${sufficient}`);

    return NextResponse.json({
      sufficient,
      currentCredits,
    });

  } catch (error: any) {
    console.error('[credits/deduct GET] 服务器错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/credits/deduct
 * 扣除用户积分（原子操作，避免并发竞态条件）
 * 
 * ⚠️ 使用 REST API 直接操作，绕过 PostgREST schema cache 问题
 * 关键安全措施：
 * 1. 先查询当前积分
 * 2. 更新时带条件 credits=gte.${credits} 防止并发竞态
 * 3. 返回是否成功和剩余积分
 * 4. 记录扣费日志
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, credits, taskId, description } = body;

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

    console.log(`[credits/deduct POST] 用户 ${userId} 扣除 ${credits} 积分`);

    // ========================================
    // 使用 REST API 实现原子性积分扣除
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

    // 2. 检查积分是否足够
    if (currentCredits < credits) {
      console.log(`[credits/deduct POST] 积分不足: 当前=${currentCredits}, 需要=${credits}`);
      return NextResponse.json(
        { error: '积分不足', remaining: currentCredits },
        { status: 400 }
      );
    }

    // 3. 更新积分（带条件：只有当积分足够时才更新，防止并发）
    const newCredits = currentCredits - credits;
    const { status: patchStatus, data: patchData } = await restRequest('users', {
      method: 'PATCH',
      query: `id=eq.${userId}&credits=gte.${credits}`,  // 条件：当前积分 >= 扣除数量
      body: { credits: newCredits, updated_at: new Date().toISOString() },
      prefer: 'return=representation',
    });

    // 4. 检查是否更新成功
    if (patchStatus !== 200 || !patchData || patchData.length === 0) {
      // 可能是并发导致条件不满足，重新查询
      console.warn('[credits/deduct POST] 更新失败，可能并发冲突，重新查询');
      const { data: retryData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      const retryCredits = retryData?.[0]?.credits || 0;
      return NextResponse.json(
        { error: '积分不足或操作冲突', remaining: retryCredits },
        { status: 400 }
      );
    }

    const remainingCredits = patchData[0].credits;

    // 5. 异步记录扣费日志
    restRequest('credit_logs', {
      method: 'POST',
      body: {
        user_id: userId,
        amount: -credits,
        type: 'deduct',
        balance_after: remainingCredits,
        task_id: taskId || null,
        description: description || '积分扣除',
        created_at: new Date().toISOString(),
      },
    }).then(({ status }) => {
      if (status !== 201) console.error('[credits/deduct POST] 记录日志失败');
    });

    console.log(`[credits/deduct POST] 扣除成功，剩余积分: ${remainingCredits}`);

    return NextResponse.json({
      success: true,
      remaining: remainingCredits,
    });

  } catch (error: any) {
    console.error('[credits/deduct POST] 服务器错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
