/**
 * COS 上传辅助工具 - 统一抽取自 image-to-image/route.ts
 * 
 * 将重复的"下载URL→上传COS"和"Base64→上传COS"逻辑抽离为公共方法。
 * 所有方法都是纯函数，不依赖路由层状态。
 * 
 * #804 双桶分离：AI生成的图片/视频 → 1号桶(临时temp)
 * 按架构定义，AI生成素材属于临时资产，默认走 temp 桶
 */

import type { AssetType } from './cos';

interface UploadResult {
  url: string;       // COS 签名 URL
  key: string;       // COS Key
  providerUrl?: string;  // 服务商原始 URL（#525 混合架构）
}

/**
 * 从远程 URL 下载图片并上传到 COS
 * 使用 https 模块下载（兼容性优于 fetch，避免 undici 问题 #063）
 */
async function downloadImageBuffer(imageUrl: string): Promise<Buffer> {
  const https = await import('https');
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    https.get(imageUrl, (res) => {
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * 批量下载 URL 图片并上传到 COS（并行）
 * #804 AI生成图片 → 1号桶(临时temp)
 * 
 * @param urls - 图片 URL 数组
 * @param keyPrefix - COS key 前缀（用于区分来源），如 'url'、'sse'、'cc'
 * @param assetType - #804 桶类型：temp(默认)=1号桶, perm=2号桶
 * @returns 上传结果数组（过滤掉失败的）
 */
export async function downloadAndUploadToCOS(
  urls: string[],
  keyPrefix: string = 'url',
  assetType: AssetType = 'temp'
): Promise<UploadResult[]> {
  const { uploadToCOS } = await import('@/lib/cos');

  const uploadPromises = urls.map(async (imageUrl, index) => {
    try {
      const imageBuffer = await downloadImageBuffer(imageUrl);
      
      const extension = imageUrl.split('.').pop()?.split('?')[0] || 'png';
      const key = `generated-images/${Date.now()}-${keyPrefix}-${Math.random().toString(36).substring(7)}-${index}.${extension}`;
      
      const uploadResult = await uploadToCOS(key, imageBuffer, 'image/png', assetType);
      console.log(`[COS上传] ${keyPrefix} 第 ${index} 张图片上传成功: ${uploadResult.key} → ${assetType === 'perm' ? '2号桶' : '1号桶'}`);
      
      return { url: uploadResult.url, key: uploadResult.key, providerUrl: imageUrl };
    } catch (error) {
      console.error(`[COS上传失败] ${keyPrefix} 第 ${index} 张图片异常:`, error);
      // 上传失败时使用原始 URL 作为兜底（key 为 null）
      return { url: imageUrl, key: '' as string, providerUrl: imageUrl };
    }
  });

  return (await Promise.all(uploadPromises)).filter(r => r !== null) as UploadResult[];
}

/**
 * 批量上传 Base64 图片到 COS（并行）
 * #804 AI生成图片 → 1号桶(临时temp)
 * 
 * @param base64Items - Base64 字符串数组
 * @param keyPrefix - COS key 前缀，如 'b64'
 * @param assetType - #804 桶类型：temp(默认)=1号桶, perm=2号桶
 * @returns 上传结果数组（过滤掉失败的）
 */
export async function uploadBase64ImagesToCOS(
  base64Items: string[],
  keyPrefix: string = 'b64',
  assetType: AssetType = 'temp'
): Promise<UploadResult[]> {
  const { uploadToCOS } = await import('@/lib/cos');

  const uploadPromises = base64Items.map(async (b64Data, index) => {
    if (!b64Data) return null;

    try {
      const imageBuffer = Buffer.from(b64Data, 'base64');
      const key = `generated-images/${Date.now()}-${keyPrefix}-${Math.random().toString(36).substring(7)}-${index}.png`;
      const uploadResult = await uploadToCOS(key, imageBuffer, 'image/png', assetType);
      console.log(`[COS上传] ${keyPrefix} 第 ${index} 张 Base64 图片上传成功: ${uploadResult.key} → ${assetType === 'perm' ? '2号桶' : '1号桶'}`);
      
      return { url: uploadResult.url, key: uploadResult.key };
    } catch (error) {
      console.error(`[COS上传失败] ${keyPrefix} 第 ${index} 张 Base64 图片异常:`, error);
      return null;
    }
  });

  return (await Promise.all(uploadPromises)).filter(Boolean) as UploadResult[];
}

/**
 * 下载单个视频并上传到 COS
 * 用于视频生成网关：服务商返回的视频 URL → 腾讯云 COS
 * #804 AI生成视频 → 1号桶(临时temp)
 * 
 * @param videoUrl - 视频原始 URL
 * @param index - 视频序号（用于 key 命名）
 * @param assetType - #804 桶类型：temp(默认)=1号桶, perm=2号桶
 * @returns COS 签名 URL
 */
export async function downloadAndUploadVideoToCOS(
  videoUrl: string,
  index: number,
  assetType: AssetType = 'temp'
): Promise<{ url: string; key: string }> {
  const { uploadToCOS } = await import('@/lib/cos');

  console.log(`[COS视频上传] 下载视频 ${index + 1}: ${videoUrl.substring(0, 80)}... → ${assetType === 'perm' ? '2号桶' : '1号桶'}`);
  
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`下载视频失败: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  const key = `videos/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}.mp4`;
  const uploadResult = await uploadToCOS(key, buffer, 'video/mp4', assetType);
  
  console.log(`[COS视频上传] 视频 ${index + 1} 上传成功, key: ${uploadResult.key} → ${assetType === 'perm' ? '2号桶' : '1号桶'}`);
  return { url: uploadResult.url, key: uploadResult.key };
}

// ============================================================
// #862 Fire-and-Forget 双链路架构
// 后端立即返回 providerUrl + 预生成 imageKey，COS 上传后台静默执行
// ============================================================

/**
 * #862 预生成 COS key（不上传，仅生成 key 字符串）
 */
export function preGenerateCosKeys(
  urls: string[],
  keyPrefix: string = 'sse'
): string[] {
  return urls.map((url, index) => {
    const extension = url.split('.').pop()?.split('?')[0] || 'png';
    return `generated-images/${Date.now()}-${keyPrefix}-${Math.random().toString(36).substring(7)}-${index}.${extension}`;
  });
}

/**
 * #862 预生成视频 COS key（不上传）
 */
export function preGenerateVideoCosKey(index: number): string {
  return `videos/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}.mp4`;
}

/**
 * #862 后台静默上传图片到 COS（Fire-and-Forget）
 * 
 * 调用方不需要 await，直接 .catch() 即可。
 * 上传完成后通过 onUploadComplete 回调更新任务缓存。
 * 
 * @param urls - 服务商原始图片 URL 数组
 * @param keys - 预生成的 COS key 数组
 * @param keyPrefix - 来源标识（日志用）
 * @param assetType - 桶类型
 * @param onUploadComplete - 每张图片上传完成后的回调
 */
export async function backgroundUploadImagesToCOS(
  urls: string[],
  keys: string[],
  keyPrefix: string = 'sse',
  assetType: AssetType = 'temp',
  onUploadComplete?: (index: number, cosUrl: string, cosKey: string, providerUrl: string, success: boolean) => void
): Promise<void> {
  const { uploadToCOS } = await import('@/lib/cos');

  // 并行上传所有图片
  const uploadPromises = urls.map(async (imageUrl, index) => {
    try {
      const imageBuffer = await downloadImageBuffer(imageUrl);
      const uploadResult = await uploadToCOS(keys[index], imageBuffer, 'image/png', assetType);
      console.log(`[COS后台上传] ${keyPrefix} 第 ${index} 张图片上传成功: ${uploadResult.key}`);
      onUploadComplete?.(index, uploadResult.url, uploadResult.key, imageUrl, true);
    } catch (error) {
      console.error(`[COS后台上传失败] ${keyPrefix} 第 ${index} 张图片异常:`, error);
      onUploadComplete?.(index, imageUrl, keys[index], imageUrl, false);
    }
  });

  await Promise.allSettled(uploadPromises);
  console.log(`[COS后台上传] ${keyPrefix} 批量上传完成（${urls.length}张）`);
}

/**
 * #862 后台静默上传视频到 COS（Fire-and-Forget）
 */
export async function backgroundUploadVideoToCOS(
  videoUrl: string,
  cosKey: string,
  index: number,
  assetType: AssetType = 'temp',
  onUploadComplete?: (cosUrl: string, cosKey: string, success: boolean) => void
): Promise<void> {
  const { uploadToCOS } = await import('@/lib/cos');

  try {
    console.log(`[COS视频后台上传] 下载视频 ${index}: ${videoUrl.substring(0, 80)}...`);
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`下载视频失败: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const uploadResult = await uploadToCOS(cosKey, buffer, 'video/mp4', assetType);
    console.log(`[COS视频后台上传] 视频 ${index} 上传成功: ${uploadResult.key}`);
    onUploadComplete?.(uploadResult.url, uploadResult.key, true);
  } catch (error) {
    console.error(`[COS视频后台上传失败] 视频 ${index} 异常:`, error);
    onUploadComplete?.(videoUrl, cosKey, false);
  }
}
