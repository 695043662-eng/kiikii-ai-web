import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';
import { refundCredits } from '@/lib/credits';

/**
 * POST /api/generation/timeout-refund
 * ⏱️ P0 防御：轮询绝对超时斩断后的退费兜底 API
 *
 * 触发场景：前端轮询超过绝对时间上限（图片5分钟/视频15分钟），
 * 服务商"静默死亡"（永远卡在 pending/generating），前端主动斩断轮询并调用此 API。
 *
 * 核心保证：
 * 1. 幂等性：同一 taskId 只能退一次（refundCredits 自带先查后插防重）
 * 2. 状态终结：将任务标记为 timeout_failed，防止诈尸（服务商延迟返回成功）
 * 3. 100% 退费：全额退还已扣积分
 */
export async function POST(request: NextRequest) {
  try {
    // 安全加固：超时退费需要登录
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) return authResult;
    const { userId } = authResult;

    const body = await request.json();
    const { taskId, type } = body;

    if (!taskId) {
      return NextResponse.json(
        { error: '缺少 taskId' },
        { status: 400 }
      );
    }

    console.log(`[timeout-refund] ⏱️ P0 超时退费请求: userId=${userId}, taskId=${taskId}, type=${type || 'unknown'}`);

    // 通用 REST API 请求函数
    const restRequest = async (
      table: string,
      options: {
        method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
        query?: string;
        body?: any;
        prefer?: string;
      }
    ): Promise<{ status: number; data: any }> => {
      const { method = 'GET', query = '', body: reqBody, prefer } = options;
      const { url: SUPABASE_URL } = getSupabaseCredentials();
      const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!SERVICE_ROLE_KEY) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY 未配置');
      }
      const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      };
      if (prefer) headers['Prefer'] = prefer;
      const res = await fetch(url, {
        method,
        headers,
        body: reqBody ? JSON.stringify(reqBody) : undefined,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: res.status, data };
    };

    // ====== Step 1: 查找任务记录，获取已扣积分 ======
    // 尝试在 image_generations 和 video_tasks 两张表中查找
    let taskRecord: any = null;
    let taskTable: string = '';
    let creditsCharged = 0;

    // 先查 image_generations
    const { status: imgStatus, data: imgData } = await restRequest('image_generations', {
      query: `id=eq.${taskId}&select=id,user_id,credits_charged,status`,
    });
    if (imgStatus === 200 && imgData && imgData.length > 0) {
      taskRecord = imgData[0];
      taskTable = 'image_generations';
      creditsCharged = taskRecord.credits_charged || 0;
    }

    // 再查 video_tasks
    if (!taskRecord) {
      const { status: vidStatus, data: vidData } = await restRequest('video_tasks', {
        query: `id=eq.${taskId}&select=id,user_id,credits_charged,status`,
      });
      if (vidStatus === 200 && vidData && vidData.length > 0) {
        taskRecord = vidData[0];
        taskTable = 'video_tasks';
        creditsCharged = taskRecord.credits_charged || 0;
      }
    }

    if (!taskRecord) {
      console.warn(`[timeout-refund] ⚠️ 任务 ${taskId} 不存在于任何表中，可能已被清理，跳过退费`);
      // 任务不存在，无法退费，但返回成功避免前端报错
      // 查询用户当前余额返回
      const { status: uStatus, data: uData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      const currentBalance = (uStatus === 200 && uData && uData.length > 0) ? uData[0].credits : 0;
      return NextResponse.json({
        success: true,
        creditsBalance: currentBalance,
        message: '任务不存在，无法退费（可能已被清理）',
      });
    }

    // ====== Step 2: 幂等性检查 —— 如果任务已经是 timeout_failed / failed，说明已处理过 ======
    if (taskRecord.status === 'timeout_failed' || taskRecord.status === 'failed') {
      console.log(`[timeout-refund] 任务 ${taskId} 已是 ${taskRecord.status} 状态，跳过重复退费`);
      const { status: uStatus, data: uData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      const currentBalance = (uStatus === 200 && uData && uData.length > 0) ? uData[0].credits : 0;
      return NextResponse.json({
        success: true,
        creditsBalance: currentBalance,
        skipped: true,
        message: `任务已是 ${taskRecord.status} 状态，无需重复退费`,
      });
    }

    // ====== Step 3: 将任务标记为 timeout_failed（防诈尸） ======
    console.log(`[timeout-refund] 将任务 ${taskId} (${taskTable}) 标记为 timeout_failed`);
    const { status: patchStatus } = await restRequest(taskTable, {
      method: 'PATCH',
      query: `id=eq.${taskId}`,
      body: {
        status: 'timeout_failed',
        error_message: `轮询绝对超时，前端主动斩断（type: ${type || 'unknown'}）`,
        updated_at: new Date().toISOString(),
      },
    });
    if (patchStatus !== 200) {
      console.error(`[timeout-refund] ⚠️ 标记任务状态失败: ${patchStatus}`);
    }

    // ====== Step 4: 执行 100% 退费 ======
    if (creditsCharged <= 0) {
      console.log(`[timeout-refund] 任务 ${taskId} 未扣积分(credits_charged=0)，无需退还`);
      const { status: uStatus, data: uData } = await restRequest('users', {
        query: `id=eq.${userId}&select=credits`,
      });
      const currentBalance = (uStatus === 200 && uData && uData.length > 0) ? uData[0].credits : 0;
      return NextResponse.json({
        success: true,
        creditsBalance: currentBalance,
        message: '未扣积分，无需退还',
      });
    }

    const refundResult = await refundCredits(
      userId,
      creditsCharged,
      taskId,
      `轮询绝对超时退费（${type || 'unknown'}，超过${type === 'video' ? '15' : '5'}分钟）`
    );

    console.log(`[timeout-refund] 退费结果: success=${refundResult.success}, remaining=${refundResult.remaining}, skipped=${refundResult.skipped}`);

    return NextResponse.json({
      success: refundResult.success,
      creditsBalance: refundResult.remaining,
      creditsRefunded: refundResult.skipped ? 0 : creditsCharged,
      skipped: refundResult.skipped,
    });

  } catch (error: any) {
    console.error('[timeout-refund] 服务器错误:', error);
    return NextResponse.json(
      { error: '服务器错误: ' + (error.message || '未知错误') },
      { status: 500 }
    );
  }
}
