/**
 * COS 前端直传工具
 * 
 * 防御机制：
 * 1. STS 权限收紧：只能上传到 upload_tmp/ 目录，文件最大 5MB
 * 2. 生命周期焚烧：upload_tmp/ 目录文件 24 小时自动删除
 * 3. 发牌限流：同一 IP 每分钟最多获取 5 次 STS 凭证
 */

import COS from 'cos-js-sdk-v5';

// STS 凭证缓存
interface STSCredentials {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  expiredTime: number;
  bucket: string;
  region: string;
  uploadPath: string;
}

let cachedCredentials: STSCredentials | null = null;

// 获取 STS 临时凭证（带缓存）
async function getSTSCredentials(): Promise<STSCredentials> {
  // 如果缓存未过期（提前 5 分钟刷新），直接返回
  if (cachedCredentials && cachedCredentials.expiredTime > Date.now() / 1000 + 300) {
    console.log('[COS直传] 使用缓存的 STS 凭证');
    return cachedCredentials;
  }

  console.log('[COS直传] 获取新的 STS 凭证...');
  
  const response = await fetch('/api/canvas/sts-token');
  const result = await response.json();
  
  if (!result.success) {
    throw new Error(result.error || '获取上传凭证失败');
  }

  const { credentials, bucket, region, uploadPath } = result.data;
  
  cachedCredentials = {
    ...credentials,
    bucket,
    region,
    uploadPath,
  };

  console.log('[COS直传] STS 凭证获取成功，过期时间:', new Date(credentials.expiredTime * 1000).toLocaleString());
  
  return cachedCredentials!;
}

// 前端直传到 COS
export async function directUploadToCOS(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ key: string; url: string; isTemporary: boolean }> {
  const startTime = Date.now();
  console.log('[COS直传] 开始上传:', {
    name: file.name,
    size: (file.size / 1024 / 1024).toFixed(2) + 'MB',
    type: file.type,
  });

  // 1. 获取 STS 临时凭证
  const credentials = await getSTSCredentials();

  // 2. 创建 COS 客户端
  const cos = new COS({
    getAuthorization: async (options, callback) => {
      callback({
        TmpSecretId: credentials.tmpSecretId,
        TmpSecretKey: credentials.tmpSecretKey,
        SecurityToken: credentials.sessionToken,
        StartTime: Math.floor(Date.now() / 1000) - 60, // 偏移60秒，避免时间差
        ExpiredTime: credentials.expiredTime,
      });
    },
  });

  // 3. 生成文件路径：upload_tmp/年月/时间戳-UUID-原文件名
  const timestamp = Date.now();
  const uuid = Math.random().toString(36).substring(2, 10);
  const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `${credentials.uploadPath}/${new Date().toISOString().slice(0, 7)}/${timestamp}-${uuid}-${safeName}`;

  // 4. 直传到 COS
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: credentials.bucket,
        Region: credentials.region,
        Key: key,
        Body: file,
        onProgress: (progressData) => {
          const percent = Math.round(progressData.percent * 100);
          console.log(`[COS直传] 上传进度: ${percent}%`);
          onProgress?.(percent);
        },
      },
      (err, data) => {
        if (err) {
          console.error('[COS直传] 上传失败:', err);
          reject(new Error(err.message || '上传失败'));
        } else {
          // 构造临时访问 URL（格式：https://bucket.cos.region.myqcloud.com/key）
          const url = `https://${credentials.bucket}.cos.${credentials.region}.myqcloud.com/${key}`;
          
          console.log('[COS直传] 上传成功:', {
            key,
            url,
            duration: Date.now() - startTime + 'ms',
          });

          // 返回结果（标记为临时文件）
          resolve({
            key,
            url,
            isTemporary: true, // 标记为临时文件，需要后端转存
          });
        }
      }
    );
  });
}

// 批量直传
export async function directUploadMultiple(
  files: File[],
  onProgress?: (fileIndex: number, percent: number) => void
): Promise<Array<{ key: string; url: string; isTemporary: boolean }>> {
  const results = await Promise.all(
    files.map((file, index) =>
      directUploadToCOS(file, (percent) => onProgress?.(index, percent))
    )
  );
  return results;
}

// 清除凭证缓存（用于强制刷新）
export function clearCredentialsCache() {
  cachedCredentials = null;
  console.log('[COS直传] 凭证缓存已清除');
}
