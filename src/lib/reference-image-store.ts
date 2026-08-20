/**
 * 参考图文件存储
 * 不上传COS，使用本地URL代理
 * 存储到 /tmp 目录，避免 Next.js 热更新导致内存丢失
 */

import * as fs from 'fs';
import * as path from 'path';

const STORAGE_DIR = '/tmp/ref-images';

// 确保目录存在
try {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    console.log(`[RefImg] 创建存储目录: ${STORAGE_DIR}`);
  }
} catch (e) {
  console.error(`[RefImg] 创建目录失败:`, e);
}

// 清理过期图片（超过2小时）
const IMAGE_EXPIRY = 2 * 60 * 60 * 1000; // 2小时过期

/**
 * 清理过期文件
 */
function cleanupExpiredFiles() {
  try {
    const files = fs.readdirSync(STORAGE_DIR);
    const now = Date.now();
    let cleaned = 0;
    for (const file of files) {
      const filePath = path.join(STORAGE_DIR, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > IMAGE_EXPIRY) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch (e) {
        // 文件可能已被删除
      }
    }
    if (cleaned > 0) {
      console.log(`[RefImg] 清理了 ${cleaned} 个过期文件`);
    }
  } catch (e) {
    console.error(`[RefImg] 清理失败:`, e);
  }
}

// 启动时清理一次
cleanupExpiredFiles();

// 定期清理（每10分钟）
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredFiles, 10 * 60 * 1000);
}

interface ImageMeta {
  contentType: string;
  createdAt: number;
}

/**
 * 存储参考图，返回ID
 */
export function storeReferenceImage(base64: string): string {
  // 生成唯一ID
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  
  // 提取content type和base64数据
  let contentType = 'image/png';
  let base64Data = base64;
  if (base64.includes(',')) {
    const match = base64.match(/^data:(image\/\w+);base64,/);
    if (match) {
      contentType = match[1];
    }
    base64Data = base64.split(',')[1];
  }
  
  // 存储图片文件
  const imagePath = path.join(STORAGE_DIR, `${id}.bin`);
  const metaPath = path.join(STORAGE_DIR, `${id}.meta`);
  
  try {
    // 写入图片数据
    fs.writeFileSync(imagePath, base64Data, 'base64');
    // 写入元数据
    const meta: ImageMeta = {
      contentType,
      createdAt: Date.now(),
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    
    console.log(`[RefImg] 存储图片: ${id}, 类型: ${contentType}, 大小: ${fs.statSync(imagePath).size} bytes`);
  } catch (e) {
    console.error(`[RefImg] 存储失败:`, e);
  }
  
  return id;
}

/**
 * 获取参考图
 */
export function getReferenceImage(id: string): { base64: string; contentType: string } | null {
  const imagePath = path.join(STORAGE_DIR, `${id}.bin`);
  const metaPath = path.join(STORAGE_DIR, `${id}.meta`);
  
  try {
    if (!fs.existsSync(imagePath) || !fs.existsSync(metaPath)) {
      console.log(`[RefImg] 图片不存在: ${id}`);
      return null;
    }
    
    // 读取图片和元数据
    const base64Data = fs.readFileSync(imagePath, 'base64');
    const meta: ImageMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    
    // 检查是否过期
    if (Date.now() - meta.createdAt > IMAGE_EXPIRY) {
      // 删除过期文件
      fs.unlinkSync(imagePath);
      fs.unlinkSync(metaPath);
      console.log(`[RefImg] 图片已过期: ${id}`);
      return null;
    }
    
    console.log(`[RefImg] 读取图片: ${id}, 类型: ${meta.contentType}`);
    return {
      base64: base64Data,
      contentType: meta.contentType,
    };
  } catch (e) {
    console.error(`[RefImg] 读取失败:`, e);
    return null;
  }
}

/**
 * 获取图片数量
 */
export function getImageCount(): number {
  try {
    const files = fs.readdirSync(STORAGE_DIR);
    return files.filter(f => f.endsWith('.bin')).length;
  } catch {
    return 0;
  }
}
