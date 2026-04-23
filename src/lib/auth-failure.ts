/**
 * 认证失效处理工具
 * 
 * 当后端返回 401 或 "用户不存在" 错误时，自动清理本地数据并跳转登录页
 */

/**
 * 检查是否是认证失效错误（需要跳转登录页）
 * 
 * 🔥 重要：只有"未登录"才跳转，"用户不存在"已由后端无感开户处理
 */
export function isAuthError(error: string, statusCode?: number): boolean {
  // 1. HTTP 状态码 401（但需要检查具体错误）
  if (statusCode === 401) {
    // 检查是否是真正的"未登录"
    const lowerError = error.toLowerCase();
    // 只有"未登录"相关错误才跳转
    const notLoggedInKeywords = [
      '未登录',
      'not logged in',
      'no user_id',
      'no token',
      'session expired',
      'token expired',
      'invalid token',
    ];
    
    // 排除"用户不存在"（后端已处理）
    if (lowerError.includes('用户不存在') || lowerError.includes('user not found')) {
      return false; // 后端已无感开户，不跳转
    }
    
    return notLoggedInKeywords.some(keyword => 
      lowerError.includes(keyword.toLowerCase())
    );
  }
  
  return false;
}

/**
 * 清理本地存储数据（彻底清理）
 */
export function clearAuthData(): void {
  if (typeof window === 'undefined') return;
  
  console.log('[Auth] 开始清理本地认证数据...');
  
  // 1. 彻底清理 localStorage
  localStorage.clear();
  
  // 2. 彻底清理 sessionStorage
  sessionStorage.clear();
  
  // 3. 清理所有可能的 Cookie
  const cookies = document.cookie.split(';');
  cookies.forEach(cookie => {
    const name = cookie.split('=')[0]?.trim();
    if (name) {
      // 清理多个路径下的 Cookie
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      document.cookie = `${name}=; path=/canvas; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      document.cookie = `${name}=; path=/api; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      // 清理带域名的 Cookie
      const domain = window.location.hostname;
      document.cookie = `${name}=; domain=${domain}; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  });
  
  console.log('[Auth] 本地认证数据已彻底清理');
}

/**
 * 认证失效处理
 * 1. 清理本地数据
 * 2. 跳转登录页（如果不在登录页）
 */
export function handleAuthFailure(
  error: string,
  statusCode?: number,
  customMessage?: string
): boolean {
  // 检查是否是认证失效错误
  if (!isAuthError(error, statusCode)) return false;
  
  // 🚫 死循环防护：如果当前已经在登录页，不再触发跳转和弹窗
  if (typeof window !== 'undefined') {
    const currentPath = window.location.pathname;
    if (currentPath === '/login' || currentPath.startsWith('/login')) {
      console.error('[Auth] 认证失效，但当前已在登录页，跳过跳转:', { error, statusCode, currentPath });
      return true;
    }
  }
  
  // 🔥 保留现场：打印错误详情
  console.error('[Auth] 认证失效:', { 
    error, 
    statusCode, 
    currentPath: typeof window !== 'undefined' ? window.location.pathname : 'SSR',
    timestamp: new Date().toISOString(),
  });
  
  // 1. 彻底清理本地数据
  clearAuthData();
  
  // 2. 显示提示
  const message = customMessage || '您的登录状态已过期或失效，请重新登录。';
  
  // 3. 跳转登录页
  if (typeof window !== 'undefined') {
    alert(message);
    window.location.href = '/login';
  }
  
  return true;
}

/**
 * 获取登录状态
 */
export function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  
  // 检查 Cookie 中是否有 user_id
  const cookies = document.cookie.split(';');
  const userIdCookie = cookies.find(c => c.trim().startsWith('user_id='));
  
  return !!userIdCookie;
}

/**
 * 获取当前用户 ID
 */
export function getCurrentUserId(): string | null {
  if (typeof window === 'undefined') return null;
  
  // 1. 从 Cookie 获取
  const cookies = document.cookie.split(';');
  const userIdCookie = cookies.find(c => c.trim().startsWith('user_id='));
  if (userIdCookie) {
    return userIdCookie.split('=')[1]?.trim() || null;
  }
  
  // 2. 从 localStorage 获取
  const localUserId = localStorage.getItem('user_id') || localStorage.getItem('userId');
  if (localUserId) {
    return localUserId;
  }
  
  return null;
}
