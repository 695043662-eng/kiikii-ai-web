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
 * GET /api/credits/deduct
 * 检查用户积分是否足够
 */
export async function GET(request: NextRequest) {
  try {
    // 安全加固：积分扣减检查需要登录
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;

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
 * 扣除用户积分（CAS 乐观锁原子递减，根除脏读漏洞）
 * 
 * 🔥🔥🔥 P0 收口：直接调用 credits.ts 的 deductCredits()，
 * 所有扣费路径统一走 CAS（Compare-And-Swap）乐观锁循环，
 * 根除"先读-再算-后写"并发脏读漏洞。
 */
export async function POST(request: NextRequest) {
  try {
    // 安全加固：积分扣减需要登录
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { userId, credits, taskId } = body;

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

    // 🔥 统一收口：调用 CAS 版 deductCredits
    const { deductCredits } = await import('@/lib/credits');
    const result = await deductCredits(userId, credits, taskId);

    if (!result.success) {
      const statusCode = result.error === '用户不存在' ? 404 
        : result.error === '积分不足' ? 400 
        : 400;
      return NextResponse.json(
        { error: result.error, remaining: result.remaining },
        { status: statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      remaining: result.remaining,
    });

  } catch (error: any) {
    console.error('[credits/deduct POST] 服务器错误:', error);
    return NextResponse.json(
      { error: '服务器错误' },
      { status: 500 }
    );
  }
}
