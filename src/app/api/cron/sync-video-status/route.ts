import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getModelAPIConfigFull } from '@/lib/api-config';
import { refundCredits } from '@/lib/credits';
import { downloadAndUploadVideoToCOS } from '@/lib/cos-upload';

// ====== #852 真·离线异步巡检状态机 ======
// 每 1~2 分钟由外部 Cron 触发，查 video_generation_tasks 表中 processing 状态的任务
// 使用任务创建时存储的 poll_url 直接向服务商发起状态查询
// 成功则下载视频→上传COS→写 video_history→标记 completed
// 失败则退费→标记 failed
// 超过 90 分钟仍未完成则标记 timeout_failed→退费

const CRON_SECRET = process.env.CRON_SECRET || 'kiikii-cron-secret-2024';
const VIDEO_TASK_TIMEOUT_MS = 90 * 60 * 1000; // 90 分钟
const MAX_TASKS_PER_RUN = 20; // 每次最多处理 20 个任务，防止 2C2G 服务器 OOM
const POLL_TIMEOUT_MS = 15000; // 单次轮询超时 15 秒

// ====== 从轮询响应中提取状态 ======
function extractStatus(pollData: any): string {
  // 统一多层级向下兼容提取
  const raw = pollData.status || pollData.data?.status || pollData.task?.status || '';
  return (raw || '').toString().toLowerCase();
}

// ====== 从轮询响应中提取视频 URL ======
function extractVideoUrl(pollData: any): string {
  // 统一多层级向下兼容提取
  const url =
    pollData.video_url ||
    pollData.video ||
    (pollData.videos && pollData.videos[0]) ||
    pollData.result?.data?.[0]?.url ||
    pollData.result?.url ||
    pollData.output?.url ||
    pollData.data?.url ||
    pollData.output?.[0] ||
    (pollData.data?.videos && pollData.data.videos[0]) ||
    '';
  return typeof url === 'string' ? url : '';
}

// ====== 判断成功状态 ======
function isSuccessStatus(status: string): boolean {
  return status === 'succeeded' || status === 'completed' || status === 'success' || status === 'done';
}

// ====== 判断失败状态 ======
function isFailedStatus(status: string): boolean {
  return status === 'failed' || status === 'error' || status === 'rejected' || status === 'cancelled' || status === 'canceled';
}

// ====== 判断进行中状态 ======
function isProcessingStatus(status: string): boolean {
  return status === 'processing' || status === 'pending' || status === 'queued' || status === 'in_progress' || status === 'running' || status === 'waiting' || status === '';
}

function wrapAsProxyUrl(originUrl: string): string {
  return `/api/video/proxy?url=${encodeURIComponent(originUrl)}`;
}

// ====== 主处理函数 ======
export async function GET(request: NextRequest) {
  console.log('[sync-video-status] 离线巡检启动', new Date().toISOString());

  // 安全校验
  const authHeader = request.headers.get('authorization');
  const urlSecret = request.nextUrl.searchParams.get('secret');
  if (authHeader !== `Bearer ${CRON_SECRET}` && urlSecret !== CRON_SECRET) {
    console.error('[sync-video-status] 鉴权失败');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseClient();
  const now = Date.now();
  const stats = { checked: 0, completed: 0, failed: 0, timeout: 0, stillProcessing: 0, errors: 0 };

  try {
    // ====== 1. 捞取 processing 状态的任务 ======
    const { data: tasks, error: fetchError } = await supabase
      .from('video_generation_tasks')
      .select('*')
      .eq('status', 'processing')
      .order('created_at', { ascending: true })
      .limit(MAX_TASKS_PER_RUN);

    if (fetchError) {
      console.error('[sync-video-status] 查询任务失败:', fetchError.message);
      return NextResponse.json({ error: 'DB query failed', detail: fetchError.message }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
      console.log('[sync-video-status] 无 processing 状态的任务，巡检完成');
      return NextResponse.json({ success: true, stats });
    }

    console.log(`[sync-video-status] 发现 ${tasks.length} 个 processing 任务`);

    // ====== 2. 逐个处理任务 ======
    for (const task of tasks) {
      stats.checked++;

      // 超时检查：超过 90 分钟的任务标记 timeout_failed + 退费
      const createdAt = new Date(task.created_at).getTime();
      const elapsed = now - createdAt;
      if (elapsed > VIDEO_TASK_TIMEOUT_MS) {
        console.log(`[sync-video-status] 任务 ${task.task_id} 超时(${Math.round(elapsed / 1000 / 60)}分钟)，标记 timeout_failed 并退费`);
        try {
          if (task.user_id && task.credits_used > 0) {
            await refundCredits(task.user_id, task.credits_used, task.task_id, `视频任务超时(>${VIDEO_TASK_TIMEOUT_MS / 60000}分钟)自动退费-离线巡检`);
          }
          await supabase
            .from('video_generation_tasks')
            .update({
              status: 'timeout_failed',
              error_message: `任务超时(${Math.round(elapsed / 1000 / 60)}分钟)`,
              updated_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            })
            .eq('task_id', task.task_id);
          stats.timeout++;
        } catch (e) {
          console.error(`[sync-video-status] 超时处理异常:`, e);
          stats.errors++;
        }
        continue;
      }

      // 缺少 poll_url 的任务跳过（无法轮询）
      if (!task.poll_url) {
        console.warn(`[sync-video-status] 任务 ${task.task_id} 无 poll_url，跳过`);
        continue;
      }

      // ====== 3. 获取 API 配置（用于 API Key） ======
      let apiKey = '';
      let apiEndpoint = '';
      try {
        const apiConfig = await getModelAPIConfigFull(task.model);
        if (apiConfig) {
          apiKey = apiConfig.apiKey || '';
          apiEndpoint = apiConfig.apiEndpoint || '';
        }
      } catch (e) {
        console.error(`[sync-video-status] 获取模型 ${task.model} 的 API 配置失败:`, e);
      }

      if (!apiKey) {
        console.error(`[sync-video-status] 模型 ${task.model} 无 API Key，跳过`);
        stats.errors++;
        continue;
      }

      // ====== 4. 使用存储的 poll_url 查询服务商 ======
      console.log(`[sync-video-status] 轮询任务 ${task.task_id} (model=${task.model}, pollUrl=${task.poll_url.substring(0, 80)})`);

      try {
        const pollResponse = await fetch(task.poll_url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        });

        if (!pollResponse.ok) {
          console.warn(`[sync-video-status] 任务 ${task.task_id} 轮询 HTTP ${pollResponse.status}，跳过本轮`);
          stats.stillProcessing++;
          continue;
        }

        const pollData = await pollResponse.json();
        const status = extractStatus(pollData);
        console.log(`[sync-video-status] 任务 ${task.task_id} 状态: ${status}`);

        // ====== 5a. 成功：下载视频 + 写 video_history + 标记 completed ======
        if (isSuccessStatus(status)) {
          const videoUrl = extractVideoUrl(pollData);
          if (!videoUrl) {
            console.error(`[sync-video-status] 任务 ${task.task_id} 成功但无视频 URL，标记 failed 并退费`);
            try {
              if (task.user_id && task.credits_used > 0) {
                await refundCredits(task.user_id, task.credits_used, task.task_id, '视频生成成功但无URL-离线巡检');
              }
              await supabase
                .from('video_generation_tasks')
                .update({
                  status: 'failed',
                  error_message: '成功但无视频URL',
                  updated_at: new Date().toISOString(),
                  completed_at: new Date().toISOString(),
                })
                .eq('task_id', task.task_id);
              stats.failed++;
            } catch (e) {
              console.error(`[sync-video-status] 无URL处理异常:`, e);
              stats.errors++;
            }
            continue;
          }

          // 处理相对路径 URL
          let finalVideoUrl = videoUrl;
          if (videoUrl.startsWith('/') && apiEndpoint) {
            finalVideoUrl = apiEndpoint.replace(/\/+$/, '') + videoUrl;
          }

          console.log(`[sync-video-status] 任务 ${task.task_id} 视频URL: ${finalVideoUrl.substring(0, 100)}`);

          // 上传到 COS
          let cosUrl = '';
          let cosKey = '';
          try {
            const cosResult = await downloadAndUploadVideoToCOS(finalVideoUrl, 0);
            cosUrl = cosResult.url;
            cosKey = cosResult.key;
            console.log(`[sync-video-status] COS 上传成功: ${cosKey}`);
          } catch (uploadErr) {
            console.error(`[sync-video-status] COS 上传失败，使用代理URL:`, uploadErr);
            cosUrl = wrapAsProxyUrl(finalVideoUrl);
            cosKey = `proxy:${finalVideoUrl}`;
          }

          // 写入 video_history（供用户历史记录页面读取）
          if (task.user_id) {
            try {
              await supabase.from('video_history').insert({
                user_id: task.user_id,
                prompt: task.prompt || '',
                model: task.model,
                video_url: cosUrl,
                video_key: cosKey,
                duration: task.duration || null,
                resolution: task.resolution || null,
                aspect_ratio: task.aspect_ratio || null,
                status: 'completed',
                created_at: new Date().toISOString(),
              });
              console.log(`[sync-video-status] 已写入 video_history`);
            } catch (dbErr) {
              console.error(`[sync-video-status] 写入 video_history 失败:`, dbErr);
            }
          }

          // 标记任务完成
          await supabase
            .from('video_generation_tasks')
            .update({
              status: 'completed',
              video_url: cosUrl,
              updated_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            })
            .eq('task_id', task.task_id);

          stats.completed++;
          console.log(`[sync-video-status] 任务 ${task.task_id} 离线巡检完成!`);
        }
        // ====== 5b. 失败：退费 + 标记 failed ======
        else if (isFailedStatus(status)) {
          const failReason = pollData.error?.message || pollData.error || pollData.message || '视频生成失败(离线巡检)';
          console.error(`[sync-video-status] 任务 ${task.task_id} 失败: ${failReason}`);

          try {
            if (task.user_id && task.credits_used > 0) {
              await refundCredits(task.user_id, task.credits_used, task.task_id, `视频任务失败-离线巡检: ${failReason}`);
            }
            await supabase
              .from('video_generation_tasks')
              .update({
                status: 'failed',
                error_message: String(failReason).substring(0, 500),
                updated_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
              })
              .eq('task_id', task.task_id);
            stats.failed++;
          } catch (e) {
            console.error(`[sync-video-status] 失败处理异常:`, e);
            stats.errors++;
          }
        }
        // ====== 5c. 仍在处理中 ======
        else if (isProcessingStatus(status)) {
          console.log(`[sync-video-status] 任务 ${task.task_id} 仍在处理中，等待下一轮`);
          stats.stillProcessing++;
        } else {
          console.warn(`[sync-video-status] 任务 ${task.task_id} 未知状态: ${status}，跳过`);
          stats.stillProcessing++;
        }
      } catch (pollErr: any) {
        console.error(`[sync-video-status] 任务 ${task.task_id} 轮询异常:`, pollErr?.message || pollErr);
        stats.errors++;
      }
    }

    console.log(`[sync-video-status] 巡检完成:`, stats);
    return NextResponse.json({ success: true, stats });
  } catch (err: any) {
    console.error('[sync-video-status] 巡检异常:', err?.message || err);
    return NextResponse.json({ error: 'Internal error', detail: err?.message }, { status: 500 });
  }
}
