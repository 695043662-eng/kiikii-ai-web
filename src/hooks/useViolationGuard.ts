/**
 * 用户风控守卫 Hook
 * 
 * 封装连续失败警告弹窗和账号锁定弹窗的状态管理逻辑
 * 
 * 逻辑说明：
 * 1. 不使用 sessionStorage，改用 ref 跟踪
 * 2. 零写入解封：locked_until 过期自然失效
 * 3. 禁用判断用时间戳覆盖法，不再依赖 is_active
 * 4. 连续20次失败/违规 → 封禁6小时，成功1次清零
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const FAILED_ATTEMPTS_WARNING_THRESHOLD = 10;  // 第10次连续失败触发警告
const FAILED_ATTEMPTS_BAN_THRESHOLD = 20;      // 第20次连续失败触发封禁

export function useViolationGuard(
  failedAttempts: number,
  isBanned: boolean,
  lockedUntil: string | null,
) {
  // ====== 警告弹窗状态 ======
  const [showViolationWarning, setShowViolationWarning] = useState(false);
  
  // ====== 禁用弹窗状态 ======
  const [showBannedDialog, setShowBannedDialog] = useState(false);
  const [bannedRemainingMinutes, setBannedRemainingMinutes] = useState(0);
  
  // ====== 追踪上一次违规计数（不使用 sessionStorage）======
  const hasShownWarningRef = useRef(false);
  const prevFailedAttemptsRef = useRef(0);

  // ====== 监听违规计数变化 → 触发警告弹窗 ======
  useEffect(() => {
    // 1. 计数被重置（成功生成或解封后），清除标记
    if (failedAttempts === 0 && prevFailedAttemptsRef.current > 0) {
      console.log('[ViolationGuard] 计数重置，清除标记, 之前:', prevFailedAttemptsRef.current, '现在:', failedAttempts);
      hasShownWarningRef.current = false;
      setShowViolationWarning(false);
    }
    
    // 2. 从 <10 变为 >=10，触发警告弹窗
    if (!hasShownWarningRef.current && failedAttempts >= FAILED_ATTEMPTS_WARNING_THRESHOLD && prevFailedAttemptsRef.current < FAILED_ATTEMPTS_WARNING_THRESHOLD) {
      console.log('[ViolationGuard] 触发警告弹窗, 之前:', prevFailedAttemptsRef.current, '现在:', failedAttempts);
      hasShownWarningRef.current = true;
      setShowViolationWarning(true);
    }
    
    // 更新上一次的值
    prevFailedAttemptsRef.current = failedAttempts;
  }, [failedAttempts]);

  // ====== 监听禁用状态变化 → 触发禁用弹窗 ======
  useEffect(() => {
    if (isBanned) {
      // 使用时间戳覆盖法判断禁用
      if (lockedUntil) {
        const remaining = new Date(lockedUntil).getTime() - Date.now();
        if (remaining > 0) {
          const remainingMinutes = Math.max(1, Math.ceil(remaining / 60000));
          setBannedRemainingMinutes(remainingMinutes);
          setShowBannedDialog(true);
          console.log('[ViolationGuard] 账号锁定中，剩余:', remainingMinutes, '分钟');
        }
        // locked_until 已过期 → 自然解封，不显示弹窗
      } else {
        // 管理员手动禁用（永久），无解封时间
        setBannedRemainingMinutes(0);
        setShowBannedDialog(true);
        console.log('[ViolationGuard] 永久禁用（管理员手动）');
      }
    } else {
      // 已解封，关闭弹窗
      setShowBannedDialog(false);
    }
  }, [isBanned, lockedUntil]);

  // ====== 计算禁用进度百分比（用于弹窗倒计时）======
  const getBannedProgress = useCallback((): number => {
    if (!lockedUntil || !isBanned) return 0;
    const totalMs = 6 * 60 * 60 * 1000; // 6 小时
    const remainingMs = new Date(lockedUntil).getTime() - Date.now();
    return Math.max(0, Math.min(100, ((totalMs - remainingMs) / totalMs) * 100));
  }, [lockedUntil, isBanned]);

  return {
    // 警告弹窗
    showViolationWarning,
    setShowViolationWarning,
    
    // 禁用弹窗
    showBannedDialog,
    setShowBannedDialog,
    bannedRemainingMinutes,
    
    // 工具函数
    getBannedProgress,
  };
}
