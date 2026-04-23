/**
 * 图片压缩工具 - 生产环境防御级压缩
 * 
 * 核心规则：
 * - 长边 2048px
 * - JPEG 格式
 * - 质量 0.8
 * - 体积绝对禁止超过 3MB
 * - 若压缩 3 次仍超标，直接抛出 Alert 拦截上传
 */

import imageCompression from 'browser-image-compression';

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  wasCompressed: boolean;
}

export interface CompressionOptions {
  maxWidthOrHeight?: number;
  maxSizeMB?: number;
  quality?: number;
  maxAttempts?: number;
}

/**
 * 压缩单张图片
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {}
): Promise<CompressionResult> {
  const {
    maxWidthOrHeight = 2048,
    maxSizeMB = 3,
    quality = 0.8,
    maxAttempts = 3,
  } = options;

  const originalSize = file.size;
  const originalSizeMB = originalSize / (1024 * 1024);

  console.log(`[压缩] 开始压缩: ${file.name}`);
  console.log(`[压缩] 原始大小: ${originalSizeMB.toFixed(2)}MB`);
  console.log(`[压缩] 目标: 长边≤${maxWidthOrHeight}px, 大小≤${maxSizeMB}MB, 质量=${quality}`);

  // 如果文件已经是小文件且符合尺寸要求，跳过压缩
  if (originalSizeMB <= maxSizeMB * 0.5) {
    // 检查尺寸
    const dimensions = await getImageDimensions(file);
    if (dimensions.width <= maxWidthOrHeight && dimensions.height <= maxWidthOrHeight) {
      console.log(`[压缩] 文件已符合要求，跳过压缩`);
      return {
        file,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1,
        wasCompressed: false,
      };
    }
  }

  let currentFile = file;
  let currentQuality = quality;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    console.log(`[压缩] 第 ${attempt} 次尝试，质量: ${currentQuality}`);

    try {
      const options = {
        maxWidthOrHeight,
        useWebWorker: true,
        fileType: 'image/jpeg' as const,
        quality: currentQuality,
        initialQuality: currentQuality,
        alwaysKeepResolution: false,
        onProgress: (progress: number) => {
          if (progress % 20 === 0) {
            console.log(`[压缩] 进度: ${progress}%`);
          }
        },
      };

      const compressedFile = await imageCompression(currentFile, options);
      const compressedSizeMB = compressedFile.size / (1024 * 1024);

      console.log(`[压缩] 压缩后大小: ${compressedSizeMB.toFixed(2)}MB`);

      // 检查是否满足要求
      if (compressedFile.size <= maxSizeMB * 1024 * 1024) {
        console.log(`[压缩] ✅ 压缩成功！压缩比: ${(originalSize / compressedFile.size).toFixed(2)}x`);
        return {
          file: compressedFile,
          originalSize,
          compressedSize: compressedFile.size,
          compressionRatio: originalSize / compressedFile.size,
          wasCompressed: true,
        };
      }

      // 如果还是太大，降低质量重试
      currentQuality = Math.max(0.5, currentQuality - 0.1);
      currentFile = compressedFile;

    } catch (error) {
      console.error(`[压缩] 第 ${attempt} 次压缩失败:`, error);
      // 继续尝试
    }
  }

  // 压缩 3 次仍超标
  const finalSizeMB = currentFile.size / (1024 * 1024);
  const errorMsg = `图片压缩失败：压缩 ${maxAttempts} 次后仍为 ${finalSizeMB.toFixed(2)}MB，超过 ${maxSizeMB}MB 限制。请选择更小的图片。`;
  console.error(`[压缩] ❌ ${errorMsg}`);
  
  throw new Error(errorMsg);
}

/**
 * 批量压缩图片
 */
export async function compressImages(
  files: File[],
  options: CompressionOptions = {}
): Promise<CompressionResult[]> {
  console.log(`[压缩] 开始批量压缩 ${files.length} 张图片`);
  
  const results: CompressionResult[] = [];
  const errors: string[] = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const result = await compressImage(files[i], options);
      results.push(result);
    } catch (error) {
      const errorMsg = `图片 ${i + 1} 压缩失败: ${error instanceof Error ? error.message : '未知错误'}`;
      errors.push(errorMsg);
      console.error(`[压缩] ${errorMsg}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  console.log(`[压缩] ✅ 批量压缩完成，成功 ${results.length} 张`);
  return results;
}

/**
 * 获取图片尺寸
 */
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.width, height: img.height });
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法加载图片'));
    };
    
    img.src = url;
  });
}

/**
 * 验证图片是否符合要求（不压缩，仅验证）
 */
export async function validateImage(
  file: File,
  options: { maxSizeMB?: number; maxWidthOrHeight?: number } = {}
): Promise<{ valid: boolean; error?: string }> {
  const { maxSizeMB = 3, maxWidthOrHeight = 2048 } = options;
  
  // 检查文件大小
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > maxSizeMB) {
    return {
      valid: false,
      error: `图片大小 ${sizeMB.toFixed(2)}MB 超过限制 ${maxSizeMB}MB`,
    };
  }

  // 检查图片尺寸
  try {
    const dimensions = await getImageDimensions(file);
    if (dimensions.width > maxWidthOrHeight || dimensions.height > maxWidthOrHeight) {
      return {
        valid: false,
        error: `图片尺寸 ${dimensions.width}x${dimensions.height} 超过限制 ${maxWidthOrHeight}px`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: '无法读取图片尺寸',
    };
  }

  return { valid: true };
}

/**
 * File 转 Base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:image/xxx;base64, 前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('FileReader 错误'));
    reader.readAsDataURL(file);
  });
}

/**
 * 计算 MD5 哈希（用于去重）
 */
export async function calculateMD5(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('MD5', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
