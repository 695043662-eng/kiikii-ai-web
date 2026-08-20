/**
 * 文件安全验证工具
 * 通过魔数（Magic Bytes）验证文件真实类型，防止 MIME Type 伪造攻击
 */

// 文件魔数签名表（前几个字节的特征值）
const MAGIC_SIGNATURES: Record<string, { signature: number[]; mime: string; ext: string }> = {
  // ====== 图片格式 ======
  // JPEG: FF D8 FF
  jpeg: { signature: [0xff, 0xd8, 0xff], mime: 'image/jpeg', ext: 'jpg' },
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  png: { signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: 'image/png', ext: 'png' },
  // GIF: 47 49 46 38
  gif: { signature: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif', ext: 'gif' },
  // WebP: 52 49 46 46 ... 57 45 42 50
  webp: { signature: [0x52, 0x49, 0x46, 0x46], mime: 'image/webp', ext: 'webp' },
};

// 允许的 MIME 类型（图片 + 视频）
const ALLOWED_MIME_TYPES = [
  // 图片
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  // 视频
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
];

// 最大文件大小（图片 50MB，视频 500MB）
const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
const MAX_VIDEO_SIZE = 500 * 1024 * 1024;

/**
 * 验证文件的魔数签名
 * @param buffer 文件 Buffer
 * @returns 检测到的文件类型，或 null 如果不是有效图片/视频
 */
export function detectFileType(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length < 8) {
    return null;
  }

  // ====== 图片格式 ======

  // 检查 JPEG
  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // 检查 PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }

  // 检查 GIF
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38
  ) {
    return { mime: 'image/gif', ext: 'gif' };
  }

  // 检查 WebP (RIFF....WEBP)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  // ====== 视频格式 ======

  // 检查 MP4 (ftyp box: 00 00 00 xx 66 74 79 70)
  // MP4 文件以 ftyp 开头，格式为 [size][ftyp][brand]
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    // 检查品牌标识符（常见：mp41, mp42, isom, M4V, etc.）
    const brand = buffer.slice(8, 12).toString('ascii').toLowerCase();
    if (brand.includes('mp4') || brand.includes('isom') || brand.includes('m4v') || brand.includes('avc1')) {
      return { mime: 'video/mp4', ext: 'mp4' };
    }
    // QuickTime MOV (ftyp qt)
    if (brand.includes('qt')) {
      return { mime: 'video/quicktime', ext: 'mov' };
    }
    // 默认 MP4
    return { mime: 'video/mp4', ext: 'mp4' };
  }

  // 检查 WebM/MKV (EBML header: 1A 45 DF A3)
  if (
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return { mime: 'video/webm', ext: 'webm' };
  }

  // 检查 AVI (RIFF....AVI)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x41 &&
    buffer[9] === 0x56 &&
    buffer[10] === 0x49 &&
    buffer[11] === 0x20
  ) {
    return { mime: 'video/x-msvideo', ext: 'avi' };
  }

  // 检查 MOV（另一种格式：moov atom）
  // 有些 MOV 文件不以 ftyp 开头，而是直接以 moov 或 mdat 开头
  if (buffer.length >= 8) {
    const atomType = buffer.slice(4, 8).toString('ascii');
    if (atomType === 'moov' || atomType === 'mdat' || atomType === 'wide') {
      return { mime: 'video/quicktime', ext: 'mov' };
    }
  }

  return null;
}

/**
 * 验证文件是否为有效图片/视频
 * @param buffer 文件 Buffer
 * @param declaredMime 声明的 MIME 类型（可选，用于日志）
 * @returns 验证结果
 */
export function validateImageFile(
  buffer: Buffer,
  declaredMime?: string
): { valid: boolean; detectedType?: { mime: string; ext: string }; error?: string } {
  // 检查文件是否为空
  if (buffer.length === 0) {
    return { valid: false, error: '文件为空' };
  }

  // 魔数验证 - 检测真实文件类型
  const detectedType = detectFileType(buffer);

  if (!detectedType) {
    // 记录可疑上传
    console.warn('[Security] 检测到非图片/视频文件上传:', {
      declaredMime,
      bufferStart: buffer.slice(0, 16).toString('hex'),
    });
    return { valid: false, error: '文件不是有效的图片或视频格式' };
  }

  // 检查文件大小（根据类型使用不同限制）
  const isVideo = detectedType.mime.startsWith('video/');
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (buffer.length > maxSize) {
    return {
      valid: false,
      error: `文件过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），超过${isVideo ? '500MB' : '50MB'}限制`,
    };
  }

  // 检查是否在允许列表中
  if (!ALLOWED_MIME_TYPES.includes(detectedType.mime)) {
    return { valid: false, error: `不支持的文件格式: ${detectedType.mime}` };
  }

  // 如果声明的 MIME 与检测到的不一致，记录警告但不拒绝
  // （某些工具导出的图片可能有轻微差异）
  if (declaredMime && declaredMime !== detectedType.mime) {
    console.warn('[Security] MIME 类型不一致:', {
      declared: declaredMime,
      detected: detectedType.mime,
    });
  }

  return { valid: true, detectedType };
}

/**
 * 验证 File 对象（用于 multipart/form-data 上传）
 */
export async function validateUploadedFile(
  file: File
): Promise<{ valid: boolean; detectedType?: { mime: string; ext: string }; error?: string }> {
  // 检查文件是否为空
  if (file.size === 0) {
    return { valid: false, error: '文件为空' };
  }

  // 🔧 #802 修复内存崩溃：只读取前 64 字节用于魔数验证
  // 之前 file.arrayBuffer() 会一次性读取整个文件（500MB 视频会 OOM）
  const headerSlice = file.slice(0, 64);
  const arrayBuffer = await headerSlice.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 魔数验证 - 检测真实文件类型
  const detectedType = detectFileType(buffer);

  if (!detectedType) {
    // 记录可疑上传
    console.warn('[Security] 检测到非图片/视频文件上传:', {
      declaredMime: file.type,
      bufferStart: buffer.slice(0, 16).toString('hex'),
    });
    return { valid: false, error: '文件不是有效的图片或视频格式' };
  }

  // 检查文件大小（根据类型使用不同限制）
  const isVideo = detectedType.mime.startsWith('video/');
  const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），超过${isVideo ? '500MB' : '50MB'}限制`,
    };
  }

  // 检查是否在允许列表中
  if (!ALLOWED_MIME_TYPES.includes(detectedType.mime)) {
    return { valid: false, error: `不支持的文件格式: ${detectedType.mime}` };
  }

  // 如果声明的 MIME 与检测到的不一致，记录警告但不拒绝
  if (file.type && file.type !== detectedType.mime) {
    console.warn('[Security] MIME 类型不一致:', {
      declared: file.type,
      detected: detectedType.mime,
    });
  }

  return { valid: true, detectedType };
}

/**
 * 验证 Base64 图片/视频数据
 */
export function validateBase64Image(
  base64Data: string
): { valid: boolean; detectedType?: { mime: string; ext: string }; error?: string; buffer?: Buffer } {
  try {
    // 提取 base64 内容（去掉 data:image/xxx;base64, 前缀）
    let base64Content = base64Data;
    let declaredMime: string | undefined;

    if (base64Data.includes(',')) {
      const [prefix, content] = base64Data.split(',');
      base64Content = content;

      const mimeMatch = prefix.match(/data:(image|video)\/[^;]+;/);
      if (mimeMatch) {
        declaredMime = prefix.match(/data:([^;]+);/)?.[1];
      }
    }

    // 解码 base64
    const buffer = Buffer.from(base64Content, 'base64');

    // 验证文件内容
    const result = validateImageFile(buffer, declaredMime);

    if (result.valid) {
      return { ...result, buffer };
    }

    return result;
  } catch (error) {
    return { valid: false, error: 'Base64 解码失败' };
  }
}
