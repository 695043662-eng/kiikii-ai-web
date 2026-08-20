/**
 * useAutoSave — 无感防抖自动保存 Hook
 *
 * 核心逻辑：
 * 1. 深度监听画布元素变化
 * 2. 防抖 3 秒后静默发送 autosave 请求
 * 3. 后端返回的 canvas_data（含 perm/ 转正后的 imageKey）静默回填到 Ref
 * 4. 绝不触发画布重渲染/闪烁
 * 5. 初始化加载：从后端拉取 workspace 还原状态
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import LZString from 'lz-string';

const { compressToBase64, decompressFromBase64 } = LZString;

// ==================== 类型定义 ====================

interface CanvasElement {
  id?: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageKey?: string;
  imageUrl?: string;
  [key: string]: unknown;
}

interface AutoSaveResponse {
  success: boolean;
  canvas_data: {
    elements: CanvasElement[];
    [key: string]: unknown;
  } | null;
  promoted_count: number;
  saved_at: string;
}

interface CasConflictData {
  /** 云端最新数据 */
  canvas_data: AutoSaveResponse['canvas_data'];
  /** 云端最新 updated_at */
  server_updated_at: string;
}

interface UseAutoSaveOptions {
  /** 用户 ID（登录后才有） */
  userId: string | null;
  /** 是否已登录 */
  isLoggedIn: boolean;
  /** 获取当前画布快照的函数 */
  getCanvasSnapshot: () => any;
  /** 将后端返回的 canvas_data 静默回填到画布 Ref 的函数 */
  applyServerData: (data: AutoSaveResponse['canvas_data']) => void;
  /** 防抖延迟（毫秒），默认 3000 */
  debounceMs?: number;
  /** 保存状态变更回调（可选，用于 UI 显示） */
  onSaveStatusChange?: (status: 'idle' | 'saving' | 'saved' | 'error') => void;
  /** #887 弊端1终极加固：CAS 冲突回调（收到 409 时由上层弹窗让用户决定是否覆盖） */
  onCasConflict?: (conflictData: CasConflictData) => void;
}

interface UseAutoSaveReturn {
  /** 当前保存状态 */
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  /** 最后一次保存时间 */
  lastSavedAt: string | null;
  /** 手动触发保存（用于离开页面前强制保存） */
  forceSave: () => Promise<boolean>;
  /** 画布变化时调用，触发防抖保存 */
  onCanvasChanged: () => void;
  /** 初始化加载状态 */
  isLoadingWorkspace: boolean;
  /** 加载 workspace 数据并还原到画布 */
  loadWorkspace: () => Promise<AutoSaveResponse['canvas_data'] | null>;
  /** 上次保存是否含资产转正 */
  lastPromotedCount: number;
}

// ==================== 工具函数 ====================

/**
 * 深度序列化用于变更检测（只比较元素结构，不比较临时 URL）
 */
function serializeForDiff(data: { elements: CanvasElement[]; [key: string]: unknown }): string {
  try {
    // 只保留影响画布状态的关键字段，排除签名 URL（会变但语义不变）
    const simplified = {
      ...data,
      elements: (data.elements || []).map((el: CanvasElement) => ({
        id: el.id,
        type: el.type,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        imageKey: el.imageKey || null,
        // 不含 imageUrl — 签名 URL 每次不同但语义相同
        name: el.name || null,
        sourceType: (el as Record<string, unknown>).sourceType || null,
        panelType: (el as Record<string, unknown>).panelType || null,
        panelRatio: (el as Record<string, unknown>).panelRatio || null,
        prompt: (el as Record<string, unknown>).prompt || null,
        sourceIds: (el as Record<string, unknown>).sourceIds || null,
        textContent: (el as Record<string, unknown>).textContent || null,
        connectedImageUrls: (el as Record<string, unknown>).connectedImageUrls || null,
        imageKeys: (el as Record<string, unknown>).imageKeys || null,
        videoKey: (el as Record<string, unknown>).videoKey || null,
        videoUrl: (el as Record<string, unknown>).videoUrl || null,
      })),
    };
    return JSON.stringify(simplified);
  } catch {
    return '';
  }
}

// ==================== Hook 实现 ====================

export function useAutoSave(options: UseAutoSaveOptions): UseAutoSaveReturn {
  const {
    userId,
    isLoggedIn,
    getCanvasSnapshot,
    applyServerData,
    debounceMs = 3000,
    onSaveStatusChange,
    onCasConflict,
  } = options;

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  const [lastPromotedCount, setLastPromotedCount] = useState(0);

  // Refs（不触发重渲染）
  const lastSnapshotRef = useRef<string>('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null); // #887 弊端2：最大等待时间 Throttle
  const firstChangeAtRef = useRef<number>(0); // #887 弊端2：首次未保存变更的时间戳
  const isSavingRef = useRef(false);
  const isMountedRef = useRef(true);
  const userIdRef = useRef(userId);
  const isLoggedInRef = useRef(isLoggedIn);
  const saveStatusRef = useRef(saveStatus);
  const pendingSaveRef = useRef(false); // 竞态保护：保存期间有新变更时标记
  const cloudUpdatedAtRef = useRef<string | null>(null); // #887 弊端3：CAS 乐观锁，记录云端 updated_at

  // 同步 Refs
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    isLoggedInRef.current = isLoggedIn;
  }, [isLoggedIn]);

  useEffect(() => {
    saveStatusRef.current = saveStatus;
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus, onSaveStatusChange]);

  // 组件卸载时清理
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current);
      }
    };
  }, []);

  // ==================== 核心保存函数 ====================

  const doSave = useCallback(async (): Promise<boolean> => {
    const currentUserId = userIdRef.current;
    const currentIsLoggedIn = isLoggedInRef.current;

    if (!currentUserId || !currentIsLoggedIn) {
      return false;
    }

    if (isSavingRef.current) {
      // 🛡️ 竞态保护：保存期间又有新变更，标记 pending 待重试
      // 防止"旧数据覆盖新数据"的 Lost Update 问题
      pendingSaveRef.current = true;
      return false; // 上一轮还没结束，跳过（但标记了待重试）
    }

    isSavingRef.current = true;
    pendingSaveRef.current = false; // 清除 pending 标记
    setSaveStatus('saving');

    try {
      const snapshot = getCanvasSnapshot();
      const rawJson = JSON.stringify(snapshot);
      // #887 弊端1: 压缩画布JSON，防止大JSON打满数据库和网络带宽
      const compressed = compressToBase64(rawJson);
      // #887 弊端3: 乐观锁(CAS)，防止多设备/多标签页旧覆盖新
      const casPayload: Record<string, unknown> = { canvas_data_compressed: compressed };
      if (cloudUpdatedAtRef.current) {
        casPayload.cloud_updated_at = cloudUpdatedAtRef.current;
      }
      const payload = JSON.stringify(casPayload);

      const response = await fetch('/api/canvas/autosave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        credentials: 'include',
      });

      // 🛡️ #887 弊端1终极加固：CAS乐观锁冲突 - 绝对禁止静默暴力覆盖！
      // 收到 409 时，把冲突数据和云端最新 updated_at 交给上层（CanvasContext → 弹窗让用户决定）
      if (response.status === 409) {
        const conflictData = await response.json();
        console.warn('[AutoSave] CAS冲突：云端数据已被其他会话更新，等待用户决定');

        // 更新本地 cloudUpdatedAt 为云端最新时间戳，避免再次冲突
        if (conflictData.server_updated_at) {
          cloudUpdatedAtRef.current = conflictData.server_updated_at;
        }

        if (onCasConflict && conflictData.canvas_data) {
          // 由上层弹窗让用户决定是否加载云端数据
          onCasConflict({
            canvas_data: conflictData.canvas_data,
            server_updated_at: conflictData.server_updated_at,
          });
        } else if (conflictData.canvas_data) {
          // 兜底：如果没有提供 onCasConflict 回调（不应发生），仍记录警告但不覆盖
          console.error('[AutoSave] CAS冲突但无 onCasConflict 回调，数据未覆盖（安全策略）');
        }

        if (isMountedRef.current) {
          setSaveStatus('error'); // 冲突时标记为 error，让 UI 显示提示
        }
        return false;
      }

      if (!response.ok) {
        // #887 鉴权终极加固：401 立即截断弹窗登录
        if (response.status === 401) {
          console.error('[AutoSave] 401 认证失效，立即截断');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('openLogin'));
          }
          return false;
        }
        console.error('[AutoSave] 保存失败:', response.status);
        if (isMountedRef.current) {
          setSaveStatus('error');
        }
        return false;
      }

      const data: AutoSaveResponse = await response.json();

      if (data.success && data.canvas_data) {
        // 关键：静默回填后端返回的 canvas_data
        // 后端可能已将 temp/ → perm/，前端需要同步
        applyServerData(data.canvas_data);

        // 更新快照，避免下次重复发送
        lastSnapshotRef.current = serializeForDiff(data.canvas_data as { elements: CanvasElement[]; [key: string]: unknown });

        if (data.promoted_count > 0) {
          console.log(`[AutoSave] 资产转正: ${data.promoted_count} 个 temp/ 素材已升级为 perm/`);
          setLastPromotedCount(data.promoted_count);
        }
      }

      if (isMountedRef.current) {
        setSaveStatus('saved');
        setLastSavedAt(data.saved_at || new Date().toISOString());
        // #887 弊端3: 保存成功后更新CAS时间戳
        if (data.saved_at) {
          cloudUpdatedAtRef.current = data.saved_at;
        }
      }

      return true;
    } catch (err) {
      console.error('[AutoSave] 保存异常:', err);
      if (isMountedRef.current) {
        setSaveStatus('error');
      }
      return false;
    } finally {
      isSavingRef.current = false;

      // 🛡️ Lost Update 兜底：保存期间有新变更被拦截，立即重试
      if (pendingSaveRef.current && isMountedRef.current) {
        console.log('[AutoSave] 检测到保存期间的新变更，立即重试');
        // 用 setTimeout 避免递归调用栈溢出，同时让 React 状态先更新
        setTimeout(() => {
          if (isMountedRef.current && !isSavingRef.current) {
            doSave();
          }
        }, 100);
      }
    }
  }, [getCanvasSnapshot, applyServerData, onCasConflict]);

  // ==================== 强制保存 ====================

  const forceSave = useCallback(async (): Promise<boolean> => {
    // 清除防抖计时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return doSave();
  }, [doSave]);

  // ==================== 加载 Workspace ====================

  const loadWorkspace = useCallback(async (): Promise<AutoSaveResponse['canvas_data'] | null> => {
    const currentUserId = userIdRef.current;
    const currentIsLoggedIn = isLoggedInRef.current;

    if (!currentUserId || !currentIsLoggedIn) {
      return null;
    }

    setIsLoadingWorkspace(true);
    try {
      const response = await fetch('/api/canvas/autosave', {
        method: 'GET',
        credentials: 'include',
      });

      if (!response.ok) {
        // #887 鉴权终极加固：401 立即截断弹窗登录
        if (response.status === 401) {
          console.error('[AutoSave] 401 认证失效，加载中止');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('openLogin'));
          }
        }
        console.error('[AutoSave] 加载 workspace 失败:', response.status);
        return null;
      }

      const data = await response.json();

      if (data.success && data.canvas_data) {
        let canvasData: AutoSaveResponse['canvas_data'] | null = null;
        // #887 弊端1: 解压画布JSON（兼容旧的未压缩数据）
        // 后端 GET 返回格式: 未压缩→原始JSON对象, 压缩→{_compressed:true, data:"base64string"}
        if (data.canvas_data && typeof data.canvas_data === 'object' && (data.canvas_data as Record<string, unknown>)._compressed) {
          const compressedStr = (data.canvas_data as Record<string, unknown>).data as string;
          // 🛡️ #887 弊端2终极加固：三层防爆解压
          // 第1层：尝试 lz-string decompressFromBase64
          try {
            const rawJson = decompressFromBase64(compressedStr);
            if (rawJson && typeof rawJson === 'string' && rawJson.length > 0) {
              canvasData = JSON.parse(rawJson) as AutoSaveResponse['canvas_data'];
              console.log('[AutoSave] 解压成功, 压缩大小:', compressedStr.length, '解压后:', rawJson.length);
            } else {
              // decompressFromBase64 返回 null → 数据损坏
              console.warn('[AutoSave] decompressFromBase64 返回 null，数据可能损坏，尝试降级解析');
            }
          } catch (decompressErr) {
            console.error('[AutoSave] 解压异常:', decompressErr);
          }

          // 第2层：解压失败 → 降级尝试直接 JSON.parse（兼容历史未压缩数据）
          if (!canvasData) {
            try {
              canvasData = JSON.parse(compressedStr) as AutoSaveResponse['canvas_data'];
              console.log('[AutoSave] 降级：直接JSON.parse成功（历史未压缩数据）');
            } catch (parseErr) {
              console.error('[AutoSave] 降级JSON.parse也失败:', parseErr);
            }
          }

          // 第3层：依然失败 → 强行回退 localStorage，绝不用空白覆盖画布
          if (!canvasData) {
            console.warn('[AutoSave] 所有解压方式失败，回退读取localStorage本地缓存');
            try {
              const localData = localStorage.getItem('canvas_data');
              if (localData) {
                canvasData = JSON.parse(localData) as AutoSaveResponse['canvas_data'];
                console.log('[AutoSave] localStorage回退成功，元素数:', canvasData?.elements?.length || 0);
              }
            } catch (localErr) {
              console.error('[AutoSave] localStorage回退也失败:', localErr);
            }
          }

          // 最终兜底：如果三层全失败，返回 null 但绝不用空对象覆盖
          if (!canvasData) {
            console.error('[AutoSave] 🚨 三层防爆全失败！返回null，绝不用空白覆盖画布！');
          }
        } else {
          canvasData = data.canvas_data;
        }

        if (canvasData) {
          // #887 弊端3: 记录云端 updated_at，作为 CAS 乐观锁的基准
          if (data.updated_at) {
            cloudUpdatedAtRef.current = data.updated_at;
          }
          // 更新快照，避免加载后立即触发保存
          lastSnapshotRef.current = serializeForDiff(canvasData as { elements: CanvasElement[]; [key: string]: unknown });
          console.log('[AutoSave] Workspace 加载成功, 元素数:', (canvasData as { elements: CanvasElement[] }).elements?.length || 0);
          return canvasData;
        }
      }

      return null;
    } catch (err) {
      console.error('[AutoSave] 加载 workspace 异常:', err);
      return null;
    } finally {
      if (isMountedRef.current) {
        setIsLoadingWorkspace(false);
      }
    }
  }, []);

  // ==================== 自动保存监听 ====================

  // 此函数由画布组件在元素变化时主动调用
  // 而不是用 useEffect 监听 elements 数组（避免闭包陷阱）
  const onCanvasChanged = useCallback(() => {
    const currentUserId = userIdRef.current;
    const currentIsLoggedIn = isLoggedInRef.current;

    if (!currentUserId || !currentIsLoggedIn) {
      return; // 未登录不保存
    }

    // 快照变更检测
    const currentSnapshot = serializeForDiff(getCanvasSnapshot());
    if (currentSnapshot === lastSnapshotRef.current) {
      return; // 没有实质性变更，跳过
    }

    // #887 弊端2：最大等待时间 Throttle
    // 记录首次未保存变更的时间，如果超过 maxWaitMs 强制保存
    const MAX_WAIT_MS = 10000; // 最多10秒必须保存一次
    if (firstChangeAtRef.current === 0) {
      firstChangeAtRef.current = Date.now();
    }
    const elapsed = Date.now() - firstChangeAtRef.current;

    // 清除上一次防抖
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 如果已经超过最大等待时间，立即保存
    if (elapsed >= MAX_WAIT_MS) {
      firstChangeAtRef.current = 0;
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      doSave();
      return;
    }

    // 设置新的防抖计时器
    debounceTimerRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      debounceTimerRef.current = null;
      firstChangeAtRef.current = 0; // 重置首次变更时间
      if (maxWaitTimerRef.current) {
        clearTimeout(maxWaitTimerRef.current);
        maxWaitTimerRef.current = null;
      }
      doSave();
    }, debounceMs);

    // 设置最大等待计时器（兜底，确保哪怕用户持续操作也不会无限延迟保存）
    if (!maxWaitTimerRef.current) {
      const remaining = MAX_WAIT_MS - elapsed;
      maxWaitTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        maxWaitTimerRef.current = null;
        // 如果防抖计时器还在，清除它并直接保存
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        firstChangeAtRef.current = 0;
        console.log('[AutoSave] #887 最大等待时间触发强制保存');
        doSave();
      }, remaining);
    }
  }, [getCanvasSnapshot, doSave, debounceMs]);

  // ==================== 页面离开前保存 ====================

  useEffect(() => {
    const handleBeforeUnload = () => {
      // 同步发送保存请求（best-effort）
      const currentUserId = userIdRef.current;
      const currentIsLoggedIn = isLoggedInRef.current;
      if (!currentUserId || !currentIsLoggedIn) return;

      const snapshot = getCanvasSnapshot();
      const payload = JSON.stringify({ canvas_data: snapshot });

      // #889 修复：使用 fetch + keepalive 替代 sendBeacon
      // sendBeacon 不发送 Cookie（credentials），导致后端 requireAuth 返回 401
      try {
        fetch('/api/canvas/autosave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          credentials: 'include',
          keepalive: true,
        });
      } catch {
        // best-effort，忽略错误
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [getCanvasSnapshot]);

  // ==================== 可见性变化时保存 ====================

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // 页面切到后台，立即保存
        forceSave();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [forceSave]);

  return {
    saveStatus,
    lastSavedAt,
    forceSave,
    isLoadingWorkspace,
    loadWorkspace,
    lastPromotedCount,
    onCanvasChanged, // 暴露给画布组件，元素变化时调用
  };
}

export default useAutoSave;
