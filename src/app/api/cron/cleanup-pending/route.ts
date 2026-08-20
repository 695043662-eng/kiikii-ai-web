import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';
import { refundCredits } from '@/lib/credits';

/**
 * POST /api/cron/cleanup-pending
 * 🧹 P0 后端守护：定时清理僵尸任务 + 自动退费
 *
 * 触发方式：外部 Cron Job（如 Vercel Cron / crontab）定期调用
 *
 * 扫描规则：
 * 1. credit_logs 中 type='consume' 且 reference_id 非空，超过 30 分钟
 *    且没有对应的 type='refund' 记录（未退费）
 *    且 reference_id 不存在于 generation_records.task_id（任务未完成）
 *    → 这些是"扣了钱但任务从未完成也从未退费"的僵尸记录
 *
 * 2. video_generation_tasks 中 status IN ('pending','processing','generating') 超过 30 分钟
 *    → 服务商静默死亡的卡死视频任务
 *
 * 安全保护：请求头必须携带 CRON_SECRET（从 .env.local 读取），否则返回 401
 *
 * 幂等性：refundCredits 自带先查后插防重，同一 taskId 只能退一次
 */

// 通用 REST API 请求函数（直接 PostgREST，绕过 schema cache）
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
  const { url: SUPABASE_URL } = getSupabaseCredentials();
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE_KEY) {
    throw new Error('[cleanup-pending] SUPABASE_SERVICE_ROLE_KEY 未配置');
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
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log('[cleanup-pending] 🧹 定时清理开始...');

  // ====== 安全校验：CRON_SECRET ======
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cleanup-pending] ⚠️ CRON_SECRET 环境变量未配置，拒绝执行');
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 }
    );
  }

  const requestSecret = request.headers.get('x-cron-secret')
    || request.headers.get('authorization')?.replace('Bearer ', '')
    || request.nextUrl.searchParams.get('secret');

  if (requestSecret !== cronSecret) {
    console.warn('[cleanup-pending] ❌ CRON_SECRET 校验失败');
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // ====== 统计变量 ======
  const result = {
    scannedCreditLogs: 0,
    scannedVideoTasks: 0,
    refundedCreditLogs: 0,
    refundedVideoTasks: 0,
    skippedAlreadyRefunded: 0,
    skippedTaskCompleted: 0,
    skippedNoCredits: 0,
    errors: [] as string[],
  };

  try {
    // ============================================================
    // Phase 1: 从 credit_logs 扫描扣费但未完成、未退费的僵尸任务
    // ============================================================
    // 🛡️ #851: 图片任务 30 分钟超时，视频任务 90 分钟超时（服务商高峰期可能排队 50+ 分钟）
    const THIRTY_MIN_AGO = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const NINETY_MIN_AGO = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    // 1.1 查找 type='consume' 且 reference_id 非空且超过 30 分钟的记录
    const { status: logStatus, data: consumeLogs } = await restRequest('credit_logs', {
      query: [
        'type=eq.consume',
        'reference_id=not.is.null',
        `created_at=lt.${THIRTY_MIN_AGO}`,
        'select=id,user_id,amount,reference_id,created_at',
        'order=created_at.asc',
        'limit=500',  // 单次最多处理 500 条，防止 OOM
      ].join('&'),
    });

    if (logStatus !== 200 || !consumeLogs || !Array.isArray(consumeLogs)) {
      console.error('[cleanup-pending] 查询 credit_logs 失败:', logStatus);
      result.errors.push(`credit_logs 查询失败: status=${logStatus}`);
    } else {
      result.scannedCreditLogs = consumeLogs.length;
      console.log(`[cleanup-pending] 扫描到 ${consumeLogs.length} 条 consume 记录（>30min）`);

      // 1.2 批量收集所有 reference_id，用于后续交叉比对
      const taskIds = consumeLogs.map((log: any) => log.reference_id).filter(Boolean);

      if (taskIds.length > 0) {
        // 1.3 查找已退费的 reference_id（type='refund'）
        const refundedSet = new Set<string>();
        // PostgREST 的 in 语法：reference_id=in.(id1,id2,id3)
        // 但 URL 长度有限，分批查询
        const BATCH_SIZE = 50;
        for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
          const batch = taskIds.slice(i, i + BATCH_SIZE);
          const { status: rStatus, data: rData } = await restRequest('credit_logs', {
            query: [
              `reference_id=in.(${batch.join(',')})`,
              'type=eq.refund',
              'select=reference_id',
            ].join('&'),
          });
          if (rStatus === 200 && rData && Array.isArray(rData)) {
            rData.forEach((r: any) => { if (r.reference_id) refundedSet.add(r.reference_id); });
          }
        }

        // 1.4 查找已完成的任务（在 generation_records 中有记录）
        const completedSet = new Set<string>();
        for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
          const batch = taskIds.slice(i, i + BATCH_SIZE);
          const { status: gStatus, data: gData } = await restRequest('generation_records', {
            query: [
              `task_id=in.(${batch.join(',')})`,
              'select=task_id',
            ].join('&'),
          });
          if (gStatus === 200 && gData && Array.isArray(gData)) {
            gData.forEach((g: any) => { if (g.task_id) completedSet.add(g.task_id); });
          }
        }

        // 1.5 也检查 video_generation_tasks 中已完成的
        for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
          const batch = taskIds.slice(i, i + BATCH_SIZE);
          const { status: vStatus, data: vData } = await restRequest('video_generation_tasks', {
            query: [
              `task_id=in.(${batch.join(',')})`,
              'status=eq.completed',
              'select=task_id',
            ].join('&'),
          });
          if (vStatus === 200 && vData && Array.isArray(vData)) {
            vData.forEach((v: any) => { if (v.task_id) completedSet.add(v.task_id); });
          }
        }

        console.log(`[cleanup-pending] 已退费: ${refundedSet.size}, 已完成: ${completedSet.size}`);

        // 1.6 过滤出需要退费的僵尸任务
        const zombieLogs = consumeLogs.filter((log: any) => {
          const refId = log.reference_id;
          if (!refId) return false;
          if (refundedSet.has(refId)) { result.skippedAlreadyRefunded++; return false; }
          if (completedSet.has(refId)) { result.skippedTaskCompleted++; return false; }
          return true;
        });

        console.log(`[cleanup-pending] 发现 ${zombieLogs.length} 个僵尸任务需要退费`);

        // 1.7 执行退费（逐条处理，避免并发冲突）
        for (const log of zombieLogs) {
          try {
            const refundAmount = Math.abs(log.amount); // amount 是负数（扣费），取绝对值
            if (refundAmount <= 0) {
              result.skippedNoCredits++;
              continue;
            }

            console.log(`[cleanup-pending] 退费: taskId=${log.reference_id}, userId=${log.user_id}, amount=${refundAmount}`);
            const refundResult = await refundCredits(
              log.user_id,
              refundAmount,
              log.reference_id,
              'Backend Cron: Task timeout and auto refunded'
            );

            if (refundResult.success) {
              result.refundedCreditLogs++;
              console.log(`[cleanup-pending] ✅ 退费成功: taskId=${log.reference_id}, remaining=${refundResult.remaining}`);
            } else {
              result.errors.push(`退费失败 taskId=${log.reference_id}: ${refundResult.error}`);
              console.error(`[cleanup-pending] ❌ 退费失败: taskId=${log.reference_id}, error=${refundResult.error}`);
            }
          } catch (err: any) {
            result.errors.push(`退费异常 taskId=${log.reference_id}: ${err.message}`);
            console.error(`[cleanup-pending] ❌ 退费异常: taskId=${log.reference_id}`, err.message);
          }
        }
      }
    }

    // ============================================================
    // Phase 2: 从 video_generation_tasks 扫描卡死的视频任务
    // 🛡️ #851: 视频任务超时阈值从 30 分钟延长至 90 分钟（5400秒）
    //          原因：T8 等服务商高峰期视频生成可能需要 50+ 分钟排队
    //          旧阈值 30 分钟会提前杀死正在排队的视频任务，导致用户白嫖（已退款但服务商仍扣费）
    // ============================================================
    const { status: vtStatus, data: vtData } = await restRequest('video_generation_tasks', {
      query: [
        // 🛡️ #848 增加 client_disconnected 状态扫描（客户端断连后5分钟内退费）
        'status=in.(pending,processing,generating,client_disconnected)',
        `created_at=lt.${NINETY_MIN_AGO}`,
        'select=task_id,user_id,credits_used,status,model,prompt,created_at',
        'order=created_at.asc',
        'limit=200',
      ].join('&'),
    });

    if (vtStatus !== 200 || !vtData || !Array.isArray(vtData)) {
      console.error('[cleanup-pending] 查询 video_generation_tasks 失败:', vtStatus);
      result.errors.push(`video_generation_tasks 查询失败: status=${vtStatus}`);
    } else {
      result.scannedVideoTasks = vtData.length;
      console.log(`[cleanup-pending] 扫描到 ${vtData.length} 个卡死/断连的视频任务（>90min）`);

      for (const task of vtData) {
        try {
          const creditsUsed = task.credits_used || 0;

          // 2.1 标记任务为 timeout_failed（防诈尸）
          const { status: patchStatus } = await restRequest('video_generation_tasks', {
            method: 'PATCH',
            query: `task_id=eq.${task.task_id}`,
            body: {
              status: 'timeout_failed',
              error_message: 'Backend Cron: Task timeout and auto refunded',
              updated_at: new Date().toISOString(),
            },
          });
          if (patchStatus !== 200) {
            console.warn(`[cleanup-pending] ⚠️ 标记视频任务 ${task.task_id} 为 timeout_failed 失败: ${patchStatus}`);
          }

          // 2.2 退费
          if (creditsUsed > 0 && task.user_id) {
            console.log(`[cleanup-pending] 视频退费: taskId=${task.task_id}, userId=${task.user_id}, credits=${creditsUsed}`);
            const refundResult = await refundCredits(
              task.user_id,
              creditsUsed,
              task.task_id,
              'Backend Cron: Video task timeout and auto refunded'
            );

            if (refundResult.success) {
              result.refundedVideoTasks++;
              console.log(`[cleanup-pending] ✅ 视频退费成功: taskId=${task.task_id}, remaining=${refundResult.remaining}`);
            } else {
              result.errors.push(`视频退费失败 taskId=${task.task_id}: ${refundResult.error}`);
              console.error(`[cleanup-pending] ❌ 视频退费失败: taskId=${task.task_id}, error=${refundResult.error}`);
            }
          } else {
            result.skippedNoCredits++;
            console.log(`[cleanup-pending] 视频任务 ${task.task_id} 无积分或无用户，跳过退费`);
          }
        } catch (err: any) {
          result.errors.push(`视频退费异常 taskId=${task.task_id}: ${err.message}`);
          console.error(`[cleanup-pending] ❌ 视频退费异常: taskId=${task.task_id}`, err.message);
        }
      }
    }

    // ============================================================
    // 汇总
    // ============================================================
    const elapsed = Date.now() - startTime;
    const totalRefunded = result.refundedCreditLogs + result.refundedVideoTasks;
    console.log(`[cleanup-pending] 🧹 清理完成: 耗时 ${elapsed}ms, 退费 ${totalRefunded} 个任务, 错误 ${result.errors.length}`);

    return NextResponse.json({
      success: true,
      duration: elapsed,
      ...result,
      totalRefunded,
    });

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error('[cleanup-pending] 💥 清理异常:', error);
    return NextResponse.json(
      {
        success: false,
        duration: elapsed,
        ...result,
        error: error.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// 也支持 GET 方式调用（方便 curl 测试）
export async function GET(request: NextRequest) {
  return POST(request);
}
