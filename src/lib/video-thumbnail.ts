/**
 * 视频缩略图生成工具
 * #689 TOPAIS 修复：视频模型未返回 thumbnailUrl 时，前端从视频第一帧截取缩略图
 * 
 * 使用 Canvas API 从视频中截取第一帧作为图片
 */

/**
 * 从视频 URL 生成缩略图
 * @param videoUrl 视频 URL（可以是 COS 签名 URL 或代理 URL）
 * @returns Promise<string> 缩略图 Base64 URL（用于 img.src）
 */
export async function generateVideoThumbnail(videoUrl: string): Promise<string> {
  // 创建隐藏的 video 元素
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.style.position = 'absolute';
  video.style.left = '-9999px';
  video.style.top = '-9999px';
  document.body.appendChild(video);

  try {
    // 等待视频加载到有足够数据
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('视频加载超时'));
      }, 10000); // 10秒超时

      video.onloadeddata = () => {
        clearTimeout(timeout);
        resolve();
      };

      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('视频加载失败'));
      };

      // 开始加载
      video.load();
    });

    // 确保视频有有效尺寸
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error('视频尺寸无效');
    }

    // 创建 Canvas 并绘制第一帧
    const canvas = document.createElement('canvas');
    // 限制缩略图最大尺寸（防止大视频占用过多内存）
    const maxSize = 400;
    const scale = Math.min(maxSize / video.videoWidth, maxSize / video.videoHeight, 1);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context 创建失败');
    }

    // 绘制视频第一帧到 Canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 转换为 Base64 URL
    const thumbnailUrl = canvas.toDataURL('image/jpeg', 0.85);

    // 清理
    document.body.removeChild(video);

    return thumbnailUrl;
  } catch (error) {
    // 清理
    if (document.body.contains(video)) {
      document.body.removeChild(video);
    }
    console.error('[generateVideoThumbnail] 生成缩略图失败:', error);
    throw error;
  }
}

/**
 * 尝试生成视频缩略图，失败时返回视频 URL 作为 fallback
 * @param videoUrl 视频 URL
 * @returns Promise<string> 缩略图 URL 或视频 URL（fallback）
 */
export async function generateVideoThumbnailOrFallback(videoUrl: string): Promise<string> {
  try {
    const thumbnailUrl = await generateVideoThumbnail(videoUrl);
    console.log('[generateVideoThumbnail] 成功生成缩略图');
    return thumbnailUrl;
  } catch (error) {
    console.warn('[generateVideoThumbnail] 缩略图生成失败，使用视频 URL 作为 fallback');
    return videoUrl;
  }
}