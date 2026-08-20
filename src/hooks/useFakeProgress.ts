'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * #655 双模态智能假进度引擎
 * 
 * 当后端不推送真实 progress 时，前端用减速曲线 + 随机抖动模拟进度。
 * 核心规则：
 *   1. 进度绝不会倒退（只增不减）
 *   2. 最大不超过 95%（留给真实完成时跳 100%）
 *   3. ±2% 随机抖动制造"系统活动感"
 *   4. 视频和图片使用不同的时间曲线
 * 
 * 【图片模式 3 段式变速齿轮算法】
 *   第一阶段 (0 - 15秒)：快速推进 0% → 80%，ease-out 二次方缓动
 *   第二阶段 (15 - 30秒)：缓慢推进 80% → 90%，ease-out 三次方缓动（明显减速感）
 *   第三阶段 (30秒以后)：极慢逼近 90% → 95%，指数衰减曲线（永不超过95%）
 * 
 * 使用方式：
 *   const { progress, start, stop, reset } = useFakeProgress({ mediaType: 'video' });
 *   start();  // 开始假进度
 *   stop();   // 暂停（真实进度接管时调用）
 *   reset();  // 重置到 0
 */

interface UseFakeProgressOptions {
  /** 媒体类型，决定时间曲线 */
  mediaType: 'image' | 'video';
  /** 更新间隔（毫秒），默认 500ms */
  intervalMs?: number;
  /** 最大假进度，默认 95 */
  maxProgress?: number;
  /** 进度变化回调 */
  onProgress?: (progress: number) => void;
  /** 初始是否启用（仅用于初始化，运行时用 start/stop 控制） */
  enabled?: boolean;
}

interface UseFakeProgressReturn {
  /** 当前假进度值（0-95） */
  progress: number;
  /** 开始假进度 */
  start: () => void;
  /** 停止假进度（不清零） */
  stop: () => void;
  /** 重置到 0 */
  reset: () => void;
  /** 手动设置进度值（真实进度覆盖时使用） */
  setProgress: (value: number) => void;
  /** 运行时切换媒体类型（视频/图片曲线切换） */
  setMediaType: (type: 'image' | 'video') => void;
}

// 视频曲线参数（#710 修复：极慢速，确保真进度能覆盖假进度）
// 后端轮询通常 30-60 秒才有首次真实进度（~45%），假进度必须远低于此值
const VIDEO_CURVE = {
  // 0-120秒：缓慢推至 30%（确保真进度到达时能覆盖）
  fastPhaseEnd: 120,      // 秒
  fastPhaseTarget: 30,    // %
  // 120-180秒：慢推至 40%
  slowPhaseEnd: 180,      // 秒
  slowPhaseTarget: 40,    // %
  // 180秒后：极慢逼近 50%
  crawlPhaseTarget: 50,   // %
  crawlPhaseDuration: 120, // 秒
};

// 图片曲线参数（3 段式变速齿轮算法）
const IMAGE_CURVE = {
  // 第一阶段 (0 - 15秒)：快速推进 0% → 80%，ease-out 二次方
  fastPhaseEnd: 15,           // 秒
  fastPhaseTarget: 80,        // %
  // 第二阶段 (15 - 30秒)：缓慢推进 80% → 90%，ease-out 三次方
  slowPhaseEnd: 30,           // 秒
  slowPhaseTarget: 90,        // %
  // 第三阶段 (30秒以后)：极慢逼近 90% → 95%，指数衰减（永不超过95%）
  crawlPhaseTarget: 95,        // %
  crawlPhaseDuration: 60,     // 秒（参考时长，实际用指数衰减曲线）
};

export function useFakeProgress(options: UseFakeProgressOptions): UseFakeProgressReturn {
  const {
    intervalMs = 500,
    maxProgress = 95,
    onProgress,
  } = options;

  const progressRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRunningRef = useRef(false);
  const mediaTypeRef = useRef(options.mediaType);

  // 🔧 闭包陷阱修复：用 ref 存储 onProgress，让 tick/reset/setProgress 始终调用最新回调
  // 根因：onProgress 是内联函数（每次渲染新引用），tick 依赖 onProgress → setInterval 捕获旧 tick → 旧 onProgress → setMessages 不触发
  // 修复：tick 通过 onProgressRef.current 调用，不依赖 onProgress 的闭包，彻底消除陈旧引用
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // 允许运行时切换 mediaType
  const setMediaType = useCallback((type: 'image' | 'video') => {
    mediaTypeRef.current = type;
  }, []);

  // 曲线参数（根据当前 mediaType 动态获取）
  const getCurve = useCallback(() => {
    return mediaTypeRef.current === 'video' ? VIDEO_CURVE : IMAGE_CURVE;
  }, []);

  const calculateProgress = useCallback((elapsedSec: number): number => {
    let base: number;
    const curve = getCurve();
    const mediaType = mediaTypeRef.current;

    if (mediaType === 'image') {
      // ====== 图片模式：3 段式变速齿轮算法 ======
      if (elapsedSec < curve.fastPhaseEnd) {
        // 第一阶段 (0 - 15秒)：快速推进 0% → 80%
        // ease-out 二次方缓动：开头快后面慢
        const ratio = elapsedSec / curve.fastPhaseEnd;
        const easedRatio = 1 - Math.pow(1 - ratio, 2);
        base = easedRatio * curve.fastPhaseTarget;
      } else if (elapsedSec < curve.slowPhaseEnd) {
        // 第二阶段 (15 - 30秒)：缓慢推进 80% → 90%
        // ease-out 三次方缓动：明显的减速感
        const ratio = (elapsedSec - curve.fastPhaseEnd) / (curve.slowPhaseEnd - curve.fastPhaseEnd);
        const easedRatio = 1 - Math.pow(1 - ratio, 3);
        base = curve.fastPhaseTarget + easedRatio * (curve.slowPhaseTarget - curve.fastPhaseTarget);
      } else {
        // 第三阶段 (30秒以后)：极慢逼近 90% → 95%
        // 指数衰减曲线：1 - Math.exp(-t) 变体，越接近95%越慢，永不超过95%
        const t = elapsedSec - curve.slowPhaseEnd;
        const decayRate = 0.05; // 衰减率，控制逼近速度
        const easedRatio = 1 - Math.exp(-decayRate * t);
        base = curve.slowPhaseTarget + easedRatio * (curve.crawlPhaseTarget - curve.slowPhaseTarget);
        // 硬性保证：永不超过 95%
        base = Math.min(base, maxProgress - 0.01);
      }
    } else {
      // ====== 视频模式：保留原有逻辑 ======
      if (elapsedSec < curve.fastPhaseEnd) {
        const ratio = elapsedSec / curve.fastPhaseEnd;
        const easedRatio = 1 - Math.pow(1 - ratio, 2);
        base = easedRatio * curve.fastPhaseTarget;
      } else if (elapsedSec < curve.slowPhaseEnd) {
        const ratio = (elapsedSec - curve.fastPhaseEnd) / (curve.slowPhaseEnd - curve.fastPhaseEnd);
        const easedRatio = 1 - Math.pow(1 - ratio, 3);
        base = curve.fastPhaseTarget + easedRatio * (curve.slowPhaseTarget - curve.fastPhaseTarget);
      } else {
        const ratio = Math.min(1, (elapsedSec - curve.slowPhaseEnd) / curve.crawlPhaseDuration);
        const easedRatio = Math.log(1 + ratio * 9) / Math.log(10);
        base = curve.slowPhaseTarget + easedRatio * (curve.crawlPhaseTarget - curve.slowPhaseTarget);
      }
    }

    // 加入 ±2% 随机抖动
    const jitter = (Math.random() - 0.5) * 4; // ±2%
    base = base + jitter;

    // 确保不倒退（只增不减）
    base = Math.max(base, progressRef.current);

    // 确保不超过最大值
    base = Math.min(base, maxProgress);

    // 确保不低于 0
    base = Math.max(0, base);

    return Math.round(base);
  }, [getCurve, maxProgress]);

  // 🔧 tick 不再依赖 onProgress，通过 ref 调用最新回调 → tick 是稳定的
  const tick = useCallback(() => {
    if (!startTimeRef.current) return;
    const elapsedSec = (Date.now() - startTimeRef.current) / 1000;
    const newProgress = calculateProgress(elapsedSec);
    progressRef.current = newProgress;
    onProgressRef.current?.(newProgress);
  }, [calculateProgress]);

  const start = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    startTimeRef.current = Date.now();
    intervalRef.current = setInterval(tick, intervalMs);
  }, [tick, intervalMs]);

  const stop = useCallback(() => {
    isRunningRef.current = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // 🔧 reset 也通过 ref 调用 onProgress，不再依赖 onProgress 闭包
  const reset = useCallback(() => {
    stop();
    progressRef.current = 0;
    startTimeRef.current = null;
    onProgressRef.current?.(0);
  }, [stop]);

  // 🔧 setProgress 也通过 ref 调用 onProgress
  const setProgress = useCallback((value: number) => {
    const clampedValue = Math.max(0, Math.min(value, maxProgress));
    // 只增不减：真实进度必须大于当前假进度才覆盖
    if (clampedValue >= progressRef.current) {
      progressRef.current = clampedValue;
      onProgressRef.current?.(clampedValue);
    }
  }, [maxProgress]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    progress: progressRef.current,
    start,
    stop,
    reset,
    setProgress,
    setMediaType,
  };
}
