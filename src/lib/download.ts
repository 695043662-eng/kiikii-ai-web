/**
 * 纯前端下载工具函数
 * 使用 fetch 获取 Blob 数据，然后创建本地虚拟链接触发下载
 * 不经过后端代理，直接从 COS 下载
 */

/**
 * 下载单个文件
 * @param url 文件 URL（COS 签名 URL 或其他可直接访问的 URL）
 * @param filename 保存的文件名
 * @returns Promise<boolean> 是否下载成功
 */
export async function downloadFile(url: string, filename: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('[downloadFile] fetch 失败:', response.status, response.statusText);
      return false;
    }
    
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // 延迟释放 Blob URL，确保下载开始
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    
    return true;
  } catch (error) {
    console.error('[downloadFile] 下载失败:', error);
    return false;
  }
}

/**
 * #876 统一下载代理：通过后端 /api/download 下载，自动 COS 双桶 + fallbackUrl 回退
 * 彻底解决 CORS 和 window.open 报错鞭尸问题
 *
 * @param cosKey COS 对象 key（必需）
 * @param filename 保存文件名
 * @param fallbackUrl 服务商直链（可选，Node.js 代理无 CORS 限制）
 * @returns 是否下载成功
 */
export async function downloadViaProxy(
  cosKey: string,
  filename: string,
  fallbackUrl?: string
): Promise<boolean> {
  try {
    let proxyUrl = `/api/download?key=${encodeURIComponent(cosKey)}&filename=${encodeURIComponent(filename)}`;
    if (fallbackUrl && (fallbackUrl.startsWith('http://') || fallbackUrl.startsWith('https://'))) {
      proxyUrl += `&fallbackUrl=${encodeURIComponent(fallbackUrl)}`;
    }
    return await downloadFile(proxyUrl, filename);
  } catch (error) {
    console.error('[downloadViaProxy] 代理下载失败:', error);
    return false;
  }
}

/**
 * 批量下载多个文件（逐个下载，带间隔）
 * @param files 文件列表 [{ url, filename }]
 * @param interval 下载间隔（毫秒），默认 150ms
 */
export async function downloadMultiple(
  files: Array<{ url: string; filename: string }>,
  interval: number = 150
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  
  for (const file of files) {
    const result = await downloadFile(file.url, file.filename);
    if (result) {
      success++;
    } else {
      failed++;
    }
    // 间隔避免浏览器阻止
    if (interval > 0) {
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }
  
  return { success, failed };
}

/**
 * #862 功能隔离：获取元素的 COS 链接（用于下载/导出/发送给AI节点）
 * 绝对禁止使用 providerUrl，彻底杜绝 CORS 跨域报错 (Tainted Canvas)
 * @param element 画布元素
 * @returns COS 代理 URL 或 null
 */
export function getCOSUrlForElement(element: {
  imageKey?: string;
  imageUrl?: string;
  providerUrl?: string;
  videoKey?: string;
}): string | null {
  // 优先使用 imageKey/videoKey 生成 COS 代理 URL（跨域安全）
  const key = element.imageKey || element.videoKey;
  if (key) {
    // #876 架构重构：拼接 providerUrl 作为 fallbackUrl
    const providerUrl = element.providerUrl || (element as any).providerUrls?.[0];
    const fallbackParam = (providerUrl && (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')))
      ? `&fallbackUrl=${encodeURIComponent(providerUrl)}`
      : '';
    return `/api/canvas/image?key=${encodeURIComponent(key)}${fallbackParam}`;
  }
  // 如果没有 key，检查 imageUrl 是否是 COS 代理 URL（以 /api/ 开头）
  if (element.imageUrl && element.imageUrl.startsWith('/api/')) {
    return element.imageUrl;
  }
  // 最后兜底：如果 imageUrl 不是 providerUrl（不是 http 开头的外部链接），可以使用
  if (element.imageUrl && !element.imageUrl.startsWith('http') && element.imageUrl.startsWith('blob:')) {
    return element.imageUrl; // blob: URL 是本地安全的
  }
  // 彻底没有 COS 链接可用
  console.warn('[getCOSUrlForElement] 元素缺少 COS key，无法生成安全下载链接', element);
  return null;
}

/**
 * #863 修复：渲染层 URL 校验
 * 与 CanvasContext 的 isValidImageUrl 不同，此函数允许 blob: URL
 * 原因：sanitizeElements 已在恢复时清洗跨会话 blob:，活跃会话中的 blob: 是安全的
 */
export function isValidDisplayUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/api/') || url.startsWith('data:') || url.startsWith('blob:');
}

/**
 * #863 修复：双链路 Fallback 渲染公式
 * 优先级：providerUrl → imageUrl(含blob:) → videoUrl → COS代理URL → null
 *
 * 核心防线：当 imageUrl 为空（刷新后 saveStateToStorage 剥离了 imageUrl），
 * 但 imageKey 存在时，直接使用 COS 代理 URL 渲染，不依赖 onError 触发！
 *
 * @param el 画布元素（需包含 providerUrl/imageUrl/imageKey/videoUrl/videoKey）
 * @returns 渲染用 URL，null 表示无可用链接（调用方显示占位符）
 */
export function getImageSrcForElement(el: {
  providerUrl?: string;
  imageUrl?: string;
  imageKey?: string;
  videoUrl?: string;
  videoKey?: string;
}): string | null {
  // 1. providerUrl（白嫖服务商流量）
  if (el.providerUrl && (el.providerUrl.startsWith('http://') || el.providerUrl.startsWith('https://'))) {
    return el.providerUrl;
  }
  // 2. imageUrl（含 blob: 用于当前活跃会话；恢复时 blob: 已被 sanitizeElements 清洗）
  if (el.imageUrl && isValidDisplayUrl(el.imageUrl)) {
    return el.imageUrl;
  }
  // 3. videoUrl（视频元素）
  if (el.videoUrl && isValidDisplayUrl(el.videoUrl)) {
    return el.videoUrl;
  }
  // 4. Fallback：COS 代理 URL（从 imageKey/videoKey 生成）
  // #876 架构重构：拼接 providerUrl 作为 fallbackUrl，COS 双桶找不到时 Node.js 代理 fetch
  const key = el.imageKey || el.videoKey;
  if (key) {
    const providerUrl = el.providerUrl || (el as any).providerUrls?.[0];
    const fallbackParam = (providerUrl && (providerUrl.startsWith('http://') || providerUrl.startsWith('https://')))
      ? `&fallbackUrl=${encodeURIComponent(providerUrl)}`
      : '';
    return `/api/canvas/image?key=${encodeURIComponent(key)}${fallbackParam}`;
  }
  // 5. 全部为空，返回 null（由调用方决定占位符）
  return null;
}

/**
 * 获取文件的 Blob 数据（用于打包下载等场景）
 * @param url 文件 URL
 * @returns Promise<Blob | null>
 */
export async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.blob();
  } catch {
    return null;
  }
}
