import { NextRequest, NextResponse } from 'next/server';
import { translateErrorMessage } from '@/lib/error-handler';
import { sanitizeError } from '@/lib/sanitize-error';
import { requireAuth } from '@/lib/auth-middleware';

// 设置 serverless 函数最长执行时间为 1900 秒（约31分钟），支持上游排队700秒+余量
export const maxDuration = 1900;
// #710 强制动态渲染，防止 Next.js 缓冲 SSE 流式响应
export const dynamic = 'force-dynamic';

import { uploadToCOS } from '@/lib/cos';
import { downloadAndUploadVideoToCOS } from '@/lib/cos-upload';

// #P1 SSE 客户端断连防护工具：统一创建 abort 监听器，防止向已关闭流写入
// 🛡️ #852 重构：视频任务 SSE 断连时仅停止写入，绝不修改任务状态！
// 原因：视频生成可能需要 50+ 分钟，用户关闭浏览器是正常行为。
// 任务必须保持 processing 状态，由离线巡检 Cron (/api/cron/sync-video-status) 接管轮询。
function createAbortGuard(request: NextRequest, taskId?: string): { isClosed(): boolean; cleanup: () => void } {
  let closed = false;
  const handler = () => {
    closed = true;
    // #852 视频任务 Fire-and-Forget：SSE 断连仅停止 HTTP 写入，任务状态不变
    // 离线巡检 Cron 会从数据库捞取 processing 状态的任务继续轮询
    if (taskId) {
      console.log(`[SSE] #852 客户端断连 taskId=${taskId}，任务保持 processing，离线巡检接管`);
    }
  };
  request.signal.addEventListener('abort', handler, { once: true });
  return { isClosed: () => closed, cleanup: () => { try { request.signal.removeEventListener('abort', handler); } catch {} } };
}

// #P1 安全 enqueue：检查客户端是否断连，断连则跳过写入
function safeEnqueue(controller: any, encoder: TextEncoder, data: string, guard: { isClosed(): boolean }) {
  if (guard.isClosed()) return false;
  try {
    controller.enqueue(encoder.encode(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * #852 离线巡检注册：提交到服务商后，将任务落库到 video_generation_tasks
 * 离线巡检 Cron (/api/cron/sync-video-status) 会捞取 processing 状态的任务，
 * 根据 provider_task_id 向服务商轮询，完成后写入 generation_records + video_history
 *
 * @param taskId 内部任务 ID（clientRequestId）
 * @param providerTaskId 服务商返回的任务 ID
 * @param model 模型名
 * @param userId 用户 ID
 * @param prompt 提示词
 * @param creditsUsed 消耗积分
 * @param extra 额外字段（resolution, aspect_ratio, duration）
 */
async function registerVideoTask(
  taskId: string,
  providerTaskId: string,
  model: string,
  userId: string | null | undefined,
  prompt: string,
  creditsUsed: number,
  extra?: { resolution?: string; aspect_ratio?: string; duration?: number; pollUrl?: string; apiKey?: string }
): Promise<void> {
  try {
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseClient(undefined, true);
    const { error } = await supabase
      .from('video_generation_tasks')
      .upsert({
        task_id: taskId,
        provider_task_id: providerTaskId,
        user_id: userId || 'anonymous',
        model,
        prompt,
        status: 'processing',
        credits_used: creditsUsed,
        resolution: extra?.resolution || '',
        aspect_ratio: extra?.aspect_ratio || '',
        duration: extra?.duration || null,
        poll_url: extra?.pollUrl || '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'task_id' });
    if (error) {
      console.error(`[registerVideoTask] 落库失败 taskId=${taskId} providerTaskId=${providerTaskId}:`, error.message);
    } else {
      console.log(`[registerVideoTask] 落库成功 taskId=${taskId} providerTaskId=${providerTaskId} model=${model}`);
    }
  } catch (err) {
    console.error(`[registerVideoTask] 异常 taskId=${taskId}:`, err);
  }
}

/**
 * #852 标记视频任务完成（供 handler 轮询成功后调用）
 */
async function markVideoTaskCompleted(taskId: string, videoUrl: string): Promise<void> {
  try {
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseClient(undefined, true);
    const { error } = await supabase
      .from('video_generation_tasks')
      .update({
        status: 'completed',
        video_url: videoUrl,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('task_id', taskId);
    if (error) {
      console.error(`[markVideoTaskCompleted] 更新失败 taskId=${taskId}:`, error.message);
    } else {
      console.log(`[markVideoTaskCompleted] 任务标记完成 taskId=${taskId}`);
    }
  } catch (err) {
    console.error(`[markVideoTaskCompleted] 异常 taskId=${taskId}:`, err);
  }
}

/**
 * #852 标记视频任务失败（供 handler 轮询失败后调用）
 */
async function markVideoTaskFailed(taskId: string, errorMessage: string): Promise<void> {
  try {
    const { getSupabaseClient } = await import('@/storage/database/supabase-client');
    const supabase = getSupabaseClient(undefined, true);
    const { error } = await supabase
      .from('video_generation_tasks')
      .update({
        status: 'failed',
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('task_id', taskId);
    if (error) {
      console.error(`[markVideoTaskFailed] 更新失败 taskId=${taskId}:`, error.message);
    } else {
      console.log(`[markVideoTaskFailed] 任务标记失败 taskId=${taskId}: ${errorMessage}`);
    }
  } catch (err) {
    console.error(`[markVideoTaskFailed] 异常 taskId=${taskId}:`, err);
  }
}

/**
 * #555 视频流代理降级：当 COS 上传失败时，将服务商原始 URL 包装为代理 URL
 * 彻底根绝 CORS 跨域与防盗链报错
 * 
 * @param originUrl 服务商原始视频 URL
 * @returns 代理 URL（前端可直接播放）
 */
function wrapAsProxyUrl(originUrl: string): string {
  // 使用后端代理接口，抹平 CORS 限制
  return `/api/video/proxy?url=${encodeURIComponent(originUrl)}`;
}

/**
 * #556 将图片 URL 转为 Base64 Data URI
 * 解决 T8 API 异步处理时无法读取 COS 签名 URL 的问题
 * 
 * @param imageUrl 图片 URL（http 开头的 COS 签名 URL 或其他 URL）
 * @returns Base64 Data URI 字符串（如 data:image/jpeg;base64,...），转换失败时返回原 URL
 */
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return imageUrl; // 非 URL（已经是 base64）直接返回
  }
  try {
    console.log(`[Base64转换] 开始转换图片: ${imageUrl.substring(0, 80)}...`);
    const response = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000), // 15秒超时
    });
    if (!response.ok) {
      console.error(`[Base64转换] 下载图片失败: ${response.status}`);
      return imageUrl; // 兜底返回原 URL
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64String = buffer.toString('base64');
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const dataUri = `data:${contentType};base64,${base64String}`;
    console.log(`[Base64转换] 转换成功, 大小: ${(buffer.length / 1024).toFixed(1)}KB, 类型: ${contentType}`);
    return dataUri;
  } catch (e) {
    console.error('[Base64转换] 转换失败，兜底使用原URL:', e);
    return imageUrl; // 转换失败兜底返回原 URL
  }
}

/**
 * #556 批量将图片 URL 转为 Base64
 * @param urls 图片 URL 数组
 * @returns Base64 Data URI 数组
 */
async function convertImageUrlsToBase64(urls: string[]): Promise<string[]> {
  if (!urls || urls.length === 0) return urls;
  return Promise.all(urls.map(url => imageUrlToBase64(url)));
}
import { getModelAPIConfigFull, shouldSwitchApiKey, getAllAvailableApiKeys, isResolutionGloballyBanned, isResolutionBanned, banResolution, isServiceProviderError, recordServiceProviderError, clearConsecutiveFailures } from '@/lib/api-config';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { checkCreditsSufficient, deductCredits, refundCredits, calculateCredits, calculateVideoCredits } from '@/lib/credits';
import { checkUserBanned, createBannedResponse } from '@/lib/ban-check';
import { getTaskResult, setTaskResult } from '@/lib/taskResultsCache';
import { setTaskProgress, getTaskProgress, deleteTaskProgress } from '@/lib/taskProgressCache';

// #549 积分余额安全获取：返还后从 refundResult.remaining 或 DB 获取最新余额
async function safeGetCreditsBalance(
  refundRemaining: number | null | undefined,
  userId: string,
  fallback: number | null
): Promise<number> {
  if (refundRemaining !== null && refundRemaining !== undefined) {
    return refundRemaining;
  }
  console.log(`[积分返还监控] #549 refundRemaining为null，查DB获取最新余额，userId=${userId}`);
  try {
    const supabase = getSupabaseClient(undefined, true);
    const { data: qData, error: qError } = await supabase
      .from('users')
      .select('credits')
      .eq('id', userId)
      .limit(1);
    if (!qError && qData && qData.length > 0) {
      const actualBalance = qData[0].credits || 0;
      console.log(`[积分返还监控] #549 DB查询最新余额: ${actualBalance}`);
      return actualBalance;
    }
    if (qError) {
      console.error(`[积分返还监控] #549 DB查询余额失败:`, qError);
    }
  } catch (queryErr) {
    console.error(`[积分返还监控] #549 DB查询余额失败:`, queryErr);
  }
  const safeFallback = fallback ?? 0;
  console.log(`[积分返还监控] #549 使用fallback余额: ${safeFallback}`);
  return safeFallback;
}

// 解析错误信息
function getErrorMessage(data: any): string {
  if (data.failure_reason) {
    switch (data.failure_reason) {
      case 'output_moderation':
        return '输出内容违规，积分已返还';
      case 'input_moderation':
        return '输入内容违规';
      case 'error':
        return data.error || '生成失败，请重试';
      default:
        return data.failure_reason;
    }
  }
  
  if (data.error) {
    return data.error;
  }
  
  if (data.fail_reason) {
    return data.fail_reason;
  }
  
  return '生成失败';
}

/**
 * 判断是否为 Lingya Veo3.1 模型（精确匹配前端入口）
 * #638 双模型收口：前端只有 veo_3_1-fast 和 veo_3_1 两个入口
 * 4K 模型 ID (veo_3_1-fast-4K, veo_3_1-4K) 由后端 mapToRealLingyaModel 动态路由，前端不直接提交
 */
function isLingyaVeoModel(model: string): boolean {
  return ['veo_3_1-fast', 'veo_3_1'].includes(model);
}

/**
 * #638 智能路由：将前端简化的 2 个模型 + 分辨率，映射为灵芽 4 个真实 API 模型
 * 铁律1：禁止篡改官方模型 ID，veo_3_1 就是标准版，不用 pro 命名
 * 铁律2：严格对齐官方文档，只支持 720p 和 4K（无 1080p）
 */
function mapToRealLingyaModel(frontendModel: string, resolution: string): string {
  const res = resolution.toLowerCase();

  // 收口 1：快速版 (veo_3_1-fast)
  if (frontendModel === 'veo_3_1-fast') {
    return res === '4k' ? 'veo_3_1-fast-4K' : 'veo_3_1-fast';
  }

  // 收口 2：标准版 (veo_3_1)
  if (frontendModel === 'veo_3_1') {
    return res === '4k' ? 'veo_3_1-4K' : 'veo_3_1';
  }

  return frontendModel; // 兜底：非灵芽模型原样返回
}

/**
 * #638 灵芽 Veo3.1 固定一口价计费（无阶梯，严格对齐官方）
 * veo_3_1-fast: 50 积分 | veo_3_1-fast-4K: 150 积分
 * veo_3_1: 80 积分 | veo_3_1-4K: 200 积分
 */
/**
 * #640 灵芽 Sora-2 VIP 固定一口价计费
 * #641 前端2合1：统一入口 sora-2-all-vip，根据 duration 决定积分
 * 10s 版本固定 60 积分，15s 版本固定 90 积分
 */
function getLingyaSora2Credits(model: string, duration?: number): number {
  // #641 统一入口时根据 duration 判断，旧入口名仍兼容
  if (model === 'sora-2-all-vip-15s' || duration === 15) return 90;
  return 60; // sora-2-all-vip-10s / sora-2-all-vip + 10s 及兜底
}

/**
 * #638 灵芽 Veo3.1 使用固定一口价计费
 */
function getLingyaVeoCredits(realModel: string): number {
  const creditMap: Record<string, number> = {
    'veo_3_1-fast': 50,
    'veo_3_1-fast-4K': 150,
    'veo_3_1': 80,
    'veo_3_1-4K': 200,
  };
  return creditMap[realModel] || 50; // 兜底
}

/**
 * 判断是否为 T8 Veo 模型（以 veo 开头，但排除 Lingya Veo3.1 和 TOPAIS）
 */
function isSeedance2Model(model: string): boolean {
  return model === 'seedance-2' || model === 'seedance-2-fast';
}

/**
 * #689 判断是否为 TOPAIS 供应商 Veo3.1 模型
 * 独立于 Lingya Veo3.1 和 T8 Veo，使用 topais-veo 前缀确保供应商隔离
 * #7xx 修正：TOPAIS 现有两个模型（Veo 和 HappyHorse），需精确判断
 */
function isTopaisVeoModel(model: string): boolean {
  return model.startsWith('topais-veo') || model === 'veo3.1-fast';  // 精确匹配 Veo 模型
}

/**
 * #7xx 判断是否为 TOPAIS 供应商 HappyHorse 模型
 * 独立判断，与 TOPAIS Veo 完全隔离
 */
function isTopaisHhModel(model: string): boolean {
  return model === 'topais-happyhorse-1.1' || model === 'topais-happyhorse-1.0' || model.startsWith('topais-happyhorse');
}

/**
 * 判断是否为 TOPAIS 供应商 Seedance 2.0 模型
 * 独立判断，与 TOPAIS Veo/HappyHorse 完全隔离
 * 支持 seedance-2 和 seedance-2-fast 两个模型
 */
function isTopaisSeedanceModel(model: string): boolean {
  return model === 'topais-seedance-2' || model === 'topais-seedance-2-fast';
}

/**
 * 判断是否为 TOPAIS 供应商 Gemini Omni Flash 模型
 * 独立判断，与 TOPAIS Veo/HappyHorse/Seedance 完全隔离
 */
function isTopaisGeminiOmniModel(model: string): boolean {
  return model === 'topais-gemini-omni-flash';
}

/**
 * 判断是否为 MEGA AI Seedance 2.0 模型
 * 独立判断，与所有其他供应商完全隔离
 * 支持 mega-ai-seedance-v2-720p 模型
 */
function isMegaAiSeedanceModel(model: string): boolean {
  return model === 'mega-ai-seedance-v2-720p';
}

/**
 * 判断是否为 TOPAIS MiniMax H3 模型
 * 独立判断，与所有其他供应商完全隔离
 * 支持 topais-minimax-h3 模型
 */
function isTopaisMinimaxModel(model: string): boolean {
  return model === 'topais-minimax-h3';
}

/**
 * 判断是否为 TOPAIS Kling v3 Omni 模型
 * 独立判断，与所有其他供应商完全隔离
 * 支持 topais-kling-v3-omni 模型
 */
function isTopaisKlingOmniModel(model: string): boolean {
  return model === 'topais-kling-v3-omni';
}

function isT8VeoModel(model: string): boolean {
  // #638 修正：排除 Lingya Veo3.1 模型，防止误拦截
  // #689 修正：排除 TOPAIS Veo 模型，防止误拦截
  // #7xx 修正：排除 TOPAIS HappyHorse 模型，防止误拦截
  // 排除 TOPAIS Seedance 2.0 模型，防止误拦截
  // 排除 TOPAIS Gemini Omni Flash 模型，防止误拦截
  // 排除 MEGA AI Seedance 2.0 模型，防止误拦截
  // 排除 TOPAIS MiniMax H3 模型，防止误拦截
  if (isLingyaVeoModel(model)) return false;
  if (isTopaisVeoModel(model)) return false;
  if (isTopaisHhModel(model)) return false;
  if (isTopaisSeedanceModel(model)) return false;
  if (isTopaisGeminiOmniModel(model)) return false;
  if (isMegaAiSeedanceModel(model)) return false;
  if (isTopaisMinimaxModel(model)) return false;
  if (isTopaisKlingOmniModel(model)) return false;
  return model.startsWith('veo');
}

/**
 * 判断是否为 T8 Sora-2 模型
 * #538 迁移：GRS Sora-2 → T8 Sora-2，走统一异步任务流
 */
function isT8SoraModel(model: string): boolean {
  return model === 'sora-2';
}

/**
 * #689 TOPAIS Veo3.1-fast 固定一口价计费
 * 独立于 Lingya Veo3.1 的积分配置，确保供应商数据独立性
 * topais-veo3.1-fast: 固定积分（根据分辨率区分）
 */
function getTopaisVeoCredits(model: string, resolution?: string): number {
  const res = (resolution || '720p').toLowerCase();
  if (res === '4k') return 150;
  if (res === '1080p') return 80;
  return 50; // 720p 默认
}

/**
 * MEGA AI Seedance 2.0 积分计算
 * 固定720p，15积分/秒
 * 独立计算，与其他供应商完全隔离
 */
function getMegaAiSeedanceCredits(duration: number): number {
  // 15积分/秒 × 时长，固定720p
  const credits = 15 * duration;
  return Math.ceil(credits);
}

/**
 * TOPAIS MiniMax H3 积分计算
 * 2K: 20积分/秒, 768p: 10积分/秒
 * 独立计算，与其他供应商完全隔离
 */
function getTopaisMinimaxCredits(duration: number, resolution?: string): number {
  // 768p 半价，2K 全价
  const rate = (resolution === '768p') ? 10 : 20;
  const credits = rate * duration;
  return Math.ceil(credits);
}

/**
 * TOPAIS Kling v3 Omni 计费
 * mode=std (720P): 基础积分
 * mode=pro (1080P): 2倍积分
 * audio=true: +Sound 附加计费
 * 有 video_list: +Video 附加计费
 */
function getTopaisKlingOmniCredits(duration: number, mode: string, audio?: boolean, hasVideoList?: boolean): number {
  const baseRate = mode === 'pro' ? 20 : 10; // 1080P=20/秒, 720P=10/秒
  let credits = baseRate * duration;
  if (audio) credits += 5 * duration; // +Sound
  if (hasVideoList) credits += 5 * duration; // +Video
  return Math.ceil(credits);
}

/**
 * 判断是否为灵芽 Sora-2 VIP 模型
 * #640 新增：走灵芽 OpenAI 兼容接口（api.lingyaai.cn/v1/videos）
 * #641 前端2合1：统一入口 sora-2-all-vip，后端根据 duration 拼接实际模型名
 */
function isLingyaSoraModel(model: string): boolean {
  return model === 'sora-2-all-vip' || model === 'sora-2-all-vip-10s' || model === 'sora-2-all-vip-15s';
}

/**
 * 判断是否为 Seedance 模型（以 sdols 开头）
 * T8 Seedance 2.0 多模态参考生视频
 */
function isSeedanceModel(model: string): boolean {
  return model.startsWith('sdols');
}

/**
 * 判断是否为 HappyHorse 模型
 * 灵芽 HappyHorse 1.0 视频生成（文生视频/图生视频/参考生视频/视频编辑）
 */
function isHappyHorseModel(model: string): boolean {
  return model.startsWith('happyhorse');
}

/**
 * 判断是否为 components 模型（元素参考组）
 */
function isComponentsModel(model: string): boolean {
  return model.endsWith('-components');
}

/**
 * 统一检查 SSE 响应是否包含错误，并处理密钥故障转移逻辑
 * 提取自 POST 密钥轮询循环中的 4 处重复代码
 * 
 * @returns null = 无错误; { shouldContinue, lastError } = 检测到错误
 */
function checkSseResponseForError(
  responseText: string,
  apiKey: string,
  videoResolution: string,
  keyIndex: number,
  totalKeys: number
): { shouldContinue: boolean; lastError: string | null } | null {
  if (!responseText.includes('"type":"error"') && !responseText.includes('"error"')) {
    return null; // 无错误
  }

  let lastError: string | null = null;
  try {
    const lines = responseText.split('\n');
    for (const line of lines) {
      if (line.includes('error') && line.startsWith('data: ')) {
        const errorData = JSON.parse(line.replace('data: ', ''));
        lastError = errorData.error || errorData.message || '未知错误';
        console.log(`[Video API] 密钥 ${keyIndex + 1} 失败: ${lastError}`);
        if (isServiceProviderError(lastError)) {
          recordServiceProviderError(apiKey, videoResolution, lastError || 'unknown error');
          if (isResolutionBanned(apiKey, videoResolution) && keyIndex < totalKeys - 1) {
            console.log(`[CircuitBreaker] 已触发熔断，尝试下一个密钥`);
            return { shouldContinue: true, lastError };
          }
        } else if (shouldSwitchApiKey(lastError) && keyIndex < totalKeys - 1) {
          console.log(`[Video API] 错误类型支持切换密钥，尝试下一个密钥`);
          return { shouldContinue: true, lastError };
        }
        break;
      }
    }
  } catch {
    lastError = '响应解析失败';
  }
  return { shouldContinue: false, lastError };
}

export async function POST(request: NextRequest) {
  // #890 终极清扫：视频生成必须鉴权，userId 从 JWT Cookie 获取，绝不信任前端 body
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const authUserId = auth.userId;
  
  // #549 提升到外层，供 catch 块访问
  let outerUserId: string | undefined;
  let outerRequiredCredits = 0;
  let outerCreditsBalanceAfterDeduct: number | null = null;
  let outerTaskId: string | undefined;
  
  try {
    const body = await request.json();

    // #681 修复：原始请求体诊断日志 — 第一时间看到前端到底发了什么
    console.log('[后端接收-原始] ========== 前端发来的原始 body 字段 ==========');
    console.log('[后端接收-原始] 所有字段:', Object.keys(body).join(', '));
    console.log('[后端接收-原始] aspectRatio:', body.aspectRatio, '| ratio:', body.ratio, '| aspect_ratio:', body.aspect_ratio);
    console.log('[后端接收-原始] duration:', body.duration, '| timeLength:', body.timeLength);
    console.log('[后端接收-原始] resolution:', body.resolution, '| size:', body.size);
    console.log('[后端接收-原始] model:', body.model);
    console.log('[后端接收-原始] mode:', body.mode);
    console.log('[后端接收-原始] ==========================================');

    // #7xx 修复：删除回退逻辑！参数缺失必须报错，不能偷偷用默认值！
    // 参数缺失直接抛出错误，让问题暴露
    if (body.duration === undefined && body.timeLength === undefined) {
      throw new Error('[参数错误] duration 字段缺失！前端必须传递此参数！');
    }
    if (!body.resolution && !body.size) {
      throw new Error('[参数错误] resolution/size 字段缺失！前端必须传递此参数！');
    }
    if (!body.aspectRatio && !body.ratio && !body.aspect_ratio) {
      throw new Error('[参数错误] aspectRatio 字段缺失！前端必须传递此参数！');
    }

    // #7xx 修复：第一时间打印前端传递的原始参数！
    console.log('[route.ts主入口] ========== 前端传递的原始参数 ==========');
    console.log('[route.ts主入口] body.resolution:', JSON.stringify(body.resolution), '(类型:', typeof body.resolution, ')');
    console.log('[route.ts主入口] body.size:', JSON.stringify(body.size), '(类型:', typeof body.size, ')');
    console.log('[route.ts主入口] body.duration:', JSON.stringify(body.duration), '(类型:', typeof body.duration, ')');
    console.log('[route.ts主入口] body.timeLength:', JSON.stringify(body.timeLength), '(类型:', typeof body.timeLength, ')');
    console.log('[route.ts主入口] body.aspectRatio:', JSON.stringify(body.aspectRatio), '(类型:', typeof body.aspectRatio, ')');
    console.log('[route.ts主入口] ==========================================');

    // 直接使用前端传来的值，不回退！
    const safeAspectRatio = body.aspectRatio || body.ratio || body.aspect_ratio;
    const safeDuration = body.duration ?? body.timeLength;
    const safeResolution = body.resolution || body.size;

    // #7xx 修复：打印安全值（防丢映射后的值）
    console.log('[route.ts主入口] ========== 防丢映射后的安全值 ==========');
    console.log('[route.ts主入口] safeResolution:', JSON.stringify(safeResolution));
    console.log('[route.ts主入口] safeDuration:', JSON.stringify(safeDuration));
    console.log('[route.ts主入口] safeAspectRatio:', JSON.stringify(safeAspectRatio));
    console.log('[route.ts主入口] ==========================================');

    const { 
      model = 'sora-2',
      prompt,
      images = [],
      isUrls = false,
      firstFrameUrl,
      lastFrameUrl,
      // #890 终极清扫：userId 从 JWT Cookie 获取（authUserId），不从 body 取
      enhancePrompt = false,
      enableUpsample = false,
      client_request_id,  // #543 前端预生成的 taskId
      taskId: frontendTaskId,  // #544 前端 GenService 预生成的 taskId（轮询用此 ID 查询）
      // HappyHorse 专用参数
      referenceImageUrls,
      videoUrl,
      audioSetting,
      hhMode,  // 前端指定的 HappyHorse 模式: t2v/i2v/r2v/video-edit
    } = body;
    // #890 终极清扫：userId 必须从 JWT Cookie 获取，杜绝伪造
    const userId = authUserId;

    // #681 修复：使用防丢映射后的安全值，而非解构默认值
    // 解构默认值只在字段为 undefined 时生效，但防丢映射覆盖了更多别名
    const aspectRatio = safeAspectRatio;
    const duration = safeDuration;
    const resolution = safeResolution;
    const size = body.size || safeResolution;

    // #549 赋值到外层变量，供 catch 块访问
    outerUserId = userId;

    // #7xx 修复：删除回退逻辑！参数缺失必须报错！
    // resolution 和 size 应该是一样的值（前端同时传），直接用 resolution
    if (!resolution) {
      throw new Error('[参数错误] resolution 缺失！前端必须传递！');
    }
    const finalResolution = resolution;

    // ========== 后端参数接收日志 ==========
    console.log('[后端接收] ========== 视频生成请求参数 ==========');
    console.log('[后端接收] model:', model);
    console.log('[后端接收] duration:', duration, '(类型:', typeof duration, ')');
    console.log('[后端接收] resolution:', resolution);
    console.log('[后端接收] size:', size);
    console.log('[后端接收] finalResolution:', finalResolution);
    console.log('[后端接收] aspectRatio:', aspectRatio);
    console.log('[后端接收] prompt:', prompt?.substring(0, 50) + '...');
    console.log('[后端接收] images:', images?.length || 0);
    console.log('[后端接收] userId:', userId);
    console.log('[后端接收] ==========================================');

    console.log(`[视频生成] model=${model}, ratio=${aspectRatio}, dur=${duration}, res=${finalResolution}, imgs=${images?.length || 0}`);

    // ⚠️ 参数过滤：根据模型家族严格过滤，防止参数串门
    // Lingya Veo3.1: 固定8秒，不发 duration/size/resolution，比例转 16x9 格式（仅 16:9/9:16）
    // Veo: 不发送 duration/size/resolution
    // Sora-2: 不发送 duration/size/resolution（T8 网关自行决定）
    // #640 灵芽 Sora-2 VIP: 固定时长由模型名决定（10s/15s），不发 resolution/size
    // Seedance: 发送完整参数（duration/resolution/aspectRatio）
    const isLingyaVeo = isLingyaVeoModel(model);
    const isLingyaSora = isLingyaSoraModel(model);
    const isVeo = isT8VeoModel(model);
    const isSora = isT8SoraModel(model);
    const isSeed = isSeedanceModel(model);
    const isHH = isHappyHorseModel(model);
    const isTopais = isTopaisVeoModel(model);  // #689 TOPAIS 供应商独立标识
    
    let filteredDuration = duration;
    let filteredResolution = finalResolution;
    let filteredSize = size;
    
    if (isLingyaVeo) {
      // #638 Lingya Veo3.1：固定8秒，不需要 duration/resolution/size
      filteredDuration = 8;
      filteredResolution = undefined as any;
      filteredSize = undefined as any;
    } else if (isLingyaSora) {
      // #640 灵芽 Sora-2 VIP：时长由模型名或前端选择决定
      // #641 前端2合1：sora-2-all-vip 入口用前端传来的 duration，旧入口名仍兼容
      if (model === 'sora-2-all-vip') {
        filteredDuration = duration || 10; // 前端选择的时长，默认10
      } else {
        filteredDuration = model.endsWith('-15s') ? 15 : 10;
      }
      filteredResolution = undefined as any;
      filteredSize = undefined as any;
    } else if (isVeo) {
      // Veo 不需要 duration 和 resolution/size 参数
      filteredDuration = undefined as any;
      filteredResolution = undefined as any;
      filteredSize = undefined as any;
    } else if (isSora) {
      // #548 Sora-2 允许 duration 参数，但不发送 resolution/size
      filteredResolution = undefined as any;
      filteredSize = undefined as any;
    } else if (isHH) {
      // HappyHorse: 透传 duration 和 resolution，不发送 size
      filteredSize = undefined as any;
    } else if (isTopais) {
      // #689 TOPAIS Veo3.1-fast：固定8秒，发 duration/aspect_ratio/resolution(metadata)，不发 size
      filteredDuration = 8;
      filteredSize = undefined as any;
    }
    // Seedance: 保持原始参数，不做过滤

    // ⚠️ 前置风控：使用统一禁用检查函数
    if (userId) {
      const banResult = await checkUserBanned(userId);
      if (banResult.isBanned) {
        console.log('[视频生成] 用户已禁用:', userId, '类型:', banResult.banType);
        return createBannedResponse(banResult);
      }
    }

    if (!prompt) {
      return new Response(JSON.stringify({ error: '缺少必要参数：prompt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ====== #544 初始化任务缓存 ======
    // 优先使用 frontendTaskId（前端 GenService 预生成，轮询用此 ID 查询）
    // 其次使用 client_request_id（请求锁 ID）
    // 最后使用自动生成的 ID
    const taskId = frontendTaskId || client_request_id || `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    outerTaskId = taskId; // #560 供外层 catch 的 refundCredits 使用
    setTaskResult(taskId, {
      status: 'generating',
      imageUrls: [],  // 视频模式复用 imageUrls 字段存储视频URL
      errors: [],
      createdAt: Date.now(),
    });
    console.log('[视频生成] 任务缓存已初始化, taskId:', taskId, '(来源:', frontendTaskId ? 'frontendTaskId' : client_request_id ? 'client_request_id' : 'auto', ')');

    // ====== Lingya Veo3.1 参数校验 ======
    if (isLingyaVeoModel(model)) {
      // 图片数量校验：最多2张（首尾帧）
      if (images && images.length > 2) {
        return new Response(JSON.stringify({ error: 'Veo3.1 最多支持2张图片(首尾帧)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // 比例校验：官方仅支持 16:9 和 9:16，禁止 1:1
      if (aspectRatio && !['16:9', '9:16'].includes(aspectRatio)) {
        return new Response(JSON.stringify({ error: 'Veo3.1 仅支持 16:9 和 9:16 比例' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ====== T8 Veo 模型图片数量校验 ======
    if (isT8VeoModel(model) && images && images.length > 0) {
      if (isComponentsModel(model)) {
        // components 模型最多3张
        if (images.length > 3) {
          return new Response(JSON.stringify({ error: '组件参考模型最多支持3张图片' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } else {
        // fast/标准/pro 模型最多2张（首尾帧）
        if (images.length > 2) {
          return new Response(JSON.stringify({ error: '该模型最多支持2张图片(首尾帧)' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ====== #689 TOPAIS Veo3.1-fast 参数校验 ======
    if (isTopaisVeoModel(model)) {
      // 图片数量校验：最多3张（1首帧 / 2首尾帧 / 3参考图）
      if (images && images.length > 3) {
        return new Response(JSON.stringify({ error: 'Veo3.1-fast 最多支持3张图片' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // 比例校验：官方仅支持 16:9 和 9:16
      if (aspectRatio && !['16:9', '9:16'].includes(aspectRatio)) {
        return new Response(JSON.stringify({ error: 'Veo3.1-fast 仅支持 16:9 和 9:16 比例' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ====== Seedance 2.0 参数校验 ======
    if (isSeedance2Model(model)) {
      // 铁律1：封杀 duration < 4（防止刷钱漏洞）
      if (!filteredDuration || filteredDuration < 4) {
        return new Response(JSON.stringify({ error: '时长必须 ≥ 4 秒' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (filteredDuration > 15) {
        return new Response(JSON.stringify({ error: '时长不能超过 15 秒' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // fast 模型不支持 1080p（#680 大小写不敏感比较）
      // #7xx 修复：删除回退！参数缺失必须报错！
      const checkRes = filteredResolution || finalResolution;
      if (!checkRes) {
        console.error('[Seedance2-参数错误] resolution 缺失！filteredResolution:', filteredResolution, 'finalResolution:', finalResolution);
        return new Response(JSON.stringify({ error: '分辨率参数缺失' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (model === 'seedance-2-fast' && checkRes.toLowerCase() === '1080p') {
        return new Response(JSON.stringify({ error: 'Seedance 2.0 Fast 不支持 1080p' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // ====== 积分检查与扣除 ======
    if (!userId) {
      return new Response(JSON.stringify({ error: '请先登录' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // #638 灵芽 Veo3.1 使用固定一口价计费（映射到真实模型后查表）
    // #640 灵芽 Sora-2 VIP 使用固定一口价计费（10s=60, 15s=90）
    // #641 前端2合1：sora-2-all-vip 入口需要根据 duration 判断积分
    const realLingyaModel = isLingyaVeoModel(model) ? mapToRealLingyaModel(model, finalResolution) : model;
    // #7xx 修复：删除积分计算的回退逻辑！参数缺失必须报错！
    // 先检查参数是否存在
    const checkResolution = filteredResolution || finalResolution;
    const checkDuration = filteredDuration || duration;
    if (!checkResolution && !isLingyaVeo && !isLingyaSora && !isVeo && !isSora && !isTopais) {
      console.error('[积分计算-参数错误] resolution 缺失！model:', model, 'filteredResolution:', filteredResolution, 'finalResolution:', finalResolution);
      throw new Error('[积分计算-参数错误] resolution 缺失！');
    }
    if (!checkDuration && !isLingyaVeo && !isTopais) {
      console.error('[积分计算-参数错误] duration 缺失！model:', model, 'filteredDuration:', filteredDuration, 'duration:', duration);
      throw new Error('[积分计算-参数错误] duration 缺失！');
    }
    
    const requiredCredits = isLingyaVeoModel(model)
      ? getLingyaVeoCredits(realLingyaModel)
      : isLingyaSoraModel(model)
        ? getLingyaSora2Credits(model, filteredDuration || 10)  // Sora-2 VIP 允许回退到默认10秒
        : isTopaisVeoModel(model)
          ? getTopaisVeoCredits(model, filteredResolution || '720p')  // TOPAIS Veo 允许回退
          : isMegaAiSeedanceModel(model)
            ? getMegaAiSeedanceCredits(filteredDuration || checkDuration || 5)  // MEGA AI Seedance 固定720p，按秒计费
            : isTopaisMinimaxModel(model)
              ? getTopaisMinimaxCredits(filteredDuration || checkDuration || 5, filteredResolution || '2K')  // TOPAIS MiniMax H3 按分辨率+时长计费
              : isTopaisKlingOmniModel(model)
                ? getTopaisKlingOmniCredits(
                    filteredDuration || checkDuration || 5,
                    (filteredResolution === '1080p') ? 'pro' : 'std',
                    body.generateAudio,
                    !!(body.referenceVideoUrls && body.referenceVideoUrls.length > 0),
                  )  // TOPAIS Kling v3 Omni 按mode+audio+video_list计费
                : isSeedance2Model(model)
              ? getSeedance2Credits(model, checkResolution, checkDuration, (body.referenceVideoUrls && body.referenceVideoUrls.length > 0))
              : await calculateVideoCredits(model, checkResolution, checkDuration);
    outerRequiredCredits = requiredCredits;  // #549 赋值到外层变量
    console.log('[视频生成] 积分计算:', { model, realModel: realLingyaModel, resolution: checkResolution, duration: checkDuration, requiredCredits });

    const checkResult = await checkCreditsSufficient(userId, requiredCredits);
    if (!checkResult.sufficient) {
      return new Response(JSON.stringify({ 
        error: `积分不足，当前积分: ${checkResult.currentCredits || 0}，需要: ${requiredCredits}`,
        insufficient: true,
        currentCredits: checkResult.currentCredits,
        requiredCredits,
      }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 预扣除积分（#851 修复：传 taskId 作为 referenceId，便于 cron 交叉比对）
    const deductResult = await deductCredits(userId, requiredCredits, taskId, `视频生成扣除 ${requiredCredits} 积分`);
    if (!deductResult.success) {
      return new Response(JSON.stringify({ 
        error: '积分扣除失败，请重试',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // #549 保存扣除后余额，供后续事件使用
    const creditsBalanceAfterDeduct: number | null = deductResult.remaining ?? null;
    outerCreditsBalanceAfterDeduct = creditsBalanceAfterDeduct;  // #549 赋值到外层变量
    console.log('[视频生成] 积分已扣除:', requiredCredits, '| 余额:', creditsBalanceAfterDeduct);

    // 从数据库获取 API 配置
    const fullConfig = await getModelAPIConfigFull(model);
    
    if (!fullConfig) {
      console.error(`[Video API] 模型 ${model} 未配置，请在数据库 api_configs + api_models 表中添加配置`);
      return new Response(JSON.stringify({ error: `模型 ${model} 未配置` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const baseEndpoint = fullConfig.apiEndpoint;
    
    // #685 防御检查：baseEndpoint 为空时直接返回明确错误，避免 fetch() 抛出 Invalid URL
    if (!baseEndpoint || !baseEndpoint.startsWith('http')) {
      console.error(`[Video API] 模型 ${model} API端点无效: "${baseEndpoint}"，config_id=${fullConfig.configId}，请在数据库 api_configs 表检查该配置的 api_endpoint 字段`);
      let invalidUrlBalance = creditsBalanceAfterDeduct;
      if (userId && requiredCredits > 0) {
        const refundResult = await refundCredits(userId, requiredCredits, taskId, `模型 ${model} API端点未配置`);
        invalidUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
      }
      return new Response(JSON.stringify({ 
        error: `模型 ${model} API端点未配置，请联系管理员检查数据库配置（config_id: ${fullConfig.configId}）`,
        creditsBalance: invalidUrlBalance ?? undefined,
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    
    // 获取所有可用密钥（按顺序）
    const apiKeys = fullConfig.apiKeys || [fullConfig.apiKey];
    
    // 获取当前请求的分辨率/比例，用于熔断检查
    const videoResolution = aspectRatio || filteredResolution || 'default';
    
    // ====== 细粒度熔断前置检查 ======
    if (isResolutionGloballyBanned(fullConfig.apiKey, videoResolution)) {
      console.log(`[CircuitBreaker] 视频模型 ${model} 分辨率 ${videoResolution} 通道冷却中`);
      return new Response(JSON.stringify({ 
        success: false,
        errorCode: 'RESOLUTION_BANNED',
        message: '该分辨率通道暂时繁忙，请稍后重试或选择其他分辨率。',
        retryAfterMs: 30000,
        resolution: videoResolution,
        taskId,
        creditsBalance: creditsBalanceAfterDeduct ?? undefined,
      }), {
        status: 429,
        headers: { 
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
      });
    }
    
    console.log(`[Video API] 可用密钥数量: ${apiKeys.length}，分辨率: ${videoResolution}，将按顺序尝试`);

    // 上传图片到对象存储（如果不是URL）
    let uploadedUrls: string[] = [];
    let uploadedRefKeys: string[] = [];  // #757 参考图 COS key 数组，用于保存到数据库
    if (images && images.length > 0) {
      if (isUrls) {
        // #810→#872 修复：前端发送的 URL 可能是代理 URL 或 CDN 域名 URL
        // 服务商无法访问代理 URL 或无签名 CDN URL，必须转换为真实的 COS 签名 URL
        const { getSignedUrl } = await import('@/lib/cos');
        // #872 获取 CDN 域名配置，用于检测 CDN 静态 URL
        const cdnDomainPerm = process.env.COS_CDN_DOMAIN_PERM || '';
        const cdnDomainTemp = process.env.COS_CDN_DOMAIN || '';
        const convertedUrls = await Promise.all(
          images.filter((url: string) => url && url.length > 0).map(async (url: string) => {
            // 检测1：代理 URL：/api/canvas/image?key=xxx[&assetType=xxx]
            const proxyMatch = url.match(/^\/api\/canvas\/image\?(?:.*&)?key=([^&]+)/);
            if (proxyMatch) {
              const objectKey = decodeURIComponent(proxyMatch[1]);
              const assetTypeMatch = url.match(/[?&]assetType=(perm|temp)/);
              const inferredAssetType = (objectKey.startsWith('dev/') || objectKey.startsWith('prod/') || objectKey.startsWith('perm/')) ? 'perm' : 'temp';
              const assetType = assetTypeMatch ? assetTypeMatch[1] as 'perm' | 'temp' : inferredAssetType;
              try {
                // #872 forceSigned=true：AI 服务商必须用签名 URL，跳过 CDN 静态化
                const signedUrl = await getSignedUrl(objectKey, 3600, assetType, true);
                console.log(`[Video API] 代理URL→COS签名URL: ${objectKey}`);
                return { url: signedUrl, key: objectKey };
              } catch (err) {
                console.error(`[Video API] ❌ 签名URL生成失败: ${objectKey}`, err);
                return { url, key: null };
              }
            }
            // #872 检测2：CDN 域名 URL（如 https://assets.kiikii.me/prod/canvas/xxx.png）
            try {
              const urlObj = new URL(url);
              if (urlObj.hostname === cdnDomainPerm || urlObj.hostname === cdnDomainTemp) {
                const objectKey = urlObj.pathname.startsWith('/') ? urlObj.pathname.substring(1) : urlObj.pathname;
                if (objectKey) {
                  const inferredAssetType = (objectKey.startsWith('dev/') || objectKey.startsWith('prod/') || objectKey.startsWith('perm/')) ? 'perm' : 'temp';
                  const signedUrl = await getSignedUrl(objectKey, 3600, inferredAssetType, true);
                  console.log(`[Video API] CDN URL→COS签名URL: ${objectKey} (host=${urlObj.hostname})`);
                  return { url: signedUrl, key: objectKey };
                }
              }
            } catch {
              // URL 解析失败（非标准 URL），忽略继续
            }
            return { url, key: null };
          })
        );
        uploadedUrls = convertedUrls.map(r => r.url);
        uploadedRefKeys = convertedUrls.map(r => r.key).filter(Boolean) as string[];
        // #757 从签名 URL 中提取 COS key（补充：非代理的 COS URL）
        const cosKeysFromSignedUrls = uploadedUrls
          .filter((url: string) => url?.includes('cos.ap-hongkong.myqcloud.com') || url?.includes('img.kiikii.me'))
          .map((url: string) => {
            try {
              const pathname = new URL(url).pathname;
              return pathname?.startsWith('/') ? pathname.substring(1) : null;
            } catch { return null; }
          })
          .filter(Boolean) as string[];
        if (cosKeysFromSignedUrls.length > 0 && uploadedRefKeys.length === 0) {
          uploadedRefKeys = cosKeysFromSignedUrls;
        }
        console.log(`使用前端上传的 ${uploadedUrls.length} 张参考图 URL (已转换代理URL)`);
      } else {
        console.log(`开始上传 ${images.length} 张参考图到腾讯云 COS...`);
        try {
          const uploadPromises = images.map(async (image: string, i: number) => {
            let base64Data = image.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const key = `video-ref/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.png`;
            // #557 修复：使用 uploadToCOS 返回的签名 URL，避免重复调用 getSignedUrl 导致路径错误
            const uploadResult = await uploadToCOS(key, buffer, 'image/png', 'temp');  // #804 AI视频参考图→1号桶(临时)
            console.log(`图片 ${i + 1} 上传成功`);
            return { url: uploadResult.url, key: uploadResult.key };  // #757 同时返回 URL 和 key
          });
          const uploadResults = await Promise.all(uploadPromises);
          uploadedUrls = uploadResults.map(r => r.url);
          uploadedRefKeys = uploadResults.map(r => r.key);  // #757 提取 COS key
          console.log(`所有参考图上传完成，共 ${uploadedUrls.length} 张`);
        } catch (uploadError) {
          console.error('上传参考图失败:', uploadError);
          return new Response(JSON.stringify({ 
            error: '上传参考图失败',
            details: uploadError instanceof Error ? uploadError.message : '未知错误'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // ====== 密钥故障转移循环（含细粒度熔断）======
    let lastError: string | null = null;
    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      const apiKey = apiKeys[keyIndex];
      
      // 细粒度熔断：跳过该密钥+该分辨率已被熔断的组合
      if (isResolutionBanned(apiKey, videoResolution)) {
        console.log(`[CircuitBreaker] 跳过已熔断: ${apiKey.substring(0, 10)}..._${videoResolution}`);
        lastError = `密钥${keyIndex + 1}: 该分辨率已被熔断`;
        continue;
      }
      
      console.log(`[Video API] 尝试密钥 ${keyIndex + 1}/${apiKeys.length}: ${apiKey.substring(0, 15)}...`);
      
      try {
        // ====== 分流：Lingya Veo3.1 / Lingya Sora-2 VIP / T8 Veo / T8 Sora-2 / Seedance / HappyHorse 异步流程 ======
        let result: Response;
        if (isLingyaVeoModel(model)) {
          // #638 Lingya Veo3.1：OpenAI 兼容格式，FormData 上传，固定8秒
          // 双模型收口：用 mapToRealLingyaModel 将前端模型 + 分辨率映射为真实 API 模型
          result = await handleLingyaVeoGeneration({
            model: realLingyaModel, prompt, uploadedUrls, uploadedRefKeys, aspectRatio,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        } else if (isLingyaSoraModel(model)) {
          // #640 灵芽 Sora-2 VIP：OpenAI 兼容格式，JSON 提交，固定10s/15s
          result = await handleLingyaSora2Generation({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        } else if (isT8VeoModel(model)) {
          result = await handleT8VeoGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, enhancePrompt, enableUpsample,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        } else if (isT8SoraModel(model)) {
          result = await handleT8Sora2Generation({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        } else if (isSeedanceModel(model)) {
          // T8 Seedance (sdols-2.0)：全模态解锁，独立 v3 API，content 数组格式
          result = await handleT8SeedanceGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration, resolution: filteredResolution,
            firstFrameUrl: body.firstFrameUrl, lastFrameUrl: body.lastFrameUrl,
            referenceImageUrls: body.referenceImageUrls,
            referenceVideoUrls: body.referenceVideoUrls,
            referenceAudioUrls: body.referenceAudioUrls,
            generateAudio: body.generateAudio,
            hhMode: body.hhMode,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        } else if (isSeedance2Model(model)) {
          // Seedance 2.0：灵芽API，content数组格式，多模态（图/视/音）
          result = await handleSeedance2Generation({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration, resolution: filteredResolution,
            firstFrameUrl: body.firstFrameUrl, lastFrameUrl: body.lastFrameUrl,
            referenceImageUrls: body.referenceImageUrls,
            referenceVideoUrls: body.referenceVideoUrls,
            referenceAudioUrls: body.referenceAudioUrls,
            sd2Mode: body.sd2Mode,
            ratio: body.ratio,
            generateAudio: body.generateAudio,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        } else if (isHappyHorseModel(model)) {
          result = await handleHappyHorseGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration, resolution: filteredResolution,
            firstFrameUrl: body.firstFrameUrl, referenceImageUrls: body.referenceImageUrls,
            videoUrl: body.videoUrl, audioSetting: body.audioSetting,
            hhMode: body.hhMode,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        } else if (isTopaisVeoModel(model)) {
          // #689 TOPAIS Veo3.1-fast：独立供应商，POST /v1/videos/generations 异步任务
          // #7xx 修复：删除回退逻辑！参数缺失必须报错！
          if (!filteredDuration) {
            throw new Error('[TOPAIS-Veo-参数错误] filteredDuration 缺失！');
          }
          if (!filteredResolution) {
            throw new Error('[TOPAIS-Veo-参数错误] filteredResolution 缺失！');
          }
          result = await handleTopaisVeoGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            resolution: filteredResolution,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
            hhMode: body.hhMode,  // #689 前端模式标识，用于判断 generation_type
          }, request);
        } else if (isTopaisHhModel(model)) {
          // #7xx TOPAIS HappyHorse：独立供应商，POST /v1/videos/generations 异步任务
          // #7xx 修复：删除回退逻辑！参数缺失必须报错！
          if (!filteredDuration) {
            throw new Error('[TOPAIS-HH-参数错误] filteredDuration 缺失！前端没传 duration！');
          }
          if (!filteredResolution) {
            throw new Error('[TOPAIS-HH-参数错误] filteredResolution 缺失！前端没传 resolution！');
          }
          result = await handleTopaisHhGeneration({
            request,
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            resolution: filteredResolution,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
            hhMode: body.hhMode,  // #7xx 前端模式标识，用于判断 action 参数
            videoUrl: body.videoUrl,  // #7xx 视频编辑模式需要输入视频
          });
        } else if (isTopaisSeedanceModel(model)) {
          // TOPAIS Seedance 2.0：独立供应商，POST /v1/videos/generations 异步任务
          // 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
          if (!filteredDuration) {
            throw new Error('[TOPAIS-SD2-参数错误] filteredDuration 缺失！前端没传 duration！');
          }
          if (!filteredResolution) {
            throw new Error('[TOPAIS-SD2-参数错误] filteredResolution 缺失！前端没传 resolution！');
          }
          result = await handleTopaisSeedanceGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            resolution: filteredResolution,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
            hhMode: body.hhMode,
            sd2Mode: body.sd2Mode,
            firstFrameUrl: body.firstFrameUrl,
            lastFrameUrl: body.lastFrameUrl,
            referenceImageUrls: body.referenceImageUrls,
            referenceVideoUrls: body.referenceVideoUrls,
            referenceAudioUrls: body.referenceAudioUrls,
            generateAudio: body.generateAudio,
          }, request);
        } else if (isTopaisGeminiOmniModel(model)) {
          // TOPAIS Gemini Omni Flash：独立供应商，POST /v1/videos/generations 异步任务
          // 支持 t2v/i2v/r2v 三种模式（无 video-edit）
          // 模式由 image_urls 数量决定：0张=t2v，1张=i2v，3张=r2v（不支持2张）
          if (!filteredDuration) {
            throw new Error('[TOPAIS-GO-参数错误] filteredDuration 缺失！前端没传 duration！');
          }
          if (!filteredResolution) {
            throw new Error('[TOPAIS-GO-参数错误] filteredResolution 缺失！前端没传 resolution！');
          }
          result = await handleTopaisGeminiOmniGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            resolution: filteredResolution,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
            hhMode: body.hhMode,  // 前端模式标识，用于判断 image_urls 数量
          }, request);
        } else if (isMegaAiSeedanceModel(model)) {
          // MEGA AI Seedance 2.0：独立供应商，POST /v1/media/generate 异步任务
          // 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
          // 固定720p，不支持分辨率选择
          if (!filteredDuration) {
            throw new Error('[MEGA-AI-SD-参数错误] filteredDuration 缺失！前端没传 duration！');
          }
          result = await handleMegaAiSeedanceGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            resolution: '720p',  // 固定720p
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
            hhMode: body.hhMode,
            sd2Mode: body.sd2Mode,
            firstFrameUrl: body.firstFrameUrl,
            lastFrameUrl: body.lastFrameUrl,
            referenceImageUrls: body.referenceImageUrls,
            referenceVideoUrls: body.referenceVideoUrls,
            referenceAudioUrls: body.referenceAudioUrls,
            generateAudio: body.generateAudio,
          }, request);
        } else if (isTopaisMinimaxModel(model)) {
          // TOPAIS MiniMax H3：独立供应商，POST /v1/videos/generations 异步任务
          // 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
          // 固定2K分辨率，不支持分辨率选择
          if (!filteredDuration) {
            throw new Error('[TOPAIS-MINIMAX-参数错误] filteredDuration 缺失！前端没传 duration！');
          }
          result = await handleTopaisMinimaxGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            resolution: '2K',  // 固定2K
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
            hhMode: body.hhMode,
            sd2Mode: body.sd2Mode,
            firstFrameUrl: body.firstFrameUrl,
            lastFrameUrl: body.lastFrameUrl,
            referenceImageUrls: body.referenceImageUrls,
            referenceVideoUrls: body.referenceVideoUrls,
            referenceAudioUrls: body.referenceAudioUrls,
            generateAudio: body.generateAudio,
          }, request);
        } else if (isTopaisKlingOmniModel(model)) {
          // TOPAIS Kling v3 Omni：独立供应商，POST /v1/videos/generations 异步任务
          // 支持 t2v/i2v/r2v 三种模式，mode=std(720P)/pro(1080P)
          // audio=true 有声视频，video_list 参考视频
          if (!filteredDuration) {
            throw new Error('[TOPAIS-KLINGOMNI-参数错误] filteredDuration 缺失！前端没传 duration！');
          }
          const klingMode = (filteredResolution === '1080p') ? 'pro' : 'std';
          const klingHasVideoList = !!(body.referenceVideoUrls && body.referenceVideoUrls.length > 0);
          const klingCredits = getTopaisKlingOmniCredits(filteredDuration, klingMode, body.generateAudio, klingHasVideoList);
          // 重新计算积分（Kling Omni 有独立的计费规则）
          if (klingCredits !== requiredCredits) {
            console.log('[TOPAIS-KlingOmni] 积分重新计算:', requiredCredits, '→', klingCredits);
          }
          result = await handleTopaisKlingOmniGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, duration: filteredDuration,
            resolution: filteredResolution || '720p',
            baseEndpoint, apiKey, userId,
            requiredCredits: klingCredits,
            creditsBalanceAfterDeduct,
            clientRequestId: taskId,
            hhMode: body.hhMode,
            generateAudio: body.generateAudio,
            referenceVideoUrls: body.referenceVideoUrls,
          }, request);
        } else {
          console.warn('[视频生成] 未知模型类型，尝试 Veo 流程:', model);
          result = await handleT8VeoGeneration({
            model, prompt, uploadedUrls, uploadedRefKeys, aspectRatio, enhancePrompt, enableUpsample,
            baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct,
            clientRequestId: taskId,
          }, request);
        }

        // ====== #721 重构：消费流+返回 JSON+后台处理 ======
        // 旧逻辑：checkSseResponseForError 读取整个流（阻塞 30-120 秒）
        // 新逻辑：立即返回 JSON，流在后台继续运行（写入缓存）
        
        // 启动后台流消费者（fire-and-forget）
        // 流的 start() 函数会继续运行，通过 sendEvent 写入 taskProgressCache
        if (result.body) {
          (async () => {
            try {
              const reader = result.body!.getReader();
              while (true) {
                const { done } = await reader.read();
                if (done) break;
              }
            } catch (e) {
              // 流消费错误，忽略（后台任务继续运行）
            }
          })();
        }
        
        // 立即返回 JSON（不等待流完成）
        console.log(`[Video API] 密钥 ${keyIndex + 1} 任务已提交，返回 JSON, taskId: ${taskId}`);
        clearConsecutiveFailures(apiKey, videoResolution);
        
        return NextResponse.json({
          success: true,
          taskId: taskId,
          status: 'submitted',
          creditsBalance: creditsBalanceAfterDeduct,
          message: '任务已提交，请通过 GET /api/video/status?taskId=xxx 轮询进度',
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : '未知错误';
        console.log(`[Video API] 密钥 ${keyIndex + 1} 异常: ${lastError}`);
        // 服务商级别错误 → 记录连续失败
        if (isServiceProviderError(lastError)) {
          recordServiceProviderError(apiKey, videoResolution, lastError);
          if (isResolutionBanned(apiKey, videoResolution) && keyIndex < apiKeys.length - 1) {
            console.log(`[CircuitBreaker] 已触发熔断，尝试下一个密钥`);
            continue;
          }
        } else if (shouldSwitchApiKey(lastError) && keyIndex < apiKeys.length - 1) {
          console.log(`[Video API] 错误类型支持切换密钥，尝试下一个密钥`);
          continue;
        }
        throw err;
      }
    }
    
    // 所有密钥都失败（可能全部在通道冷却中）
    if (isResolutionGloballyBanned(fullConfig.apiKey, videoResolution)) {
      return new Response(JSON.stringify({ 
        success: false,
        errorCode: 'RESOLUTION_BANNED',
        message: '该分辨率通道暂时繁忙，请稍后重试或选择其他分辨率。',
        retryAfterMs: 30000,
        resolution: videoResolution,
        taskId,
        creditsBalance: creditsBalanceAfterDeduct ?? undefined,
      }), {
        status: 429,
        headers: { 
          'Content-Type': 'application/json',
          'Retry-After': '30',
        },
      });
    }
    
    console.error(`[Video API] 所有密钥都失败，最后错误: ${lastError}`);
    return new Response(JSON.stringify({ 
      error: lastError || '所有密钥都失败',
      taskId,
      creditsBalance: creditsBalanceAfterDeduct ?? undefined,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('视频生成 API 错误:', error);
    // #549 外层异常兜底返还积分
    if (outerUserId && outerRequiredCredits > 0) {
      try {
        const refundResult = await refundCredits(outerUserId, outerRequiredCredits, outerTaskId || `catch-${Date.now()}`, '视频生成外层异常');
        const errorCreditsBalance = await safeGetCreditsBalance(refundResult.remaining, outerUserId, outerCreditsBalanceAfterDeduct);
        console.log(`[积分返还监控] #549 外层异常返还: requiredCredits=${outerRequiredCredits}, newBalance=${errorCreditsBalance}`);
      } catch (refundErr) {
        console.error('[积分返还监控] #549 外层异常返还失败:', refundErr);
      }
    }
    return new Response(JSON.stringify({ 
      error: '服务器内部错误'  // 🔒 P0 脱敏：不泄露 error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ====================================================================
// #7xx TOPAIS HappyHorse 异步流程（1.0→1.1 升级）
// 官方文档：POST /v1/videos/generations 提交 → GET /v1/videos/generations/{id} 轮询
// 支持：文生视频(t2v)、首帧生视频(i2v)、参考生视频(r2v)、视频编辑(video-edit)
// 重要：使用 action 参数区分模式（不是 generation_type）
// 时长：3-15秒；分辨率：720P/1080P；比例：16:9/9:16/1:1/4:3/3:4
// 参考图：r2v 最多9张；video-edit 需输入视频 URL
// 独立于 TOPAIS Veo 和 LingYa HappyHorse，确保供应商数据配置独立性
// ====================================================================
interface TopaisHhParams {
  request: NextRequest;  // #P1 SSE abort 防护需要 request.signal
  model: string;            // topais-happyhorse-1.1（前端入口，发送给 API 时用 happyhorse-1.1）
  prompt: string;
  uploadedUrls: string[];   // 参考图 URL 数组
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;      // "16:9" | "9:16" | "1:1" | "4:3" | "3:4"
  duration: number;         // 3-15秒
  resolution: string;       // "720P" | "1080P"
  baseEndpoint: string;     // https://toapis.com
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  hhMode?: string;          // #7xx 前端指定的模式: t2v/i2v/r2v/video-edit
  videoUrl?: string;        // #7xx 视频编辑模式的输入视频 URL
}

async function handleTopaisHhGeneration(params: TopaisHhParams): Promise<Response> {
  const {
    request: req,
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    duration,
    resolution,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
    clientRequestId,
    hhMode,
    videoUrl,
  } = params;

  // ====== #7xx 修复：删除回退！参数缺失必须报错！======
  if (!duration) {
    console.error('[TOPAIS-HH-参数错误] duration 缺失！');
    throw new Error('duration 参数缺失');
  }
  if (!resolution) {
    console.error('[TOPAIS-HH-参数错误] resolution 缺失！');
    throw new Error('resolution 参数缺失');
  }
  if (!aspectRatio) {
    console.error('[TOPAIS-HH-参数错误] aspectRatio 缺失！');
    throw new Error('aspectRatio 参数缺失');
  }

  const safeAspectRatio = aspectRatio;
  const safeDuration = Math.max(3, Math.min(15, duration));  // 限制在3-15秒范围
  const safeResolution = resolution;

  console.log('[TOPAIS-HH] #7xx 实际参数: aspectRatio=' + safeAspectRatio + ', duration=' + safeDuration + ', resolution=' + safeResolution + ', hhMode=' + (hhMode || '空') + ', uploadedUrls=' + uploadedUrls.length);

  // ====== 构建 TOPAIS HappyHorse 请求体（对齐官方文档）======
  // model 字段：固定为 happyhorse-1.0
  // action 字段：根据 hhMode 映射
  const requestBody: any = {
    model: 'happyhorse-1.1',  // TOPAIS HappyHorse 1.1 模型名
    prompt,
    duration: safeDuration,
    resolution: safeResolution,
    aspect_ratio: safeAspectRatio,
  };

  // ====== action 参数映射（TOPAIS HappyHorse 核心差异！）======
  // t2v → text-to-video（无素材）
  // i2v → image-to-video（首帧图，image_urls）
  // r2v → reference-to-video（参考图，reference_images，最多9张）
  // video-edit → video-edit（输入视频，url）
  const actionMap: Record<string, string> = {
    't2v': 'text-to-video',
    'i2v': 'image-to-video',
    'r2v': 'reference-to-video',
    'video-edit': 'video-edit',
  };
  requestBody.action = actionMap[hhMode || 't2v'] || 'text-to-video';

  // ====== 素材参数（根据 action 类型）======
  if (hhMode === 'i2v' && uploadedUrls.length > 0) {
    // 首帧生视频：单张图片 URL
    requestBody.image_urls = [uploadedUrls[0]];
  } else if (hhMode === 'r2v' && uploadedUrls.length > 0) {
    // 参考生视频：1-9张图片 URL
    requestBody.reference_images = uploadedUrls.slice(0, 9);  // 最多9张
  } else if (hhMode === 'video-edit' && videoUrl) {
    // 视频编辑：输入视频 URL
    requestBody.url = videoUrl;
  }

  console.log('[TOPAIS-HH] #7xx 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));

  // ====== 创建流式响应 ======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    start(controller) {
      // #7xx 军师定海神针：移除 async 关键字，让 start 函数瞬间返回！
      // 流立刻就绪，HTTP 响应头立刻发送给前端，打通天路！
      // #7xx+4 终极突破：sendEvent 必须 async + await yield！
      // 根因：即使 highWaterMark=0 + 32KB padding，Next.js 内部 TransformStream
      // 仍然批量缓冲所有 enqueue 的数据，直到异步让出才 Flush 到 TCP！
      // 解决：每次 enqueue 后 await 让出事件循环，逼迫 Node.js 把缓冲数据刷到网络层
      const sendEvent = async (data: any) => {
        // #722 致命修复：缓存 key 必须用 clientRequestId（前端轮询的 key），不是服务商 taskId！
        // 优先级：闭包 clientRequestId > data.clientRequestId > data.taskId
        const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
        const safeTaskId = data.taskId || data.clientRequestId || clientRequestId;
        
        if (!safeTaskId && data.type === 'progress') {
          console.error('[sendEvent] #722 CRITICAL: progress 事件缺失 taskId, clientRequestId:', clientRequestId, 'data:', JSON.stringify(data));
        }
        
        // #SSE-CACHE-FIRST: 进度缓存必须在 yield 之前写入！
        // GET 轮询依赖此缓存，如果放在 yield 之后，可能因为异步延迟导致 GET 轮询读到旧值
        if (data.type === 'progress' && cacheTaskId && typeof data.progress === 'number') {
          setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          console.log('[TOPAIS-HH sendEvent] CACHE_WRITE: cacheTaskId=', cacheTaskId, 'progress=', data.progress, 'status=', data.status || 'processing');
        }
        
        // 强制确保 taskId 不为 undefined
        const safeData = { ...data, taskId: safeTaskId };
        // #P1 安全写入：客户端断连时跳过 enqueue，避免 TypeError
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(safeData)}\n\n`, abortGuard)) return;
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // #SSE-FLUSH-终极方案：双重 yield + 10ms 延迟，强制 Node.js Flush！
        await new Promise(r => setTimeout(r, 0));  // 第一次 yield
        await new Promise(r => setTimeout(r, 10)); // 第二次 yield + 10ms 延迟
        // #7xx+3 进度缓存保留！不再删除！GET轮询依赖此缓存返回实时进度
        // 删除会导致GET轮询返回 status:completed 但 progress:undefined
        // 缓存自动通过 TTL 过期清理（见 taskProgressCache.ts）
        // if (data.type === 'complete' || data.type === 'error') {
        //   const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
        //   if (cacheTaskId) deleteTaskProgress(cacheTaskId);
        // }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      // 根因：sendEvent 是 async 函数，在 start(controller) 同步上下文中调用时不加 await，
      // Node.js 不会 Flush，首个事件卡在缓冲区，导致整个管道堵塞，后续所有 progress 事件全部积压！
      // 直到流关闭才一次性释放！修复：移入 async IIFE 内部，加 await 确保首个事件 Flush！

      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model, taskId: clientRequestId });

        // ====== Step 1: 提交任务到 TOPAIS API ======
        const submitEndpoint = `${baseEndpoint}/v1/videos/generations`;
        console.log('[TOPAIS-HH] 提交任务到:', submitEndpoint);

        const submitResponse = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[TOPAIS-HH] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `TOPAIS HappyHorse API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          let tphhSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS HappyHorse 提交任务失败');
            tphhSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] TOPAIS-HH提交失败: requiredCredits=${requiredCredits}, newBalance=${tphhSubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: tphhSubmitBalance ?? undefined });
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: errorMsg }],
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const topaisTaskId = submitData.id;

        if (!topaisTaskId) {
          let tphhNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS HappyHorse 未获取到任务ID');
            tphhNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: tphhNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[TOPAIS-HH] 任务已提交, topaisTaskId:', topaisTaskId);
        await registerVideoTask(clientRequestId, topaisTaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/v1/videos/generations/${topaisTaskId}` });
        await sendEvent({ type: 'waiting', taskId: topaisTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/v1/videos/generations/${topaisTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟（36次 × 5秒），超时后返回 still_processing，离线 Cron 接管
        const pollInterval = 5000; // 每5秒轮询一次

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[TOPAIS-HH] 轮询 #${pollCount}, topaisTaskId: ${topaisTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[TOPAIS-HH] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();
            
            // ====== #7xx 军师照妖镜：完整打印服务商原始数据 ======
            console.log("====== [TOPAIS-HH 服务商原始轮询数据] ======", JSON.stringify(pollData));
            
            const status = pollData.status;
            
            // ====== #7xx 粉碎假进度：多层级向下兼容提取真实进度 ======
            let realProgress = pollData.progress 
              || pollData.data?.progress 
              || pollData.task?.progress 
              || pollData.metadata?.progress
              || pollData.result?.progress
              || 0;
            
            // 如果服务商给的是小数，转成百分比
            if (realProgress > 0 && realProgress < 1) {
              realProgress = Math.round(realProgress * 100);
            }
            
            console.log(`[TOPAIS-HH] #7xx 进度提取: pollData.progress=${pollData.progress}, 最终realProgress=${realProgress}`);
            console.log(`[TOPAIS-HH] 轮询结果: status=${status}, progress=${realProgress}, video_url=${pollData.video_url?.substring?.(0,80) || '无'}`);

            // ====== #7xx 透传真实进度 ======
            // #710 关键修复：TOPAIS API 不返回 progress 字段时，基于轮询次数估算
            let hhFinalProgress = realProgress;
            let hhProgressSource = 'api';
            if (hhFinalProgress <= 0) {
              hhFinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
              hhProgressSource = 'estimated';
            }
            console.log(`[TOPAIS-HH] 发送进度: ${hhFinalProgress}% (来源: ${hhProgressSource}, 原始API: ${realProgress}%)`);
            await sendEvent({
              type: 'progress',
              progress: Math.min(hhFinalProgress, 95),
              status: 'processing',
              taskId: topaisTaskId,
              clientRequestId,
            });

            if (status === 'succeeded' || status === 'completed' || status === 'success') {
              // ====== 任务成功 ======
              console.log('[TOPAIS-HH] 任务成功，获取视频 URL');
              
              // #834 修复：兼容 result.data[0].url 格式（与 TOPAIS-GO 相同的服务商格式）
              const hhResultDataUrl = pollData.result?.data?.[0]?.url || '';
              let videoUrl = pollData.video_url || pollData.video || (pollData.videos && pollData.videos[0]) || hhResultDataUrl || '';
              
              if (!videoUrl) {
                console.error('[TOPAIS-HH] 响应中无视频 URL:', JSON.stringify(pollData));
                let tphhNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS HappyHorse 未返回视频URL');
                  tphhNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                }
                await sendEvent({ type: 'error', error: '视频生成成功但未返回URL', taskId: clientRequestId, creditsBalance: tphhNoUrlBalance ?? undefined });
                // #834 关键：必须调用 setTaskResult 标记失败，否则任务永远卡在 generating 状态
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '视频生成成功但未返回URL' }],
                  creditsBalance: tphhNoUrlBalance ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[TOPAIS-HH] 原始视频 URL:', videoUrl.substring(0, 100));

              // 上传到 COS
              try {
                const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);
                console.log('[TOPAIS-HH] COS 上传成功:', cosResult.key);

                // 保存到数据库
                if (userId) {
                  try {
                    const supabase = getSupabaseClient();
                    await supabase.from('video_history').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      video_url: cosResult.url,
                      video_key: cosResult.key,
                      duration: safeDuration,
                      resolution: safeResolution,
                      aspect_ratio: safeAspectRatio,
                      status: 'completed',
                      created_at: new Date().toISOString(),
                    });
                    console.log('[TOPAIS-HH] 已保存到数据库');
                  } catch (dbError) {
                    console.error('[TOPAIS-HH] 保存到数据库失败:', dbError);
                  }
                }

                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                console.log('[TOPAIS-HH] #7xx complete 事件已发送，关闭 SSE 流');
                controller.close();
                return;
              } catch (uploadError) {
                // COS 上传失败，启动动态代理降级
                console.error('[TOPAIS-HH] 上传视频失败，启动动态代理降级:', uploadError);
                const proxyUrl = wrapAsProxyUrl(videoUrl);
                const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
              }

              controller.close();
              return;

            } else if (status === 'failed') {
              // ====== 任务失败 ======
              const failReason = pollData.error?.message || pollData.error || '视频生成失败';
              console.error('[TOPAIS-HH] 任务失败:', failReason);

              let tphhFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS HappyHorse 任务失败: ${failReason}`);
                tphhFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                console.log(`[积分返还监控] TOPAIS-HH任务失败: requiredCredits=${requiredCredits}, newBalance=${tphhFailBalance}`);
              }

              // 判断是否违规内容
              const lowerReason = (failReason || '').toLowerCase();
              if (lowerReason.includes('moderation') || lowerReason.includes('safety') || lowerReason.includes('policy') || lowerReason.includes('inappropriate')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: topaisTaskId, clientRequestId,
                  creditsBalance: tphhFailBalance ?? undefined,
                });
              }

              await sendEvent({ type: 'error', error: failReason, taskId: topaisTaskId, clientRequestId, creditsBalance: tphhFailBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: failReason }],
                creditsBalance: tphhFailBalance ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            // queued / in_progress / processing → 继续轮询

          } catch (pollErr) {
            console.error('[TOPAIS-HH] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[TOPAIS-HH] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[TOPAIS-HH] 生成异常:', error);
        let tphhExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          try {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS HappyHorse 生成异常');
            tphhExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          } catch {}
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: tphhExceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          creditsBalance: tphhExceptBalance ?? undefined,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      abortGuard.cleanup();
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====== TOPAIS Gemini Omni Flash 异步流程 ======
// POST /v1/videos/generations 提交任务 → GET /v1/videos/generations/{task_id} 轮询结果
// 模式由 image_urls 数量决定：0张=t2v，1张=i2v，3张=r2v（不支持2张）
// 不使用 action 参数，与 HappyHorse 核心差异！
interface TopaisGeminiOmniParams {
  model: string;            // topais-gemini-omni-flash（前端入口，发送给 API 时用 gemini_omni_flash）
  prompt: string;
  uploadedUrls: string[];   // 参考图 URL 数组
  uploadedRefKeys?: string[];  // 参考图 COS key 数组
  aspectRatio: string;      // "16:9" | "9:16"
  duration: number;         // 4 | 6 | 8 | 10
  resolution: string;       // "720P" | "1080p"（1080p 仅 16:9）
  baseEndpoint: string;     // https://toapis.com
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  hhMode?: string;          // 前端指定的模式: t2v/i2v/r2v
}

async function handleTopaisGeminiOmniGeneration(params: TopaisGeminiOmniParams, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,
    aspectRatio,
    duration,
    resolution,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
    clientRequestId,
    hhMode,
  } = params;

  // ====== 参数校验 ======
  if (!duration) {
    console.error('[TOPAIS-GO-参数错误] duration 缺失！');
    throw new Error('duration 参数缺失');
  }
  if (!resolution) {
    console.error('[TOPAIS-GO-参数错误] resolution 缺失！');
    throw new Error('resolution 参数缺失');
  }
  if (!aspectRatio) {
    console.error('[TOPAIS-GO-参数错误] aspectRatio 缺失！');
    throw new Error('aspectRatio 参数缺失');
  }

  const safeAspectRatio = aspectRatio;
  const safeDuration = [4, 6, 8, 10].includes(duration) ? duration : 6;  // 支持 4/6/8/10
  // 1080p 仅支持 16:9，其他比例强制降级为 720P
  let safeResolution = resolution;
  if (resolution === '1080p' && aspectRatio !== '16:9') {
    console.warn('[TOPAIS-GO] 1080p 仅支持 16:9，自动降级为 720P');
    safeResolution = '720P';
  }

  console.log('[TOPAIS-GO] 实际参数: aspectRatio=' + safeAspectRatio + ', duration=' + safeDuration + ', resolution=' + safeResolution + ', hhMode=' + (hhMode || '空') + ', uploadedUrls=' + uploadedUrls.length);

  // ====== 构建 TOPAIS Gemini Omni Flash 请求体（对齐官方文档）======
  // model 字段：固定为 gemini_omni_flash
  // 无 action 字段！模式由 image_urls 数量决定
  const requestBody: any = {
    model: 'gemini_omni_flash',
    prompt,
    duration: safeDuration,
    aspect_ratio: safeAspectRatio,
    resolution: safeResolution,
  };

  // ====== 参考图参数（根据模式）======
  // t2v: 不传 image_urls
  // i2v: image_urls 传 1 张
  // r2v: image_urls 传 3 张（不支持 2 张）
  if (hhMode === 'i2v' && uploadedUrls.length >= 1) {
    requestBody.image_urls = [uploadedUrls[0]];
  } else if (hhMode === 'r2v' && uploadedUrls.length >= 3) {
    requestBody.image_urls = uploadedUrls.slice(0, 3);  // 最多 3 张
  } else if (hhMode === 'r2v' && uploadedUrls.length >= 1 && uploadedUrls.length < 3) {
    // r2v 模式但不足 3 张图，传实际数量（服务商可能按 i2v 处理）
    console.warn('[TOPAIS-GO] r2v 模式但参考图不足3张，传实际数量:', uploadedUrls.length);
    requestBody.image_urls = uploadedUrls;
  }
  // t2v 模式不传 image_urls

  console.log('[TOPAIS-GO] 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));

  // ====== 创建流式响应 ======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = async (data: any) => {
        const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
        const safeTaskId = data.taskId || data.clientRequestId || clientRequestId;

        if (!safeTaskId && data.type === 'progress') {
          console.error('[sendEvent] CRITICAL: progress 事件缺失 taskId, clientRequestId:', clientRequestId);
        }

        if (data.type === 'progress' && cacheTaskId && typeof data.progress === 'number') {
          setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          console.log('[TOPAIS-GO sendEvent] CACHE_WRITE: cacheTaskId=', cacheTaskId, 'progress=', data.progress);
        }

        const safeData = { ...data, taskId: safeTaskId };
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(safeData)}\n\n`, abortGuard)) return;
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 10));
      };

      (async () => {
      try {
        await sendEvent({ type: 'start', model, taskId: clientRequestId });

        // ====== Step 1: 提交任务到 TOPAIS API ======
        const submitEndpoint = `${baseEndpoint}/v1/videos/generations`;
        console.log('[TOPAIS-GO] 提交任务到:', submitEndpoint);

        const submitResponse = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[TOPAIS-GO] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `TOPAIS Gemini Omni Flash API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
          } catch {}
          errorMsg = translateErrorMessage(errorMsg);
          let tpgoSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Gemini Omni Flash 提交任务失败');
            tpgoSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] TOPAIS-GO提交失败: requiredCredits=${requiredCredits}, newBalance=${tpgoSubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: tpgoSubmitBalance ?? undefined });
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: errorMsg }],
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const topaisTaskId = submitData.id;

        if (!topaisTaskId) {
          let tpgoNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Gemini Omni Flash 未获取到任务ID');
            tpgoNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: tpgoNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[TOPAIS-GO] 任务已提交, topaisTaskId:', topaisTaskId);
        await registerVideoTask(clientRequestId, topaisTaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/v1/videos/generations/${topaisTaskId}` });
        await sendEvent({ type: 'waiting', taskId: topaisTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/v1/videos/generations/${topaisTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟（36次 × 5秒），超时后返回 still_processing，离线 Cron 接管
        const pollInterval = 5000; // 每5秒轮询一次

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[TOPAIS-GO] 轮询 #${pollCount}, topaisTaskId: ${topaisTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[TOPAIS-GO] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();

            console.log("====== [TOPAIS-GO 服务商原始轮询数据] ======", JSON.stringify(pollData));

            const status = pollData.status;

            // 进度提取
            let realProgress = pollData.progress
              || pollData.data?.progress
              || pollData.task?.progress
              || pollData.metadata?.progress
              || pollData.result?.progress
              || 0;

            if (realProgress > 0 && realProgress < 1) {
              realProgress = Math.round(realProgress * 100);
            }

            console.log(`[TOPAIS-GO] 进度提取: realProgress=${realProgress}`);

            // 估算进度
            let goFinalProgress = realProgress;
            let goProgressSource = 'api';
            if (goFinalProgress <= 0) {
              goFinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
              goProgressSource = 'estimated';
            }
            console.log(`[TOPAIS-GO] 发送进度: ${goFinalProgress}% (来源: ${goProgressSource})`);
            await sendEvent({
              type: 'progress',
              progress: Math.min(goFinalProgress, 95),
              status: 'processing',
              taskId: topaisTaskId,
              clientRequestId,
            });

            if (status === 'succeeded' || status === 'completed' || status === 'success') {
              // ====== 任务成功 ======
              console.log('[TOPAIS-GO] 任务成功，获取视频 URL');

              // #834 修复：Gemini Omni Flash 返回 result.data[0].url 格式
              // 服务商原始格式: { result: { type: "video", data: [{ url: "https://...", format: "mp4" }] } }
              const resultDataUrl = pollData.result?.data?.[0]?.url || '';
              let videoUrl = pollData.video_url || pollData.video || (pollData.videos && pollData.videos[0]) || resultDataUrl || '';

              if (!videoUrl) {
                console.error('[TOPAIS-GO] 响应中无视频 URL:', JSON.stringify(pollData));
                let tpgoNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Gemini Omni Flash 未返回视频URL');
                  tpgoNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                }
                await sendEvent({ type: 'error', error: '视频生成成功但未返回URL', taskId: clientRequestId, creditsBalance: tpgoNoUrlBalance ?? undefined });
                // #834 关键：必须调用 setTaskResult 标记失败，否则任务永远卡在 generating 状态
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '视频生成成功但未返回URL' }],
                  creditsBalance: tpgoNoUrlBalance ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[TOPAIS-GO] 原始视频 URL:', videoUrl.substring(0, 100));

              // 上传到 COS
              try {
                const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);
                console.log('[TOPAIS-GO] COS 上传成功:', cosResult.key);

                // 保存到数据库
                if (userId) {
                  try {
                    const supabase = getSupabaseClient();
                    await supabase.from('video_history').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      video_url: cosResult.url,
                      video_key: cosResult.key,
                      duration: safeDuration,
                      resolution: safeResolution,
                      aspect_ratio: safeAspectRatio,
                      status: 'completed',
                      created_at: new Date().toISOString(),
                    });
                    console.log('[TOPAIS-GO] 已保存到数据库');
                  } catch (dbError) {
                    console.error('[TOPAIS-GO] 保存到数据库失败:', dbError);
                  }
                }

                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                console.log('[TOPAIS-GO] complete 事件已发送，关闭 SSE 流');
                controller.close();
                return;
              } catch (uploadError) {
                // COS 上传失败，启动动态代理降级
                console.error('[TOPAIS-GO] 上传视频失败，启动动态代理降级:', uploadError);
                const proxyUrl = wrapAsProxyUrl(videoUrl);
                const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
              }

              controller.close();
              return;

            } else if (status === 'failed') {
              // ====== 任务失败 ======
              const rawFailReason = pollData.error?.message || pollData.error || '视频生成失败';
              console.error('[TOPAIS-GO] 任务失败:', rawFailReason);

              // #833 翻译服务商原始错误消息为中文（如 prominent_people_filter_failed → "内容包含知名人物"）
              const failReason = translateErrorMessage(rawFailReason);

              let tpgoFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Gemini Omni Flash 任务失败: ${rawFailReason}`);
                tpgoFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                console.log(`[积分返还监控] TOPAIS-GO任务失败: requiredCredits=${requiredCredits}, newBalance=${tpgoFailBalance}`);
              }

              const lowerReason = (rawFailReason || '').toLowerCase();
              if (lowerReason.includes('moderation') || lowerReason.includes('safety') || lowerReason.includes('policy') || lowerReason.includes('inappropriate') || lowerReason.includes('prominent_people') || lowerReason.includes('people_filter')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: topaisTaskId, clientRequestId,
                  creditsBalance: tpgoFailBalance ?? undefined,
                });
              }

              await sendEvent({ type: 'error', error: failReason, taskId: topaisTaskId, clientRequestId, creditsBalance: tpgoFailBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: failReason }],
                creditsBalance: tpgoFailBalance ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            // queued / in_progress / processing → 继续轮询

          } catch (pollErr) {
            console.error('[TOPAIS-GO] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[TOPAIS-GO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[TOPAIS-GO] 生成异常:', error);
        let tpgoExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          try {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Gemini Omni Flash 生成异常');
            tpgoExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          } catch {}
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: tpgoExceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          creditsBalance: tpgoExceptBalance ?? undefined,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      })(); // 自执行异步函数
    },
  }, { highWaterMark: 0 });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
// #7xx TOPAIS Seedance 2.0 异步流程：POST JSON 提交任务 → GET 轮询结果
// 支持 seedance-2 (4-15s, 720p/1080p) 和 seedance-2-fast (4-12s, 720p only)
// 支持文生视频、首帧图生视频、首尾帧图生视频、多模态参考生视频
// ====================================================================
interface TopaisSeedanceParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;
  duration: number;
  resolution: string;
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  hhMode?: string;
  sd2Mode?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  generateAudio?: boolean;
}

async function handleTopaisSeedanceGeneration(params: TopaisSeedanceParams, req: NextRequest): Promise<Response> {
  const {
    model, prompt, uploadedUrls, uploadedRefKeys = [], aspectRatio, duration, resolution,
    baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct, clientRequestId,
    hhMode, sd2Mode, firstFrameUrl, lastFrameUrl,
    referenceImageUrls, referenceVideoUrls, referenceAudioUrls, generateAudio,
  } = params;

  console.log('[TOPAIS-Seedance] 开始生成:', { model, duration, aspectRatio, resolution, generateAudio, sd2Mode });

  // ====== model 映射：去掉 topais- 前缀，发送给 TOPAIS 的实际模型名 ======
  // topais-seedance-2 → seedance-2, topais-seedance-2-fast → seedance-2-fast
  const actualModel = model.replace(/^topais-/, '');
  console.log('[TOPAIS-Seedance] 模型映射:', model, '→', actualModel);

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    model: actualModel,
    prompt: prompt,
    duration: duration,
    aspect_ratio: aspectRatio,
    resolution: resolution,
    generate_audio: generateAudio !== false, // 默认 true
  };

  // 构建 image_with_roles 数组
  const imageWithRoles: Array<{ url: string; role: string }> = [];

  // 首帧图
  if (firstFrameUrl) {
    imageWithRoles.push({ url: firstFrameUrl, role: 'first_frame' });
  }

  // 尾帧图
  if (lastFrameUrl) {
    imageWithRoles.push({ url: lastFrameUrl, role: 'last_frame' });
  }

  // 参考图 (最多9张)
  const refImages = referenceImageUrls || uploadedUrls || [];
  if (refImages.length > 0) {
    for (const imgUrl of refImages.slice(0, 9)) {
      imageWithRoles.push({ url: imgUrl, role: 'reference_image' });
    }
  }

  if (imageWithRoles.length > 0) {
    requestBody.image_with_roles = imageWithRoles;
  }

  // 构建 video_with_roles 数组 (最多3条)
  if (referenceVideoUrls && referenceVideoUrls.length > 0) {
    const videoWithRoles = referenceVideoUrls.slice(0, 3).map(url => ({
      url: url,
      role: 'reference_video',
    }));
    requestBody.video_with_roles = videoWithRoles;
  }

  // 构建 audio_with_roles 数组 (最多3段)
  if (referenceAudioUrls && referenceAudioUrls.length > 0) {
    const audioWithRoles = referenceAudioUrls.slice(0, 3).map(url => ({
      url: url,
      role: 'reference_audio',
    }));
    requestBody.audio_with_roles = audioWithRoles;
  }

  console.log('[TOPAIS-Seedance] 请求体:', JSON.stringify(requestBody, null, 2));

  // 创建 SSE 流
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendEvent = async (data: Record<string, unknown>) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
      };

      try {
        // 发送等待事件
        await sendEvent({ type: 'waiting', taskId: clientRequestId, message: '正在提交任务...' });

        // Step 1: POST 提交任务
        const submitResponse = await fetch(`${baseEndpoint}/v1/videos/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text();
          console.error('[TOPAIS-Seedance] 提交失败:', submitResponse.status, errorText);

          let tsErrMsg = `提交失败: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(errorText);
            tsErrMsg = errorData.error?.message || errorData.error || errorData.message || errorData.upstream_message || tsErrMsg;
          } catch {}
          tsErrMsg = translateErrorMessage(tsErrMsg);

          let tsBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Seedance 提交失败: ${submitResponse.status}`);
            tsBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }

          await sendEvent({ type: 'error', error: tsErrMsg, taskId: clientRequestId, creditsBalance: tsBalance ?? undefined });
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: tsErrMsg }],
            creditsBalance: tsBalance ?? undefined,
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          controller.close();
          return;
        }

        const submitData = await submitResponse.json();
        // 检查响应体中的API错误（即使HTTP 200也可能包含错误）
        if (submitData.error || submitData.code) {
          const apiError = typeof submitData.error === 'string' ? submitData.error : (submitData.error?.message || JSON.stringify(submitData.error));
          const errorCode = submitData.code ? `[${submitData.code}] ` : '';
          console.error('[TOPAIS-Seedance] API返回错误:', errorCode, apiError);
          let tsApiErrBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Seedance API错误: ${errorCode}${apiError}`);
            tsApiErrBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: translateErrorMessage(`${errorCode}${apiError}`), taskId: clientRequestId, creditsBalance: tsApiErrBalance ?? undefined });
          controller.close();
          return;
        }
        const topaisTaskId = submitData.id;

        if (!topaisTaskId) {
          let tsNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Seedance 未获取到任务ID');
            tsNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: tsNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[TOPAIS-Seedance] 任务已提交, topaisTaskId:', topaisTaskId);
        await registerVideoTask(clientRequestId, topaisTaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/v1/videos/generations/${topaisTaskId}` });
        await sendEvent({ type: 'waiting', taskId: topaisTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // Step 2: 轮询任务状态
        const pollEndpoint = `${baseEndpoint}/v1/videos/generations/${topaisTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟
        const pollInterval = 5000;

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[TOPAIS-Seedance] 轮询 #${pollCount}, topaisTaskId: ${topaisTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[TOPAIS-Seedance] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();
            console.log('[TOPAIS-Seedance] 轮询数据:', JSON.stringify(pollData));

            const status = pollData.status;
            const progress = pollData.progress || 0;

            // 发送进度事件
            if (status === 'in_progress' && progress > 0) {
              await sendEvent({ type: 'progress', progress: progress, taskId: topaisTaskId, clientRequestId });
            }

            if (status === 'completed') {
              // #834 修复：兼容 result.data[0].url 格式
              const sdResultDataUrl = pollData.result?.data?.[0]?.url || '';
              const videoUrl = pollData.video_url || pollData.video || (pollData.videos && pollData.videos[0]) || sdResultDataUrl || '';

              if (!videoUrl) {
                console.error('[TOPAIS-Seedance] 任务完成但没有视频URL');
                let tsNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Seedance 任务完成但无视频URL');
                  tsNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                }
                await sendEvent({ type: 'error', error: '任务完成但未获取到视频', taskId: topaisTaskId, clientRequestId, creditsBalance: tsNoUrlBalance ?? undefined });
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '任务完成但未获取到视频' }],
                  creditsBalance: tsNoUrlBalance ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[TOPAIS-Seedance] 原始视频 URL:', videoUrl.substring(0, 100));

              // 上传到 COS
              try {
                const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);
                console.log('[TOPAIS-Seedance] COS 上传成功:', cosResult.key);

                // 保存到数据库
                if (userId) {
                  try {
                    const supabase = getSupabaseClient();
                    await supabase.from('video_history').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      video_url: cosResult.url,
                      video_key: cosResult.key,
                      duration: duration,
                      resolution: resolution,
                      aspect_ratio: aspectRatio,
                      status: 'completed',
                      created_at: new Date().toISOString(),
                    });
                    console.log('[TOPAIS-Seedance] 已保存到数据库');
                  } catch (dbError) {
                    console.error('[TOPAIS-Seedance] 保存到数据库失败:', dbError);
                  }
                }

                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                console.log('[TOPAIS-Seedance] complete 事件已发送，关闭 SSE 流');
                controller.close();
                return;
              } catch (uploadError) {
                console.error('[TOPAIS-Seedance] 上传视频失败，启动动态代理降级:', uploadError);
                const proxyUrl = wrapAsProxyUrl(videoUrl);
                const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

            } else if (status === 'failed') {
              const failReason = pollData.error?.message || pollData.error || '视频生成失败';
              console.error('[TOPAIS-Seedance] 任务失败:', failReason);

              let tsFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Seedance 任务失败: ${failReason}`);
                tsFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }

              // 判断是否违规内容
              const lowerReason = (failReason || '').toLowerCase();
              if (lowerReason.includes('moderation') || lowerReason.includes('safety') || lowerReason.includes('policy') || lowerReason.includes('inappropriate')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: topaisTaskId, clientRequestId, creditsBalance: tsFailBalance ?? undefined });
              }

              await sendEvent({ type: 'error', error: failReason, taskId: topaisTaskId, clientRequestId, creditsBalance: tsFailBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: failReason }],
                creditsBalance: tsFailBalance ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            // queued / in_progress → 继续轮询

          } catch (pollErr) {
            console.error('[TOPAIS-Seedance] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[TOPAIS-Seedance] 生成异常:', error);
        let tsExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          try {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Seedance 生成异常');
            tsExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          } catch {}
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: tsExceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          creditsBalance: tsExceptBalance ?? undefined,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ============================================================
// MEGA AI Seedance 2.0 异步流程：POST /v1/media/generate → GET /v1/tasks/{taskId}
// 独立供应商，与所有其他模型完全隔离！
// 固定720p，15积分/秒
// ============================================================

interface MegaAiSeedanceParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];
  aspectRatio: string;
  duration: number;
  resolution: string;   // 固定720p
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  hhMode?: string;
  sd2Mode?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  generateAudio?: boolean;
}

async function handleMegaAiSeedanceGeneration(params: MegaAiSeedanceParams, req: NextRequest): Promise<Response> {
  const {
    model, prompt, uploadedUrls, uploadedRefKeys = [], aspectRatio, duration, resolution,
    baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct, clientRequestId,
    hhMode, sd2Mode, firstFrameUrl, lastFrameUrl,
    referenceImageUrls, referenceVideoUrls, referenceAudioUrls, generateAudio,
  } = params;

  console.log('[MEGA-AI-SD] 开始生成:', { model, duration, aspectRatio, resolution, generateAudio, hhMode, sd2Mode });

  // 构建请求体 - MEGA AI 使用 /v1/media/generate 端点，字段放在顶层
  const requestBody: Record<string, unknown> = {
    model: 'seedance-v2-720p',  // MEGA AI 的模型名（固定，不使用前端传入的 model_id）
    prompt: prompt,
    duration: duration,
    aspect_ratio: aspectRatio,
  };

  // auto_face_mask: 自动过人脸（MEGA AI 支持）
  requestBody.auto_face_mask = true;

  // 构建 images 数组（公网可访问的图片 URL）
  const images: string[] = [];

  // 首帧图
  if (firstFrameUrl) {
    images.push(firstFrameUrl);
  }

  // 尾帧图
  if (lastFrameUrl) {
    images.push(lastFrameUrl);
  }

  // 参考图 (最多9张)
  const refImages = referenceImageUrls || uploadedUrls || [];
  if (refImages.length > 0) {
    for (const imgUrl of refImages.slice(0, 9)) {
      images.push(imgUrl);
    }
  }

  if (images.length > 0) {
    requestBody.images = images;
  }

  // 构建 videos 数组 (最多3段)
  if (referenceVideoUrls && referenceVideoUrls.length > 0) {
    requestBody.videos = referenceVideoUrls.slice(0, 3);
  }

  // 构建 audios 数组 (最多3段)
  if (referenceAudioUrls && referenceAudioUrls.length > 0) {
    requestBody.audios = referenceAudioUrls.slice(0, 3);
  }

  console.log('[MEGA-AI-SD] 请求体:', JSON.stringify(requestBody, null, 2));

  // 创建 SSE 流
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendEvent = async (data: Record<string, unknown>) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
      };

      try {
        // 发送等待事件
        await sendEvent({ type: 'waiting', taskId: clientRequestId, message: '正在提交任务...' });

        // Step 1: POST 提交任务 - 使用 /v1/media/generate 端点
        const submitResponse = await fetch(`${baseEndpoint}/v1/media/generate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text();
          console.error('[MEGA-AI-SD] 提交失败:', submitResponse.status, errorText);

          let maErrMsg = `提交失败: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(errorText);
            maErrMsg = errorData.error?.message || errorData.error || errorData.message || errorData.upstream_message || maErrMsg;
          } catch {}
          maErrMsg = translateErrorMessage(maErrMsg);

          let maBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `MEGA AI Seedance 提交失败: ${submitResponse.status}`);
            maBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }

          await sendEvent({ type: 'error', error: maErrMsg, taskId: clientRequestId, creditsBalance: maBalance ?? undefined });
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: maErrMsg }],
            creditsBalance: maBalance ?? undefined,
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          controller.close();
          return;
        }

        const submitData = await submitResponse.json();
        // 检查响应体中的API错误（即使HTTP 200也可能包含错误）
        if (submitData.error || submitData.code) {
          const apiError = typeof submitData.error === 'string' ? submitData.error : JSON.stringify(submitData.error);
          const errorCode = submitData.code ? `[${submitData.code}] ` : '';
          console.error('[MEGA-AI-SD] API返回错误:', errorCode, apiError);
          let maApiErrBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `MEGA AI API错误: ${errorCode}${apiError}`);
            maApiErrBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: translateErrorMessage(`${errorCode}${apiError}`), taskId: clientRequestId, creditsBalance: maApiErrBalance ?? undefined });
          controller.close();
          return;
        }
        // MEGA AI 返回 task_id 字段（不是 id）
        const megaTaskId = submitData.task_id || submitData.id;

        if (!megaTaskId) {
          let maNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'MEGA AI Seedance 未获取到任务ID');
            maNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: maNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[MEGA-AI-SD] 任务已提交, megaTaskId:', megaTaskId);
        await registerVideoTask(clientRequestId, megaTaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/v1/tasks/${megaTaskId}` });
        await sendEvent({ type: 'waiting', taskId: megaTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // Step 2: 轮询任务状态 - 使用 /v1/tasks/{taskId} 端点
        const pollEndpoint = `${baseEndpoint}/v1/tasks/${megaTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟
        const pollInterval = 5000;

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[MEGA-AI-SD] 轮询 #${pollCount}, megaTaskId: ${megaTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[MEGA-AI-SD] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();
            console.log('[MEGA-AI-SD] 轮询数据:', JSON.stringify(pollData));

            // MEGA AI 返回 status 字段：pending / processing / completed / failed
            const status = pollData.status;
            const progress = pollData.progress || 0;

            // 发送进度事件
            if (status === 'processing' && progress > 0) {
              await sendEvent({ type: 'progress', progress: progress, taskId: megaTaskId, clientRequestId });
            }

            if (status === 'completed') {
              // 提取视频 URL - MEGA AI 返回 result.data[0].url 格式
              const resultDataUrl = pollData.result?.data?.[0]?.url || '';
              const videoUrl = pollData.video_url || pollData.video || (pollData.videos && pollData.videos[0]) || resultDataUrl || '';

              if (!videoUrl) {
                console.error('[MEGA-AI-SD] 任务完成但没有视频URL');
                let maNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'MEGA AI Seedance 任务完成但无视频URL');
                  maNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                }
                await sendEvent({ type: 'error', error: '任务完成但未获取到视频', taskId: megaTaskId, clientRequestId, creditsBalance: maNoUrlBalance ?? undefined });
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '任务完成但未获取到视频' }],
                  creditsBalance: maNoUrlBalance ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[MEGA-AI-SD] 原始视频 URL:', videoUrl.substring(0, 100));

              // 上传到 COS
              try {
                const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);
                console.log('[MEGA-AI-SD] COS 上传成功:', cosResult.key);

                // 保存到数据库
                if (userId) {
                  try {
                    const supabase = getSupabaseClient();
                    await supabase.from('video_history').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      video_url: cosResult.url,
                      video_key: cosResult.key,
                      duration: duration,
                      resolution: '720p',
                      aspect_ratio: aspectRatio,
                      status: 'completed',
                      created_at: new Date().toISOString(),
                    });
                    console.log('[MEGA-AI-SD] 已保存到数据库');
                  } catch (dbError) {
                    console.error('[MEGA-AI-SD] 保存到数据库失败:', dbError);
                  }
                }

                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                console.log('[MEGA-AI-SD] complete 事件已发送，关闭 SSE 流');
                controller.close();
                return;
              } catch (uploadError) {
                console.error('[MEGA-AI-SD] 上传视频失败，启动动态代理降级:', uploadError);
                const proxyUrl = wrapAsProxyUrl(videoUrl);
                const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

            } else if (status === 'failed') {
              const failReason = pollData.error?.message || pollData.error || pollData.message || '视频生成失败';
              console.error('[MEGA-AI-SD] 任务失败:', failReason);

              let maFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `MEGA AI Seedance 任务失败: ${failReason}`);
                maFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }

              // 判断是否违规内容
              const lowerReason = (failReason || '').toLowerCase();
              if (lowerReason.includes('moderation') || lowerReason.includes('safety') || lowerReason.includes('policy') || lowerReason.includes('inappropriate')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: megaTaskId, clientRequestId, creditsBalance: maFailBalance ?? undefined });
              }

              await sendEvent({ type: 'error', error: failReason, taskId: megaTaskId, clientRequestId, creditsBalance: maFailBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: failReason }],
                creditsBalance: maFailBalance ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            // pending / processing → 继续轮询

          } catch (pollErr) {
            console.error('[MEGA-AI-SD] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[MEGA-AI-SD] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[MEGA-AI-SD] 生成异常:', error);
        let maExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          try {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'MEGA AI Seedance 生成异常');
            maExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          } catch {}
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: maExceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          creditsBalance: maExceptBalance ?? undefined,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====================================================================
// TOPAIS MiniMax H3 异步流程：POST /v1/videos/generations 提交任务 → GET /v1/videos/generations/{taskId} 轮询结果
// 独立供应商，与 TOPAIS Seedance API 格式相同但配置完全独立
// 支持 t2v/i2v-first-frame/i2v-first-last-frame/r2v 四种模式
// 固定2K分辨率，image_with_roles/video_with_roles/audio_with_roles 角色映射
// ====================================================================
interface TopaisMinimaxParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];
  aspectRatio: string;
  duration: number;
  resolution: string;   // 固定2K
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  hhMode?: string;
  sd2Mode?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  generateAudio?: boolean;
}

async function handleTopaisMinimaxGeneration(params: TopaisMinimaxParams, req: NextRequest): Promise<Response> {
  const {
    model, prompt, uploadedUrls, uploadedRefKeys = [], aspectRatio, duration, resolution,
    baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct, clientRequestId,
    hhMode, sd2Mode, firstFrameUrl, lastFrameUrl,
    referenceImageUrls, referenceVideoUrls, referenceAudioUrls, generateAudio,
  } = params;

  console.log('[TOPAIS-Minimax] 开始生成:', { model, duration, aspectRatio, resolution, generateAudio, hhMode, sd2Mode });

  // 构建请求体 - MiniMax H3 使用 /v1/videos/generations 端点，字段放在顶层
  const requestBody: Record<string, unknown> = {
    model: 'MiniMax-H3',  // MiniMax H3 的模型名（固定，不使用前端传入的 model_id）
    prompt: prompt,
    duration: duration,
    aspect_ratio: aspectRatio,
    resolution: resolution,  // 固定2K
    watermark: false,  // 不添加水印
  };

  // 构建 image_with_roles 数组
  const imageWithRoles: Array<{ url: string; role: string }> = [];

  // 首帧图
  if (firstFrameUrl) {
    imageWithRoles.push({ url: firstFrameUrl, role: 'first_frame' });
  }

  // 尾帧图
  if (lastFrameUrl) {
    imageWithRoles.push({ url: lastFrameUrl, role: 'last_frame' });
  }

  // 参考图 (最多9张)
  const refImages = referenceImageUrls || uploadedUrls || [];
  if (refImages.length > 0) {
    for (const imgUrl of refImages.slice(0, 9)) {
      imageWithRoles.push({ url: imgUrl, role: 'reference_image' });
    }
  }

  if (imageWithRoles.length > 0) {
    requestBody.image_with_roles = imageWithRoles;
  }

  // 构建 video_with_roles 数组 (最多3条)
  if (referenceVideoUrls && referenceVideoUrls.length > 0) {
    const videoWithRoles = referenceVideoUrls.slice(0, 3).map(url => ({
      url: url,
      role: 'reference_video',
    }));
    requestBody.video_with_roles = videoWithRoles;
  }

  // 构建 audio_with_roles 数组 (最多3段)
  if (referenceAudioUrls && referenceAudioUrls.length > 0) {
    const audioWithRoles = referenceAudioUrls.slice(0, 3).map(url => ({
      url: url,
      role: 'reference_audio',
    }));
    requestBody.audio_with_roles = audioWithRoles;
  }

  console.log('[TOPAIS-Minimax] 请求体:', JSON.stringify(requestBody, null, 2));

  // 创建 SSE 流
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendEvent = async (data: Record<string, unknown>) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
      };

      try {
        // 发送等待事件
        await sendEvent({ type: 'waiting', taskId: clientRequestId, message: '正在提交任务...' });

        // Step 1: POST 提交任务
        const submitResponse = await fetch(`${baseEndpoint}/v1/videos/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text();
          console.error('[TOPAIS-Minimax] 提交失败:', submitResponse.status, errorText);

          let mmErrMsg = `提交失败: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(errorText);
            mmErrMsg = errorData.error?.message || errorData.error || errorData.message || errorData.upstream_message || mmErrMsg;
          } catch {}
          mmErrMsg = translateErrorMessage(mmErrMsg);

          let mmBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS MiniMax H3 提交失败: ${submitResponse.status}`);
            mmBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }

          await sendEvent({ type: 'error', error: mmErrMsg, taskId: clientRequestId, creditsBalance: mmBalance ?? undefined });
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: mmErrMsg }],
            creditsBalance: mmBalance ?? undefined,
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          controller.close();
          return;
        }

        const submitData = await submitResponse.json();
        // 检查响应体中的API错误（即使HTTP 200也可能包含错误）
        if (submitData.error || submitData.code) {
          const apiError = typeof submitData.error === 'string' ? submitData.error : (submitData.error?.message || JSON.stringify(submitData.error));
          const errorCode = submitData.code ? `[${submitData.code}] ` : '';
          console.error('[TOPAIS-Minimax] API返回错误:', errorCode, apiError);
          let mmApiErrBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS MiniMax H3 API错误: ${errorCode}${apiError}`);
            mmApiErrBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: translateErrorMessage(`${errorCode}${apiError}`), taskId: clientRequestId, creditsBalance: mmApiErrBalance ?? undefined });
          controller.close();
          return;
        }
        // MiniMax H3 返回 id 字段（ToAPIs 统一格式）
        const minimaxTaskId = submitData.id || submitData.task_id;

        if (!minimaxTaskId) {
          let mmNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS MiniMax H3 未获取到任务ID');
            mmNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: mmNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[TOPAIS-Minimax] 任务已提交, minimaxTaskId:', minimaxTaskId);
        await registerVideoTask(clientRequestId, minimaxTaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/v1/videos/generations/${minimaxTaskId}` });
        await sendEvent({ type: 'waiting', taskId: minimaxTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // Step 2: 轮询任务状态
        const pollEndpoint = `${baseEndpoint}/v1/videos/generations/${minimaxTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟
        const pollInterval = 5000;

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[TOPAIS-Minimax] 轮询 #${pollCount}, minimaxTaskId: ${minimaxTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[TOPAIS-Minimax] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();
            console.log('[TOPAIS-Minimax] 轮询数据:', JSON.stringify(pollData));

            // ToAPIs 统一状态：queued / in_progress / completed / failed
            const status = pollData.status;
            const progress = pollData.progress || 0;

            // 发送进度事件
            if (status === 'in_progress' && progress > 0) {
              await sendEvent({ type: 'progress', progress: progress, taskId: minimaxTaskId, clientRequestId });
            }

            if (status === 'completed' || status === 'succeeded') {
              // 提取视频 URL - 兼容多种返回格式
              const mmResultDataUrl = pollData.result?.data?.[0]?.url || '';
              const videoUrl = pollData.video_url || pollData.video || (pollData.videos && pollData.videos[0]) || mmResultDataUrl || '';

              if (!videoUrl) {
                console.error('[TOPAIS-Minimax] 任务完成但没有视频URL');
                let mmNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS MiniMax H3 任务完成但无视频URL');
                  mmNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                }
                await sendEvent({ type: 'error', error: '任务完成但未获取到视频', taskId: minimaxTaskId, clientRequestId, creditsBalance: mmNoUrlBalance ?? undefined });
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '任务完成但未获取到视频' }],
                  creditsBalance: mmNoUrlBalance ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[TOPAIS-Minimax] 原始视频 URL:', videoUrl.substring(0, 100));

              // 检查是否为相对路径，需要拼接 baseEndpoint
              let finalVideoUrl = videoUrl;
              if (videoUrl.startsWith('/') && !videoUrl.startsWith('//')) {
                // 相对路径，拼接 baseEndpoint（去掉末尾的斜杠）
                const base = baseEndpoint.replace(/\/+$/, '');
                finalVideoUrl = `${base}${videoUrl}`;
                console.log('[TOPAIS-Minimax] 相对路径拼接:', finalVideoUrl.substring(0, 100));
              }

              // 上传到 COS
              try {
                const cosResult = await downloadAndUploadVideoToCOS(finalVideoUrl, 0);
                console.log('[TOPAIS-Minimax] COS 上传成功:', cosResult.key);

                // 保存到数据库
                if (userId) {
                  try {
                    const supabase = getSupabaseClient();
                    await supabase.from('video_history').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      video_url: cosResult.url,
                      video_key: cosResult.key,
                      duration: duration,
                      resolution: '2K',
                      aspect_ratio: aspectRatio,
                      status: 'completed',
                      created_at: new Date().toISOString(),
                    });
                    console.log('[TOPAIS-Minimax] 已保存到数据库');
                  } catch (dbError) {
                    console.error('[TOPAIS-Minimax] 保存到数据库失败:', dbError);
                  }
                }

                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                console.log('[TOPAIS-Minimax] complete 事件已发送，关闭 SSE 流');
                controller.close();
                return;
              } catch (uploadError) {
                console.error('[TOPAIS-Minimax] 上传视频失败，启动动态代理降级:', uploadError);
                const proxyUrl = wrapAsProxyUrl(finalVideoUrl);
                const fallbackVideoKey = finalVideoUrl ? `proxy:${finalVideoUrl}` : '';
                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

            } else if (status === 'failed' || status === 'error' || status === 'rejected') {
              const failReason = pollData.error?.message || pollData.error || pollData.message || '视频生成失败';
              console.error('[TOPAIS-Minimax] 任务失败:', failReason);

              let mmFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS MiniMax H3 任务失败: ${failReason}`);
                mmFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }

              // 判断是否违规内容
              const lowerReason = (failReason || '').toLowerCase();
              if (lowerReason.includes('moderation') || lowerReason.includes('safety') || lowerReason.includes('policy') || lowerReason.includes('inappropriate')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: minimaxTaskId, clientRequestId, creditsBalance: mmFailBalance ?? undefined });
              }

              await sendEvent({ type: 'error', error: failReason, taskId: minimaxTaskId, clientRequestId, creditsBalance: mmFailBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: failReason }],
                creditsBalance: mmFailBalance ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            // queued / in_progress → 继续轮询

          } catch (pollErr) {
            console.error('[TOPAIS-Minimax] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();
      } catch (err: unknown) {
        console.error('[TOPAIS-Minimax] SSE 流异常:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        let mmErrBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS MiniMax H3 SSE流异常: ${errMsg}`);
          mmErrBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
        }
        try {
          if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({ type: 'error', error: errMsg, taskId: clientRequestId, creditsBalance: mmErrBalance ?? undefined })}\n\n`, abortGuard)) return;
        } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====================================================================
// TOPAIS Kling v3 Omni 异步流程：POST 提交任务 → GET 轮询结果
// 独立供应商，支持 image_list / video_list / element_list 引用
// mode=std (720P) / mode=pro (1080P)
// audio=true 有声视频 / video_list 参考视频
// ====================================================================
interface TopaisKlingOmniParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];
  aspectRatio: string;
  duration: number;
  resolution: string;     // 720p / 1080p
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  hhMode?: string;
  generateAudio?: boolean;
  referenceVideoUrls?: string[];
}

async function handleTopaisKlingOmniGeneration(params: TopaisKlingOmniParams, req: NextRequest): Promise<Response> {
  const {
    model, prompt, uploadedUrls, uploadedRefKeys = [], aspectRatio, duration, resolution,
    baseEndpoint, apiKey, userId, requiredCredits, creditsBalanceAfterDeduct, clientRequestId,
    generateAudio, referenceVideoUrls,
  } = params;

  console.log('[TOPAIS-KlingOmni] 开始生成:', { model, duration, aspectRatio, resolution, generateAudio });

  // mode 映射：resolution 720p → std, 1080p → pro
  const mode = resolution === '1080p' ? 'pro' : 'std';

  // 构建请求体 - Kling v3 Omni 使用 /v1/videos/generations 端点
  const requestBody: Record<string, unknown> = {
    model: 'kling-v3-omni',
    prompt: prompt,
    mode: mode,
    duration: duration,
    aspect_ratio: aspectRatio,
  };

  // 有声视频
  if (generateAudio) {
    requestBody.audio = true;
  }

  // 参考视频 (最多1段)
  if (referenceVideoUrls && referenceVideoUrls.length > 0) {
    requestBody.video_list = referenceVideoUrls.slice(0, 1).map(url => ({
      video_url: url,
      refer_type: 'base',
      keep_original_sound: 'no',
    }));
  }

  // image_list 引用 (使用 uploadedUrls 作为图片引用)
  const refImages = uploadedUrls || [];
  if (refImages.length > 0) {
    requestBody.metadata = {
      image_list: refImages.slice(0, 9).map(url => ({
        image_url: url,
      })),
    };
  }

  console.log('[TOPAIS-KlingOmni] 请求体:', JSON.stringify(requestBody, null, 2));

  // 创建 SSE 流
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const sendEvent = async (data: Record<string, unknown>) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
      };

      try {
        await sendEvent({ type: 'waiting', taskId: clientRequestId, message: '正在提交任务...' });

        // Step 1: POST 提交任务
        const submitResponse = await fetch(`${baseEndpoint}/v1/videos/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!submitResponse.ok) {
          const errorText = await submitResponse.text();
          console.error('[TOPAIS-KlingOmni] 提交失败:', submitResponse.status, errorText);

          let koErrMsg = `提交失败: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(errorText);
            koErrMsg = errorData.error?.message || errorData.error || errorData.message || errorData.upstream_message || koErrMsg;
          } catch {}
          koErrMsg = translateErrorMessage(koErrMsg);

          let koBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Kling v3 Omni 提交失败: ${submitResponse.status}`);
            koBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }

          await sendEvent({ type: 'error', error: koErrMsg, taskId: clientRequestId, creditsBalance: koBalance ?? undefined });
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: koErrMsg }],
            creditsBalance: koBalance ?? undefined,
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          controller.close();
          return;
        }

        const submitData = await submitResponse.json();
        // 检查响应体中的API错误（即使HTTP 200也可能包含错误）
        if (submitData.error || submitData.code) {
          const apiError = typeof submitData.error === 'string' ? submitData.error : (submitData.error?.message || JSON.stringify(submitData.error));
          const errorCode = submitData.code ? `[${submitData.code}] ` : '';
          console.error('[TOPAIS-KlingOmni] API返回错误:', errorCode, apiError);
          let koApiErrBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Kling v3 Omni API错误: ${errorCode}${apiError}`);
            koApiErrBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: translateErrorMessage(`${errorCode}${apiError}`), taskId: clientRequestId, creditsBalance: koApiErrBalance ?? undefined });
          controller.close();
          return;
        }

        // Kling v3 Omni 返回 id 字段（ToAPIs 统一格式）
        const klingTaskId = submitData.id || submitData.task_id;

        if (!klingTaskId) {
          let koNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Kling v3 Omni 未获取到任务ID');
            koNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: koNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[TOPAIS-KlingOmni] 任务已提交, klingTaskId:', klingTaskId);
        await registerVideoTask(clientRequestId, klingTaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/v1/videos/generations/${klingTaskId}` });
        await sendEvent({ type: 'waiting', taskId: klingTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // Step 2: 轮询任务状态
        const pollEndpoint = `${baseEndpoint}/v1/videos/generations/${klingTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟
        const pollInterval = 5000;

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[TOPAIS-KlingOmni] 轮询 #${pollCount}, klingTaskId: ${klingTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[TOPAIS-KlingOmni] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();
            console.log('[TOPAIS-KlingOmni] 轮询数据:', JSON.stringify(pollData));

            // ToAPIs 统一状态：queued / in_progress / completed / failed
            const status = pollData.status;
            const progress = pollData.progress || 0;

            // 发送进度事件
            if (status === 'in_progress' && progress > 0) {
              await sendEvent({ type: 'progress', progress: progress, taskId: klingTaskId, clientRequestId });
            }

            if (status === 'completed' || status === 'succeeded') {
              // 提取视频 URL - 兼容多种返回格式
              const koResultDataUrl = pollData.result?.data?.[0]?.url || '';
              const videoUrl = pollData.video_url || pollData.video || (pollData.videos && pollData.videos[0]) || koResultDataUrl || '';

              if (!videoUrl) {
                console.error('[TOPAIS-KlingOmni] 任务完成但没有视频URL');
                let koNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS Kling v3 Omni 任务完成但无视频URL');
                  koNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                }
                await sendEvent({ type: 'error', error: '任务完成但未获取到视频', taskId: klingTaskId, clientRequestId, creditsBalance: koNoUrlBalance ?? undefined });
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '任务完成但未获取到视频' }],
                  creditsBalance: koNoUrlBalance ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[TOPAIS-KlingOmni] 原始视频 URL:', videoUrl.substring(0, 100));

              // 检查是否为相对路径，需要拼接 baseEndpoint
              let finalVideoUrl = videoUrl;
              if (videoUrl.startsWith('/') && !videoUrl.startsWith('//')) {
                const base = baseEndpoint.replace(/\/+$/, '');
                finalVideoUrl = `${base}${videoUrl}`;
                console.log('[TOPAIS-KlingOmni] 相对路径拼接:', finalVideoUrl.substring(0, 100));
              }

              // 上传到 COS
              try {
                const cosResult = await downloadAndUploadVideoToCOS(finalVideoUrl, 0);
                console.log('[TOPAIS-KlingOmni] COS 上传成功:', cosResult.key);

                // 保存到数据库
                if (userId) {
                  try {
                    const supabase = getSupabaseClient();
                    await supabase.from('video_history').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      video_url: cosResult.url,
                      video_key: cosResult.key,
                      duration: duration,
                      resolution: resolution,
                      aspect_ratio: aspectRatio,
                      status: 'completed',
                      created_at: new Date().toISOString(),
                    });
                    console.log('[TOPAIS-KlingOmni] 已保存到数据库');
                  } catch (dbError) {
                    console.error('[TOPAIS-KlingOmni] 保存到数据库失败:', dbError);
                  }
                }

                await markVideoTaskCompleted(clientRequestId, cosResult.url);

                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                console.log('[TOPAIS-KlingOmni] complete 事件已发送，关闭 SSE 流');
                controller.close();
                return;
              } catch (uploadError) {
                console.error('[TOPAIS-KlingOmni] 上传视频失败，启动动态代理降级:', uploadError);
                const proxyUrl = wrapAsProxyUrl(finalVideoUrl);
                const fallbackVideoKey = finalVideoUrl ? `proxy:${finalVideoUrl}` : '';
                await markVideoTaskCompleted(clientRequestId, proxyUrl);
                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

            } else if (status === 'failed' || status === 'error' || status === 'rejected') {
              const failReason = pollData.error?.message || pollData.error || pollData.message || '视频生成失败';
              console.error('[TOPAIS-KlingOmni] 任务失败:', failReason);

              let koFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Kling v3 Omni 任务失败: ${failReason}`);
                koFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }

              await markVideoTaskFailed(clientRequestId, failReason);

              // 判断是否违规内容
              const lowerReason = (failReason || '').toLowerCase();
              if (lowerReason.includes('moderation') || lowerReason.includes('safety') || lowerReason.includes('policy') || lowerReason.includes('inappropriate')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: klingTaskId, clientRequestId, creditsBalance: koFailBalance ?? undefined });
              }

              await sendEvent({ type: 'error', error: failReason, taskId: klingTaskId, clientRequestId, creditsBalance: koFailBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: failReason }],
                creditsBalance: koFailBalance ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            // queued / in_progress → 继续轮询

          } catch (pollErr) {
            console.error('[TOPAIS-KlingOmni] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();
      } catch (err: unknown) {
        console.error('[TOPAIS-KlingOmni] SSE 流异常:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        let koErrBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS Kling v3 Omni SSE流异常: ${errMsg}`);
          koErrBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
        }
        try {
          if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify({ type: 'error', error: errMsg, taskId: clientRequestId, creditsBalance: koErrBalance ?? undefined })}\n\n`, abortGuard)) return;
        } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// #638 Lingya Veo3.1 异步流程：POST FormData 提交任务 → GET 轮询结果
// OpenAI 兼容格式，multipart/form-data 上传（参考图 URL 直传）
// 双模型收口：前端提交 veo_3_1-fast/veo_3_1，后端已映射为真实模型
// ====================================================================
interface LingyaVeoParams {
  model: string;          // 映射后的真实模型: veo_3_1-fast, veo_3_1, veo_3_1-fast-4K, veo_3_1-4K
  prompt: string;
  uploadedUrls: string[]; // 参考图 URL 数组（首帧/尾帧）
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;    // 前端格式 "16:9" 或 "9:16"，后端转 "16x9"
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
}

async function handleLingyaVeoGeneration(params: LingyaVeoParams, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
    clientRequestId,
  } = params;

  // #638 修正：灵芽 Veo3.1 API 官方格式 - multipart/form-data（不是 JSON）
  // 参数名：size（如 16x9）、input_reference（可多次传递）
  const lingyaSize = aspectRatio?.replace(':', 'x') || '16x9';  // 转换为官方格式 "16x9"
  console.log(`[Lingya Veo3.1] 构建 FormData: model=${model}, size=${lingyaSize}, input_reference=${uploadedUrls.length}`);

  // 构建 FormData（官方格式要求 multipart/form-data）
  const formData = new FormData();
  formData.append('model', model);
  formData.append('prompt', prompt);
  formData.append('size', lingyaSize);  // 官方参数名：size（如 16x9）

  // 参考图使用 input_reference 参数（可多次传递，用于首尾帧）
  if (uploadedUrls.length > 0) {
    uploadedUrls.forEach((url, idx) => {
      formData.append('input_reference', url);  // 官方参数名：input_reference
      console.log(`[Lingya Veo3.1] 已添加第 ${idx + 1} 个参考图 URL 到 input_reference`);
    });
  }

  // ====== 创建流式响应 ======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    // #7xx 军师定海神针：移除 async 关键字，让 start 函数瞬间返回！
    // 流立刻就绪，HTTP 响应头立刻发送给前端，打通天路！
    start(controller) {
      // #722 终极修复：强制提取 TaskID，拒绝一切 undefined
      const sendEvent = async (data: any) => {
        // #722 致命修复：缓存 key 必须用 clientRequestId（前端轮询的 key），不是服务商 taskId！
        const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
        const safeTaskId = data.taskId || data.clientRequestId || clientRequestId;
        
        console.log('[Lingya-Veo sendEvent] type=', data.type, 'cacheTaskId=', cacheTaskId, 'progress=', data.progress);

        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 8KB Padding 防止缓冲
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(8192)}\n\n`, abortGuard)) return;
        
        await new Promise(r => setTimeout(r, 0));

        // #722 核心修复：用 cacheTaskId（优先 clientRequestId）写入缓存
        if (data.type === 'progress' && cacheTaskId && typeof data.progress === 'number') {
          setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          console.log('[Lingya-Veo sendEvent] CACHE_WRITE: cacheTaskId=', cacheTaskId, 'progress=', data.progress);
        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model });

        // ====== Step 1: 提交任务到灵芽 API ======
        const submitEndpoint = `${baseEndpoint}/v1/videos`;
        console.log('[Lingya Veo3.1] 提交任务到:', submitEndpoint);
        // #680 日志：FormData 内容
        console.log('[Lingya Veo3.1] FormData: model=' + formData.get('model') + ', size=' + formData.get('size') + ', input_reference count=' + uploadedUrls.length);

        // #638 修正：灵芽 Veo3.1 API 官方格式 - multipart/form-data（不设置 Content-Type，浏览器自动设置）
        const submitResponse = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            // 注意：FormData 不需要手动设置 Content-Type，浏览器/Node 会自动设置 multipart/form-data + boundary
          },
          body: formData,  // 直接发送 FormData，不 JSON stringify
        });

        const submitText = await submitResponse.text();
        console.log('[Lingya Veo3.1] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `Lingya Veo3.1 API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          let lvSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Veo3.1 提交任务失败');
            lvSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] Lingya Veo3.1提交失败: requiredCredits=${requiredCredits}, newBalance=${lvSubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: lvSubmitBalance ?? undefined });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const lingyaTaskId = submitData.id;

        if (!lingyaTaskId) {
          let lvNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Veo3.1 未获取到任务ID');
            lvNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: lvNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[Lingya Veo3.1] 任务已提交, lingyaTaskId:', lingyaTaskId);
        await registerVideoTask(clientRequestId, lingyaTaskId, model, userId, prompt, requiredCredits, { aspect_ratio: aspectRatio, pollUrl: `${baseEndpoint}/v1/videos/${lingyaTaskId}` });
        await sendEvent({ type: 'waiting', taskId: lingyaTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/v1/videos/${lingyaTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟（36次 × 5秒），超时后返回 still_processing，离线 Cron 接管
        const pollInterval = 5000; // 每5秒轮询一次
        let pollCount = 0;

        while (pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          const pollResponse = await fetch(pollEndpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (!pollResponse.ok) {
            console.error('[Lingya Veo3.1] 轮询请求失败:', pollResponse.status);
            continue;
          }

          const pollData = await pollResponse.json();
          
          // ====== #7xx 军师照妖镜：完整打印服务商原始数据 ======
          console.log("====== [Lingya Veo3.1 服务商原始轮询数据] ======", JSON.stringify(pollData));
          
          const status = pollData.status;

          // ====== #7xx 粉碎假进度：多层级向下兼容提取真实进度 ======
          let realProgress = pollData.progress 
            || pollData.data?.progress 
            || pollData.task?.progress 
            || pollData.metadata?.progress
            || pollData.result?.progress
            || 0;
          
          // 处理字符串格式的进度（如 "50%"）
          if (typeof realProgress === 'string') {
            realProgress = parseInt(realProgress.replace('%', ''), 10) || 0;
          }
          
          // 如果服务商给的是小数，转成百分比
          if (realProgress > 0 && realProgress < 1) {
            realProgress = Math.round(realProgress * 100);
          }
          
          console.log(`[Lingya Veo3.1] #7xx 进度提取: pollData.progress=${pollData.progress}, 最终realProgress=${realProgress}`);
          console.log(`[Lingya Veo3.1] 轮询 #${pollCount}: status=${status}, progress=${realProgress}%`);

          // ====== #7xx 透传真实进度 ======
          // #710 关键修复：灵芽 API 不返回 progress 字段时，基于轮询次数估算
          let lingyaFinalProgress = realProgress;
          let lingyaProgressSource = 'api';
          if (lingyaFinalProgress <= 0) {
            lingyaFinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
            lingyaProgressSource = 'estimated';
          }
          console.log(`[Lingya Veo3.1] 发送进度: ${lingyaFinalProgress}% (来源: ${lingyaProgressSource}, 原始API: ${realProgress}%)`);
          await sendEvent({
            type: 'progress',
            progress: Math.min(lingyaFinalProgress, 95),
            status: status || 'processing',
            taskId: lingyaTaskId,
            clientRequestId,
          });

          if (status === 'completed') {
            // ====== 任务完成 ======
            const videoUrl = pollData.video_url;
            if (!videoUrl) {
              let lvNoUrlBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Veo3.1 任务完成但无视频URL');
                lvNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }
              await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: lvNoUrlBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            console.log('[Lingya Veo3.1] 视频生成成功, URL:', videoUrl.substring(0, 80));
            await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

            try {
              // 下载并上传到 COS（灵芽视频 URL 约2小时有效）
              const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);

              // 保存到数据库
              if (userId) {
                try {
                  const client = getSupabaseClient(undefined, true);
                  await client.from('generation_records').insert({
                    user_id: userId,
                    prompt: prompt,
                    model: model,
                    aspect_ratio: aspectRatio,
                    videos: [cosResult.url],
                    source: 'video',
                    credits_charged: requiredCredits,
                    credits_balance: creditsBalanceAfterDeduct,
                    reference_images: uploadedUrls.length > 0 ? uploadedUrls : null,  // #757
                    reference_image_keys: (params.uploadedRefKeys && params.uploadedRefKeys.length > 0) ? params.uploadedRefKeys : null,  // #757
                    created_at: new Date().toISOString(),
                  });
                  console.log('[Lingya Veo3.1] 已保存到数据库');
                } catch (dbError) {
                  console.error('[Lingya Veo3.1] 保存到数据库失败:', dbError);
                }
              }

              await sendEvent({
                type: 'complete',
                videos: [cosResult.url],
                videoKeys: [cosResult.key],
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
              });
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [cosResult.url],
                videos: [cosResult.url],
                videoKeys: [cosResult.key],
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            } catch (uploadError) {
              // COS 上传失败，启动动态代理降级
              console.error('[Lingya Veo3.1] 上传视频失败，启动动态代理降级:', uploadError);
              const proxyUrl = wrapAsProxyUrl(videoUrl);
              const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
              await sendEvent({
                type: 'complete',
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
              });
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [proxyUrl],
                imageKeys: [fallbackVideoKey],
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            }

            controller.close();
            return;
          } else if (status === 'failed') {
            // ====== 任务失败 ======
            const failReason = pollData.error?.message || pollData.error || '视频生成失败';
            console.error('[Lingya Veo3.1] 任务失败:', failReason);
            let lvFailBalance = creditsBalanceAfterDeduct;
            if (userId && requiredCredits > 0) {
              const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `Lingya Veo3.1 任务失败: ${failReason}`);
              lvFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              console.log(`[积分返还监控] Lingya Veo3.1任务失败: requiredCredits=${requiredCredits}, newBalance=${lvFailBalance}`);
            }

            await sendEvent({ type: 'error', error: failReason, taskId: clientRequestId, creditsBalance: lvFailBalance ?? undefined });
            setTaskResult(clientRequestId, {
              status: 'failed',
              imageUrls: [],
              errors: [{ index: 0, error: failReason }],
              createdAt: Date.now(),
              completedAt: Date.now(),
            });
            controller.close();
            return;
          }

          // queued / processing → 继续轮询
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[Lingya Veo3.1] 生成异常:', error);
        let lvExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          try {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Veo3.1 生成异常');
            lvExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          } catch {}
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: lvExceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          creditsBalance: lvExceptBalance ?? undefined,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====================================================================
// #689 TOPAIS Veo3.1-fast 异步流程
// 官方文档：POST /v1/videos/generations 提交 → GET /v1/videos/generations/{id} 轮询
// 支持：文生视频、首尾帧生视频（1-2张）、参考生视频（1-3张）
// 重要：image_urls 仅支持 URL 格式（不支持 base64），需使用公开可访问的 URL
// 独立于 Lingya Veo3.1 和 T8 Veo，确保供应商数据配置独立性
// ====================================================================
interface TopaisVeoParams {
  model: string;            // topais-veo3.1-fast（前端入口，发送给 API 时用 veo3.1-fast）
  prompt: string;
  uploadedUrls: string[];   // 参考图 URL 数组（仅支持 URL，不支持 base64）
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;      // "16:9" 或 "9:16"
  duration: number;         // 固定8秒
  resolution: string;       // "720p" | "1080p" | "4k"
  baseEndpoint: string;     // https://toapis.com
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  hhMode?: string;  // #689 前端指定的模式: t2v/i2v/i2v-first-last-frame/r2v
}

async function handleTopaisVeoGeneration(params: TopaisVeoParams, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    duration,
    resolution,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
    clientRequestId,
    hhMode,  // #689 前端指定的模式
  } = params;

  // #7xx 修复：删除回退逻辑！参数缺失必须报错！
  if (!aspectRatio || aspectRatio === 'auto') {
    throw new Error('[TOPAIS-参数错误] aspectRatio 缺失或为 auto！必须传递有效比例！');
  }
  if (!duration) {
    throw new Error('[TOPAIS-参数错误] duration 缺失！必须传递！');
  }
  if (!resolution) {
    throw new Error('[TOPAIS-参数错误] resolution 缺失！必须传递！');
  }

  const safeAspectRatio = aspectRatio;
  const safeDuration = duration;
  const safeResolution = resolution;

  console.log('[TOPAIS] #689 实际参数: aspectRatio=' + safeAspectRatio + ', duration=' + safeDuration + ', resolution=' + safeResolution + ', hhMode=' + (hhMode || '空') + ', uploadedUrls=' + uploadedUrls.length);

  // ====== 构建 TOPAIS 请求体（对齐官方文档）======
  // model 字段：发送给 TOPAIS 的实际模型名（去掉 topais- 前缀）
  const actualModel = model.replace(/^topais-/, ''); // topais-veo3.1-fast → veo3.1-fast

  const requestBody: any = {
    model: actualModel,
    prompt,
    duration: safeDuration,
    aspect_ratio: safeAspectRatio,
  };

  // 图片处理：TOPAIS 仅支持 URL 格式（不支持 base64）
  // uploadedUrls 已是公开可访问的 URL（COS 签名 URL 或其他公开 URL）
  if (uploadedUrls.length > 0) {
    requestBody.image_urls = uploadedUrls;

    // #689 根据 hhMode 判断 generation_type（优先使用前端指定的模式）
    // TOPAIS Veo3.1-fast 模式映射：
    // - t2v (文生视频)：无图片，不传 generation_type
    // - i2v (首尾帧生视频)：1-2张图片，generation_type: 'frame'
    // - r2v (参考生视频)：1-3张图片，generation_type: 'reference'
    if (hhMode === 'i2v' || hhMode === 'i2v-first-last-frame') {
      // TOPAIS i2v = 首尾帧模式；其他模型的 i2v-first-last-frame 也是首尾帧
      requestBody.metadata = {
        ...requestBody.metadata,
        generation_type: 'frame',
      };
    } else if (hhMode === 'r2v') {
      // 参考图生视频模式：明确指定 reference
      requestBody.metadata = {
        ...requestBody.metadata,
        generation_type: 'reference',
      };
    } else if (!hhMode) {
      // 兜底：前端未指定模式时，根据图片数量自动判断
      // TOPAIS: 1-2张 → frame，3张 → reference
      if (uploadedUrls.length >= 1 && uploadedUrls.length <= 2) {
        requestBody.metadata = {
          ...requestBody.metadata,
          generation_type: 'frame',
        };
      } else if (uploadedUrls.length >= 3) {
        requestBody.metadata = {
          ...requestBody.metadata,
          generation_type: 'reference',
        };
      }
      // 0张图：不传 generation_type，文生视频
    }
    // t2v：不传 generation_type，文生视频
  }

  // metadata: resolution
  if (safeResolution && safeResolution !== '720p') {
    requestBody.metadata = {
      ...requestBody.metadata,
      resolution: safeResolution,
    };
  }

  console.log('[TOPAIS] #689 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));

  // ====== 创建流式响应 ======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    // #7xx 军师定海神针：移除 async 关键字，让 start 函数瞬间返回！
    // 流立刻就绪，HTTP 响应头立刻发送给前端，打通天路！
    start(controller) {
      // #722 sendEvent：强制 taskId 绑定 + 调试日志
      const sendEvent = async (data: any) => {
        // #722 致命修复：缓存 key 必须用 clientRequestId（前端轮询的 key），不是服务商 taskId！
        const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
        const safeTaskId = data.taskId || data.clientRequestId || clientRequestId;
        console.log('[TOPAIS-VEO sendEvent] type=', data.type, 'cacheTaskId=', cacheTaskId, 'progress=', data.progress);

        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：32KB 逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        await new Promise(r => setTimeout(r, 0));

        // #722 核心修复：用 cacheTaskId（优先 clientRequestId）写入缓存
        if (data.type === 'progress' && cacheTaskId && typeof data.progress === 'number') {
          setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          console.log('[TOPAIS-VEO sendEvent] CACHE_WRITE: cacheTaskId=', cacheTaskId, 'progress=', data.progress, 'status=', data.status || 'processing');
        } else if (data.type === 'progress') {
          console.error('[TOPAIS-VEO sendEvent] CACHE_WRITE_FAILED: cacheTaskId=', cacheTaskId, 'typeof progress=', typeof data.progress);
        }
        // 完成或失败时：保留进度缓存（10分钟自动过期），不立即删除
        if (data.type === 'complete' || data.type === 'error') {
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || data.type);
          }
        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model, taskId: clientRequestId });

        // ====== Step 1: 提交任务到 TOPAIS API ======
        const submitEndpoint = `${baseEndpoint}/v1/videos/generations`;
        console.log('[TOPAIS] 提交任务到:', submitEndpoint);

        const submitResponse = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[TOPAIS] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `TOPAIS API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          let tpSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS 提交任务失败');
            tpSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] TOPAIS提交失败: requiredCredits=${requiredCredits}, newBalance=${tpSubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: tpSubmitBalance ?? undefined });
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: errorMsg }],
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const topaisTaskId = submitData.id;

        if (!topaisTaskId) {
          let tpNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS 未获取到任务ID');
            tpNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: tpNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[TOPAIS] 任务已提交, topaisTaskId:', topaisTaskId);
        await registerVideoTask(clientRequestId, topaisTaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, pollUrl: `${baseEndpoint}/v1/videos/generations/${topaisTaskId}` });
        await sendEvent({ type: 'waiting', taskId: topaisTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/v1/videos/generations/${topaisTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟（36次 × 5秒），超时后返回 still_processing，离线 Cron 接管
        const pollInterval = 5000; // 每5秒轮询一次

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[TOPAIS] 轮询 #${pollCount}, topaisTaskId: ${topaisTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[TOPAIS] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();
            
            // ====== #7xx 军师照妖镜：完整打印服务商原始数据 ======
            console.log("====== [服务商原始轮询数据] ======", JSON.stringify(pollData));
            
            const status = pollData.status;
            
            // ====== #7xx 粉碎假进度：多层级向下兼容提取真实进度 ======
            // 禁止后端伪造进度！必须从服务商真实数据中提取
            let realProgress = pollData.progress 
              || pollData.data?.progress 
              || pollData.task?.progress 
              || pollData.metadata?.progress
              || pollData.result?.progress
              || 0;
            
            // 如果服务商给的是小数(比如 0.14)，转成百分比 14
            if (realProgress > 0 && realProgress < 1) {
              realProgress = Math.round(realProgress * 100);
            }
            
            // 诊断日志：进度提取结果
            console.log(`[TOPAIS] #7xx 进度提取: pollData.progress=${pollData.progress}, pollData.data?.progress=${pollData.data?.progress}, pollData.task?.progress=${pollData.task?.progress}, 最终realProgress=${realProgress}`);
            console.log(`[TOPAIS] 轮询结果: status=${status}, progress=${realProgress}, video_url=${pollData.video_url?.substring?.(0,80) || '无'}, video=${pollData.video?.substring?.(0,80) || '无'}, videos=${pollData.videos?.length || 0}个, metadata.url=${pollData.metadata?.url?.substring?.(0,80) || '无'}`);

            // ====== #7xx 透传真实进度，绝对不允许伪造 ======
            // #690 关键修复：progress=0 说明服务商没返回进度字段，不是"真实进度为0%"！
            // #710 关键修复：TOPAIS API (APIPod) 不返回 progress 字段，只有 status
            // 当 API 不返回真实进度时，基于轮询次数估算时间进度（好过前端假进度引擎的盲目动画）
            let finalProgress = realProgress;
            let progressSource = 'api'; // 'api' | 'estimated'
            if (finalProgress <= 0) {
              // 基于轮询次数的时间估算：每次轮询 5 秒
              // pollCount=1(5s)→7%, pollCount=5(25s)→15%, pollCount=10(50s)→30%, pollCount=20(100s)→55%, pollCount=30(150s)→80%
              finalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
              progressSource = 'estimated';
            }
            
            const progressEvent = {
              type: 'progress',
              progress: Math.min(finalProgress, 95), // 上限95%，留5%给上传阶段
              status: progressSource === 'estimated' ? 'processing' : (status || 'processing'),
              taskId: clientRequestId,  // #722 致命修复：必须用 clientRequestId（前端轮询的 key），不是 topaisTaskId！
              clientRequestId,
            };
            console.log(`[TOPAIS] 发送进度: ${progressEvent.progress}% (来源: ${progressSource}, 原始API: ${realProgress}%)`);
            await sendEvent(progressEvent);

            if (status === 'completed') {
              // ====== 任务完成 ======
              // #690 兼容多种视频字段名：result.data[0].url / video_url / video / videos[0] / metadata.url
              const metadataUrl = pollData.metadata?.url || (typeof pollData.metadata === 'string' ? null : null);
              const resultDataUrl = pollData.result?.data?.[0]?.url || null;
              const videoUrl = resultDataUrl || pollData.video_url || pollData.video || (pollData.videos && pollData.videos[0]) || metadataUrl || null;
              console.log('[TOPAIS] #690 视频URL提取:', { 'result.data[0].url': resultDataUrl, video_url: pollData.video_url, video: pollData.video, videos: pollData.videos, 'metadata.url': metadataUrl, 最终: videoUrl?.substring?.(0,80) || '无' });
              if (!videoUrl) {
                let tpNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS 任务完成但无视频URL');
                  tpNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                  console.log(`[积分返还监控] TOPAIS无视频URL: requiredCredits=${requiredCredits}, newBalance=${tpNoUrlBalance}`);
                }
                await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: tpNoUrlBalance ?? undefined });
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[TOPAIS] 视频生成成功, URL:', videoUrl.substring(0, 80));
              await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

              try {
                // 下载并上传到 COS（TOPAIS 视频链接有效期24小时）
                const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);

                // 保存到数据库
                if (userId) {
                  try {
                    const client = getSupabaseClient(undefined, true);
                    await client.from('generation_records').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      aspect_ratio: aspectRatio,
                      videos: [cosResult.url],
                      source: 'video',
                      credits_charged: requiredCredits,
                      credits_balance: creditsBalanceAfterDeduct,
                      reference_images: (params.uploadedUrls && params.uploadedUrls.length > 0) ? params.uploadedUrls : null,  // #757
                      reference_image_keys: (params.uploadedRefKeys && params.uploadedRefKeys.length > 0) ? params.uploadedRefKeys : null,  // #757
                      created_at: new Date().toISOString(),
                    });
                    console.log('[TOPAIS] 已保存到数据库');
                  } catch (dbError) {
                    console.error('[TOPAIS] 保存到数据库失败:', dbError);
                  }
                }

                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                console.log('[TOPAIS] #690 complete 事件已发送，关闭 SSE 流');
                controller.close();
                return;
              } catch (uploadError) {
                // COS 上传失败，启动动态代理降级
                console.error('[TOPAIS] 上传视频失败，启动动态代理降级:', uploadError);
                const proxyUrl = wrapAsProxyUrl(videoUrl);
                const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
              }

              controller.close();
              return;

            } else if (status === 'failed') {
              // ====== 任务失败 ======
              const failReason = pollData.error?.message || pollData.error || '视频生成失败';
              console.error('[TOPAIS] 任务失败:', failReason);

              let tpFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `TOPAIS 任务失败: ${failReason}`);
                tpFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                console.log(`[积分返还监控] TOPAIS任务失败: requiredCredits=${requiredCredits}, newBalance=${tpFailBalance}`);
              }

              // 判断是否违规内容
              const lowerReason = (failReason || '').toLowerCase();
              if (lowerReason.includes('moderation') || lowerReason.includes('safety') || lowerReason.includes('policy') || lowerReason.includes('inappropriate')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: topaisTaskId, clientRequestId,
                  creditsBalance: tpFailBalance ?? undefined,
                });
              }

              await sendEvent({ type: 'error', error: failReason, taskId: topaisTaskId, clientRequestId, creditsBalance: tpFailBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: failReason }],
                creditsBalance: tpFailBalance ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            // queued / in_progress / processing → 继续轮询

          } catch (pollErr) {
            console.error('[TOPAIS] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[TOPAIS] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[TOPAIS] 生成异常:', error);
        let tpExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          try {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'TOPAIS 生成异常');
            tpExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          } catch {}
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: tpExceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          creditsBalance: tpExceptBalance ?? undefined,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====================================================================
// #640 灵芽 Sora-2 VIP 异步流程：POST JSON 提交任务 → GET 轮询结果
// OpenAI 兼容格式，JSON 请求体（参考图 URL 数组，仅1张首帧）
// 固定时长由模型名决定：sora-2-all-vip-10s=10秒, sora-2-all-vip-15s=15秒
// ====================================================================
interface LingyaSora2Params {
  model: string;          // sora-2-all-vip-10s 或 sora-2-all-vip-15s
  prompt: string;
  uploadedUrls: string[]; // 参考图 URL 数组（仅1张首帧）
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;    // "16:9" 或 "9:16"
  duration: number;       // 固定10或15，由模型名决定
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
}

async function handleLingyaSora2Generation(params: LingyaSora2Params, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    duration,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
    clientRequestId,
  } = params;

  // #640 构建灵芽 Sora-2 VIP 请求体（JSON 格式，OpenAI 兼容）
  // #641 前端2合1：统一入口 sora-2-all-vip → 根据 duration 拼接实际模型名
  const actualModel = model === 'sora-2-all-vip'
    ? (duration === 15 ? 'sora-2-all-vip-15s' : 'sora-2-all-vip-10s')
    : model;

  const requestBody: any = {
    model: actualModel,
    prompt,
    duration,
    aspect_ratio: aspectRatio || '16:9',
  };

  // 参考图：仅支持1张首帧（官方文档 images 数组，仅支持一张图作为首帧）
  if (uploadedUrls.length > 0) {
    requestBody.images = uploadedUrls.slice(0, 1);  // 最多1张
  }

  console.log(`[Lingya Sora-2 VIP] 构建 JSON: model=${actualModel}, duration=${duration}, ratio=${aspectRatio}, images=${requestBody.images?.length || 0}`);

  // ====== 创建流式响应 ======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    // #7xx 军师定海神针：移除 async 关键字，让 start 函数瞬间返回！
    // 流立刻就绪，HTTP 响应头立刻发送给前端，打通天路！
    start(controller) {
      const sendEvent = async (data: any) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：1024 字节远远不够！Next.js TransformStream highWaterMark 默认 16KB
        // 32768 字节 (32KB) 才能逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层！
        // Next.js 内部 TransformStream highWaterMark=16KB + ServerResponse highWaterMark=16KB
        // 8KB 远不够，必须 32KB 才能确保每次 enqueue 都触发 TCP Flush
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
        await new Promise(r => setTimeout(r, 0));
        // 同步进度到内存缓存，供前端 GET 轮询获取（SSE 可能被 Next.js 缓冲）
        // 关键修复：强制使用闭包捕获的 clientRequestId 作为缓存 Key
        // 进度事件中的 data.clientRequestId 可能不存在，而 data.taskId 是服务商 ID（如 tsk_vid_xxx）
        // 前端 GET 轮询用的是 clientRequestId，两者 Key 不匹配会导致永远查不到进度！
        if (data.type === 'progress') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          }
        }
        // 完成或失败时清理进度缓存
        if (data.type === 'complete' || data.type === 'error') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          // #7xx+3 进度缓存延迟清理：保留进度让GET轮询能读取，10分钟后自动过期（见taskProgressCache.ts）
          // if (cacheTaskId) deleteTaskProgress(cacheTaskId);

        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model });

        // ====== Step 1: 提交任务到灵芽 API ======
        const submitEndpoint = `${baseEndpoint}/v1/videos`;
        console.log('[Lingya Sora-2 VIP] 提交任务到:', submitEndpoint);

        const submitResponse = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[Lingya Sora-2 VIP] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `Lingya Sora-2 VIP API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          let lsSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Sora-2 VIP 提交任务失败');
            lsSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] Lingya Sora-2 VIP提交失败: requiredCredits=${requiredCredits}, newBalance=${lsSubmitBalance}`);
          }
          // #730 修复：更新任务缓存状态为 failed
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: errorMsg }],
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: lsSubmitBalance ?? undefined });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const lingyaTaskId = submitData.id;

        if (!lingyaTaskId) {
          let lsNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Sora-2 VIP 未获取到任务ID');
            lsNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          // #730 修复：更新任务缓存状态为 failed
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: '未获取到任务ID，提交失败' }],
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: lsNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[Lingya Sora-2 VIP] 任务已提交, lingyaTaskId:', lingyaTaskId);
        await registerVideoTask(clientRequestId, lingyaTaskId, model, userId, prompt, requiredCredits, { resolution: undefined, aspect_ratio: aspectRatio, pollUrl: `${baseEndpoint}/v1/videos/${lingyaTaskId}` });
        await sendEvent({ type: 'waiting', taskId: lingyaTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/v1/videos/${lingyaTaskId}`;
        const maxPolls = 36;     // #852 短轮询窗口3分钟（36次 × 5秒），超时后返回 still_processing，离线 Cron 接管
        const pollInterval = 5000; // 每5秒轮询一次

        for (let pollCount = 1; pollCount <= maxPolls; pollCount++) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));

          console.log(`[Lingya Sora-2 VIP] 轮询 #${pollCount}, lingyaTaskId: ${lingyaTaskId}`);

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.error('[Lingya Sora-2 VIP] 轮询请求失败:', pollResponse.status);
              if (pollCount >= maxPolls) break;
              continue;
            }

            const pollData = await pollResponse.json();
            const status = pollData.status;
            // #710 进度估算：API 不返回 progress 时基于轮询次数估算
            let lsProgress = pollData.progress || 0;
            let lsSource = 'api';
            if (lsProgress <= 0) {
              lsProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
              lsSource = 'estimated';
            }

            console.log(`[Lingya Sora-2 VIP] 轮询结果: status=${status}, progress=${lsProgress}% (来源: ${lsSource})`);

            if (status === 'completed') {
              const videoUrl = pollData.video_url;
              if (!videoUrl) {
                let lsNoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Sora-2 VIP 任务完成但无视频URL');
                  lsNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                  console.log(`[积分返还监控] Lingya Sora-2 VIP无视频URL: requiredCredits=${requiredCredits}, newBalance=${lsNoUrlBalance}`);
                }
                await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: lsNoUrlBalance ?? undefined });
                controller.close();
                return;
              }

              // ====== 成功 ======
              await sendEvent({ type: 'progress', progress: 100, taskId: lingyaTaskId, clientRequestId });

              // 上传视频到 COS 并保存数据库
              let finalVideoUrl = videoUrl;
              try {
                const cosResult = await downloadAndUploadVideoToCOS(videoUrl, Date.now());
                if (cosResult?.url) {
                  finalVideoUrl = cosResult.url;
                  console.log('[Lingya Sora-2 VIP] 视频已上传COS:', finalVideoUrl.substring(0, 80));
                }
              } catch (uploadError) {
                console.error('[Lingya Sora-2 VIP] 上传视频失败，启动动态代理降级:', uploadError);
                try {
                  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
                  const host = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_SITE_URL || 'localhost:5000';
                  const proxyUrl = `${protocol}://${host}/api/video/proxy?url=${encodeURIComponent(videoUrl)}`;
                  finalVideoUrl = proxyUrl;
                  console.log('[Lingya Sora-2 VIP] 代理 URL:', proxyUrl);
                } catch {}
              }

              // 保存到数据库
              try {
                const supabase = getSupabaseClient(undefined, true);
                await supabase.from('video_generation_tasks').upsert({
                  task_id: lingyaTaskId,
                  user_id: userId || 'anonymous',
                  model,
                  prompt,
                  status: 'completed',
                  video_url: finalVideoUrl,
                  duration: pollData.seconds ? parseInt(pollData.seconds) : duration,
                  resolution: pollData.size || '',
                  aspect_ratio: aspectRatio,
                  credits_used: requiredCredits,
                  client_request_id: clientRequestId,
                  completed_at: new Date().toISOString(),
                }, { onConflict: 'task_id' });
                console.log('[Lingya Sora-2 VIP] 已保存到数据库');
              } catch (dbError) {
                console.error('[Lingya Sora-2 VIP] 保存到数据库失败:', dbError);
              }

              await sendEvent({
                type: 'complete',
                videoUrl: finalVideoUrl,
                taskId: lingyaTaskId,
                clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
              });
              controller.close();
              return;

            } else if (status === 'failed') {
              const failReason = pollData.error?.message || pollData.error || '任务失败';
              console.error('[Lingya Sora-2 VIP] 任务失败:', failReason);

              let lsFailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `Lingya Sora-2 VIP 任务失败: ${failReason}`);
                lsFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                console.log(`[积分返还监控] Lingya Sora-2 VIP任务失败: requiredCredits=${requiredCredits}, newBalance=${lsFailBalance}`);
              }

              // 判断是否违规内容
              const lowerReason = (failReason || '').toLowerCase();
              if (lowerReason.includes('content_policy') || lowerReason.includes('safety') || lowerReason.includes('inappropriate') || lowerReason.includes('violation')) {
                await sendEvent({ type: 'warning', error: '生成内容可能涉及违规，请修改提示词后重试', taskId: lingyaTaskId, clientRequestId,
                  creditsBalance: lsFailBalance ?? undefined,
                });
              }
              await sendEvent({ type: 'error', error: failReason, taskId: lingyaTaskId, clientRequestId, creditsBalance: lsFailBalance ?? undefined });
              controller.close();
              return;
            }

            // 仍在处理中，发送进度
            await sendEvent({ type: 'progress', progress: Math.min(lsProgress, 95), taskId: lingyaTaskId, clientRequestId });

          } catch (pollErr) {
            console.error('[Lingya Sora-2 VIP] 轮询异常:', pollErr);
            if (pollCount >= maxPolls) break;
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[Lingya Sora-2 VIP] 生成错误:', error);
        // #731 翻译错误消息
        const errorMsg = translateErrorMessage(error instanceof Error ? error.message : '生成失败');
        let lsExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Lingya Sora-2 VIP 异常错误');
          lsExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          console.log(`[积分返还监控] Lingya Sora-2 VIP异常错误: requiredCredits=${requiredCredits}, newBalance=${lsExceptBalance}`);
        }
        // #730 修复：更新任务缓存状态为 failed
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: errorMsg }],
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        await sendEvent({
          type: 'error',
          error: errorMsg,
          taskId: clientRequestId,
          creditsBalance: lsExceptBalance ?? undefined,
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====================================================================
// T8 Veo 异步流程：POST 提交任务 → GET 轮询结果
// ====================================================================
interface T8VeoParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;
  enhancePrompt: boolean;
  enableUpsample: boolean;
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;  // #549 扣除后余额
  clientRequestId: string;
}

async function handleT8VeoGeneration(params: T8VeoParams, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    enhancePrompt,
    enableUpsample,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
    clientRequestId,
  } = params;

  // ====== #681 参数防丢：使用安全值 ======
  // Veo 不支持 duration/resolution，只需确保 aspectRatio 正确
  const safeAspectRatio = aspectRatio || '16:9';

  if (!aspectRatio || aspectRatio === 'auto') {
    console.warn('[T8Veo-警告] #681 aspectRatio 缺失或为auto！使用默认值:', safeAspectRatio);
  }
  console.log('[T8Veo] #681 实际参数: aspectRatio=' + safeAspectRatio);

  // ====== 构建 T8 Veo 请求体 ======
  const requestBody: any = {
    model,
    prompt,
    enhance_prompt: enhancePrompt || false,
  };

  // #556 图片处理：COS URL 转 Base64，解决 T8 异步读取签名 URL 失败问题
  // #638 Veo 最多2张参考图（首帧+尾帧），后端兜底截断
  let finalUploadedUrls = uploadedUrls.slice(0, 2);
  if (finalUploadedUrls.length > 0) {
    console.log('[T8 Veo] #556 开始将参考图 URL 转为 Base64...');
    finalUploadedUrls = await convertImageUrlsToBase64(finalUploadedUrls);
    requestBody.images = finalUploadedUrls;
  }

  // 比例处理：#681 使用安全值
  // 有图片时：用户明确选了非auto比例才发，否则让 T8 自动匹配
  // 无图片时：始终发送比例
  if (uploadedUrls.length === 0) {
    requestBody.aspect_ratio = safeAspectRatio;
  } else if (safeAspectRatio !== 'auto') {
    // 有图片但用户明确选了比例，也传
    requestBody.aspect_ratio = safeAspectRatio;
  }

  // 1080P 提升：仅文生视频（无参考图）时可用
  if (enableUpsample && uploadedUrls.length === 0) {
    requestBody.enable_upsample = true;
  }

  console.log('[T8 Veo] #681 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));

  // ====== 创建流式响应 ======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    // #7xx 军师定海神针：移除 async 关键字，让 start 函数瞬间返回！
    start(controller) {
      const sendEvent = async (data: any) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：1024 字节远远不够！Next.js TransformStream highWaterMark 默认 16KB
        // 32768 字节 (32KB) 才能逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层！
        // Next.js 内部 TransformStream highWaterMark=16KB + ServerResponse highWaterMark=16KB
        // 8KB 远不够，必须 32KB 才能确保每次 enqueue 都触发 TCP Flush
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
        await new Promise(r => setTimeout(r, 0));
        // 同步进度到内存缓存，供前端 GET 轮询获取（SSE 可能被 Next.js 缓冲）
        // 关键修复：强制使用闭包捕获的 clientRequestId 作为缓存 Key
        // 进度事件中的 data.clientRequestId 可能不存在，而 data.taskId 是服务商 ID（如 tsk_vid_xxx）
        // 前端 GET 轮询用的是 clientRequestId，两者 Key 不匹配会导致永远查不到进度！
        if (data.type === 'progress') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          }
        }
        // 完成或失败时清理进度缓存
        if (data.type === 'complete' || data.type === 'error') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          // #7xx+3 进度缓存延迟清理：保留进度让GET轮询能读取，10分钟后自动过期（见taskProgressCache.ts）
          // if (cacheTaskId) deleteTaskProgress(cacheTaskId);

        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model });

        // ====== Step 1: 提交任务 ======
        console.log('[T8 Veo] 提交任务到:', baseEndpoint);
        // #680 完整请求体日志
        console.log('[T8 Veo] 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));
        const submitResponse = await fetch(baseEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[T8 Veo] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `T8 API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            // 解析 upstream_message（T8 API 的上游错误详情）
            if (errorData.upstream_message) {
              try {
                const upstream = JSON.parse(errorData.upstream_message);
                errorMsg = `上游错误: ${upstream.msg || upstream.message || errorData.upstream_message} (code: ${upstream.code || 'unknown'})`;
              } catch {
                errorMsg = `上游错误: ${errorData.upstream_message}`;
              }
            } else {
              errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
            }
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          // 积分退还
          let veSubmitErrorBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Veo 提交任务失败');
            veSubmitErrorBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] #549 Veo提交失败: requiredCredits=${requiredCredits}, newBalance=${veSubmitErrorBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: veSubmitErrorBalance ?? undefined });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const t8TaskId = submitData.task_id;

        if (!t8TaskId) {
          // 积分退还
          let veNoTaskIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Veo 未获取到任务ID');
            veNoTaskIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] #549 Veo无taskId: requiredCredits=${requiredCredits}, newBalance=${veNoTaskIdBalance}`);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: veNoTaskIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[T8 Veo] 任务已提交, t8TaskId:', t8TaskId);
        await registerVideoTask(clientRequestId, t8TaskId, model, userId, prompt, requiredCredits, { resolution: undefined, aspect_ratio: aspectRatio, pollUrl: `${baseEndpoint}/${t8TaskId}` });
        await sendEvent({ type: 'waiting', taskId: t8TaskId, clientRequestId: clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/${t8TaskId}`;
        const maxPolls = 36; // #852 短轮询窗口3分钟，超时后 still_processing，离线 Cron 接管
        const pollInterval = 5000; // 每5秒轮询一次
        let pollCount = 0;

        while (pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          console.log(`[T8 Veo] 轮询 #${pollCount}, t8TaskId: ${t8TaskId}`);

          const pollResponse = await fetch(pollEndpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (!pollResponse.ok) {
            console.error('[T8 Veo] 轮询请求失败:', pollResponse.status);
            // 轮询请求失败不直接终止，继续尝试
            continue;
          }

          const pollData = await pollResponse.json();
          const status = pollData.status;
          console.log(`[T8 Veo] 轮询结果: status=${status}, data:`, JSON.stringify(pollData).substring(0, 200));

          // #710 进度估算：T8 API 不返回 progress 时基于轮询次数估算
          const t8RealProgress = pollData.progress;
          let t8FinalProgress = 0;
          let t8ProgressSource = 'api';
          if (t8RealProgress !== undefined && t8RealProgress !== null) {
            const progressNum = typeof t8RealProgress === 'string' ? parseInt(t8RealProgress) : t8RealProgress;
            if (!isNaN(progressNum) && progressNum > 0) {
              t8FinalProgress = progressNum;
            }
          }
          if (t8FinalProgress <= 0) {
            t8FinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
            t8ProgressSource = 'estimated';
          }
          console.log(`[T8 Veo] 发送进度: ${t8FinalProgress}% (来源: ${t8ProgressSource})`);
          await sendEvent({
            type: 'progress',
            progress: Math.min(t8FinalProgress, 95),
            status: 'processing',
            taskId: t8TaskId,
            clientRequestId: clientRequestId,
          });

          if (status === 'SUCCESS') {
            // ====== 任务完成 ======
            const videoUrl = pollData.data?.output;
            if (!videoUrl) {
              // #549 成功但无视频地址，需返还积分
              let veNoUrlBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Veo 成功但无视频地址');
                veNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                console.log(`[积分返还监控] #549 Veo无视频地址: requiredCredits=${requiredCredits}, newBalance=${veNoUrlBalance}`);
              }
              await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: veNoUrlBalance ?? undefined });
              // #543 更新任务缓存
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            console.log('[T8 Veo] 视频生成成功, URL:', videoUrl.substring(0, 80));
            await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

            try {
              // 下载并上传到 COS
              const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);

              // 保存到数据库
              if (userId) {
                try {
                  const client = getSupabaseClient(undefined, true);
                  await client.from('generation_records').insert({
                    user_id: userId,
                    prompt: prompt,
                    model: model,
                    aspect_ratio: aspectRatio,
                    videos: [cosResult.url],
                    source: 'video',
                    credits_charged: requiredCredits,
                    credits_balance: creditsBalanceAfterDeduct,
                    reference_images: uploadedUrls.length > 0 ? uploadedUrls : null,  // #757
                    reference_image_keys: (uploadedRefKeys && uploadedRefKeys.length > 0) ? uploadedRefKeys : null,  // #757
                    created_at: new Date().toISOString(),
                  });
                  console.log('[T8 Veo] 已保存到数据库');
                } catch (dbError) {
                  console.error('[T8 Veo] 保存到数据库失败:', dbError);
                }
              }

              await sendEvent({ 
                type: 'complete', 
                videos: [cosResult.url],
                videoKeys: [cosResult.key],  // #616 传递视频 COS key
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549 完成事件携带积分余额
              });
              // #543 更新任务缓存
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [cosResult.url],
                videos: [cosResult.url],  // #637 存储视频URL
                videoKeys: [cosResult.key],  // #637 存储视频Key
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            } catch (uploadError) {
              console.error('[T8 Veo] 上传视频失败，启动动态代理降级:', uploadError);
              // #555 使用代理 URL 抹平 CORS 跨域与防盗链
              const proxyUrl = wrapAsProxyUrl(videoUrl);
              console.log('[T8 Veo] 代理 URL:', proxyUrl);
              // #618 修复：保留完整 URL，绝不截断！（截断会导致带 Token 的签名链接报废）
              const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
              await sendEvent({ 
                type: 'complete', 
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],  // #617 降级时也传递 key（代理模式）
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
              });
              // #543 更新任务缓存
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [proxyUrl],
                imageKeys: [fallbackVideoKey],  // #617 缓存 key
                videos: [proxyUrl],  // #637 存储视频URL
                videoKeys: [fallbackVideoKey],  // #637 存储视频Key
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            }

            controller.close();
            return;
          } else if (status === 'FAILURE') {
            // ====== 任务失败 ======
            const failReason = pollData.fail_reason || pollData.message || '视频生成失败';
            console.error('[T8 Veo] 任务失败:', failReason);
            // 积分退还
            let veFailBalance = creditsBalanceAfterDeduct;
            if (userId && requiredCredits > 0) {
              const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `T8 Veo 任务失败: ${failReason}`);
              veFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              console.log(`[积分返还监控] #549 Veo任务失败: requiredCredits=${requiredCredits}, newBalance=${veFailBalance}`);
            }
            await sendEvent({ type: 'error', error: failReason, taskId: clientRequestId, creditsBalance: veFailBalance ?? undefined });
            // #543 更新任务缓存
            setTaskResult(clientRequestId, {
              status: 'failed',
              imageUrls: [],
              errors: [{ index: 0, error: failReason }],
              creditsBalance: veFailBalance ?? undefined,  // #549
              createdAt: Date.now(),
              completedAt: Date.now(),
            });
            controller.close();
            return;
          }

          // NOT_START / IN_PROGRESS → 继续轮询
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[T8 Veo] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });

      } catch (error) {
        console.error('[T8 Veo] 生成错误:', error);
        // 积分退还
        let veExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Veo 异常错误');
          veExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          console.log(`[积分返还监控] #549 Veo异常错误: requiredCredits=${requiredCredits}, newBalance=${veExceptBalance}`);
        }
        await sendEvent({ 
          type: 'error', 
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: veExceptBalance ?? undefined,
        });
        // #543 更新任务缓存
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ======================================================================
// #633 HappyHorse 1.0 视频生成（灵芽 API）
// 支持：文生视频(t2v) / 图生视频(i2v) / 参考生视频(r2v) / 视频编辑(video-edit)
// 异步轮询架构：POST 创建任务 → GET 轮询状态 → 下载视频上传 COS
// ======================================================================

interface HappyHorseParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;
  duration: number;
  resolution: string;
  firstFrameUrl?: string;
  referenceImageUrls?: string[];
  videoUrl?: string;
  audioSetting?: 'auto' | 'origin';
  hhMode?: string;  // 前端指定的模式: t2v/i2v/r2v/video-edit
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
}

/**
 * 根据输入素材判断 HappyHorse 实际模型
 * 优先级：videoUrl → video-edit, referenceImageUrls → r2v, firstFrameUrl → i2v, 纯文本 → t2v
 */
function determineHappyHorseModel(params: HappyHorseParams): string {
  // 前端显式指定模式时直接使用
  if (params.hhMode) {
    const modeMap: Record<string, string> = {
      't2v': 'happyhorse-1.0-t2v',
      'i2v': 'happyhorse-1.0-i2v',
      'r2v': 'happyhorse-1.0-r2v',
      'video-edit': 'happyhorse-1.0-video-edit',
    };
    return modeMap[params.hhMode] || params.hhMode;
  }

  // 自动推断：按"槽位"判断，不按数量
  if (params.videoUrl) {
    return 'happyhorse-1.0-video-edit';
  }
  if (params.referenceImageUrls && params.referenceImageUrls.length > 0) {
    return 'happyhorse-1.0-r2v';
  }
  if (params.firstFrameUrl) {
    return 'happyhorse-1.0-i2v';
  }
  // 兼容：uploadedUrls 有数据时走 i2v
  if (params.uploadedUrls.length > 0) {
    return 'happyhorse-1.0-i2v';
  }
  return 'happyhorse-1.0-t2v';
}

/**
 * 构建 HappyHorse API 请求体
 */
function buildHappyHorseRequestBody(
  actualModel: string,
  params: HappyHorseParams
): object {
  // #7xx 修复：删除回退逻辑！参数缺失必须报错！
  if (!params.resolution) {
    throw new Error('[HappyHorse-参数错误] resolution 缺失！必须传递！');
  }
  if (!params.aspectRatio) {
    throw new Error('[HappyHorse-参数错误] aspectRatio 缺失！必须传递！');
  }
  if (params.duration === undefined || params.duration === null) {
    throw new Error('[HappyHorse-参数错误] duration 缺失！必须传递！');
  }

  const safeResolution = params.resolution;
  const safeAspectRatio = params.aspectRatio;
  const safeDuration = params.duration;

  console.log('[HappyHorse] #681 实际参数: resolution=' + safeResolution + ', aspectRatio=' + safeAspectRatio + ', duration=' + safeDuration);

  // #7xx 终极降维令：摧毁 input 对象外壳！
  // 灵芽 API 网关拒收以对象形式存在的 input 字段，media 随之被静默丢弃！
  // prompt 和 media 必须直接放在最外层（Root Level），众生平等！
  const body: any = {
    model: actualModel,
    prompt: params.prompt,
    // 所有参数全部在最外层，绝对不能嵌套！
    resolution: safeResolution.toUpperCase().replace('P', 'P'),
    watermark: false,
  };

  // 确保 resolution 格式正确（720P / 1080P）
  if (body.resolution === '1080P' || body.resolution === '720P') {
    // ok
  } else {
    body.resolution = '1080P';
  }

  switch (actualModel) {
    case 'happyhorse-1.0-t2v':
      body.ratio = safeAspectRatio;
      body.duration = safeDuration;
      break;

    case 'happyhorse-1.0-i2v':
      body.duration = safeDuration;
      // 图生视频：首帧图片
      const firstFrameSrc = params.firstFrameUrl || params.uploadedUrls[0];
      if (firstFrameSrc) {
        body.media = [{
          type: 'first_frame',
          url: firstFrameSrc,
        }];
      }
      break;

    case 'happyhorse-1.0-r2v':
      body.ratio = safeAspectRatio;
      body.duration = safeDuration;
      // #639 参考生视频：多张参考图，最多9张（官方文档）
      const refUrlsRaw = params.referenceImageUrls && params.referenceImageUrls.length > 0
        ? params.referenceImageUrls
        : params.uploadedUrls;
      const refUrls = refUrlsRaw.slice(0, 9);
      if (refUrls.length > 0) {
        body.media = refUrls.map((url: string) => ({
          type: 'reference_image',
          url,
        }));
      }
      break;

    case 'happyhorse-1.0-video-edit':
      // 视频编辑：必传视频
      if (params.videoUrl) {
        body.media = [{ type: 'video', url: params.videoUrl }];
        // #639 可选参考图，最多5张（官方文档）
        if (params.referenceImageUrls && params.referenceImageUrls.length > 0) {
          const limitedRefUrls = params.referenceImageUrls.slice(0, 5);
          body.media.push(
            ...limitedRefUrls.map((url: string) => ({
              type: 'reference_image',
              url,
            }))
          );
        }
      }
      if (params.audioSetting) {
        body.audio_setting = params.audioSetting;
      }
      // 注意：video-edit 不支持 duration 和 ratio
      delete body.duration;
      delete body.ratio;
      break;
  }

  return body;
}

async function handleHappyHorseGeneration(params: HappyHorseParams, req: NextRequest): Promise<Response> {
  const {
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    duration,
    resolution,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
  } = params;
  const clientRequestId = params.clientRequestId || `hh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ====== 判断实际模型 ======
  const actualModel = determineHappyHorseModel(params);
  console.log(`[HappyHorse] 判断模型: ${actualModel}, prompt长度: ${prompt?.length || 0}`);

  // ====== 参数校验 ======
  const promptRequired = actualModel !== 'happyhorse-1.0-i2v';
  if (promptRequired && !prompt?.trim()) {
    let hhNoPromptBalance = creditsBalanceAfterDeduct;
    if (userId && requiredCredits > 0) {
      const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'HappyHorse 提示词为空');
      hhNoPromptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
    }
    return new Response(JSON.stringify({
      error: '此模式下提示词为必填项',
      creditsBalance: hhNoPromptBalance ?? undefined,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // ====== 构建请求体 ======
  const requestBody = buildHappyHorseRequestBody(actualModel, params);
  console.log('[HappyHorse] 请求体构建完成, model:', actualModel, ', media数量:', (requestBody as any).input?.media?.length || 0);

  // ====== 创建流式响应（复用 Seedance 轮询架构）======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    // #7xx 军师定海神针：移除 async 关键字，让 start 函数瞬间返回！
    start(controller) {
      const sendEvent = async (data: any) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：1024 字节远远不够！Next.js TransformStream highWaterMark 默认 16KB
        // 32768 字节 (32KB) 才能逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层！
        // Next.js 内部 TransformStream highWaterMark=16KB + ServerResponse highWaterMark=16KB
        // 8KB 远不够，必须 32KB 才能确保每次 enqueue 都触发 TCP Flush
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
        await new Promise(r => setTimeout(r, 0));
        // 同步进度到内存缓存，供前端 GET 轮询获取（SSE 可能被 Next.js 缓冲）
        // 关键修复：强制使用闭包捕获的 clientRequestId 作为缓存 Key
        // 进度事件中的 data.clientRequestId 可能不存在，而 data.taskId 是服务商 ID（如 tsk_vid_xxx）
        // 前端 GET 轮询用的是 clientRequestId，两者 Key 不匹配会导致永远查不到进度！
        if (data.type === 'progress') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          }
        }
        // 完成或失败时清理进度缓存
        if (data.type === 'complete' || data.type === 'error') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          // #7xx+3 进度缓存延迟清理：保留进度让GET轮询能读取，10分钟后自动过期（见taskProgressCache.ts）
          // if (cacheTaskId) deleteTaskProgress(cacheTaskId);

        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model: actualModel });

        // ====== Step 1: 提交任务到灵芽 API ======
        const submitEndpoint = `${baseEndpoint}/v1/videos`;
        console.log('[HappyHorse] 提交任务到:', submitEndpoint);
        // #680 完整请求体日志：记录实际发给服务商的所有参数
        console.log('[HappyHorse] 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));

        const submitResponse = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[HappyHorse] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `HappyHorse API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            errorMsg = errorData.message || errorData.error?.message || errorData.error || errorMsg;
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          let hhSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'HappyHorse 提交任务失败');
            hhSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] HappyHorse提交失败: requiredCredits=${requiredCredits}, newBalance=${hhSubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: hhSubmitBalance ?? undefined });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const lingyaTaskId = submitData.id;

        if (!lingyaTaskId) {
          let hhNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'HappyHorse 未获取到任务ID');
            hhNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: hhNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[HappyHorse] 任务已提交, lingyaTaskId:', lingyaTaskId);
        await registerVideoTask(clientRequestId, lingyaTaskId, actualModel, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/v1/videos/${lingyaTaskId}` });
        await sendEvent({ type: 'waiting', taskId: lingyaTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/v1/videos/${lingyaTaskId}`;
        const maxPolls = 12;  // #852 短轮询窗口3分钟（12次 × 15秒），超时后 still_processing，离线 Cron 接管
        const pollInterval = 15000;  // 官方建议 15 秒
        let pollCount = 0;

        while (pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          console.log(`[HappyHorse] 轮询 #${pollCount}, lingyaTaskId: ${lingyaTaskId}`);

          const pollResponse = await fetch(pollEndpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (!pollResponse.ok) {
            console.error('[HappyHorse] 轮询请求失败:', pollResponse.status);
            continue;
          }

          const pollData = await pollResponse.json();
          
          // ====== #7xx 军师照妖镜：完整打印服务商原始数据 ======
          console.log("====== [HappyHorse 服务商原始轮询数据] ======", JSON.stringify(pollData));
          
          const status = pollData.status;

          // ====== #7xx 粉碎假进度：多层级向下兼容提取真实进度 ======
          let realProgress = pollData.progress 
            || pollData.data?.progress 
            || pollData.task?.progress 
            || pollData.metadata?.progress
            || pollData.result?.progress
            || 0;
          
          // 处理字符串格式的进度（如 "50%"）
          if (typeof realProgress === 'string') {
            realProgress = parseInt(realProgress.replace('%', ''), 10) || 0;
          }
          
          // 如果服务商给的是小数，转成百分比
          if (realProgress > 0 && realProgress < 1) {
            realProgress = Math.round(realProgress * 100);
          }
          
          console.log(`[HappyHorse] #7xx 进度提取: pollData.progress=${pollData.progress}, 最终realProgress=${realProgress}`);
          console.log(`[HappyHorse] 轮询结果: status=${status}, progress=${realProgress}%`);

          // ====== #7xx 透传真实进度 ======
          // #710 关键修复：API 不返回 progress 字段时，基于轮询次数估算
          let hhDirectFinalProgress = realProgress;
          let hhDirectProgressSource = 'api';
          if (hhDirectFinalProgress <= 0) {
            hhDirectFinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
            hhDirectProgressSource = 'estimated';
          }
          console.log(`[HappyHorse] 发送进度: ${hhDirectFinalProgress}% (来源: ${hhDirectProgressSource}, 原始API: ${realProgress}%)`);
          await sendEvent({
            type: 'progress',
            progress: Math.min(hhDirectFinalProgress, 95),
            status: status || 'processing',
            taskId: lingyaTaskId,
            clientRequestId,
          });

          if (status === 'completed') {
            // ====== 任务完成 ======
            const videoUrl = pollData.video_url;
            if (!videoUrl) {
              let hhNoUrlBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'HappyHorse 任务完成但无视频URL');
                hhNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }
              await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: hhNoUrlBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            console.log('[HappyHorse] 视频生成成功, URL:', videoUrl.substring(0, 80));
            await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

            try {
              // 下载并上传到 COS（视频 URL 仅 24 小时有效）
              const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);

              // 保存到数据库
              if (userId) {
                try {
                  const client = getSupabaseClient(undefined, true);
                  await client.from('generation_records').insert({
                    user_id: userId,
                    prompt: prompt,
                    model: actualModel,
                    aspect_ratio: aspectRatio,
                    videos: [cosResult.url],
                    source: 'video',
                    credits_charged: requiredCredits,
                    credits_balance: creditsBalanceAfterDeduct,
                    reference_images: uploadedUrls.length > 0 ? uploadedUrls : null,  // #757
                    reference_image_keys: (uploadedRefKeys && uploadedRefKeys.length > 0) ? uploadedRefKeys : null,  // #757
                    created_at: new Date().toISOString(),
                  });
                  console.log('[HappyHorse] 已保存到数据库');
                } catch (dbError) {
                  console.error('[HappyHorse] 保存到数据库失败:', dbError);
                }
              }

              await sendEvent({
                type: 'complete',
                videos: [cosResult.url],
                videoKeys: [cosResult.key],
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
              });
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [cosResult.url],
                videos: [cosResult.url],  // #637 存储视频URL
                videoKeys: [cosResult.key],  // #637 存储视频Key
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            } catch (uploadError) {
              console.error('[HappyHorse] 上传视频失败，启动动态代理降级:', uploadError);
              const proxyUrl = wrapAsProxyUrl(videoUrl);
              const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
              await sendEvent({
                type: 'complete',
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
              });
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [proxyUrl],
                imageKeys: [fallbackVideoKey],
                videos: [proxyUrl],  // #637 存储视频URL
                videoKeys: [fallbackVideoKey],  // #637 存储视频Key
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            }

            controller.close();
            return;
          } else if (status === 'failed') {
            // ====== 任务失败 ======
            const failReason = '视频生成失败';
            console.error('[HappyHorse] 任务失败:', failReason);
            let hhFailBalance = creditsBalanceAfterDeduct;
            if (userId && requiredCredits > 0) {
              const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `HappyHorse 任务失败: ${failReason}`);
              hhFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              console.log(`[积分返还监控] HappyHorse任务失败: requiredCredits=${requiredCredits}, newBalance=${hhFailBalance}`);
            }

            await sendEvent({ type: 'error', error: failReason, taskId: clientRequestId, creditsBalance: hhFailBalance ?? undefined });
            setTaskResult(clientRequestId, {
              status: 'failed',
              imageUrls: [],
              errors: [{ index: 0, error: failReason }],
              createdAt: Date.now(),
              completedAt: Date.now(),
            });
            controller.close();
            return;
          }

          // queued / processing → 继续轮询
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[HappyHorse] 生成异常:', error);
        let hhExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          try {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'HappyHorse 生成异常');
            hhExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          } catch {}
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: hhExceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          creditsBalance: hhExceptBalance ?? undefined,
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====== Seedance 2.0 (Lingya API) 支持 ======

// 模型 ID 映射：前端简写 → 灵芽官方 ID
const SEEDANCE2_REAL_ID_MAP: Record<string, string> = {
  'seedance-2': 'doubao-seedance-2-0-260128',
  'seedance-2-fast': 'doubao-seedance-2-0-fast-260128',
};

// Seedance 2.0 积分计算（含视频折扣）
const SEEDANCE2_PRICING: Record<string, Record<string, number>> = {
  'seedance-2': { '480p': 0.581, '720p': 1.25, '1080p': 3.116 },
  'seedance-2-fast': { '480p': 0.442, '720p': 0.95 },
};
const SEEDANCE2_VIDEO_DISCOUNT: Record<string, number> = {
  'seedance-2': 0.609,
  'seedance-2-fast': 0.595,
};

function getSeedance2Credits(
  model: string,
  resolution: string,
  duration: number,
  hasVideoInput: boolean
): number {
  // #7xx 修复：统一转换为小写，避免 480P（大写）找不到定价表 480p（小写）
  const normalizedResolution = resolution.toLowerCase();
  const basePrice = SEEDANCE2_PRICING[model]?.[normalizedResolution] || 0;
  const discount = hasVideoInput ? (SEEDANCE2_VIDEO_DISCOUNT[model] || 1) : 1;
  // ⚠️ 关键：SEEDANCE2_PRICING 存储的是人民币元，必须乘以 100 转换为积分（1积分=0.01元）
  console.log(`[getSeedance2Credits] model=${model}, resolution=${resolution}→${normalizedResolution}, duration=${duration}, basePrice=${basePrice}, credits=${Math.ceil(basePrice * 100 * duration * discount)}`);
  return Math.ceil(basePrice * 100 * duration * discount);
}

// Seedance 2.0 content 数组构建（根据前端明确字段，不推断）
interface Seedance2ContentParams {
  prompt: string;
  mode: string; // 't2v' | 'i2v-first-frame' | 'i2v-first-last-frame' | 'r2v'
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}

function buildSeedance2Content(params: Seedance2ContentParams): any[] {
  const content: any[] = [];

  // 文本
  if (params.prompt) {
    content.push({ type: 'text', text: params.prompt });
  }

  // 根据模式添加图片（role 明确指定，绝不按数量推断）
  if (params.mode === 'i2v-first-frame' && params.firstFrameUrl) {
    content.push({
      type: 'image_url',
      image_url: { url: params.firstFrameUrl },
      role: 'first_frame',
    });
  } else if (params.mode === 'i2v-first-last-frame') {
    if (params.firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: params.firstFrameUrl },
        role: 'first_frame',
      });
    }
    if (params.lastFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: params.lastFrameUrl },
        role: 'last_frame',
      });
    }
  } else if (params.mode === 'r2v' && params.referenceImageUrls?.length) {
    params.referenceImageUrls.forEach(url => {
      content.push({
        type: 'image_url',
        image_url: { url },
        role: 'reference_image',
      });
    });
  }

  // 参考视频（非 t2v 模式）
  if (params.mode !== 't2v' && params.referenceVideoUrls?.length) {
    params.referenceVideoUrls.forEach(url => {
      content.push({
        type: 'video_url',
        video_url: { url },
        role: 'reference_video',
      });
    });
  }

  // 参考音频（非 t2v 模式）
  if (params.referenceAudioUrls?.length) {
    params.referenceAudioUrls.forEach(url => {
      content.push({
        type: 'audio_url',
        audio_url: { url },
        role: 'reference_audio',
      });
    });
  }

  return content;
}

async function handleSeedance2Generation(params: any, req: NextRequest): Promise<Response> {
  // #681 修复：第一时间打印收到的全部参数，绝不漏掉
  console.log('[Seedance2.0-入参] ========== handleSeedance2Generation 收到的参数 ==========');
  console.log('[Seedance2.0-入参] prompt:', params.prompt?.substring(0, 50));
  console.log('[Seedance2.0-入参] model:', params.model);
  console.log('[Seedance2.0-入参] resolution:', params.resolution, '(类型:', typeof params.resolution, ')');
  console.log('[Seedance2.0-入参] duration:', params.duration, '(类型:', typeof params.duration, ')');
  console.log('[Seedance2.0-入参] aspectRatio:', params.aspectRatio, '(类型:', typeof params.aspectRatio, ')');
  console.log('[Seedance2.0-入参] sd2Mode:', params.sd2Mode);
  console.log('[Seedance2.0-入参] ratio(别名):', params.ratio);
  console.log('[Seedance2.0-入参] ==========================================');

  const {
    prompt,
    model,
    resolution,
    duration,
    aspectRatio,
    mode: sd2ModeParam,
    sd2Mode,
    firstFrameUrl,
    lastFrameUrl,
    referenceImageUrls,
    referenceVideoUrls,
    referenceAudioUrls,
    generateAudio,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
  } = params;

  // #7xx 修复：删除回退逻辑！参数缺失必须报错！
  if (!aspectRatio && !params.ratio) {
    throw new Error('[Seedance2.0-参数错误] aspectRatio 和 ratio 均缺失！必须传递！');
  }
  if (duration === undefined || duration === null) {
    throw new Error('[Seedance2.0-参数错误] duration 缺失！必须传递！');
  }
  if (!resolution) {
    throw new Error('[Seedance2.0-参数错误] resolution 缺失！必须传递！');
  }

  const safeAspectRatio = aspectRatio || params.ratio;
  const safeDuration = duration;
  const safeResolution = resolution;

  const mode = sd2Mode || sd2ModeParam || 't2v';
  const clientRequestId = params.clientRequestId || `sd2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ====== 铁律1：封杀 duration < 4 ======
  // #681 修复：使用 safeDuration 替代 duration，防止参数丢失后误判
  if (!safeDuration || safeDuration < 4 || safeDuration > 15) {
    let sd2InvalidDurBalance = creditsBalanceAfterDeduct;
    if (userId && requiredCredits > 0) {
      const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 duration无效');
      sd2InvalidDurBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
    }
    return new Response(JSON.stringify({
      error: '时长必须在4-15秒之间',
      creditsBalance: sd2InvalidDurBalance ?? undefined,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // ====== 铁律3：i2v-first-last-frame 必须同时有首帧和尾帧 ======
  if (mode === 'i2v-first-last-frame') {
    if (!firstFrameUrl || !lastFrameUrl) {
      let sd2NoFramesBalance = creditsBalanceAfterDeduct;
      if (userId && requiredCredits > 0) {
        const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 首尾帧缺失');
        sd2NoFramesBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
      }
      return new Response(JSON.stringify({
        error: '首尾帧模式必须同时上传首帧和尾帧图片',
        creditsBalance: sd2NoFramesBalance ?? undefined,
      }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // ====== 音频依赖强校验：音频必须搭配图片或视频 ======
  const hasAudio = referenceAudioUrls && referenceAudioUrls.length > 0;
  const hasImageOrVideo = (firstFrameUrl || lastFrameUrl || (referenceImageUrls && referenceImageUrls.length > 0) || (referenceVideoUrls && referenceVideoUrls.length > 0));
  if (hasAudio && !hasImageOrVideo) {
    let sd2NoImgVidBalance = creditsBalanceAfterDeduct;
    if (userId && requiredCredits > 0) {
      const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 音频无图视');
      sd2NoImgVidBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
    }
    return new Response(JSON.stringify({
      error: '参考音频必须搭配至少1张图片或1段视频',
      creditsBalance: sd2NoImgVidBalance ?? undefined,
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // ====== 铁律2：模型 ID 映射 ======
  const realModelId = SEEDANCE2_REAL_ID_MAP[model] || model;
  console.log(`[Seedance 2.0] 模型映射: ${model} → ${realModelId}`);

  // ====== 构建灵芽 /v1/videos 请求体 ======
  // #686 修复：Seedance 2.0 必须走灵芽 /v1/videos 端点（非火山方舟原生 /api/v3 端点）
  // #7xx 军师修正令：恢复原始简化格式！Lingya 封装的 input: { media: [...] } 不兼容 OpenAI 格式！
  const media: any[] = [];

  // 根据模式添加 media（使用简化格式，Lingya API 兼容）
  if (mode === 'i2v-first-frame' && firstFrameUrl) {
    media.push({ type: 'first_frame', url: firstFrameUrl });
  } else if (mode === 'i2v-first-last-frame') {
    if (firstFrameUrl) media.push({ type: 'first_frame', url: firstFrameUrl });
    if (lastFrameUrl) media.push({ type: 'last_frame', url: lastFrameUrl });
  } else if (mode === 'r2v' && referenceImageUrls?.length) {
    referenceImageUrls.forEach((url: string) => media.push({ type: 'reference_image', url }));
  }

  // 参考视频（使用简化格式）
  if (mode !== 't2v' && referenceVideoUrls?.length) {
    referenceVideoUrls.forEach((url: string) => media.push({ type: 'video', url }));
  }

  // 参考音频（使用简化格式）
  if (referenceAudioUrls?.length) {
    referenceAudioUrls.forEach((url: string) => media.push({ type: 'audio', url }));
  }

  // #680 修复：灵芽API要求 resolution 大写（如 480P, 720P, 1080P）
  // #681 修复：使用 safeResolution 替代 resolution || '720p'，杜绝静默回退
  // #用户反馈：服务商计费系统只认小写 480p/720p，改为小写发送
  const effectiveResolution = (model === 'seedance-2-fast' && safeResolution.toLowerCase() === '1080p') ? '720p' : safeResolution.toLowerCase();
  console.log('[Seedance 2.0] resolution参数转换: 前端传入=', resolution, '| 安全值=', safeResolution, '| 发送给服务商=', effectiveResolution);
  console.log('[Seedance 2.0] #681 实际发给服务商: resolution=' + effectiveResolution + ', duration=' + safeDuration + ', ratio=' + safeAspectRatio);

  // #7xx 终极降维令：摧毁 input 对象外壳！
  // 灵芽 API 网关拒收以对象形式存在的 input 字段，media 随之被静默丢弃！
  // prompt 和 media 必须直接放在最外层（Root Level），众生平等！
  const requestBody: any = {
    model: realModelId,
    prompt: prompt || '',
    // 所有参数全部在最外层，绝对不能嵌套！
    resolution: effectiveResolution,
    duration: safeDuration,
    watermark: false,
    ratio: safeAspectRatio,
    ...(generateAudio !== false ? { generate_audio: true } : {}),
    ...(media.length > 0 ? { media } : {}),
  };

  // ====== 创建流式响应（复用 Lingya 轮询架构）======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    // #7xx 军师定海神针：移除 async 关键字，让 start 函数瞬间返回！
    start(controller) {
      const sendEvent = async (data: any) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：1024 字节远远不够！Next.js TransformStream highWaterMark 默认 16KB
        // 32768 字节 (32KB) 才能逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层！
        // Next.js 内部 TransformStream highWaterMark=16KB + ServerResponse highWaterMark=16KB
        // 8KB 远不够，必须 32KB 才能确保每次 enqueue 都触发 TCP Flush
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
        await new Promise(r => setTimeout(r, 0));
        // 同步进度到内存缓存，供前端 GET 轮询获取（SSE 可能被 Next.js 缓冲）
        // 关键修复：强制使用闭包捕获的 clientRequestId 作为缓存 Key
        // 进度事件中的 data.clientRequestId 可能不存在，而 data.taskId 是服务商 ID（如 tsk_vid_xxx）
        // 前端 GET 轮询用的是 clientRequestId，两者 Key 不匹配会导致永远查不到进度！
        if (data.type === 'progress') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          }
        }
        // 完成或失败时清理进度缓存
        if (data.type === 'complete' || data.type === 'error') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          // #7xx+3 进度缓存延迟清理：保留进度让GET轮询能读取，10分钟后自动过期（见taskProgressCache.ts）
          // if (cacheTaskId) deleteTaskProgress(cacheTaskId);

        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model: realModelId, taskId: clientRequestId });

        // ====== Step 1: 提交任务到灵芽 Seedance 2.0 API ======
        // #686 修复：改用灵芽 /v1/videos 端点（与 HappyHorse/Veo/Sora 统一）
        const submitEndpoint = `${baseEndpoint}/v1/videos`;
        console.log('[Seedance 2.0] 提交任务到:', submitEndpoint, ', model:', realModelId, ', mode:', mode);
        // #680 完整请求体日志：记录实际发给服务商的所有参数
        console.log('[Seedance 2.0] 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));

        const submitResponse = await fetch(submitEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[Seedance 2.0] 提交响应 status:', submitResponse.status);
        console.log('[Seedance 2.0] 服务商返回完整响应:', submitText);

        if (!submitResponse.ok) {
          let errorMsg = `Seedance 2.0 API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            errorMsg = errorData.message || errorData.error?.message || errorData.error || errorMsg;
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          let sd2SubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 提交任务失败');
            sd2SubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] Seedance 2.0提交失败: requiredCredits=${requiredCredits}, newBalance=${sd2SubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: sd2SubmitBalance ?? undefined });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const lingyaTaskId = submitData.id;

        if (!lingyaTaskId) {
          let sd2NoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 未获取到任务ID');
            sd2NoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: sd2NoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[Seedance 2.0] 任务已提交, lingyaTaskId:', lingyaTaskId);
        await registerVideoTask(clientRequestId, lingyaTaskId, model, userId, prompt, requiredCredits, { resolution: safeResolution, aspect_ratio: safeAspectRatio, duration: safeDuration, pollUrl: `${baseEndpoint}/v1/videos/${lingyaTaskId}` });
        await sendEvent({ type: 'waiting', taskId: lingyaTaskId, clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        // #686 修复：使用灵芽 /v1/videos/{id} 轮询端点
        const pollEndpoint = `${baseEndpoint}/v1/videos/${lingyaTaskId}`;
        const maxPolls = 12;  // #852 短轮询窗口3分钟（12次 × 15秒），超时后 still_processing，离线 Cron 接管
        const pollInterval = 15000;
        let pollCount = 0;
        let completed = false;

        while (pollCount < maxPolls && !completed) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          try {
            const pollResponse = await fetch(pollEndpoint, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            });

            if (!pollResponse.ok) {
              console.log(`[Seedance 2.0] 轮询失败 status: ${pollResponse.status}, 第${pollCount}次`);
              continue;
            }

            const pollData = await pollResponse.json();
            console.log(`[Seedance 2.0] 轮询第${pollCount}次, status: ${pollData.status}, progress: ${pollData.progress || 'N/A'}`);

            // #710 进度事件：API 不返回 progress 时基于轮询次数估算
            let sd2Progress = pollData.progress || 0;
            let sd2Source = 'api';
            if (sd2Progress <= 0) {
              sd2Progress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
              sd2Source = 'estimated';
            }
            console.log(`[Seedance 2.0] 发送进度: ${sd2Progress}% (来源: ${sd2Source})`);
            await sendEvent({ type: 'progress', progress: Math.min(sd2Progress, 95), taskId: lingyaTaskId, clientRequestId });

            // #686 修复：灵芽 API 成功状态为 'completed'（非 'succeeded'）
            if (pollData.status === 'completed' || pollData.status === 'succeeded') {
              completed = true;
              // #686 修复：灵芽 API 视频 URL 在顶层 video_url（非 content.video_url）
              const videoUrl = pollData.video_url || pollData.content?.video_url;

              if (!videoUrl) {
                // 成功但无视频URL → 退还积分
                let sd2NoUrlBalance = creditsBalanceAfterDeduct;
                if (userId && requiredCredits > 0) {
                  const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 任务完成但无视频URL');
                  sd2NoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                }
                await sendEvent({ type: 'error', error: '视频生成完成但未获取到视频URL', taskId: lingyaTaskId, clientRequestId, creditsBalance: sd2NoUrlBalance ?? undefined });
                // 更新任务缓存
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
                controller.close();
                return;
              }

              console.log('[Seedance 2.0] 视频生成成功, URL:', videoUrl.substring(0, 80));
              await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

              try {
                // 下载并上传到 COS
                const cosResult = await downloadAndUploadVideoToCOS(videoUrl, lingyaTaskId);

                // 保存到数据库
                if (userId) {
                  try {
                    const dbClient = getSupabaseClient(undefined, true);
                    await dbClient.from('generation_records').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      aspect_ratio: aspectRatio,
                      videos: [cosResult.url],
                      source: 'video',
                      credits_charged: requiredCredits,
                      credits_balance: creditsBalanceAfterDeduct,
                      reference_images: (params.uploadedUrls && params.uploadedUrls.length > 0) ? params.uploadedUrls : null,  // #757
                      reference_image_keys: (params.uploadedRefKeys && params.uploadedRefKeys.length > 0) ? params.uploadedRefKeys : null,  // #757
                      created_at: new Date().toISOString(),
                    });
                    console.log('[Seedance 2.0] 已保存到数据库');
                  } catch (dbErr) {
                    console.error('[Seedance 2.0] 数据库保存失败:', dbErr);
                  }
                }

                // #687 修复：complete 事件使用标准 videos/videoKeys 格式（与其他视频处理器一致）
                await sendEvent({
                  type: 'complete',
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                // 更新任务缓存
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],
                  videoKeys: [cosResult.key],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });

                console.log('[Seedance 2.0] 任务完成(COS), videoUrl:', cosResult.url?.substring(0, 80));
              } catch (uploadError) {
                console.error('[Seedance 2.0] COS上传失败，启动代理降级:', uploadError);
                // #555 使用代理 URL 抹平 CORS 跨域与防盗链
                const proxyUrl = wrapAsProxyUrl(videoUrl);
                const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';

                // 保存到数据库（降级URL）
                if (userId) {
                  try {
                    const dbClient = getSupabaseClient(undefined, true);
                    await dbClient.from('generation_records').insert({
                      user_id: userId,
                      prompt: prompt,
                      model: model,
                      aspect_ratio: aspectRatio,
                      videos: [proxyUrl],
                      source: 'video',
                      credits_charged: requiredCredits,
                      credits_balance: creditsBalanceAfterDeduct,
                      reference_images: (params.uploadedUrls && params.uploadedUrls.length > 0) ? params.uploadedUrls : null,  // #757
                      reference_image_keys: (params.uploadedRefKeys && params.uploadedRefKeys.length > 0) ? params.uploadedRefKeys : null,  // #757
                      created_at: new Date().toISOString(),
                    });
                  } catch (dbErr) {
                    console.error('[Seedance 2.0] 数据库保存失败(降级):', dbErr);
                  }
                }

                await sendEvent({
                  type: 'complete',
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  taskId: clientRequestId,
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                });
                // 更新任务缓存
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  imageKeys: [fallbackVideoKey],
                  videos: [proxyUrl],
                  videoKeys: [fallbackVideoKey],
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });

                console.log('[Seedance 2.0] 任务完成(代理降级), proxyUrl:', proxyUrl.substring(0, 80));
              }

              controller.close();
              return;
            } else if (pollData.status === 'failed' || pollData.status === 'expired') {
              completed = true;
              // #686 修复：灵芽 API 错误格式兼容（顶层 message 或 error.message）
              const errorMsg = pollData.error?.message || pollData.error?.code || pollData.message || pollData.code || '视频生成失败';
              console.error(`[Seedance 2.0] 任务失败: ${errorMsg}`);

              let sd2FailBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 生成失败');
                sd2FailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }

              await sendEvent({ type: 'error', error: errorMsg, taskId: lingyaTaskId, clientRequestId, creditsBalance: sd2FailBalance ?? undefined });
              controller.close();
              return;
            }
            // queued / processing → 继续轮询
          } catch (pollErr) {
            console.error(`[Seedance 2.0] 轮询异常 第${pollCount}次:`, pollErr);
          }
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        if (!completed) {
          console.log('[Seedance 2.0] 后端轮询超时，任务转入后台异步处理，不退款');
          await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
          setTaskResult(clientRequestId, {
            status: 'processing',
            imageUrls: [],
            errors: [],
            createdAt: Date.now(),
          });
          controller.close();
        }
      } catch (err: any) {
        console.error('[Seedance 2.0] 未预期错误:', err);
        let sd2ErrBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 2.0 未预期错误');
          sd2ErrBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
        }
        await sendEvent({ type: 'error', error: err.message || '生成失败', taskId: clientRequestId, creditsBalance: sd2ErrBalance ?? undefined });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// #543 新增 GET 处理程序：视频任务状态轮询
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json(
      { error: '缺少 taskId 参数' },
      { status: 400 }
    );
  }

  console.log(`[视频轮询] GET 查询任务状态, taskId: ${taskId}`);

  // 1. 先查内存缓存
  const cachedResult = getTaskResult(taskId);
  // 同时查询进度缓存（SSE 可能被缓冲，前端通过 GET 轮询获取实时进度）
  const cachedProgress = getTaskProgress(taskId);
  
  if (cachedResult) {
    console.log(`[视频轮询] 命中缓存, taskId: ${taskId}, status: ${cachedResult.status}, progress: ${cachedProgress?.progress ?? 'N/A'}`);
    return NextResponse.json({
      status: cachedResult.status,
      imageUrls: cachedResult.imageUrls,
      errors: cachedResult.errors,
      creditsBalance: cachedResult.creditsBalance,  // #549 传递积分余额
      // 视频任务特有字段
      videos: cachedResult.status === 'completed' ? cachedResult.imageUrls : undefined,
      // 实时进度（前端轮询获取）
      progress: cachedProgress?.progress,
      progressStatus: cachedProgress?.status,
    });
  }

  // 2. 缓存未命中，查数据库（可能任务是之前服务器重启前创建的）
  try {
    const client = getSupabaseClient(undefined, true);
    const { data, error } = await client
      .from('generation_records')
      .select('videos, prompt, model, created_at')
      .eq('user_id', searchParams.get('userId') || '')
      .eq('model', searchParams.get('model') || '')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!error && data && data.length > 0 && data[0].videos?.length > 0) {
      console.log(`[视频轮询] 从数据库恢复结果, taskId: ${taskId}`);
      return NextResponse.json({
        status: 'completed',
        imageUrls: data[0].videos,
        videos: data[0].videos,
      });
    }
  } catch (dbError) {
    console.error('[视频轮询] 数据库查询失败:', dbError);
  }

  // 3. 任务仍在进行中或未找到
  return NextResponse.json({
    status: 'generating',
    imageUrls: [],
    progress: cachedProgress?.progress,
    progressStatus: cachedProgress?.status,
  });
}

// ====================================================================
// Seedance 2.0 异步流程：POST 提交任务 → GET 轮询结果
// T8 Seedance API: /v2/videos/generations
// 参数：model, prompt, duration, resolution, ratio, images, videos
// ====================================================================
interface SeedanceParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;
  duration: number;
  resolution: string;
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;  // #549 扣除后余额
  clientRequestId: string;
  // #644 T8 Seedance 音频和模式支持
  t8seedanceMode?: string;
  referenceAudioUrls?: string[];
  generateAudio?: boolean;
  hhMode?: string;
}

async function handleSeedanceGeneration(params: SeedanceParams, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    duration,
    resolution,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,  // #549 扣除后余额
    clientRequestId: rawClientRequestId,
    t8seedanceMode,
    referenceAudioUrls,
    generateAudio,
    hhMode,
  } = params;
  const clientRequestId = rawClientRequestId || `seedance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ====== #7xx 修复：删除回退！参数缺失必须报错！======
  if (duration === undefined || duration === null) {
    console.error('[Seedance-参数错误] duration 缺失！原始值:', duration);
    throw new Error('duration 参数缺失');
  }
  if (!resolution) {
    console.error('[Seedance-参数错误] resolution 缺失！原始值:', resolution);
    throw new Error('resolution 参数缺失');
  }
  if (!aspectRatio) {
    console.error('[Seedance-参数错误] aspectRatio 缺失！原始值:', aspectRatio);
    throw new Error('aspectRatio 参数缺失');
  }

  const safeDuration = duration;
  const safeResolution = resolution;
  const safeAspectRatio = aspectRatio;

  if (duration === undefined || duration === null) {
    console.warn('[Seedance-警告] #681 duration 缺失！回退默认:', safeDuration);
  }
  if (!resolution) {
    console.warn('[Seedance-警告] #681 resolution 缺失！回退默认:', safeResolution);
  }
  if (!aspectRatio) {
    console.warn('[Seedance-警告] #681 aspectRatio 缺失！回退默认:', safeAspectRatio);
  }
  console.log('[Seedance] #681 实际参数: resolution=' + safeResolution + ', aspectRatio=' + safeAspectRatio + ', duration=' + safeDuration);

  const ratio = safeAspectRatio === 'auto' ? 'adaptive' : safeAspectRatio;

  // 映射 duration → Seedance duration（4-15秒，前端传什么就透传什么）
  const seedanceDuration = Math.max(4, Math.min(15, safeDuration));

  // 使用前端传来的分辨率参数（不再硬编码）
  const seedanceResolution = safeResolution;

  const requestBody: any = {
    model,
    prompt,
    ratio,
    duration: seedanceDuration,
    resolution: seedanceResolution,
    generate_audio: generateAudio !== false,  // #644 默认开启音频生成
  };

  // #556 参考图：COS URL 转 Base64，解决 T8 异步读取签名 URL 失败问题
  if (uploadedUrls.length > 0) {
    console.log('[Seedance] #556 开始将参考图 URL 转为 Base64...');
    const base64Urls = await convertImageUrlsToBase64(uploadedUrls);
    requestBody.images = base64Urls;
  }

  // #644 参考音频
  if (referenceAudioUrls && referenceAudioUrls.length > 0) {
    requestBody.audio_urls = referenceAudioUrls;
    console.log('[Seedance] 参考音频数量:', referenceAudioUrls.length);
  }

  console.log('[Seedance] 请求体构建完成, images:', requestBody.images?.length || 0, ', audio:', referenceAudioUrls?.length || 0);

  // ====== 创建流式响应（复用 Veo/Sora 轮询架构）======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    start(controller) { // 👈 #7xx 军师定海神针：移除 async，防流初始化死锁！
      const sendEvent = async (data: any) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：1024 字节远远不够！Next.js TransformStream highWaterMark 默认 16KB
        // 32768 字节 (32KB) 才能逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层！
        // Next.js 内部 TransformStream highWaterMark=16KB + ServerResponse highWaterMark=16KB
        // 8KB 远不够，必须 32KB 才能确保每次 enqueue 都触发 TCP Flush
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
        await new Promise(r => setTimeout(r, 0));
        // 同步进度到内存缓存，供前端 GET 轮询获取（SSE 可能被 Next.js 缓冲）
        // 关键修复：强制使用闭包捕获的 clientRequestId 作为缓存 Key
        // 进度事件中的 data.clientRequestId 可能不存在，而 data.taskId 是服务商 ID（如 tsk_vid_xxx）
        // 前端 GET 轮询用的是 clientRequestId，两者 Key 不匹配会导致永远查不到进度！
        if (data.type === 'progress') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          }
        }
        // 完成或失败时清理进度缓存
        if (data.type === 'complete' || data.type === 'error') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          // #7xx+3 进度缓存延迟清理：保留进度让GET轮询能读取，10分钟后自动过期（见taskProgressCache.ts）
          // if (cacheTaskId) deleteTaskProgress(cacheTaskId);

        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model });

        // ====== Step 1: 提交任务 ======
        console.log('[Seedance] 提交任务到:', baseEndpoint);
        const submitResponse = await fetch(baseEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[Seedance] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `Seedance API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            // 解析 upstream_message（T8 API 的上游错误详情）
            if (errorData.upstream_message) {
              try {
                const upstream = JSON.parse(errorData.upstream_message);
                errorMsg = `上游错误: ${upstream.msg || upstream.message || errorData.upstream_message} (code: ${upstream.code || 'unknown'})`;
              } catch {
                errorMsg = `上游错误: ${errorData.upstream_message}`;
              }
            } else {
              errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
            }
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          // 积分退还
          let sdSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 提交任务失败');
            sdSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] #549 Seedance提交失败: requiredCredits=${requiredCredits}, newBalance=${sdSubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: sdSubmitBalance ?? undefined });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const t8TaskId = submitData.task_id;

        if (!t8TaskId) {
          // 积分退还
          let sdNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 未获取到任务ID');
            sdNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] #549 Seedance无任务ID: requiredCredits=${requiredCredits}, newBalance=${sdNoIdBalance}`);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: sdNoIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[Seedance] 任务已提交, t8TaskId:', t8TaskId);
        await registerVideoTask(clientRequestId, t8TaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${baseEndpoint}/${t8TaskId}` });
        await sendEvent({ type: 'waiting', taskId: t8TaskId, clientRequestId: clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/${t8TaskId}`;
        const maxPolls = 36; // #852 短轮询窗口3分钟，超时后 still_processing，离线 Cron 接管
        const pollInterval = 5000;
        let pollCount = 0;

        while (pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          console.log(`[Seedance] 轮询 #${pollCount}, t8TaskId: ${t8TaskId}`);
          // #655 真假进度分流：如果 T8 响应包含真实 progress 字段，透传给前端；否则不发送（前端 useFakeProgress 接管）
          // 注意：此处不发送假进度，前端 useFakeProgress Hook 自动接管

          const pollResponse = await fetch(pollEndpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (!pollResponse.ok) {
            console.error('[Seedance] 轮询请求失败:', pollResponse.status);
            continue;
          }

          const pollData = await pollResponse.json();
          const status = pollData.status;
          console.log(`[Seedance] 轮询结果: status=${status}`);

          // #710 进度估算：Seedance API 不返回 progress 时基于轮询次数估算
          const sdRealProgress = pollData.progress;
          let sdFinalProgress = 0;
          let sdProgressSource = 'api';
          if (sdRealProgress !== undefined && sdRealProgress !== null) {
            const progressNum = typeof sdRealProgress === 'string' ? parseInt(sdRealProgress) : sdRealProgress;
            if (!isNaN(progressNum) && progressNum > 0) {
              sdFinalProgress = progressNum;
            }
          }
          if (sdFinalProgress <= 0) {
            sdFinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
            sdProgressSource = 'estimated';
          }
          console.log(`[Seedance] 发送进度: ${sdFinalProgress}% (来源: ${sdProgressSource})`);
          await sendEvent({
            type: 'progress',
            progress: Math.min(sdFinalProgress, 95),
            status: 'running',
            taskId: t8TaskId,
            clientRequestId: clientRequestId,
          });

          if (status === 'SUCCESS') {
            // ====== 任务完成 ======
            const videoUrl = pollData.data?.output;
            if (!videoUrl) {
              // 成功但无视频URL → 退还积分
              let sdNoUrlBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 任务完成但无视频URL');
                sdNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                console.log(`[积分返还监控] #549 Seedance无视频URL: requiredCredits=${requiredCredits}, newBalance=${sdNoUrlBalance}`);
              }
              await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: sdNoUrlBalance ?? undefined });
              // #544 更新任务缓存
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            console.log('[Seedance] 视频生成成功, URL:', videoUrl.substring(0, 80));
            await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

            try {
              // 下载并上传到 COS
              const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);

              // 保存到数据库
              if (userId) {
                try {
                  const client = getSupabaseClient(undefined, true);
                  await client.from('generation_records').insert({
                    user_id: userId,
                    prompt: prompt,
                    model: model,
                    aspect_ratio: aspectRatio,
                    videos: [cosResult.url],
                    source: 'video',
                    credits_charged: requiredCredits,
                    credits_balance: creditsBalanceAfterDeduct,
                    reference_images: uploadedUrls.length > 0 ? uploadedUrls : null,  // #757
                    reference_image_keys: (params.uploadedRefKeys && params.uploadedRefKeys.length > 0) ? params.uploadedRefKeys : null,  // #757
                    created_at: new Date().toISOString(),
                  });
                  console.log('[Seedance] 已保存到数据库');
                } catch (dbError) {
                  console.error('[Seedance] 保存到数据库失败:', dbError);
                }
              }

              await sendEvent({
                type: 'complete',
                videos: [cosResult.url],
                videoKeys: [cosResult.key],  // #616 传递视频 COS key
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
              });
              // #543 更新任务缓存
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [cosResult.url],
                videos: [cosResult.url],  // #637 存储视频URL
                videoKeys: [cosResult.key],  // #637 存储视频Key
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            } catch (uploadError) {
              console.error('[Seedance] 上传视频失败，启动动态代理降级:', uploadError);
              // #555 使用代理 URL 抹平 CORS 跨域与防盗链
              const proxyUrl = wrapAsProxyUrl(videoUrl);
              console.log('[Seedance] 代理 URL:', proxyUrl);
              // #618 修复：保留完整 URL，绝不截断！（截断会导致带 Token 的签名链接报废）
              const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
              await sendEvent({
                type: 'complete',
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],  // #617 降级时也传递 key
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
              });
              // #543 更新任务缓存
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [proxyUrl],
                imageKeys: [fallbackVideoKey],  // #617 缓存 key
                videos: [proxyUrl],  // #637 存储视频URL
                videoKeys: [fallbackVideoKey],  // #637 存储视频Key
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            }

            controller.close();
            return;
          } else if (status === 'FAILURE') {
            // ====== 任务失败 ======
            const failReason = pollData.fail_reason || pollData.message || '视频生成失败';
            console.error('[Seedance] 任务失败:', failReason);
            // 积分退还
            let sdFailBalance = creditsBalanceAfterDeduct;
            if (userId && requiredCredits > 0) {
              const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `Seedance 任务失败: ${failReason}`);
              sdFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              console.log(`[积分返还监控] #549 Seedance任务失败: requiredCredits=${requiredCredits}, newBalance=${sdFailBalance}`);
            }

            // 检测违规类型
            let userMessage = failReason;
            if (failReason.includes('moderation') || failReason.includes('content_policy') || failReason.includes('safety')) {
              userMessage = '内容违规，积分已返还';
            }

            await sendEvent({ type: 'error', error: userMessage, taskId: clientRequestId, creditsBalance: sdFailBalance ?? undefined });
            // #543 更新任务缓存
            setTaskResult(clientRequestId, {
              status: 'failed',
              imageUrls: [],
              errors: [{ index: 0, error: userMessage }],
              createdAt: Date.now(),
              completedAt: Date.now(),
            });
            controller.close();
            return;
          }

          // NOT_START / IN_PROGRESS / PROCESSING → 继续轮询
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[Seedance] 生成错误:', error);
        // 积分退还
        let sdExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'Seedance 异常错误');
          sdExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          console.log(`[积分返还监控] #549 Seedance异常错误: requiredCredits=${requiredCredits}, newBalance=${sdExceptBalance}`);
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: sdExceptBalance ?? undefined,
        });
        // #543 更新任务缓存
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====================================================================
// T8 Seedance 2.0 (sdols-2.0) 全模态解锁 —— 服务商完全物理隔离架构
// 独立于 LingYa Seedance 2.0，使用 T8 官方 /seedance/v3/contents/generations/tasks 端点
// content 数组格式严格对齐 T8 官方 OpenAPI 文档（已交叉验证 LingYa buildSeedance2Content）
// ====================================================================
interface T8SeedanceParams {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;
  duration: number;
  resolution: string;
  baseEndpoint: string;
  apiKey: string;
  userId: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;
  clientRequestId: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  generateAudio?: boolean;
  hhMode?: string;
}

/**
 * 构建 T8 Seedance content 数组
 * ⚠️ 严格对齐 T8 官方 OpenAPI 文档 + LingYa buildSeedance2Content 交叉验证
 * type 必须带 _url 后缀：'text' / 'image_url' / 'video_url' / 'audio_url'
 * prompt 必须在 content 数组中，不在根目录
 */
function buildT8SeedanceContent(params: {
  prompt: string;
  mode: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}): any[] {
  const content: any[] = [];
  const { prompt, mode, firstFrameUrl, lastFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls } = params;

  // 1. 文本提示词必须在 content 里（根目录没有 prompt 字段！）
  if (prompt) {
    content.push({ type: 'text', text: prompt });
  }

  // 2. 根据模式添加图片素材
  if (mode === 'i2v-first-frame' || mode === 'i2v') {
    // 首帧/图生视频：首帧图
    if (firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: firstFrameUrl },
        role: 'first_frame',
      });
    }
  } else if (mode === 'i2v-first-last-frame') {
    // 首尾帧模式：首帧 + 尾帧
    if (firstFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: firstFrameUrl },
        role: 'first_frame',
      });
    }
    if (lastFrameUrl) {
      content.push({
        type: 'image_url',
        image_url: { url: lastFrameUrl },
        role: 'last_frame',
      });
    }
  } else if (mode === 'r2v') {
    // 参考生视频：所有参考图
    if (referenceImageUrls && referenceImageUrls.length > 0) {
      for (const url of referenceImageUrls) {
        content.push({
          type: 'image_url',
          image_url: { url },
          role: 'reference_image',
        });
      }
    }
  }
  // t2v 模式不需要图片

  // 3. 参考视频
  if (referenceVideoUrls && referenceVideoUrls.length > 0) {
    for (const url of referenceVideoUrls) {
      content.push({
        type: 'video_url',
        video_url: { url },
        role: 'reference_video',
      });
    }
  }

  // 4. 参考音频
  if (referenceAudioUrls && referenceAudioUrls.length > 0) {
    for (const url of referenceAudioUrls) {
      content.push({
        type: 'audio_url',
        audio_url: { url },
        role: 'reference_audio',
      });
    }
  }

  console.log(`[T8Seedance] content数组构建完成: mode=${mode}, 内容项=${content.length}, 图片=${mode === 'r2v' ? referenceImageUrls?.length || 0 : (firstFrameUrl ? 1 : 0) + (lastFrameUrl ? 1 : 0)}, 视频=${referenceVideoUrls?.length || 0}, 音频=${referenceAudioUrls?.length || 0}`);

  return content;
}

async function handleT8SeedanceGeneration(params: T8SeedanceParams, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    duration,
    resolution,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,
    clientRequestId: rawClientRequestId,
    firstFrameUrl,
    lastFrameUrl,
    referenceImageUrls,
    referenceVideoUrls,
    referenceAudioUrls,
    generateAudio,
    hhMode,
  } = params;
  const clientRequestId = rawClientRequestId || `t8seedance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ====== 确定 T8 Seedance 模式 ======
  // 优先使用前端传来的 hhMode，否则根据素材自动推断
  let effectiveMode = hhMode || 't2v';
  if (!hhMode) {
    if (firstFrameUrl && lastFrameUrl) {
      effectiveMode = 'i2v-first-last-frame';
    } else if (firstFrameUrl) {
      effectiveMode = 'i2v-first-frame';
    } else if ((referenceImageUrls && referenceImageUrls.length > 0) || (uploadedUrls && uploadedUrls.length > 0)) {
      effectiveMode = 'r2v';
    }
  }
  console.log(`[T8Seedance] 模式: ${effectiveMode} (hhMode=${hhMode || '空'}, firstFrame=${!!firstFrameUrl}, lastFrame=${!!lastFrameUrl}, refImgs=${referenceImageUrls?.length || 0}, uploaded=${uploadedUrls?.length || 0})`);

  // ====== 构建 content 数组 ======
  // ⚠️ 参考生视频模式(r2v)：如果前端传了 uploadedUrls 而没传 referenceImageUrls，需要合并
  const effectiveRefImageUrls = effectiveMode === 'r2v'
    ? (referenceImageUrls && referenceImageUrls.length > 0 ? referenceImageUrls : uploadedUrls)
    : referenceImageUrls;

  // #556 参考图/首帧/尾帧：COS URL 转 Base64，解决 T8 异步读取签名 URL 失败问题
  let effectiveFirstFrame = firstFrameUrl;
  let effectiveLastFrame = lastFrameUrl;
  let effectiveRefImagesBase64 = effectiveRefImageUrls;

  console.log('[T8Seedance] #556 开始将图片 URL 转为 Base64...');
  const base64Promises: Promise<string>[] = [];
  const base64Keys: string[] = []; // 'firstFrame' | 'lastFrame' | 'refImage-N'

  if (effectiveFirstFrame && effectiveFirstFrame.startsWith('http')) {
    base64Keys.push('firstFrame');
    base64Promises.push(imageUrlToBase64(effectiveFirstFrame));
  }
  if (effectiveLastFrame && effectiveLastFrame.startsWith('http')) {
    base64Keys.push('lastFrame');
    base64Promises.push(imageUrlToBase64(effectiveLastFrame));
  }
  if (effectiveRefImagesBase64 && effectiveRefImagesBase64.length > 0) {
    for (let i = 0; i < effectiveRefImagesBase64.length; i++) {
      if (effectiveRefImagesBase64[i].startsWith('http')) {
        base64Keys.push(`refImage-${i}`);
        base64Promises.push(imageUrlToBase64(effectiveRefImagesBase64[i]));
      }
    }
  }

  if (base64Promises.length > 0) {
    const base64Results = await Promise.all(base64Promises);
    for (let i = 0; i < base64Keys.length; i++) {
      const key = base64Keys[i];
      const val = base64Results[i];
      if (key === 'firstFrame') effectiveFirstFrame = val;
      else if (key === 'lastFrame') effectiveLastFrame = val;
      else if (key.startsWith('refImage-')) {
        const idx = parseInt(key.split('-')[1]);
        effectiveRefImagesBase64![idx] = val;
      }
    }
    console.log(`[T8Seedance] Base64转换完成: ${base64Promises.length} 张`);
  }

  const content = buildT8SeedanceContent({
    prompt,
    mode: effectiveMode,
    firstFrameUrl: effectiveFirstFrame,
    lastFrameUrl: effectiveLastFrame,
    referenceImageUrls: effectiveRefImagesBase64,
    referenceVideoUrls,
    referenceAudioUrls,
  });

  // ====== #7xx 修复：删除回退！参数缺失必须报错！======
  if (duration === undefined || duration === null) {
    console.error('[T8Seedance-参数错误] duration 缺失！原始值:', duration);
    throw new Error('duration 参数缺失');
  }
  if (!resolution) {
    console.error('[T8Seedance-参数错误] resolution 缺失！原始值:', resolution);
    throw new Error('resolution 参数缺失');
  }
  if (!aspectRatio) {
    console.error('[T8Seedance-参数错误] aspectRatio 缺失！原始值:', aspectRatio);
    throw new Error('aspectRatio 参数缺失');
  }

  const safeDuration = duration;
  const safeResolution = resolution;
  const safeAspectRatio = aspectRatio;
  console.log('[T8Seedance] #681 实际参数: resolution=' + safeResolution + ', aspectRatio=' + safeAspectRatio + ', duration=' + safeDuration);

  const seedanceDuration = Math.max(4, Math.min(15, safeDuration));

  const requestBody: any = {
    model: model,  // 直接透传原模型 ID，严禁字典翻译
    content,
    resolution: safeResolution,
    duration: seedanceDuration,
    generate_audio: generateAudio !== false, // 默认开启音频生成
  };

  // ratio 条件添加
  if (safeAspectRatio && safeAspectRatio !== 'auto') {
    requestBody.ratio = safeAspectRatio;
  }

  // ====== 构建 T8 v3 API 端点 ======
  // 从 baseEndpoint 提取基础域名（如 https://ai.t8star.org）
  // T8 v3 API 路径: /seedance/v3/contents/generations/tasks
  let t8BaseUrl: string;
  try {
    const urlObj = new URL(baseEndpoint);
    t8BaseUrl = `${urlObj.protocol}//${urlObj.host}`;
  } catch {
    // baseEndpoint 可能不包含路径，直接使用
    t8BaseUrl = baseEndpoint.replace(/\/+$/, '');
  }
  const t8SubmitEndpoint = `${t8BaseUrl}/seedance/v3/contents/generations/tasks`;

  console.log('[T8Seedance] 提交端点:', t8SubmitEndpoint);
  console.log('[T8Seedance] 请求体: model=%s, ratio=%s, duration=%s, content项=%d, generate_audio=%s', model, aspectRatio || 'auto', seedanceDuration, content.length, requestBody.generate_audio);

  // ====== 创建流式响应（复用 T8 轮询架构）======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    start(controller) { // 👈 #7xx 军师定海神针：移除 async，防流初始化死锁！
      const sendEvent = async (data: any) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：1024 字节远远不够！Next.js TransformStream highWaterMark 默认 16KB
        // 32768 字节 (32KB) 才能逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层！
        // Next.js 内部 TransformStream highWaterMark=16KB + ServerResponse highWaterMark=16KB
        // 8KB 远不够，必须 32KB 才能确保每次 enqueue 都触发 TCP Flush
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
        await new Promise(r => setTimeout(r, 0));
        // 同步进度到内存缓存，供前端 GET 轮询获取（SSE 可能被 Next.js 缓冲）
        // 关键修复：强制使用闭包捕获的 clientRequestId 作为缓存 Key
        // 进度事件中的 data.clientRequestId 可能不存在，而 data.taskId 是服务商 ID（如 tsk_vid_xxx）
        // 前端 GET 轮询用的是 clientRequestId，两者 Key 不匹配会导致永远查不到进度！
        if (data.type === 'progress') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          }
        }
        // 完成或失败时清理进度缓存
        if (data.type === 'complete' || data.type === 'error') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          // #7xx+3 进度缓存延迟清理：保留进度让GET轮询能读取，10分钟后自动过期（见taskProgressCache.ts）
          // if (cacheTaskId) deleteTaskProgress(cacheTaskId);

        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model });

        // ====== Step 1: 提交任务 ======
        const submitResponse = await fetch(t8SubmitEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[T8Seedance] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `T8 Seedance API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            if (errorData.upstream_message) {
              try {
                const upstream = JSON.parse(errorData.upstream_message);
                errorMsg = `上游错误: ${upstream.msg || upstream.message || errorData.upstream_message} (code: ${upstream.code || 'unknown'})`;
              } catch {
                errorMsg = `上游错误: ${errorData.upstream_message}`;
              }
            } else {
              errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
            }
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          let submitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8Seedance 提交任务失败');
            submitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] T8Seedance提交失败: requiredCredits=${requiredCredits}, newBalance=${submitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: submitBalance ?? undefined });
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const t8TaskId = submitData.task_id;

        if (!t8TaskId) {
          let noIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8Seedance 未获取到任务ID');
            noIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: noIdBalance ?? undefined });
          controller.close();
          return;
        }

        console.log('[T8Seedance] 任务已提交, t8TaskId:', t8TaskId);
        await registerVideoTask(clientRequestId, t8TaskId, model, userId, prompt, requiredCredits, { resolution, aspect_ratio: aspectRatio, duration, pollUrl: `${t8SubmitEndpoint}/${t8TaskId}` });
        await sendEvent({ type: 'waiting', taskId: t8TaskId, clientRequestId: clientRequestId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        // #668 对齐 LingYa Seedance 2.0：15秒/60次（火山官方推荐 15 秒轮询，5 秒会触发 429 限流）
        const pollEndpoint = `${t8SubmitEndpoint}/${t8TaskId}`;
        const maxPolls = 12;  // #852 短轮询窗口3分钟（12次 × 15秒），超时后 still_processing，离线 Cron 接管
        const pollInterval = 15000;
        let pollCount = 0;

        while (pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          console.log(`[T8Seedance] 轮询 #${pollCount}, t8TaskId: ${t8TaskId}`);

          const pollResponse = await fetch(pollEndpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (!pollResponse.ok) {
            console.error('[T8Seedance] 轮询请求失败:', pollResponse.status);
            continue;
          }

          const pollData = await pollResponse.json();
          const status = pollData.status;
          console.log(`[T8Seedance] 轮询结果: status=${status}, data:`, JSON.stringify(pollData).substring(0, 200));

          // #710 进度估算：T8Seedance API 不返回 progress 时基于轮询次数估算
          const t8sdRealProgress = pollData.progress;
          let t8sdFinalProgress = 0;
          let t8sdProgressSource = 'api';
          if (t8sdRealProgress !== undefined && t8sdRealProgress !== null) {
            const progressNum = typeof t8sdRealProgress === 'string' ? parseInt(t8sdRealProgress) : t8sdRealProgress;
            if (!isNaN(progressNum) && progressNum > 0) {
              t8sdFinalProgress = progressNum;
            }
          }
          if (t8sdFinalProgress <= 0) {
            t8sdFinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
            t8sdProgressSource = 'estimated';
          }
          console.log(`[T8Seedance] 发送进度: ${t8sdFinalProgress}% (来源: ${t8sdProgressSource})`);
          await sendEvent({
            type: 'progress',
            progress: Math.min(t8sdFinalProgress, 95),
            status: 'processing',
            taskId: t8TaskId,
            clientRequestId: clientRequestId,
          });

          if (status === 'succeeded') {
            // ====== 任务完成 ======
            const videoUrl = pollData.content?.[0]?.video_url?.url;
            if (!videoUrl) {
              let noUrlBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8Seedance 任务完成但无视频URL');
                noUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              }
              await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: noUrlBalance ?? undefined });
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
              controller.close();
              return;
            }

            console.log('[T8Seedance] 视频生成成功, URL:', videoUrl.substring(0, 80));
            await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

            try {
              const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);

              if (userId) {
                try {
                  const client = getSupabaseClient(undefined, true);
                  await client.from('generation_records').insert({
                    user_id: userId,
                    prompt: prompt,
                    model: model,
                    aspect_ratio: aspectRatio,
                    videos: [cosResult.url],
                    source: 'video',
                    credits_charged: requiredCredits,
                    credits_balance: creditsBalanceAfterDeduct,
                    reference_images: uploadedUrls.length > 0 ? uploadedUrls : null,  // #757
                    reference_image_keys: (uploadedRefKeys && uploadedRefKeys.length > 0) ? uploadedRefKeys : null,  // #757
                    created_at: new Date().toISOString(),
                  });
                } catch (dbError) {
                  console.error('[T8Seedance] 保存到数据库失败:', dbError);
                }
              }

              await sendEvent({
                type: 'complete',
                videos: [cosResult.url],
                videoKeys: [cosResult.key],
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
              });
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [cosResult.url],
                videos: [cosResult.url],
                videoKeys: [cosResult.key],
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            } catch (uploadError) {
              console.error('[T8Seedance] 上传视频失败，启动动态代理降级:', uploadError);
              const proxyUrl = wrapAsProxyUrl(videoUrl);
              const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
              await sendEvent({
                type: 'complete',
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
              });
              setTaskResult(clientRequestId, {
                status: 'completed',
                imageUrls: [proxyUrl],
                imageKeys: [fallbackVideoKey],
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],
                errors: [],
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            }

            controller.close();
            return;
          } else if (status === 'failed') {
            // ====== 任务失败 ======
            const failReason = pollData.message || pollData.fail_reason || '视频生成失败';
            console.error('[T8Seedance] 任务失败:', failReason);
            let failBalance = creditsBalanceAfterDeduct;
            if (userId && requiredCredits > 0) {
              const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `T8Seedance 任务失败: ${failReason}`);
              failBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            }

            let userMessage = failReason;
            if (failReason.includes('moderation') || failReason.includes('content_policy') || failReason.includes('safety')) {
              userMessage = '内容违规，积分已返还';
            }

            await sendEvent({ type: 'error', error: userMessage, taskId: clientRequestId, creditsBalance: failBalance ?? undefined });
            setTaskResult(clientRequestId, {
              status: 'failed',
              imageUrls: [],
              errors: [{ index: 0, error: userMessage }],
              createdAt: Date.now(),
              completedAt: Date.now(),
            });
            controller.close();
            return;
          }

          // NOT_START / IN_PROGRESS / PROCESSING → 继续轮询
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[T8Seedance] 生成错误:', error);
        let exceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8Seedance 异常错误');
          exceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
        }
        await sendEvent({
          type: 'error',
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: exceptBalance ?? undefined,
        });
        setTaskResult(clientRequestId, {
          status: 'failed',
          imageUrls: [],
          errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
          createdAt: Date.now(),
          completedAt: Date.now(),
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ====================================================================
// #538 T8 Sora-2 异步流程：POST 提交任务 → GET 轮询结果
// 迁移自 GRS Sora 同步流程，极简文生/图生视频模式
// ====================================================================
interface T8Sora2Params {
  model: string;
  prompt: string;
  uploadedUrls: string[];
  uploadedRefKeys?: string[];  // #757 参考图 COS key 数组
  aspectRatio: string;
  duration?: number;  // #548 Sora-2 时长参数：文生视频10s，图生视频4/8/10/12s
  baseEndpoint: string;
  apiKey: string;
  userId?: string;
  requiredCredits: number;
  creditsBalanceAfterDeduct: number | null;  // #549 扣除后余额
  clientRequestId?: string;  // #543 前端预生成的 taskId，用于缓存
}

async function handleT8Sora2Generation(params: T8Sora2Params, req: NextRequest): Promise<Response> {
  const {
    model,
    prompt,
    uploadedUrls,
    uploadedRefKeys,  // #757
    aspectRatio,
    duration,
    baseEndpoint,
    apiKey,
    userId,
    requiredCredits,
    creditsBalanceAfterDeduct,  // #549 扣除后余额
    clientRequestId: rawClientRequestId,
  } = params;
  const clientRequestId = rawClientRequestId || `sora2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ====== #681 参数防丢：使用安全值替代条件检查 ======
  const safeAspectRatio = aspectRatio || '16:9';
  const safeDuration = duration ?? 10;  // Sora-2 默认10秒

  if (!aspectRatio || aspectRatio === 'auto') {
    console.warn('[T8Sora2-警告] #681 aspectRatio 缺失或为auto！使用默认值:', safeAspectRatio);
  }
  if (duration === undefined || duration === null) {
    console.warn('[T8Sora2-警告] #681 duration 缺失！使用默认值:', safeDuration);
  }
  console.log('[T8Sora2] #681 实际参数: aspectRatio=' + safeAspectRatio + ', duration=' + safeDuration);

  // ====== 构建 T8 Sora-2 请求体 ======
  // #548 Sora-2 支持 duration 参数：文生视频10s，图生视频4/8/10/12s
  const requestBody: any = {
    model,
    prompt,
  };

  // 比例处理：仅发送 aspect_ratio（T8格式），不发送 size（OpenAI格式）
  // #681 修复：auto 不发送，让 T8 自动决定
  if (safeAspectRatio && safeAspectRatio !== 'auto') {
    requestBody.aspect_ratio = safeAspectRatio;
  }

  // 时长：Sora-2 官方API支持 duration 参数（字符串格式）
  // #681 修复：使用安全值，确保总是发送 duration
  requestBody.duration = String(safeDuration);

  // #556 参考图（首帧/尾帧），仅限1张：COS URL 转 Base64
  if (uploadedUrls.length > 0) {
    console.log('[T8 Sora-2] #556 开始将参考图 URL 转为 Base64...');
    const base64Urls = await convertImageUrlsToBase64(uploadedUrls.slice(0, 1));
    requestBody.images = base64Urls;
  }

  console.log('[T8 Sora-2] #681 发送给服务商的完整请求体:', JSON.stringify(requestBody, null, 2));

  // ====== 创建流式响应（复用 Veo 轮询架构）======
  const encoder = new TextEncoder();
  const abortGuard = createAbortGuard(req, clientRequestId);
  const stream = new ReadableStream({
    start(controller) { // 👈 #7xx 军师定海神针：移除 async，防流初始化死锁！
      const sendEvent = async (data: any) => {
        if (!safeEnqueue(controller, encoder, `data: ${JSON.stringify(data)}\n\n`, abortGuard)) return;
        // 暴力填缝 V2：1024 字节远远不够！Next.js TransformStream highWaterMark 默认 16KB
        // 32768 字节 (32KB) 才能逼破 Next.js TransformStream + Node.js ServerResponse 双重缓冲层！
        // Next.js 内部 TransformStream highWaterMark=16KB + ServerResponse highWaterMark=16KB
        // 8KB 远不够，必须 32KB 才能确保每次 enqueue 都触发 TCP Flush
        if (!safeEnqueue(controller, encoder, `: ${' '.repeat(32768)}\n\n`, abortGuard)) return;
        // 🔥 关键：await 让出事件循环，逼迫 Node.js ServerResponse Flush！
        await new Promise(r => setTimeout(r, 0));
        // 同步进度到内存缓存，供前端 GET 轮询获取（SSE 可能被 Next.js 缓冲）
        // 关键修复：强制使用闭包捕获的 clientRequestId 作为缓存 Key
        // 进度事件中的 data.clientRequestId 可能不存在，而 data.taskId 是服务商 ID（如 tsk_vid_xxx）
        // 前端 GET 轮询用的是 clientRequestId，两者 Key 不匹配会导致永远查不到进度！
        if (data.type === 'progress') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          if (cacheTaskId && typeof data.progress === 'number') {
            setTaskProgress(cacheTaskId, data.progress, data.status || 'processing');
          }
        }
        // 完成或失败时清理进度缓存
        if (data.type === 'complete' || data.type === 'error') {
          const cacheTaskId = clientRequestId || data.clientRequestId || data.taskId;
          // #7xx+3 进度缓存延迟清理：保留进度让GET轮询能读取，10分钟后自动过期（见taskProgressCache.ts）
          // if (cacheTaskId) deleteTaskProgress(cacheTaskId);

        }
      };

      // #SSE-BUFFER-FIX: start 事件移入异步闭包内！
      (async () => {
      try {
        // ✅ 正确：在闭包内，必须加 await！首个事件一旦 Flush，后续畅通无阻！
        await sendEvent({ type: 'start', model });

        // ====== Step 1: 提交任务 ======
        console.log('[T8 Sora-2] 提交任务到:', baseEndpoint);
        const submitResponse = await fetch(baseEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        const submitText = await submitResponse.text();
        console.log('[T8 Sora-2] 提交响应 status:', submitResponse.status);

        if (!submitResponse.ok) {
          let errorMsg = `T8 Sora-2 API 错误: ${submitResponse.status}`;
          try {
            const errorData = JSON.parse(submitText);
            // 优先解析 upstream_message（T8 API 的上游错误详情）
            if (errorData.upstream_message) {
              try {
                const upstream = JSON.parse(errorData.upstream_message);
                errorMsg = `上游错误: ${upstream.msg || upstream.message || errorData.upstream_message} (code: ${upstream.code || 'unknown'})`;
              } catch {
                errorMsg = `上游错误: ${errorData.upstream_message}`;
              }
            } else {
              errorMsg = errorData.error?.message || errorData.error || errorData.message || errorMsg;
            }
          } catch {}
          // #731 翻译错误消息
          errorMsg = translateErrorMessage(errorMsg);
          // 积分退还
          let soraSubmitBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Sora-2 提交任务失败');
            soraSubmitBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] #549 Sora提交失败: requiredCredits=${requiredCredits}, newBalance=${soraSubmitBalance}`);
          }
          await sendEvent({ type: 'error', error: errorMsg, taskId: clientRequestId, creditsBalance: soraSubmitBalance ?? undefined });
          // #543 更新任务缓存
          if (clientRequestId) {
            setTaskResult(clientRequestId, {
              status: 'failed',
              imageUrls: [],
              errors: [{ index: 0, error: errorMsg }],
              createdAt: Date.now(),
              completedAt: Date.now(),
            });
          }
          controller.close();
          return;
        }

        const submitData = JSON.parse(submitText);
        const t8TaskId = submitData.task_id;

        if (!t8TaskId) {
          // 积分退还
          let soraNoIdBalance = creditsBalanceAfterDeduct;
          if (userId && requiredCredits > 0) {
            const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Sora-2 未获取到任务ID');
            soraNoIdBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
            console.log(`[积分返还监控] #549 Sora无任务ID: requiredCredits=${requiredCredits}, newBalance=${soraNoIdBalance}`);
          }
          await sendEvent({ type: 'error', error: '未获取到任务ID，提交失败', taskId: clientRequestId, creditsBalance: soraNoIdBalance ?? undefined });
          // #543 更新任务缓存
          if (clientRequestId) {
            setTaskResult(clientRequestId, {
              status: 'failed',
              imageUrls: [],
              errors: [{ index: 0, error: '未获取到任务ID，提交失败' }],
              createdAt: Date.now(),
              completedAt: Date.now(),
            });
          }
          controller.close();
          return;
        }

        console.log('[T8 Sora-2] 任务已提交, task_id:', t8TaskId);
        await registerVideoTask(clientRequestId, t8TaskId, model, userId, prompt, requiredCredits, { resolution: undefined, aspect_ratio: aspectRatio, pollUrl: `${baseEndpoint}/${t8TaskId}` });
        await sendEvent({ type: 'waiting', taskId: clientRequestId, t8TaskId, message: '任务已提交，等待处理...' });

        // ====== Step 2: 轮询任务状态 ======
        const pollEndpoint = `${baseEndpoint}/${t8TaskId}`;
        const maxPolls = 36; // #852 短轮询窗口3分钟，超时后 still_processing，离线 Cron 接管
        const pollInterval = 5000; // 每5秒轮询一次
        let pollCount = 0;

        while (pollCount < maxPolls) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          pollCount++;

          console.log(`[T8 Sora-2] 轮询 #${pollCount}, task_id: ${t8TaskId}`);

          const pollResponse = await fetch(pollEndpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
          });

          if (!pollResponse.ok) {
            console.error('[T8 Sora-2] 轮询请求失败:', pollResponse.status);
            continue;
          }

          const pollData = await pollResponse.json();
          const status = pollData.status;
          console.log(`[T8 Sora-2] 轮询结果: status=${status}, data:`, JSON.stringify(pollData).substring(0, 200));

          // #710 进度估算：T8 Sora-2 API 不返回 progress 时基于轮询次数估算
          const t8soraRealProgress = pollData.progress;
          let t8soraFinalProgress = 0;
          let t8soraProgressSource = 'api';
          if (t8soraRealProgress !== undefined && t8soraRealProgress !== null) {
            const progressNum = typeof t8soraRealProgress === 'string' ? parseInt(t8soraRealProgress) : t8soraRealProgress;
            if (!isNaN(progressNum) && progressNum > 0) {
              t8soraFinalProgress = progressNum;
            }
          }
          if (t8soraFinalProgress <= 0) {
            t8soraFinalProgress = Math.min(Math.max(Math.round(5 + pollCount * 2.5), 5), 85);
            t8soraProgressSource = 'estimated';
          }
          console.log(`[T8 Sora-2] 发送进度: ${t8soraFinalProgress}% (来源: ${t8soraProgressSource})`);
          await sendEvent({ 
            type: 'progress', 
            progress: Math.min(t8soraFinalProgress, 95),
            status: 'processing',
            taskId: clientRequestId,
          });

          if (status === 'SUCCESS') {
            // ====== 任务完成（T8 官方格式：status === 'succeeded', videoUrl 在 content[0].video_url.url）======
            const videoUrl = pollData.data?.output;
            if (!videoUrl) {
              // 成功但无视频URL → 退还积分
              let soraNoUrlBalance = creditsBalanceAfterDeduct;
              if (userId && requiredCredits > 0) {
                const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Sora-2 任务完成但无视频URL');
                soraNoUrlBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
                console.log(`[积分返还监控] #549 Sora无视频URL: requiredCredits=${requiredCredits}, newBalance=${soraNoUrlBalance}`);
              }
              await sendEvent({ type: 'error', error: '任务完成但未获取到视频地址', taskId: clientRequestId, creditsBalance: soraNoUrlBalance ?? undefined });
              // #543 更新任务缓存
              if (clientRequestId) {
                setTaskResult(clientRequestId, {
                  status: 'failed',
                  imageUrls: [],
                  errors: [{ index: 0, error: '任务完成但未获取到视频地址' }],
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
              }
              controller.close();
              return;
            }

            console.log('[T8 Sora-2] 视频生成成功, URL:', videoUrl.substring(0, 80));
            await sendEvent({ type: 'progress', progress: 95, status: 'uploading', taskId: clientRequestId }); // #722 补齐 taskId

            try {
              // 下载并上传到 COS
              const cosResult = await downloadAndUploadVideoToCOS(videoUrl, 0);

              // 保存到数据库
              if (userId) {
                try {
                  const client = getSupabaseClient(undefined, true);
                  await client.from('generation_records').insert({
                    user_id: userId,
                    prompt: prompt,
                    model: model,
                    aspect_ratio: aspectRatio,
                    videos: [cosResult.url],
                    source: 'video',
                    credits_charged: requiredCredits,
                    credits_balance: creditsBalanceAfterDeduct,
                    reference_images: uploadedUrls.length > 0 ? uploadedUrls : null,  // #757
                    reference_image_keys: (uploadedRefKeys && uploadedRefKeys.length > 0) ? uploadedRefKeys : null,  // #757
                    created_at: new Date().toISOString(),
                  });
                  console.log('[T8 Sora-2] 已保存到数据库');
                } catch (dbError) {
                  console.error('[T8 Sora-2] 保存到数据库失败:', dbError);
                }
              }

              // #543 更新任务缓存
              if (clientRequestId) {
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [cosResult.url],
                  videos: [cosResult.url],  // #637 存储视频URL
                  videoKeys: [cosResult.key],  // #637 存储视频Key
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
              }
              await sendEvent({ 
                type: 'complete', 
                videos: [cosResult.url],
                videoKeys: [cosResult.key],  // #616 传递视频 COS key
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
              });
            } catch (uploadError) {
              console.error('[T8 Sora-2] 上传视频失败，启动动态代理降级:', uploadError);
              // #555 使用代理 URL 抹平 CORS 跨域与防盗链
              const proxyUrl = wrapAsProxyUrl(videoUrl);
              console.log('[T8 Sora-2] 代理 URL:', proxyUrl);
              // #618 修复：保留完整 URL，绝不截断！（截断会导致带 Token 的签名链接报废）
              const fallbackVideoKey = videoUrl ? `proxy:${videoUrl}` : '';
              // #543 更新任务缓存（使用代理 URL）
              if (clientRequestId) {
                setTaskResult(clientRequestId, {
                  status: 'completed',
                  imageUrls: [proxyUrl],
                  imageKeys: [fallbackVideoKey],  // #617 缓存 key
                  videos: [proxyUrl],  // #637 存储视频URL
                  videoKeys: [fallbackVideoKey],  // #637 存储视频Key
                  errors: [],
                  creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
                  createdAt: Date.now(),
                  completedAt: Date.now(),
                });
              }
              await sendEvent({ 
                type: 'complete', 
                videos: [proxyUrl],
                videoKeys: [fallbackVideoKey],  // #617 降级时也传递 key
                taskId: clientRequestId,
                creditsBalance: creditsBalanceAfterDeduct ?? undefined,  // #549
              });
            }

            controller.close();
            return;
          } else if (status === 'FAILURE') {
            // ====== 任务失败（T8 官方格式：status === 'failed'）======
            const failReason = pollData.message || pollData.fail_reason || '视频生成失败';
            console.error('[T8 Sora-2] 任务失败:', failReason);
            // 积分退还
            let soraFailBalance = creditsBalanceAfterDeduct;
            if (userId && requiredCredits > 0) {
              const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, `T8 Sora-2 任务失败: ${failReason}`);
              soraFailBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
              console.log(`[积分返还监控] #549 Sora任务失败: requiredCredits=${requiredCredits}, newBalance=${soraFailBalance}`);
            }

            // 检测违规类型
            let userMessage = failReason;
            if (failReason.includes('moderation') || failReason.includes('content_policy') || failReason.includes('safety')) {
              userMessage = '内容违规，积分已返还';
            }

            // #543 更新任务缓存
            if (clientRequestId) {
              setTaskResult(clientRequestId, {
                status: 'failed',
                imageUrls: [],
                errors: [{ index: 0, error: userMessage }],
                creditsBalance: soraFailBalance ?? undefined,  // #549
                createdAt: Date.now(),
                completedAt: Date.now(),
              });
            }
            await sendEvent({ type: 'error', error: userMessage, taskId: clientRequestId, creditsBalance: soraFailBalance ?? undefined });
            controller.close();
            return;
          }

          // NOT_START / IN_PROGRESS / PROCESSING → 继续轮询
        }

        // ====== 轮询超时 → Fire-and-Forget：任务仍在服务商排队，不退款不报错 ======
        console.log('[VIDEO] 后端轮询超时，任务转入后台异步处理，不退款');
        await sendEvent({ type: 'still_processing', taskId: clientRequestId, message: '视频仍在生成中，请稍后在历史记录中查看结果' });
        setTaskResult(clientRequestId, {
          status: 'processing',
          imageUrls: [],
          errors: [],
          createdAt: Date.now(),
        });
        controller.close();

      } catch (error) {
        console.error('[T8 Sora-2] 生成错误:', error);
        // 积分退还
        let soraExceptBalance = creditsBalanceAfterDeduct;
        if (userId && requiredCredits > 0) {
          const refundResult = await refundCredits(userId, requiredCredits, clientRequestId, 'T8 Sora-2 异常错误');
          soraExceptBalance = await safeGetCreditsBalance(refundResult.remaining, userId, creditsBalanceAfterDeduct);
          console.log(`[积分返还监控] #549 Sora异常错误: requiredCredits=${requiredCredits}, newBalance=${soraExceptBalance}`);
        }
        // #543 更新任务缓存
        if (clientRequestId) {
          setTaskResult(clientRequestId, {
            status: 'failed',
            imageUrls: [],
            errors: [{ index: 0, error: error instanceof Error ? error.message : '生成失败' }],
            creditsBalance: soraExceptBalance ?? undefined,  // #549
            createdAt: Date.now(),
            completedAt: Date.now(),
          });
        }
        await sendEvent({ 
          type: 'error', 
          error: sanitizeError(error, '生成失败'),
          taskId: clientRequestId,
          creditsBalance: soraExceptBalance ?? undefined,
        });
        controller.close();
      }
      })(); // 👈 #7xx 军师定海神针：自执行异步函数结束，不要 await！让轮询在后台异步运行！
    },
  }, { highWaterMark: 0 }); // #7xx 流缓冲根治：highWaterMark=0 阻止 ReadableStream 内部缓冲，每个 enqueue 立刻 Flush

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
