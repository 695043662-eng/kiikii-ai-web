'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { VideoModelMode } from '@/components/ModelModeSwitcher';
// ⚠️ 防御机制：防止并发请求 + 幂等性保护
import { RequestLock, generateClientRequestId } from '@/lib/frontend-defense';
// ⚠️ 认证失效处理
import { handleAuthFailure } from '@/lib/auth-failure';
// #732 错误消息翻译
import { translateErrorMessage } from '@/lib/error-handler';

// ========== P0 防御：轮询绝对超时常量（物理斩断）==========
// 图片生成任务轮询上限：5 分钟（300,000ms）
export const IMAGE_POLL_ABSOLUTE_TIMEOUT = 30 * 60 * 1000; // 30 分钟，支持上游排队700秒+余量
// 视频生成任务前端轮询上限：5 分钟（300,000ms）
// 后端短轮询窗口 3 分钟后会发送 still_processing 事件，前端收到后立即放手
// 剩余的长时间等待由后台离线巡检 Cron (/api/cron/sync-video-status) 接管
export const VIDEO_POLL_ABSOLUTE_TIMEOUT = 30 * 60 * 1000; // 30 分钟，支持上游排队700秒+余量

/**
 * P0 防御：调用后端超时退费 API
 * 将任务状态标记为 timeout_failed 并执行 100% 退费
 * 幂等性：后端通过 status 检查防止重复退费
 */
async function requestTimeoutRefund(taskId: string, mode: 'image' | 'video'): Promise<{ success: boolean; creditsBalance?: number }> {
  try {
    console.log(`[GenService] ⏱️ P0 绝对超时斩断！请求退费: taskId=${taskId}, mode=${mode}`);
    const res = await fetch('/api/generation/timeout-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, type: mode }),
    });
    if (!res.ok) {
      console.error('[GenService] ⏱️ 超时退费请求失败:', res.status);
      return { success: false };
    }
    const data = await res.json();
    console.log('[GenService] ⏱️ 超时退费结果:', data);
    return { success: data.success === true, creditsBalance: data.creditsBalance };
  } catch (err) {
    console.error('[GenService] ⏱️ 超时退费请求异常:', err);
    return { success: false };
  }
}

// ========== 类型定义 ==========

// 生成进度
export interface GenProgress {
  completed: number;
  total: number;
  waiting?: number;
}

// 图片事件
export interface ImageEvent {
  index: number;
  url: string;
  key?: string;
  imageKey?: string;  // #493 后端 SSE 事件发送的字段名（优先于 key）
  providerUrl?: string | null;  // #525 混合架构：服务商原始URL（优先使用，省流量）
  status?: 'completed' | 'failed';
  error?: string;
  // 占位符信息
  placeholderId?: string;
}

// 单个图片项
export interface ImageItem {
  index: number;
  url: string | null;
  key: string | null;
  providerUrl?: string | null;  // #525 混合架构：服务商原始URL
  status: 'completed' | 'failed' | 'generating';
  error: string | null;
}

// 占位符信息（用于画布页面坐标锁定）
export interface PlaceholderInfo {
  id: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// 视频进度
export interface VideoProgress {
  progress: number;  // 0-100 百分比
  status: string;
}

// 视频事件
export interface VideoEvent {
  url: string;
  key?: string;
  imageKey?: string;  // #493 后端 SSE 事件发送的字段名（优先于 key）
  thumbnailUrl?: string;
  videoKey?: string;  // #616 视频文件 COS key（用于刷新恢复）
}

// 视频结果
export interface VideoResult {
  videos: string[];
  videoKeys?: string[];
  thumbnails?: string[];
  creditsCharged?: number;
  creditsBalance?: number;
}

// 生成结果
export interface GenResult {
  imageUrls: string[];
  imageKeys: string[];
  providerUrls?: (string | null)[];  // #525 混合架构：服务商原始URL数组
  imageItems?: ImageItem[];
  creditsCharged?: number;
  creditsBalance?: number;
  errors?: Array<{ index: number; error: string }>;
  // 占位符替换信息
  placeholderReplacements?: Array<{
    placeholderId: string;
    imageUrl: string;
    imageKey?: string;
    providerUrl?: string | null;  // #525 混合架构
    index: number;
  }>;
  // 视频相关（用于视频生成）
  videos?: string[];
  videoKeys?: string[];
  thumbnails?: string[];
  videoProgress?: number;
  // #209 新增：任务ID（用于幂等保存）
  taskId?: string;
  // #231 新增：用于生成历史记录
  source?: 'canvas' | 'generate';
  prompt?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
}

// 生成错误
export interface GenError {
  type: 'global' | 'item' | 'timeout' | 'banned' | 'violation_warning' | 'resolution_banned';  // #276 修复：新增 timeout 类型；#504 新增 banned 类型；#508 新增 violation_warning 类型；熔断新增 resolution_banned
  index?: number;
  message: string;
  taskId?: string;
  // 用于清理占位符
  placeholderIds?: string[];
  // 细粒度熔断：触发熔断的分辨率
  resolution?: string;
}

// 生成服务配置
export interface GenServiceConfig {
  // 生成模式
  mode?: 'image' | 'video';
  
  // #231 新增：来源标识（用于历史记录）
  source?: 'canvas' | 'generate';
  
  // API 端点
  apiEndpoint?: '/api/image-to-image' | '/api/text-to-image' | '/api/video/generate';
  
  // 请求参数
  prompt: string;
  model: string;
  resolution: string;
  aspectRatio: string;
  generationCount: number;
  images?: string[];
  isUrls?: boolean;
  md5Hashes?: string[];
  taskId?: string;
  userId?: string | number;
  quality?: string;  // #522 T8Star GPT 品质参数（low/medium/high/auto）
  enhancePrompt?: boolean;  // Veo 视频提示词增强
  enableUpsample?: boolean;  // Veo 视频 1080P 提升（仅 pro 模型）
  // 视频参数
  duration?: number;  // 视频时长（秒）
  size?: string;      // 视频清晰度（small/large）
  
  // HappyHorse 视频参数
  firstFrameUrl?: string;          // 首帧图片URL（i2v模式）
  inputVideoUrl?: string;          // 输入视频URL（video-edit模式）
  audioSetting?: 'auto' | 'origin'; // 音频设置（video-edit模式）
  hhMode?: VideoModelMode; // 视频子模式（HappyHorse + Seedance 2.0 + T8 Seedance）
  
  // #642 Seedance 2.0 / T8 Seedance 视频参数
  sd2Mode?: 't2v' | 'i2v-first-frame' | 'i2v-first-last-frame' | 'r2v'; // Seedance 2.0子模式
  t8seedanceMode?: string;           // T8 Seedance 子模式（全模态：t2v/i2v/i2v-first-frame/i2v-first-last-frame/r2v）
  lastFrameUrl?: string;              // 尾帧图片URL（i2v-first-last-frame模式）
  referenceImageUrls?: string[];      // 参考图片URL数组（r2v模式）
  referenceVideoUrls?: string[];      // 参考视频URL数组（r2v模式）
  referenceAudioUrls?: string[];      // 参考音频URL数组（r2v模式）
  generateAudio?: boolean;            // 是否生成音频（Seedance 2.0）
  
  // ========== 画布占位符支持（仅图片模式）==========
  // 如果提供这些回调，生成的图片会替换到对应占位符位置
  // #093 修复：增加 taskId 参数，让占位符在创建时就有 generationTaskId
  onBeforeGenerate?: (count: number, prompt: string, taskId: string) => PlaceholderInfo[];
  onImageReceived?: (data: ImageEvent) => void;
  // 【修正】onPlaceholderFailed：改为更新失败状态，而非删除
  // 调用方应使用 canvas.updateElement(elementId, { generationStatus: 'failed', generationError: error })
  onPlaceholderFailed?: (elementId: string, error: string) => void;
  
  // ========== 任务ID替换（干净替换法）==========
  // SSE 收到 start 事件时触发，将 elementId 对应的占位符的 generationTaskId 替换为 actualTaskId
  // 用于刷新后轮询恢复
  onActualTaskIdReceived?: (elementId: string, actualTaskId: string) => void;
  
  // ========== 视频模式回调（仅视频模式）==========
  onVideoProgress?: (progress: VideoProgress) => void;
  onVideoReceived?: (data: VideoEvent) => void;
  // Fire-and-Forget：后端轮询超时但任务仍在服务商排队
  onStillProcessing?: (data: { taskId: string; message: string }) => void;
  
  // ========== 积分扣费回调 ==========
  // #270 新增：任务开始时扣费后立即回调，让前端及时显示积分变化
  onCreditsDeducted?: (data: { creditsCharged: number; creditsBalance: number }) => void;
  
  // 回调
  onProgress?: (progress: GenProgress) => void;
  onComplete?: (result: GenResult) => void;
  onError?: (error: GenError) => void;
}

// 服务结果
export interface GenServiceResult {
  taskId: string;
  success: boolean;
  message?: string;
  stillProcessing?: boolean;
}

// 任务状态（用于轮询）
interface TaskStatus {
  status: 'pending' | 'generating' | 'completed' | 'failed';
  taskId?: string;  // #231 任务 ID
  imageUrls?: string[];
  imageKeys?: string[];
  providerUrls?: (string | null)[];  // #525 混合架构：服务商原始URL
  imageItems?: ImageItem[];
  error?: string;
  errors?: Array<{ index: number; error: string }>;
  creditsCharged?: number;
  creditsBalance?: number;
  // #637 视频/视频Key字段
  videos?: string[];
  videoKeys?: string[];
  // #231 新增：用于生成历史记录
  source?: string;
  prompt?: string;
  model?: string;
  resolution?: string;
  aspectRatio?: string;
}

// ========== 辅助函数 ==========

// 处理 imageItems 和 deletedUrls，返回正确的状态
export function processImageItemsWithDeletedFilter(
  imageUrls: string[],
  imageItems: ImageItem[] | undefined,
  errors: Array<{ index: number; error: string }> | undefined,
  deletedUrls?: Set<string>
): {
  orderedImages: string[];
  orderedImageKeys: string[];
  orderedProviderUrls: (string | null)[];  // #528 提取服务商原始URL
  newItemStatuses: ('pending' | 'completed' | 'failed' | 'generating')[];
  newItemErrors: (string | null)[];
} {
  let orderedImages: string[];
  let orderedImageKeys: string[];
  let orderedProviderUrls: (string | null)[];  // #528 服务商原始URL
  let newItemStatuses: ('completed' | 'failed' | 'generating')[];
  let newItemErrors: (string | null)[];

  if (imageItems && Array.isArray(imageItems)) {
    const completedItems = imageItems.filter((item) => item.status === 'completed' && item.url && !(deletedUrls?.has(item.url)));
    orderedImages = completedItems.map((item) => item.url as string);
    orderedImageKeys = completedItems.map((item) => item.key as string);
    orderedProviderUrls = completedItems.map((item) => item.providerUrl || null);  // #528 提取providerUrl
    
    newItemStatuses = imageItems.map((item) => {
      if (item?.url && deletedUrls?.has(item.url)) {
        return 'failed';
      }
      return item?.status || 'generating';
    });
    
    newItemErrors = imageItems.map((item) => {
      if (item?.url && deletedUrls?.has(item.url)) {
        return '已删除';
      }
      if (item?.status === 'failed' && item.error) {
        return item.error;
      }
      return item?.status === 'failed' ? '生成失败' : null;
    });
  } else {
    orderedImages = imageUrls.filter(url => !deletedUrls?.has(url));
    orderedImageKeys = [];
    orderedProviderUrls = [];  // #528 无imageItems时无providerUrl
    newItemStatuses = [];
    newItemErrors = [];
  }

  return { orderedImages, orderedImageKeys, orderedProviderUrls, newItemStatuses, newItemErrors };
}

// ========== useGenService Hook ==========

// ⚠️ 全局请求锁（单例模式）- 防止用户在生图期间触发并发请求
let globalRequestLock: InstanceType<typeof RequestLock> | null = null;

function getRequestLock(): InstanceType<typeof RequestLock> {
  if (!globalRequestLock) {
    globalRequestLock = new RequestLock();
  }
  return globalRequestLock;
}

export function useGenService() {
  // ⚠️ 防御：获取全局请求锁
  const requestLock = getRequestLock();
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const currentTaskIdRef = useRef<string | null>(null);
  const placeholdersRef = useRef<Map<number, PlaceholderInfo>>(new Map());

  // 停止轮询
  const stopPolling = useCallback((taskId: string) => {
    const timer = pollingTimersRef.current.get(taskId);
    if (timer) {
      clearTimeout(timer);
      pollingTimersRef.current.delete(taskId);
    }
  }, []);

  // 停止所有轮询
  const stopAllPolling = useCallback(() => {
    pollingTimersRef.current.forEach((timer) => {
      clearTimeout(timer);
    });
    pollingTimersRef.current.clear();
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 中断请求
  const abortRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  // 获取占位符 ID
  const getPlaceholderId = useCallback((index: number): string | undefined => {
    return placeholdersRef.current.get(index)?.id;
  }, []);

  // 轮询获取任务状态
  const pollTaskStatus = useCallback(async (
    taskId: string,
    apiEndpoint: string,
    config: GenServiceConfig,
    generationCount: number,
    deletedUrls?: Set<string>
  ): Promise<TaskStatus | null> => {
    // 【#852】轮询参数：60 次 × 3 秒 = 180 秒（3 分钟），与后端短轮询窗口对齐
    // 后端 3 分钟后发送 still_processing，前端收到后立即放手，剩余等待交给离线巡检 Cron
    const maxPolls = 60;
    const pollInterval = 3000;
    
    // 🔧 #224 诊断：记录轮询开始时间
    const pollStartTime = Date.now();
    // ⏱️ P0 防御：绝对超时时间戳（图片5分钟 / 视频15分钟）
    const absoluteTimeout = config.mode === 'video' ? VIDEO_POLL_ABSOLUTE_TIMEOUT : IMAGE_POLL_ABSOLUTE_TIMEOUT;
    console.log(`[GenService] ⏱️ P0 绝对超时上限: ${absoluteTimeout / 1000}s, mode: ${config.mode || 'image'}`);
    console.log('[GenService] #224 pollTaskStatus 开始:', { 
      taskId: taskId?.substring(0, 15), 
      apiEndpoint, 
      generationCount,
      maxPolls,
      pollInterval,
      isAborted: abortControllerRef.current?.signal.aborted
    });
    
    for (let i = 0; i < maxPolls; i++) {
      // 🔧 #224 诊断：检查中断状态
      if (abortControllerRef.current?.signal.aborted) {
        console.log('[GenService] #224 轮询已中断:', { 
          pollIndex: i, 
          elapsed: Date.now() - pollStartTime 
        });
        return null;
      }
      
      // ⏱️ P0 防御：绝对超时处理
      const elapsed = Date.now() - pollStartTime;
      if (elapsed > absoluteTimeout) {
        const currentMode = config.mode || 'image';
        console.error(`[GenService] ⏱️ P0 绝对超时触发！已轮询 ${elapsed / 1000}s，超过上限 ${absoluteTimeout / 1000}s，taskId: ${taskId}, mode: ${currentMode}`);
        
        if (currentMode === 'video') {
          // 视频任务：Fire-and-Forget 模式 — 不退款，任务转入后台异步处理
          console.log(`[GenService] 🎬 视频任务绝对超时，转入 Fire-and-Forget 模式，不退款。taskId: ${taskId}`);
          if (config.onStillProcessing) {
            config.onStillProcessing({ taskId, message: '视频仍在服务商排队生成中，请稍后在历史记录中查看结果' });
          }
          return {
            status: 'still_processing',
            taskId,
            message: `视频仍在生成中（已等待${Math.round(elapsed / 1000 / 60)}分钟），任务已转入后台，请稍后在历史记录中查看`,
          } as any;
        }
        
        // 图片任务：立即向后端请求超时退费
        const refundResult = await requestTimeoutRefund(taskId, 'image');
        // 通知前端积分余额更新
        if (refundResult.creditsBalance !== undefined && config.onCreditsDeducted) {
          config.onCreditsDeducted({ creditsCharged: 0, creditsBalance: refundResult.creditsBalance });
        }
        return { 
          status: 'failed', 
          error: `服务商响应超时（超过${absoluteTimeout / 1000 / 60}分钟），已停止等待并退还积分`,
          creditsBalance: refundResult.creditsBalance,
        } as any;
      }
      
      try {
        // #690 修复：轮询 URL 携带 userId + model，确保数据库兜底查询能命中
        const pollParams = new URLSearchParams({ taskId });
        if (config.userId) pollParams.set('userId', String(config.userId));
        if (config.model) pollParams.set('model', config.model);
        const requestUrl = `${apiEndpoint}?${pollParams.toString()}`;
        console.log(`[GenService] #224 轮询请求 #${i}:`, requestUrl);
        
        const response = await fetch(requestUrl, {
          signal: abortControllerRef.current?.signal,
        });
        
        console.log(`[GenService] #224 轮询响应 #${i}:`, { 
          status: response.status, 
          ok: response.ok 
        });
        
        if (!response.ok) {
          console.error('[GenService] #224 查询失败:', response.status);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          continue;
        }
        
        const data = await response.json();
        console.log(`[GenService] #224 轮询数据 #${i}:`, { 
          status: data.status, 
          imageUrls: data.imageUrls?.length,
          imageItems: data.imageItems?.length,
          completedCount: data.completedCount
        });
        
        if (data.status === 'completed') {
          const { orderedImages, orderedImageKeys, orderedProviderUrls, newItemStatuses, newItemErrors } = 
            processImageItemsWithDeletedFilter(
              data.imageUrls || [],
              data.imageItems,
              data.errors,
              deletedUrls
            );
          
          // #637 修复：视频模式返回视频数据
          const result: any = {
            status: 'completed',
            imageUrls: orderedImages,
            imageKeys: orderedImageKeys,
            providerUrls: orderedProviderUrls,  // #528 轮询路径也返回providerUrls
            imageItems: data.imageItems?.map((item: ImageItem, idx: number) => ({
              ...item,
              status: newItemStatuses[idx] || item.status,
              error: newItemErrors[idx] || item.error,
            })),
            creditsCharged: data.creditsCharged,
            creditsBalance: data.creditsBalance,
          };
          
          // #637 视频模式：传递 videos 和 videoKeys
          if (data.videos?.length) {
            result.videos = data.videos;
          }
          if (data.videoKeys?.length) {
            result.videoKeys = data.videoKeys;
          }
          
          return result;
        } else if (data.status === 'failed') {
          return {
            status: 'failed',
            error: data.error || '生成失败',
            errors: data.errors,
            creditsCharged: data.creditsCharged,    // #497 修复：轮询失败时携带积分信息
            creditsBalance: data.creditsBalance,    // #497 修复：轮询失败时携带积分余额
          };
        } else if (data.status === 'generating') {
          // #230 修复：如果 completedCount >= generationCount，认为任务完成
          const actualCompletedCount = data.completedCount || data.imageItems?.filter((item: ImageItem) => item.status === 'completed').length || 0;
          
          if (actualCompletedCount >= generationCount) {
            console.log(`[GenService] #230 后端状态滞后，但 completedCount=${actualCompletedCount} >= generationCount=${generationCount}，认为完成`);
            const { orderedImages, orderedImageKeys, orderedProviderUrls, newItemStatuses, newItemErrors } = 
              processImageItemsWithDeletedFilter(
                data.imageUrls || [],
                data.imageItems,
                data.errors,
                deletedUrls
              );
            
            // #637 修复：视频模式返回视频数据
            const result: any = {
              status: 'completed',
              imageUrls: orderedImages,
              imageKeys: orderedImageKeys,
              providerUrls: orderedProviderUrls,  // #528 轮询路径也返回providerUrls
              imageItems: data.imageItems?.map((item: ImageItem, idx: number) => ({
                ...item,
                status: newItemStatuses[idx] || item.status,
                error: newItemErrors[idx] || item.error,
              })),
              creditsCharged: data.creditsCharged,
              creditsBalance: data.creditsBalance,
              // #231 新增：用于生成历史记录
              source: config.source,
              prompt: config.prompt,
              model: config.model,
              resolution: config.resolution,
              aspectRatio: config.aspectRatio,
            };
            
            // #637 视频模式：传递 videos 和 videoKeys
            if (data.videos?.length) {
              result.videos = data.videos;
            }
            if (data.videoKeys?.length) {
              result.videoKeys = data.videoKeys;
            }
            
            return result;
          }
          
          config.onProgress?.({
            completed: data.completedCount || 0,
            total: generationCount,
            waiting: generationCount - (data.completedCount || 0),
          });
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        } else {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      } catch (error: any) {
        if (error.name === 'AbortError') {
          console.log('[GenService] #224 查询已中止 (AbortError):', { 
            errorMessage: error.message,
            elapsed: Date.now() - pollStartTime 
          });
          return null;
        }
        console.error('[GenService] #224 查询异常:', { 
          errorName: error.name, 
          errorMessage: error.message,
          elapsed: Date.now() - pollStartTime 
        });
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
    
    // 轮询超时，最后查询一次
    console.log('[GenService] #224 轮询超时，最后查询一次');
    try {
      const response = await fetch(`${apiEndpoint}?taskId=${taskId}`, {
        signal: abortControllerRef.current?.signal,
      });
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'completed') {
          const { orderedImages, orderedImageKeys, orderedProviderUrls } = 
            processImageItemsWithDeletedFilter(
              data.imageUrls || [],
              data.imageItems,
              data.errors,
              deletedUrls
            );
          
          // #637 修复：视频模式返回视频数据
          const result: any = {
            status: 'completed',
            imageUrls: orderedImages,
            imageKeys: orderedImageKeys,
            providerUrls: orderedProviderUrls,  // #528 最终查询也返回providerUrls
            imageItems: data.imageItems,
            creditsCharged: data.creditsCharged,
            creditsBalance: data.creditsBalance,
            // #231 新增：用于生成历史记录
            source: config.source,
            prompt: config.prompt,
            model: config.model,
            resolution: config.resolution,
            aspectRatio: config.aspectRatio,
          };
          
          // #637 视频模式：传递 videos 和 videoKeys
          if (data.videos?.length) {
            result.videos = data.videos;
          }
          if (data.videoKeys?.length) {
            result.videoKeys = data.videoKeys;
          }
          
          return result;
        }
      }
    } catch (error) {
      console.error('[GenService] 最终查询失败:', error);
    }
    
    // ⏱️ P0 防御：轮询次数耗尽仍未获得结果
    const currentMode = config.mode || 'image';
    console.error(`[GenService] ⏱️ P0 轮询次数耗尽(${maxPolls}次), taskId: ${taskId}, mode: ${currentMode}`);
    
    if (currentMode === 'video') {
      // 视频任务：Fire-and-Forget 模式 — 不退款，任务转入后台异步处理
      console.log(`[GenService] 🎬 视频任务轮询耗尽，转入 Fire-and-Forget 模式，不退款。taskId: ${taskId}`);
      if (config.onStillProcessing) {
        config.onStillProcessing({ taskId, message: '视频仍在服务商排队生成中，请稍后在历史记录中查看结果' });
      }
      return {
        status: 'still_processing',
        taskId,
        message: `视频仍在生成中（已轮询${maxPolls}次），任务已转入后台，请稍后在历史记录中查看`,
      } as any;
    }
    
    // 图片任务：请求超时退费
    const refundResult = await requestTimeoutRefund(taskId, 'image');
    if (refundResult.creditsBalance !== undefined && config.onCreditsDeducted) {
      config.onCreditsDeducted({ creditsCharged: 0, creditsBalance: refundResult.creditsBalance });
    }
    
    return { 
      status: 'failed', 
      error: '轮询超时，已停止等待并退还积分',
      creditsBalance: refundResult.creditsBalance,
    } as any;
  }, []);

  // 核心生成函数
  const generate = useCallback(async (config: GenServiceConfig): Promise<GenServiceResult> => {
    // ====== #7xx 军师拨云见日令：粉碎幽灵路由，强制分流！======
    // 问题：参数解构顺序导致 apiEndpoint 默认值在 mode 被赋值之前计算
    // 解决：先解构 mode，再在代码中强制计算 apiEndpoint
    const {
      mode = 'image',
      // 废弃这个幽灵默认值！
      // apiEndpoint = mode === 'video' ? '/api/video/generate' : '/api/image-to-image',
    } = config;
    
    // ====== 军师强制分流：写死 API 端点，绝不依赖解构顺序！======
    // 只要 mode 是 video（前面 page.tsx 已经写死判定），强制走视频路由！
    const apiEndpoint = mode === 'video' ? '/api/video/generate' : '/api/image-to-image';
    console.log('====== [军师拨云见日令] API 端点强制分流 ======');
    console.log('1. mode (来自 config):', config.mode);
    console.log('2. mode 默认值:', mode);
    console.log('3. 最终 apiEndpoint:', apiEndpoint);
    console.log('4. 视频路由判定: mode === "video" ?', mode === 'video');
    console.log('========================================');
    
    const {
      prompt,
      model,
      resolution,
      aspectRatio,
      generationCount,
      images,
      isUrls = false,
      md5Hashes,
      taskId: providedTaskId,
      userId,
      onBeforeGenerate,
    } = config;

    // ⚠️ 防御1：尝试获取锁（计数锁，支持 5 个并发）
    // 如果当前有 5 个任务在执行，会自动排队等待
    const acquired = await requestLock.acquire();
    if (!acquired) {
      console.log('[GenService] ⚠️ 获取锁失败');
      config.onError?.({
        type: 'global',
        message: '获取锁失败，请重试',
      });
      return { taskId: '', success: false, message: '获取锁失败' };
    }

    // ⚠️ 防御2：生成 client_request_id，用于幂等性保护
    const clientRequestId = requestLock.getClientRequestId();
    console.log('[GenService] ✅ 锁已获取，client_request_id:', clientRequestId, '当前并发:', requestLock.getActiveCount());

    // #093 修复：先生成 taskId，再创建占位符
    // 这样占位符在创建时就有 generationTaskId，刷新后也能恢复
    // #094 防弹微调：使用 crypto.randomUUID() 替代 Date.now()，避免高并发 ID 碰撞
    const taskId = providedTaskId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    currentTaskIdRef.current = taskId;
    console.log('[GenService] 预生成 taskId:', taskId);

    // 清空占位符映射
    placeholdersRef.current.clear();

    // ========== 画布占位符支持：生成前创建占位符 ==========
    let placeholderReplacements: Array<{ placeholderId: string; index: number }> = [];
    
    if (onBeforeGenerate) {
      console.log('[GenService] 创建占位符（带 taskId）...');
      const placeholders = onBeforeGenerate(generationCount, prompt, taskId);
      
      // 存储占位符映射
      placeholders.forEach((p, idx) => {
        placeholdersRef.current.set(idx, p);
        placeholderReplacements.push({ placeholderId: p.id, index: idx });
      });
      
      console.log('[GenService] 已创建占位符:', placeholderReplacements);
    }

    // 创建 AbortController
    abortControllerRef.current = new AbortController();
    
    // 构建请求体（⚠️ 防御3：添加 client_request_id）
    // #681 修复：删除回退逻辑！参数缺失必须报错！
    if (!resolution) {
      throw new Error('[useGenService] resolution 参数缺失！禁止回退默认值！');
    }
    const requestBody: Record<string, any> = {
      taskId,
      prompt: prompt.trim(),
      model,
      resolution: mode === 'video' ? resolution : resolution.toUpperCase(),  // 视频模式保留小写分辨率
      aspectRatio,
      generationCount,
      md5Hashes: md5Hashes || [],
      // 视频模式标识
      mode,
      // ⚠️ 幂等性保护：携带 client_request_id
      client_request_id: clientRequestId,
    };

    if (images && images.length > 0) {
      requestBody.images = images;
      requestBody.isUrls = isUrls;
    }

    if (userId) {
      requestBody.userId = userId;
    }

    // #522 T8Star GPT 品质参数
    // ⚠️ 铁律修复：始终传递 quality，不能因为 undefined 就跳过！
    // 后端依赖此字段，缺失会导致服务商收到的 Payload 没有 quality
    requestBody.quality = config.quality || 'auto';

    // Veo 视频参数
    if (config.enhancePrompt !== undefined) {
      requestBody.enhancePrompt = config.enhancePrompt;
    }
    if (config.enableUpsample !== undefined) {
      requestBody.enableUpsample = config.enableUpsample;
    }

    // 视频参数
    // #681 修复：duration 必须传递，禁止回退！
    if (mode === 'video' && !config.duration) {
      throw new Error('[useGenService] duration 参数缺失！视频模式必须传递 duration！');
    }
    if (config.duration !== undefined) {
      requestBody.duration = config.duration;
    }
    if (config.size) {
      requestBody.size = config.size;
    }

    // HappyHorse 视频参数
    if (config.firstFrameUrl) {
      requestBody.firstFrameUrl = config.firstFrameUrl;
    }
    if (config.referenceImageUrls && config.referenceImageUrls.length > 0) {
      requestBody.referenceImageUrls = config.referenceImageUrls;
    }
    if (config.inputVideoUrl) {
      requestBody.videoUrl = config.inputVideoUrl;
    }
    if (config.audioSetting) {
      requestBody.audioSetting = config.audioSetting;
    }
    if (config.hhMode) {
      requestBody.hhMode = config.hhMode;
    }
    // #642 Seedance 2.0 视频参数
    if (config.sd2Mode) {
      requestBody.sd2Mode = config.sd2Mode;
    }
    // T8 Seedance 全模态参数
    if (config.t8seedanceMode) {
      requestBody.t8seedanceMode = config.t8seedanceMode;
    }
    if (config.lastFrameUrl) {
      requestBody.lastFrameUrl = config.lastFrameUrl;
    }
    if (config.referenceImageUrls && config.referenceImageUrls.length > 0) {
      requestBody.referenceImageUrls = config.referenceImageUrls;
    }
    if (config.referenceVideoUrls && config.referenceVideoUrls.length > 0) {
      requestBody.referenceVideoUrls = config.referenceVideoUrls;
    }
    if (config.referenceAudioUrls && config.referenceAudioUrls.length > 0) {
      requestBody.referenceAudioUrls = config.referenceAudioUrls;
    }
    if (config.generateAudio !== undefined) {
      requestBody.generateAudio = config.generateAudio;
    }

    console.log('[GenService] 发送请求:', {
      taskId,
      model,
      resolution,
      aspectRatio,
      generationCount,
      imageCount: images?.length || 0,
      isUrls,
      quality: config.quality || 'auto',  // #522 品质参数
      placeholderCount: placeholderReplacements.length,
      userId: userId || '未传递',  // 🔒 军规日志
    });

    // ========== GenService 请求体日志 ==========
    console.log('[GenService请求体] ========== 发送给后端的完整参数 ==========');
    console.log('[GenService请求体] taskId:', taskId);
    console.log('[GenService请求体] model:', requestBody.model);
    console.log('[GenService请求体] duration:', requestBody.duration);
    console.log('[GenService请求体] resolution:', requestBody.resolution);
    console.log('[GenService请求体] size:', requestBody.size);
    console.log('[GenService请求体] aspectRatio:', requestBody.aspectRatio);
    console.log('[GenService请求体] mode:', requestBody.mode);
    console.log('[GenService请求体] generationCount:', requestBody.generationCount);
    console.log('[GenService请求体] images:', requestBody.images?.length || 0);
    console.log('[GenService请求体] hhMode:', requestBody.hhMode);
    console.log('[GenService请求体] sd2Mode:', requestBody.sd2Mode);
    console.log('[GenService请求体] quality:', requestBody.quality);  // #522 品质参数
    console.log('[GenService请求体] ============================================');

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        // 🛡️ 维度一：认证失效自动处理
        let errorMsg = `请求失败: ${response.status}`;
        let isAuthFailed = false;
        
        try {
          const errData = await response.json();
          if (errData.error) {
            errorMsg = errData.error;
            
            // 🔥 认证失效检测：401 或 "用户不存在" 等
            if (response.status === 401 || 
                errorMsg.includes('用户不存在') || 
                errorMsg.includes('未登录') ||
                errorMsg.includes('TOKEN_EXPIRED')) {
              isAuthFailed = true;
              handleAuthFailure(errorMsg, response.status);
              throw new Error('REDIRECT_TO_LOGIN');
            }
            
            // #504 禁用状态检测：403 + isBanned
            if (response.status === 403 && errData.isBanned) {
              console.log('[GenService] #504 收到禁用响应, bannedUntil:', errData.bannedUntil);
              config.onError?.({
                type: 'banned',
                message: errData.error || '账号已被禁用',
                taskId,
                placeholderIds: placeholderReplacements.map(p => p.placeholderId),
              });
              throw new Error('BANNED');
            }
            
            // ====== 细粒度熔断：429 + RESOLUTION_BANNED ======
            if (errData.errorCode === 'RESOLUTION_BANNED') {
              console.log('[GenService] 熔断触发，分辨率:', errData.resolution, '重试等待:', errData.retryAfterMs);
              config.onError?.({
                type: 'resolution_banned' as any,
                message: errData.message || '当前分辨率暂时不可用，请换一个分辨率或稍后重试',
                taskId,
                placeholderIds: placeholderReplacements.map(p => p.placeholderId),
                resolution: errData.resolution,
              });
              // 传递完整错误信息以便上层处理
              const bannedError: any = new Error(errData.message || '当前分辨率暂时不可用，请换一个分辨率或稍后重试');
              bannedError.errorCode = 'RESOLUTION_BANNED';
              bannedError.resolution = errData.resolution;
              bannedError.retryAfterMs = errData.retryAfterMs || 600000;
              throw bannedError;
            }
            
            if (errData.currentCredits !== undefined) {
              errorMsg = `积分不足（当前: ${errData.currentCredits}, 需要: ${errData.requiredCredits}）`;
            }
            
            // #497 修复：非流式错误响应中携带 creditsBalance 时，触发积分更新回调
            // 后端 catch 块全额返还积分后返回的 creditsBalance 需要前端同步
            if (errData.creditsBalance !== undefined && errData.creditsBalance !== null) {
              console.log('[GenService] #497 非流式错误响应携带积分余额:', errData.creditsBalance);
              config.onCreditsDeducted?.({
                creditsCharged: errData.creditsCharged ?? 0,
                creditsBalance: errData.creditsBalance,
              });
            }
          }
        } catch (jsonError: any) {
          // 如果是我们主动跳转的错误，继续抛出
          if (jsonError.message === 'REDIRECT_TO_LOGIN') {
            throw jsonError;
          }
          // 其他 JSON 解析错误，忽略
        }
        
        // 请求失败，清理占位符（非认证失效情况）
        if (!isAuthFailed && placeholderReplacements.length > 0) {
          placeholderReplacements.forEach(({ placeholderId }) => {
            config.onPlaceholderFailed?.(placeholderId, errorMsg);
          });
        }
        
        throw new Error(errorMsg);
      }

      const contentType = response.headers.get('content-type');
      
      // ====== #721 重构：视频模式使用纯 HTTP 轮询，图片模式保留 SSE ======
      const isVideoMode = config.mode === 'video';
      
      if (isVideoMode && contentType?.includes('application/json')) {
        // ====== 视频模式：纯 HTTP 轮询架构 ======
        // POST 返回 JSON { taskId, status: 'submitted', creditsBalance }
        // 然后通过 GET /api/video/status?taskId=xxx 轮询进度
        console.log('[GenService] 🎬 #721 视频模式：纯 HTTP 轮询架构');
        
        const submitData = await response.json();
        console.log('[GenService] 🎬 任务已提交:', submitData);
        
        // 积分扣减回调
        if (submitData.creditsBalance !== undefined) {
          config.onCreditsDeducted?.({
            creditsCharged: submitData.creditsCharged ?? 0,
            creditsBalance: submitData.creditsBalance,
          });
        }
        
        // ====== 启动轮询器 ======
        // 策略：统一 3s/次，带抖动防脉冲
        // 熔断：连续 3 次失败自动停止
        // #721+1 防重叠锁：网络卡顿时防止前一次请求未返回就发下一次，导致乱序
        let pollInterval: ReturnType<typeof setInterval> | null = null;
        let pollCount = 0;
        let consecutiveFailures = 0;
        let lastProgress = -1;
        let isPollingActive = true;
        let isPollInFlight = false;  // #721+1 防重叠锁：true = 上一次 fetch 尚未返回
        const MAX_CONSECUTIVE_FAILURES = 3;
        const POLL_INTERVAL = 3000;     // #722 统一轮询间隔 3 秒，减轻服务器压力
        const JITTER_MAX = 200;        // 抖动上限 200ms
        // ⏱️ P0 防御：视频绝对超时 90 分钟
        const videoPollStartTime = Date.now();
        
        const doPoll = async () => {
          if (!isPollingActive) return;
          
          // ⏱️ P0 防御：视频绝对超时物理斩断 → Fire-and-Forget
          // 超时后不退款，任务转入后台异步处理，用户可在历史记录中查看最终结果
          const videoElapsed = Date.now() - videoPollStartTime;
          if (videoElapsed > VIDEO_POLL_ABSOLUTE_TIMEOUT) {
            console.log(`[GenService] ⏱️ 视频绝对超时触发！已轮询 ${videoElapsed / 1000}s，超过上限 ${VIDEO_POLL_ABSOLUTE_TIMEOUT / 1000}s，转入 Fire-and-Forget 模式！taskId: ${taskId}`);
            stopPolling();
            // 通知前端：任务仍在服务商排队，不退款
            config.onStillProcessing?.({
              taskId,
              message: `视频仍在生成中（已等待${Math.round(videoElapsed / 1000 / 60)}分钟），任务已转入后台处理。请稍后在历史记录中查看结果。`,
            });
            // 不清理占位符 — 保持 processing 状态，用户刷新后从历史记录恢复
            requestLock.release();
            return;
          }
          
          // #721+1 防重叠守卫：上一次请求还没回来，跳过本次，防止队列堆积和乱序
          if (isPollInFlight) {
            console.warn(`[GenService] 🎬 轮询#${pollCount + 1} 跳过：上一次请求尚未返回（防重叠锁生效）`);
            return;
          }
          isPollInFlight = true;
          pollCount++;
          
          try {
            const pollRes = await fetch(`/api/video/status?taskId=${taskId}`, {
              cache: 'no-store',
              signal: abortControllerRef.current?.signal,
            });
            
            if (!pollRes.ok) {
              consecutiveFailures++;
              console.warn(`[GenService] 🎬 轮询#${pollCount} 失败: HTTP ${pollRes.status}, 连续失败: ${consecutiveFailures}`);
              if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.error(`[GenService] 🎬 熔断触发：连续 ${MAX_CONSECUTIVE_FAILURES} 次失败，停止轮询`);
                stopPolling();
                config.onError?.({
                  type: 'global',
                  message: '进度查询连续失败，请刷新页面查看结果',
                  taskId,
                });
              }
              return;
            }
            
            // 成功，重置失败计数
            consecutiveFailures = 0;
            
            const pollData = await pollRes.json();
            console.log(`[GenService] 🎬 轮询#${pollCount}: progress=${pollData.progress}%, status=${pollData.status}`);
            
            // 进度更新回调
            if (typeof pollData.progress === 'number' && pollData.progress > lastProgress) {
              lastProgress = pollData.progress;
              config.onVideoProgress?.({
                progress: pollData.progress,
                status: pollData.progressStatus || pollData.status || 'processing',
              });
            }
            
            // 任务完成
            if (pollData.status === 'completed') {
              console.log('[GenService] 🎬 任务完成！', pollData);
              stopPolling();
              
              // #725 修复：视频轮询结果必须同时设置 videos/videoKeys 字段
              // 否则 onComplete 回调中 videoUrls = result.videos || [] 永远为空
              // 导致视频被当作图片处理，对话框显示"已生成1张图片"
              const pollVideos = pollData.videos || pollData.videoUrls || [];
              const pollVideoKeys = pollData.videoKeys || [];
              const pollImages = pollData.imageUrls || [];
              const pollImageKeys = pollData.imageKeys || [];
              const isVideoPoll = pollVideos.length > 0;

              const result: GenResult = {
                // #721+1 修复字段名不匹配：后端 status 路由返回 videos，前端之前只读 videoUrls/imageUrls
                imageUrls: isVideoPoll ? pollImages : (pollData.imageUrls || []),
                imageKeys: isVideoPoll ? pollImageKeys : (pollData.imageKeys || []),
                providerUrls: pollData.providerUrls || [],
                imageItems: pollData.imageItems,
                creditsCharged: pollData.creditsCharged,
                creditsBalance: pollData.creditsBalance,
                taskId,
                // #725 关键修复：视频模式必须传递 videos/videoKeys，否则 onComplete 判断 videoUrls.length===0
                videos: isVideoPoll ? pollVideos : undefined,
                videoKeys: isVideoPoll ? pollVideoKeys : undefined,
                thumbnails: pollData.thumbnails || undefined,
                placeholderReplacements: placeholderReplacements.map((p, idx) => ({
                  ...p,
                  imageUrl: (pollData.providerUrls?.[idx] || pollData.videos?.[idx] || pollData.videoUrls?.[idx] || pollData.imageUrls?.[idx]) || '',
                  imageKey: (pollData.videoKeys?.[idx] || pollData.imageKeys?.[idx]) || undefined,
                  providerUrl: pollData.providerUrls?.[idx] || undefined,
                })),
              };
              
              config.onComplete?.(result);
              requestLock.release();
            }
            
            // 任务失败
            if (pollData.status === 'failed') {
              console.error('[GenService] 🎬 任务失败:', pollData.error);
              stopPolling();
              
              // 清理占位符
              if (placeholderReplacements.length > 0) {
                placeholderReplacements.forEach(({ placeholderId }) => {
                  config.onPlaceholderFailed?.(placeholderId, pollData.error || '生成失败');
                });
              }
              
              config.onError?.({
                type: 'global',
                message: translateErrorMessage(pollData.error || '视频生成失败'),
                taskId,
              });
              requestLock.release();
            }
            
          } catch (e: any) {
            if (e.name === 'AbortError') {
              console.log('[GenService] 🎬 轮询已中止（用户取消）');
              stopPolling();
              return;
            }
            consecutiveFailures++;
            console.warn(`[GenService] 🎬 轮询#${pollCount} 异常: ${e.message}, 连续失败: ${consecutiveFailures}`);
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              console.error(`[GenService] 🎬 熔断触发：连续 ${MAX_CONSECUTIVE_FAILURES} 次失败，停止轮询`);
              stopPolling();
              config.onError?.({
                type: 'global',
                message: '进度查询连续失败，请刷新页面查看结果',
                taskId,
              });
            }
          } finally {
            // #721+1 释放防重叠锁：无论成功/失败/异常，都确保释放
            isPollInFlight = false;
          }
        };
        
        const stopPolling = () => {
          isPollingActive = false;
          isPollInFlight = false;  // #721+1 停止时重置防重叠锁
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
          console.log(`[GenService] 🎬 轮询已停止，共轮询 ${pollCount} 次`);
        };
        
        // 保存停止函数到 abortController，以便用户取消时停止轮询
        const origAbort = abortControllerRef.current?.abort.bind(abortControllerRef.current);
        if (abortControllerRef.current && origAbort) {
          abortControllerRef.current.abort = () => {
            stopPolling();
            origAbort();
          };
        }
        
        // 启动轮询：统一 3s，带抖动
        const scheduleNextPoll = () => {
          if (!isPollingActive) return;
          const jitter = Math.random() * JITTER_MAX;
          const nextInterval = POLL_INTERVAL + jitter;
          
          pollInterval = setTimeout(() => {
            doPoll().then(() => {
              // 如果任务仍在进行中，调度下一次轮询
              if (isPollingActive) {
                scheduleNextPoll();
              }
            });
          }, nextInterval) as unknown as ReturnType<typeof setInterval>;
        };
        
        // 立即执行第一次轮询
        doPoll().then(() => {
          if (isPollingActive) {
            scheduleNextPoll();
          }
        });
        
        return { taskId, success: true };
        
      } else if (contentType?.includes('text/event-stream')) {
        // ====== 图片模式：保留 SSE 流式处理 ======
        console.log('[GenService] 🖼️ 图片模式：SSE 流式处理');
        
        // 🔄 #720 进度轮询主通道：SSE 在代理/CDN 环境下会被缓冲（curl 直连正常但浏览器经代理缓冲）
        // GET 轮询是进度更新的【主通道】，SSE 进度事件仅作补充
        // 关键改动：
        //   1. 轮询频率从 2s 降到 1s（代理缓冲时轮询是唯一实时通道）
        //   2. SSE 流结束后继续轮询 30s（SSE 缓冲的事件可能通过 GET 获取）
        //   3. 轮询与 SSE 完全解耦，互不影响
        let progressPollTimer: ReturnType<typeof setInterval> | null = null;
        let lastPolledProgress = -1;
        let pollCount = 0;
        const isVideoMode = config.mode === 'video';
        
        if (isVideoMode && config.onVideoProgress) {
          console.log('[GenService] 🔄 #720 启动进度轮询主通道 (每3秒 GET), taskId:', taskId);
          const pollProgress = async () => {
            pollCount++;
            try {
              const pollRes = await fetch(`/api/video/generate?taskId=${taskId}`, {
                cache: 'no-store',  // #720 强制跳过浏览器缓存
              });
              if (pollRes.ok) {
                const pollData = await pollRes.json();
                if (typeof pollData.progress === 'number' && pollData.progress > lastPolledProgress) {
                  lastPolledProgress = pollData.progress;
                  console.log(`[GenService] 🔄 #720 轮询#${pollCount}: ${pollData.progress}% (status: ${pollData.progressStatus || pollData.status})`);
                  config.onVideoProgress?.({
                    progress: pollData.progress,
                    status: pollData.progressStatus || pollData.status || 'processing',
                  });
                }
                // #720 如果任务已完成（completed/failed），停止轮询
                if (pollData.status === 'completed' || pollData.status === 'failed') {
                  if (progressPollTimer) {
                    clearInterval(progressPollTimer);
                    progressPollTimer = null;
                    console.log(`[GenService] 🔄 #720 任务已结束(${pollData.status})，轮询停止`);
                  }
                }
              }
            } catch (e) {
              // 轮询失败静默忽略（2C2G 服务器可能偶尔超时）
            }
          };
          pollProgress(); // 立即执行第一次轮询
          progressPollTimer = setInterval(pollProgress, 3000); // #722 轮询降频：从 1000ms 改为 3000ms，减轻服务器压力
        }

        try {
          return await handleSSEStream(
            response, 
            taskId, 
            apiEndpoint, 
            config, 
            generationCount,
            placeholderReplacements,
            requestLock  // ⚠️ 防御：传递锁实例
          );
        } finally {
          // #720 SSE 流结束后，不立即停止轮询！
          // SSE 可能被代理缓冲，事件在流关闭时才一次性释放
          // 继续轮询 30 秒，确保 GET 通道能获取到最终状态
          if (progressPollTimer) {
            console.log('[GenService] 🔄 #720 SSE 流结束，轮询继续运行 30s 兜底...');
            const stopTimer = setTimeout(() => {
              if (progressPollTimer) {
                clearInterval(progressPollTimer);
                progressPollTimer = null;
                console.log('[GenService] 🔄 #720 30s 兜底轮询已停止');
              }
            }, 30000);
            // 如果轮询检测到任务已结束，会在 pollProgress 内部自动 clearInterval
            // 这里的 setTimeout 只是最终兜底
            const origTimer = progressPollTimer;
            const checkStopped = setInterval(() => {
              if (!progressPollTimer) {
                clearTimeout(stopTimer);
                clearInterval(checkStopped);
              }
            }, 2000);
          }
        }
      } else {
        console.log('[GenService] ❌ 非 SSE 流，contentType:', contentType, '尝试 JSON 解析...');
        const data = await response.json();
        
        if (data.success === false) {
          // 清理占位符
          if (placeholderReplacements.length > 0) {
            placeholderReplacements.forEach(({ placeholderId }) => {
              config.onPlaceholderFailed?.(placeholderId, data.error || '生成失败');
            });
          }
          throw new Error(data.error || '生成失败');
        }

        // 直接返回结果
        const result: GenResult = {
          imageUrls: data.imageUrls || [],
          imageKeys: data.imageKeys || [],
          providerUrls: data.providerUrls || [],  // #525 混合架构：服务商原始URL
          imageItems: data.imageItems,
          creditsCharged: data.creditsCharged,
          creditsBalance: data.creditsBalance,
          taskId,  // #209 新增：传递 taskId
          placeholderReplacements: placeholderReplacements.map((p, idx) => ({
            ...p,
            imageUrl: (data.providerUrls?.[idx] || data.imageUrls?.[idx]) || '',  // #525 优先服务商URL
            imageKey: data.imageKeys?.[idx] || undefined,
            providerUrl: data.providerUrls?.[idx] || undefined,  // #525 服务商原始URL
          })),
        };
        
        config.onComplete?.(result);
        // ⚠️ 防御4：成功完成，释放锁
        requestLock.release();
        return { taskId, success: true };
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('[GenService] 请求已中止');
        // 清理占位符
        if (placeholderReplacements.length > 0) {
          placeholderReplacements.forEach(({ placeholderId }) => {
            config.onPlaceholderFailed?.(placeholderId, '用户取消');
          });
        }
        // ⚠️ 防御5：用户取消，释放锁
        requestLock.release();
        return { taskId, success: false, message: '用户取消' };
      }
      
      // #504 禁用/认证错误不需要再触发全局错误
      if (error.message === 'BANNED' || error.message === 'REDIRECT_TO_LOGIN') {
        requestLock.release();
        return { taskId, success: false, message: error.message };
      }
      
      console.error('[GenService] 请求失败:', error);
      
      // 清理占位符
      if (placeholderReplacements.length > 0) {
        placeholderReplacements.forEach(({ placeholderId }) => {
          config.onPlaceholderFailed?.(placeholderId, translateErrorMessage(error.message || '网络错误'));
        });
      }
      
      config.onError?.({
        type: 'global',
        message: translateErrorMessage(error.message || '网络错误'),
        taskId,
        placeholderIds: placeholderReplacements.map(p => p.placeholderId),
      });
      // ⚠️ 防御6：请求失败，释放锁
      requestLock.release();
      return { taskId, success: false, message: error.message };
    } finally {
      // 清空占位符引用
      placeholdersRef.current.clear();
    }
  }, [abortRequest, requestLock]);

  // SSE 流处理
  const handleSSEStream = useCallback(async (
    response: Response,
    taskId: string,
    apiEndpoint: string,
    config: GenServiceConfig,
    generationCount: number,
    placeholderReplacements: Array<{ placeholderId: string; index: number }>,
    requestLock: InstanceType<typeof RequestLock>  // ⚠️ 防御：传递锁实例
  ): Promise<GenServiceResult> => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法读取响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let receivedCount = 0;
    let completedIndices = new Set<number>();
    let failedIndices = new Set<number>();
    let pendingPlaceholders = new Set(placeholderReplacements.map(p => p.placeholderId));
    let hasReceivedGlobalError = false;  // #544 标记是否收到全局错误事件，收到后不再启动轮询

    // 构建 index -> placeholderId 映射
    const indexToPlaceholderId = new Map<number, string>();
    placeholderReplacements.forEach(p => {
      indexToPlaceholderId.set(p.index, p.placeholderId);
    });

    // 处理单行数据
    const processLine = (line: string) => {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          
          switch (data.type) {
            case 'ping':
              break;
              
            case 'start':
              // 收到后端返回的 actualTaskId，触发干净替换
              console.log('[GenService] 收到 start 事件:', { taskId: data.taskId, count: data.count, placeholderCount: placeholderReplacements.length, creditsCharged: data.creditsCharged, creditsBalance: data.creditsBalance });
              if (data.taskId && config.onActualTaskIdReceived) {
                const actualTaskId = data.taskId;
                placeholderReplacements.forEach(({ placeholderId }) => {
                  console.log('[GenService] 触发 onActualTaskIdReceived:', { placeholderId, actualTaskId });
                  config.onActualTaskIdReceived!(placeholderId, actualTaskId);
                });
              }
              // #270 新增：任务开始时扣费后立即回调，让前端及时显示积分变化
              if (data.creditsBalance !== undefined && data.creditsCharged !== undefined) {
                console.log(`[GenService] #270 积分扣费回调: 扣除 ${data.creditsCharged}, 余额 ${data.creditsBalance}`);
                config.onCreditsDeducted?.({
                  creditsCharged: data.creditsCharged,
                  creditsBalance: data.creditsBalance,
                });
              }
              break;
              
            case 'image':
              if (data.url) {
                // 🔧 #451 修复：检测特殊标记（如 PROHIBITED_CONTENT）
                if (data.url.startsWith('(') && data.url.endsWith(')')) {
                  const errorType = data.url.slice(1, -1);
                  console.error(`[GenService] #451 收到特殊标记: ${errorType}, index: ${data.index}`);
                  
                  // 当作 item_failed 处理
                  if (data.index !== undefined) {
                    failedIndices.add(data.index);
                    const placeholderId = indexToPlaceholderId.get(data.index);
                    
                    const errorMessage = errorType === 'PROHIBITED_CONTENT' 
                      ? '内容违规，请修改提示词后重试' 
                      : `生成失败: ${errorType}`;
                    
                    config.onImageReceived?.({
                      index: data.index,
                      url: '',
                      error: errorMessage,
                      status: 'failed',
                      placeholderId,
                    });
                    
                    if (placeholderId) {
                      pendingPlaceholders.delete(placeholderId);
                      config.onPlaceholderFailed?.(placeholderId, errorMessage);
                    }
                  }
                  break;
                }
                
                receivedCount++;
                if (data.index !== undefined) {
                  completedIndices.add(data.index);
                }
                
                const placeholderId = data.index !== undefined 
                  ? indexToPlaceholderId.get(data.index) 
                  : undefined;
                
                config.onImageReceived?.({
                  index: data.index ?? receivedCount - 1,
                  url: data.url,
                  key: data.imageKey,  // 后端发送的是 imageKey，不是 key
                  providerUrl: data.providerUrl || null,  // #525 混合架构：服务商原始URL
                  status: 'completed',
                  placeholderId,
                });
                
                config.onProgress?.({
                  completed: receivedCount,
                  total: generationCount,
                });
              }
              break;
              
            case 'item_failed':
              if (data.index !== undefined) {
                failedIndices.add(data.index);
                const placeholderId = indexToPlaceholderId.get(data.index);
                
                config.onImageReceived?.({
                  index: data.index,
                  url: '',
                  error: translateErrorMessage(data.error || '提交失败'),
                  status: 'failed',
                  placeholderId,
                });
                
                if (placeholderId) {
                  pendingPlaceholders.delete(placeholderId);
                  config.onPlaceholderFailed?.(placeholderId, translateErrorMessage(data.error || '提交失败'));
                }
              }
              break;

            // ========== 视频进度事件 ==========
            case 'progress':
              // #7xx 净化：废弃高频诊断日志，只保留关键输出
              // #军师绝杀令：废弃 config.mode === 'video' 判断，只要后端发来真实进度就强制触发！
              if (data.progress !== undefined) {
                // 强制触发视频进度回调（无视 mode 状态）
                config.onVideoProgress?.({
                  progress: data.progress,
                  status: data.status || 'processing',
                });
                
                // 同时触发通用进度回调
                config.onProgress?.({
                  completed: data.progress,
                  total: 100,
                });
              }
              break;
              
            case 'video':
              // 视频生成完成（单个）
              if (config.mode === 'video' && data.url) {
                config.onVideoReceived?.({
                  url: data.url,
                  key: data.imageKey || data.key,
                  thumbnailUrl: data.thumbnailUrl,
                  videoKey: data.videoKey || data.video_key,  // #616 传递视频 COS key
                });
              }
              break;
              
            case 'videos':
              // 视频组完成（兼容某些 API 返回格式）
              if (config.mode === 'video' && data.videos) {
                data.videos.forEach((v: string, idx: number) => {
                  config.onVideoReceived?.({
                    url: v,
                    key: data.videoKeys?.[idx],
                    thumbnailUrl: data.thumbnails?.[idx],
                    videoKey: data.videoKeys?.[idx],  // #616 传递视频 COS key
                  });
                });
              }
              break;
              
            case 'error':
              // #504 如果是禁用错误，触发强制刷新用户信息
              if (data.isBanned) {
                console.log('[GenService] #504 收到禁用错误, bannedUntil:', data.bannedUntil);
                hasReceivedGlobalError = true;  // #544 收到全局错误，标记不再启动轮询
                // 立即触发 onError，让上层刷新用户信息
                config.onError?.({
                  type: 'banned',
                  message: data.error || data.message || '账号已被禁用',
                  taskId: data.taskId,
                  placeholderIds: placeholderReplacements.map(p => p.placeholderId),
                });
                break;
              }
              
              // ====== #551 细粒度熔断：处理分辨率熔断错误 ======
              if (data.errorCode === 'RESOLUTION_BANNED') {
                console.log('[GenService] 熔断触发（SSE 流），分辨率:', data.resolution, '重试等待:', data.retryAfterMs);
                hasReceivedGlobalError = true;
                config.onError?.({
                  type: 'resolution_banned' as any,
                  message: data.error || data.message || '当前分辨率暂时不可用，请换一个分辨率或稍后重试',
                  taskId: data.taskId,
                  placeholderIds: placeholderReplacements.map(p => p.placeholderId),
                  resolution: data.resolution,
                });
                // #276 积分余额回调
                if (data.creditsBalance !== undefined && data.creditsBalance !== null) {
                  console.log('[GenService] 熔断事件携带积分余额:', data.creditsBalance);
                  config.onCreditsDeducted?.({
                    creditsCharged: data.creditsCharged ?? 0,
                    creditsBalance: data.creditsBalance,
                  });
                }
                break;
              }
              
              if (data.index !== undefined) {
                failedIndices.add(data.index);
                const placeholderId = indexToPlaceholderId.get(data.index);
                
                config.onImageReceived?.({
                  index: data.index,
                  url: '',
                  error: data.error || '生成失败',
                  status: 'failed',
                  placeholderId,
                });
                
                if (placeholderId) {
                  pendingPlaceholders.delete(placeholderId);
                  config.onPlaceholderFailed?.(placeholderId, translateErrorMessage(data.error || '生成失败'));
                }
              } else if (data.taskId) {
                console.log('[GenService] #301 调用 onError 回调, taskId:', data.taskId, 'error:', data.error);
                hasReceivedGlobalError = true;  // #544 收到全局错误，标记不再启动轮询
                config.onError?.({
                  type: 'global',
                  message: translateErrorMessage(data.error || '生成失败'),
                  taskId: data.taskId,
                  placeholderIds: Array.from(pendingPlaceholders),
                });
              } else {
                console.log('[GenService] #301 error 事件缺少 taskId, data:', JSON.stringify(data));
              }
              
              // #276 修复：error 事件携带积分余额时，触发积分更新回调
              if (data.creditsBalance !== undefined && data.creditsBalance !== null) {
                console.log('[GenService] error 事件携带积分余额:', data.creditsBalance);
                config.onCreditsDeducted?.({
                  creditsCharged: data.creditsCharged ?? 0,
                  creditsBalance: data.creditsBalance,
                });
              }
              break;
              
            case 'banned':
              // #504 新增：处理账号禁用事件
              console.log('[GenService] #504 收到 banned 事件:', JSON.stringify(data));
              hasReceivedGlobalError = true;  // #544 收到全局错误，标记不再启动轮询
              config.onError?.({
                type: 'banned',
                message: data.message || data.error || '账号已被禁用',
                taskId: data.taskId,
                placeholderIds: Array.from(pendingPlaceholders),
              });
              break;

            case 'violation_warning':
              // #508 新增：处理违规警告事件（第5次违规），触发前端弹窗
              console.log('[GenService] #508 收到 violation_warning 事件:', JSON.stringify(data));
              hasReceivedGlobalError = true;  // #544 收到全局错误，标记不再启动轮询
              config.onError?.({
                type: 'violation_warning',
                message: data.message || '您已连续违规多次，请注意',
                taskId: data.taskId,
                placeholderIds: [],
              });
              break;

            case 'still_processing':
              // 视频任务后端轮询超时 → Fire-and-Forget：任务仍在服务商排队
              console.log('[GenService] 收到 still_processing 事件:', data);
              config.onStillProcessing?.({
                taskId: data.taskId,
                message: data.message || '视频仍在生成中，请稍后在历史记录中查看结果',
              });
              // 不触发 onError，让前端静默进入"任务列表"模式
              break;

            case 'timeout':
              // #276 新增：处理超时事件，携带积分余额
              console.log('[GenService] 收到 timeout 事件:', data);
              // #472 修复：立即处理 timeout 事件中的失败项
              if (data.imageItems && Array.isArray(data.imageItems)) {
                console.log('[GenService] #472 timeout 事件包含 imageItems:', data.imageItems);
                // 遍历所有待处理的占位符
                placeholderReplacements.forEach(p => {
                  const item = data.imageItems.find((img: any) => img.index === p.index);
                  if (item?.status === 'failed') {
                    console.log(`[GenService] #472 timeout 发现 index ${p.index} 失败: ${item.error}`);
                    config.onPlaceholderFailed?.(p.placeholderId, item.error || '生成失败');
                    pendingPlaceholders.delete(p.placeholderId);
                  }
                });
              }
              config.onError?.({
                type: 'timeout',
                message: data.message || '请求超时，请稍后查询结果',
                taskId: data.taskId,
                placeholderIds: Array.from(pendingPlaceholders),
              });
              // 更新积分余额
              if (data.creditsBalance !== undefined && data.creditsBalance !== null) {
                console.log('[GenService] timeout 事件携带积分余额:', data.creditsBalance);
                config.onCreditsDeducted?.({
                  creditsCharged: data.creditsCharged ?? 0,
                  creditsBalance: data.creditsBalance,
                });
              }
              break;
              
            case 'complete':
              console.log('[GenService] 收到 complete 事件, mode:', config.mode);
              
              // 处理所有占位符替换（仅图片模式）
              let result: GenResult;
              
              if (config.mode === 'video') {
                // #631 修复：视频模式下需要处理 data.videos 并调用 onVideoReceived
                const videos = data.videos || [];
                const videoKeys = data.videoKeys || [];
                const thumbnails = data.thumbnails || [];
                
                if (videos.length > 0) {
                  console.log('[GenService] #631 complete 事件中处理视频:', videos.length, '个');
                  videos.forEach((v: string, idx: number) => {
                    config.onVideoReceived?.({
                      url: v,
                      key: videoKeys[idx],
                      thumbnailUrl: thumbnails[idx],
                      videoKey: videoKeys[idx],
                    });
                  });
                }
                
                // 视频模式：返回视频结果
                result = {
                  imageUrls: [],
                  imageKeys: [],
                  videos: videos,
                  videoKeys: videoKeys,
                  thumbnails: thumbnails,
                  creditsCharged: data.creditsCharged,
                  creditsBalance: data.creditsBalance,
                  taskId,  // #209 新增：传递 taskId
                  // #231 新增：用于生成历史记录
                  source: config.source,
                  prompt: config.prompt,
                  model: config.model,
                };
              } else {
                // 图片模式：处理占位符替换
                // #229 修复：修复竞态条件 - 不要在 complete 中误杀正在异步处理的图片
                const replacements: Array<{
                  placeholderId: string;
                  index: number;
                  imageUrl: string;
                  imageKey?: string;
                }> = [];
                
                placeholderReplacements.forEach(p => {
                  const item = data.imageItems?.find((img: ImageItem) => img.index === p.index);
                  let imageUrl = item?.url || '';
                  const imageKey = item?.imageKey || item?.key;
                  const itemStatus = item?.status;
                  
                  // 🔧 #451 修复：检测特殊标记（如 PROHIBITED_CONTENT）
                  if (imageUrl.startsWith('(') && imageUrl.endsWith(')')) {
                    const errorType = imageUrl.slice(1, -1);
                    console.error(`[GenService] #451 complete 事件中检测到特殊标记: ${errorType}, index: ${p.index}`);
                    
                    const errorMsg = errorType === 'PROHIBITED_CONTENT' 
                      ? '内容违规，请修改提示词后重试' 
                      : `生成失败: ${errorType}`;
                    
                    config.onPlaceholderFailed?.(p.placeholderId, errorMsg);
                    pendingPlaceholders.delete(p.placeholderId);
                    return;  // 跳过这个占位符
                  }
                  
                  // #229 关键修复：检查是否在 SSE 流中已经收到了这张图片
                  // 如果 completedIndices 包含该索引，说明 onImageReceived 已经被调用，正在异步处理中
                  // 此时不要做任何操作，让异步操作自然完成
                  if (completedIndices.has(p.index)) {
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 已在 SSE 流中收到，跳过 complete 处理，等待异步完成`);
                    return; // 跳过，不做任何处理
                  }
                  
                  // 检查后端返回的状态
                  const isCompleted = itemStatus === 'completed';
                  const isFailed = itemStatus === 'failed';
                  
                  if (isCompleted && imageUrl) {
                    // 后端确认成功，且有 URL（可能是轮询恢复的情况）
                    replacements.push({
                      placeholderId: p.placeholderId,
                      index: p.index,
                      imageUrl,
                      imageKey,
                    });
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 后端确认成功，加入替换列表`);
                  } else if (isFailed) {
                    // 后端明确说失败了
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 后端确认失败`);
                    const errorMsg = item?.error || 
                                    data.errors?.find((e: { index: number; error: string }) => e.index === p.index)?.error || 
                                    '生成失败';
                    config.onPlaceholderFailed?.(p.placeholderId, errorMsg);
                    pendingPlaceholders.delete(p.placeholderId);
                  } else if (imageUrl) {
                    // 有 URL 但状态不明确，当作成功处理
                    replacements.push({
                      placeholderId: p.placeholderId,
                      index: p.index,
                      imageUrl,
                      imageKey,
                    });
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 有 URL，加入替换列表`);
                  } else {
                    // 没有任何信息，可能是还在处理中
                    console.log(`[GenService] #229 占位符 ${p.placeholderId} (index ${p.index}) 状态不明确，暂不处理`);
                  }
                });
                
                result = {
                  imageUrls: data.imageUrls || [],
                  imageKeys: data.imageKeys || [],
                  providerUrls: data.providerUrls || [],  // #525 混合架构
                  imageItems: data.imageItems,
                  creditsCharged: data.creditsCharged,
                  creditsBalance: data.creditsBalance,
                  errors: data.errors,
                  placeholderReplacements: replacements,
                  taskId,  // #209 新增：传递 taskId
                  // #231 新增：用于生成历史记录
                  source: config.source,
                  prompt: config.prompt,
                  model: config.model,
                  resolution: config.resolution,
                  aspectRatio: config.aspectRatio,
                };
              }
              
              config.onComplete?.(result);
              stopPolling(taskId);
              // ⚠️ 防御7：SSE 完成，释放锁
              requestLock.release();
              return true;
          }
        } catch (e) {
          console.error('[GenService] 解析事件失败:', e, line);
        }
      }
      return false;
    };

    // 读取流
    while (reader) {
      const { done, value } = await reader.read();
      
      if (done) {
        if (buffer.trim()) {
          const isComplete = processLine(buffer.trim());
          if (isComplete) {
            // ⚠️ 已在 processLine 的 complete 事件中释放锁
            return { taskId, success: true };
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const isComplete = processLine(line);
        // 🔧 #7xx 修复：让出控制权给浏览器，确保进度更新能实时渲染
        // 没有 yield 的话，多个 SSE 事件在同一同步循环中处理，
        // React 批量合并 dispatch，浏览器无法 repaint，进度永远不显示
        await new Promise(resolve => setTimeout(resolve, 0));
        if (isComplete) {
          // ⚠️ 已在 processLine 的 complete 事件中释放锁
          return { taskId, success: true };
        }
      }
    }

    // SSE 流结束，检查任务状态
    console.log('[GenService] SSE 流结束，检查任务状态...');
    
    // #544 修复：如果已收到全局错误事件（如 T8 API 400），不再启动轮询
    if (hasReceivedGlobalError) {
      console.log('[GenService] #544 已收到全局错误事件，跳过轮询，释放锁');
      // 清理所有未完成的占位符
      pendingPlaceholders.forEach(placeholderId => {
        config.onPlaceholderFailed?.(placeholderId, '生成失败');
      });
      requestLock.release();
      return { taskId, success: false, message: 'SSE 收到错误，已跳过轮询' };
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 🔧 #224 诊断：打印轮询参数
    console.log('[GenService] #224 开始轮询:', { taskId, apiEndpoint, generationCount });
    
    const taskStatus = await pollTaskStatus(
      taskId,
      apiEndpoint,
      config,
      generationCount
    );

    // 🔧 #224 诊断：打印轮询结果
    console.log('[GenService] #224 轮询结果:', taskStatus ? { 
      status: taskStatus.status, 
      imageUrls: taskStatus.imageUrls?.length,
      imageItems: taskStatus.imageItems?.map((item: any) => ({ index: item.index, status: item.status, error: item.error })),
    } : null);

    if (taskStatus) {
      if (taskStatus.status === 'completed') {
        // #472 修复：处理失败的占位符（部分成功部分失败的情况）
        console.log('[GenService] #472 检查失败占位符, placeholderReplacements:', placeholderReplacements.map(p => p.index));
        placeholderReplacements.forEach(p => {
          const item = taskStatus.imageItems?.find(img => img.index === p.index);
          console.log(`[GenService] #472 检查 index ${p.index}, item:`, item ? { status: item.status, error: item.error } : null);
          if (item?.status === 'failed') {
            console.log(`[GenService] #472 轮询发现 index ${p.index} 失败: ${item.error}`);
            config.onPlaceholderFailed?.(p.placeholderId, item.error || '生成失败');
            pendingPlaceholders.delete(p.placeholderId);
          }
        });

        // 构建占位符替换信息（只包含成功的）
        const replacements = placeholderReplacements.filter(p => {
          const item = taskStatus.imageItems?.find(img => img.index === p.index);
          return item?.status === 'completed' && item.url;
        }).map(p => {
          const item = taskStatus.imageItems?.find(img => img.index === p.index);
          return {
            placeholderId: p.placeholderId,
            index: p.index,
            imageUrl: item?.url || '',
            imageKey: item?.key || undefined,
          };
        });
        
        config.onComplete?.({
          imageUrls: taskStatus.imageUrls || [],
          imageKeys: taskStatus.imageKeys || [],
          providerUrls: taskStatus.providerUrls || [],  // #525 混合架构
          imageItems: taskStatus.imageItems,
          videos: taskStatus.videos,  // #637 修复：传递视频数据
          videoKeys: taskStatus.videoKeys,  // #637 修复：传递视频Key
          creditsCharged: taskStatus.creditsCharged,
          creditsBalance: taskStatus.creditsBalance,
          placeholderReplacements: replacements,
          taskId,  // #231 修复：轮询路径缺少 taskId 导致历史记录不保存
        });
        
        // #637 修复：视频模式轮询完成后调用 onVideoReceived
        if (config.mode === 'video' && taskStatus.videos?.length) {
          console.log('[GenService] #637 轮询完成，调用 onVideoReceived:', taskStatus.videos.length, '个视频');
          taskStatus.videos.forEach((v: string, idx: number) => {
            config.onVideoReceived?.({
              url: v,
              key: taskStatus.videoKeys?.[idx],
              videoKey: taskStatus.videoKeys?.[idx],
            });
          });
        }
        // ⚠️ 防御8：轮询完成，释放锁
        requestLock.release();
        return { taskId, success: true };
      } else if (taskStatus.status === 'failed') {
        // 清理所有未完成的占位符
        pendingPlaceholders.forEach(placeholderId => {
          config.onPlaceholderFailed?.(placeholderId, taskStatus.error || '生成失败');
        });
        
        // #497 修复：轮询失败时，携带积分余额更新回调
        if (taskStatus.creditsBalance !== undefined && taskStatus.creditsBalance !== null) {
          console.log('[GenService] #497 轮询失败携带积分余额:', taskStatus.creditsBalance);
          config.onCreditsDeducted?.({
            creditsCharged: taskStatus.creditsCharged ?? 0,
            creditsBalance: taskStatus.creditsBalance,
          });
        }
        
        config.onError?.({
          type: 'global',
          message: taskStatus.error || '生成失败',
          taskId,
          placeholderIds: Array.from(pendingPlaceholders),
        });
        // ⚠️ 防御9：轮询失败，释放锁
        requestLock.release();
        return { taskId, success: false, message: taskStatus.error };
      } else if ((taskStatus as any).status === 'still_processing') {
        // #851 Fire-and-Forget：后端轮询超时但任务仍在服务商排队，不报错不退款
        console.log('[GenService] #851 后端轮询超时，任务转入后台异步处理');
        config.onStillProcessing?.({
          taskId,
          message: (taskStatus as any).message || '视频仍在生成中，请稍后在历史记录中查看结果',
        });
        // ⚠️ 释放锁，但不报错
        requestLock.release();
        return { taskId, success: true, stillProcessing: true };
      }
    }

    // ⚠️ 防御10：未收到结果，释放锁
    requestLock.release();
    return { taskId, success: receivedCount > 0, message: receivedCount > 0 ? undefined : '未收到图片' };
  }, [stopPolling, pollTaskStatus, requestLock]);

  // ⚠️ P0.1 修复：组件卸载时清理所有轮询和SSE，防止内存泄漏
  useEffect(() => {
    return () => {
      stopAllPolling();
    };
  }, [stopAllPolling]);

  // 返回 Hook API
  return {
    generate,
    abortRequest,
    stopPolling,
    stopAllPolling,
    getPlaceholderId,
    currentTaskId: currentTaskIdRef.current,
  };
}

// ========== 导出辅助函数 ==========
// 注意：processImageItemsWithDeletedFilter 在文件末尾导出
