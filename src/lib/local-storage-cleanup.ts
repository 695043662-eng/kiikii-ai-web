/**
 * 集中式敏感 localStorage 清理工具
 * 
 * #890 终极全面清扫：统一管理所有与用户数据/画布/对话相关的 localStorage Key
 * 
 * 设计原则：
 * 1. 所有清理点（登出/401/未登录初始化/多标签页同步）统一调用此函数
 * 2. Key 分三类：用户数据（必须清）、用户偏好（账号切换清）、UI布局（不清）
 * 3. 新增敏感 Key 时只需在此文件添加，全站自动生效
 */

// ====== 第一类：用户数据 Key（包含对话/任务历史，必须清） ======
// #891 修复：canvas_data 不在此列表中！
// PLG模式：未登录用户也可以操作画布，登出时不清空画布数据
// 画布数据的清空由 CanvasContext 的 canvasPrevUserIdRef useEffect 负责（仅在账号切换 A→B 时清空）
const USER_DATA_KEYS = [
  'dialog-inputValue',        // 对话框输入草稿
  'dialog_messages',          // 对话消息历史（dialog-data-db）
  'dialog_input',             // 对话输入（dialog-data-db）
  'generationTasks',          // 生图任务历史
  'videoTasks',               // 视频任务历史
  'videoPromptHistory',       // 视频提示词历史
  'dislikedImages',           // 不喜欢的图片记录
  'submittedTaskIds',         // 已提交审核的任务ID
  'deletedImageUrls',         // 已删除的图片URL
  'presigned-url-cache',      // 预签名URL缓存
  'video-page-prompt',        // 视频页提示词草稿
] as const;

// ====== 第二类：用户偏好 Key（模型/比例/分辨率选择，账号切换时清） ======
const USER_PREFERENCE_KEYS = [
  'dialog-selectedModel',
  'dialog-modelTab',
  'dialog-selectedRatio',
  'dialog-selectedResolution',
  'dialog-selectedAspectRatio',
  'dialog-selectedCount',
  'dialog-selectedDuration',
  'dialog-hhOverrideMode',
  'video-page-model',
  'video-page-aspectRatio',
  'video-page-duration',
  'video-page-resolution',
  'video-page-hhOverrideMode',
  'model_config_cache',
  'api_config_cache',
  'defaultModels',
  'user_id',
  'userId',
  'user',
] as const;

// ====== 第三类：UI 布局 Key（跨账号通用，不清） ======
// rightPanelWidth, homepage_cards_full, homepage_custom_cards, history_cleared_at 等
// 这些是纯 UI 偏好，不含用户数据，无需清理

/**
 * 清空所有敏感 localStorage 数据
 * 
 * 调用场景：
 * - 用户登出（Navbar handleLogout）
 * - 401 Token 过期（auth-failure.ts triggerAuthExpired）
 * - 未登录初始化（CanvasContext/AIGeneratorContext 检测到未登录）
 * - 多标签页同步（storage 事件检测到另一 Tab 登出）
 * - 账号切换（isLoggedIn 从 true 变为 false）
 */
export function clearSensitiveLocalStorage(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const allKeys = [...USER_DATA_KEYS, ...USER_PREFERENCE_KEYS];
    let clearedCount = 0;
    
    for (const key of allKeys) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    }
    
    // 额外清理：IndexedDB 中的对话框参考图数据库
    try {
      // 清除 dialog-image-key-map 的映射
      localStorage.removeItem('dialog-image-key-map');
    } catch { /* ignore */ }
    
    console.log(`[LocalStorage] 已清空 ${clearedCount} 个敏感 Key（数据 ${USER_DATA_KEYS.length} + 偏好 ${USER_PREFERENCE_KEYS.length}）`);
  } catch (e) {
    console.error('[LocalStorage] 清空敏感数据失败:', e);
  }
}

/**
 * 仅清空用户数据 Key（保留偏好设置）
 * 
 * 调用场景：
 * - 未登录用户初始化时，只清数据不清偏好（偏好是通用的）
 */
export function clearUserDataLocalStorage(): void {
  if (typeof window === 'undefined') return;
  
  try {
    let clearedCount = 0;
    for (const key of USER_DATA_KEYS) {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        clearedCount++;
      }
    }
    console.log(`[LocalStorage] 已清空 ${clearedCount} 个用户数据 Key`);
  } catch (e) {
    console.error('[LocalStorage] 清空用户数据失败:', e);
  }
}

/**
 * 检查是否存在敏感用户数据
 * 用于判断是否需要清理
 */
export function hasSensitiveData(): boolean {
  if (typeof window === 'undefined') return false;
  return USER_DATA_KEYS.some(key => localStorage.getItem(key) !== null);
}

// ====== 多标签页同步机制 ======

/**
 * Auth Signal Key - 用于跨标签页同步登录状态
 * 
 * 原理：
 * - 登录成功后写入 { userId, ts } → 其他标签页的 storage 事件触发，无需操作
 * - 登出/401 时删除 → 其他标签页的 storage 事件触发，检测到删除，执行清理+弹窗
 * 
 * 注意：localStorage 的 storage 事件只在【其他标签页】触发，当前标签页不触发
 */
const AUTH_SIGNAL_KEY = 'auth_signal';

/**
 * 写入 auth_signal（登录成功后调用）
 */
export function setAuthSignal(userId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTH_SIGNAL_KEY, JSON.stringify({ userId, ts: Date.now() }));
  } catch { /* ignore */ }
}

/**
 * 删除 auth_signal（登出/401 后调用）
 * 删除后其他标签页会通过 storage 事件检测到
 */
export function removeAuthSignal(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(AUTH_SIGNAL_KEY);
  } catch { /* ignore */ }
}

/**
 * 检查 auth_signal 是否存在
 */
export function hasAuthSignal(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(AUTH_SIGNAL_KEY) !== null;
}

/**
 * 获取当前 auth_signal 中的 userId
 */
export function getAuthSignalUserId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_SIGNAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.userId || null;
  } catch { return null; }
}

/**
 * 注册跨标签页 storage 事件监听
 * 
 * 当检测到其他标签页删除了 auth_signal（即其他 Tab 登出）：
 * 1. 标记未登录
 * 2. 清空内存状态
 * 3. 清空敏感 localStorage
 * 4. 派发 openLogin 事件（触发 LoginModal）
 * 
 * 当检测到其他标签页写入了新的 auth_signal（即其他 Tab 登录了新账号）：
 * 1. 刷新用户信息（当前 Tab 自动同步到新账号）
 * 
 * @param onOtherTabLogout - 其他 Tab 登出时的回调
 * @param onOtherTabLogin - 其他 Tab 登录新账号时的回调
 * @returns cleanup 函数
 */
export function registerCrossTabAuthSync(options: {
  onOtherTabLogout: () => void;
  onOtherTabLogin: (userId: string) => void;
}): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleStorageChange = (event: StorageEvent) => {
    // 只关心 auth_signal 的变化
    if (event.key !== AUTH_SIGNAL_KEY) return;

    if (event.newValue === null) {
      // auth_signal 被删除 → 其他 Tab 登出了
      console.log('[CrossTabAuth] 检测到其他标签页登出，执行清理');
      options.onOtherTabLogout();
    } else if (event.newValue) {
      // auth_signal 被写入 → 其他 Tab 登录了（可能切换了账号）
      try {
        const parsed = JSON.parse(event.newValue);
        const newUserId = parsed.userId;
        if (newUserId) {
          console.log('[CrossTabAuth] 检测到其他标签页登录，userId:', newUserId);
          options.onOtherTabLogin(newUserId);
        }
      } catch { /* ignore invalid JSON */ }
    }
  };

  window.addEventListener('storage', handleStorageChange);
  return () => window.removeEventListener('storage', handleStorageChange);
}
