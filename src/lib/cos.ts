// 腾讯云 COS 配置模块
import COS from 'cos-nodejs-sdk-v5';

// 环境判断
const isProd = process.env.NODE_ENV === 'production';
const ENV_PREFIX = isProd ? 'prod/' : 'dev/';

console.log('[COS] 环境配置:', { 
  NODE_ENV: process.env.NODE_ENV, 
  isProd, 
  ENV_PREFIX 
});

// COS 配置（优先从环境变量读取）
export const COS_CONFIG = {
  SecretId: process.env.COS_SECRET_ID || '',
  SecretKey: process.env.COS_SECRET_KEY || '',
  Bucket: process.env.COS_BUCKET || '',
  Region: process.env.COS_REGION || 'ap-hongkong',
  Domain: process.env.COS_DOMAIN || '',
};

console.log('[COS] 配置信息:', {
  Bucket: COS_CONFIG.Bucket,
  Region: COS_CONFIG.Region,
  Domain: COS_CONFIG.Domain,
  SecretId: COS_CONFIG.SecretId ? `${COS_CONFIG.SecretId.substring(0, 8)}...` : '未配置',
  SecretKey: COS_CONFIG.SecretKey ? `${COS_CONFIG.SecretKey.substring(0, 4)}***` : '❌ 未配置',
  ENV_PREFIX,
});

// 检查配置是否完整
export function isCOSConfigured(): boolean {
  return !!(
    COS_CONFIG.SecretId &&
    COS_CONFIG.SecretKey &&
    COS_CONFIG.Bucket &&
    COS_CONFIG.Region
  );
}

// 创建 COS 客户端实例
let cosClient: COS | null = null;
let lastSecretKey: string = '';

export function getCOSClient(): COS {
  // #261 修复：每次都检查 SecretKey 是否变化，避免使用旧的空配置客户端
  const currentSecretKey = process.env.COS_SECRET_KEY || '';
  
  if (!cosClient || lastSecretKey !== currentSecretKey) {
    console.log('[COS] 创建新的 COS 客户端');
    console.log('[COS] SecretKey 来源:', currentSecretKey ? `process.env (${currentSecretKey.substring(0, 4)}***)` : '空');
    
    // 更新 COS_CONFIG（以防环境变量后来加载）
    COS_CONFIG.SecretId = process.env.COS_SECRET_ID || '';
    COS_CONFIG.SecretKey = currentSecretKey;
    COS_CONFIG.Bucket = process.env.COS_BUCKET || '';
    COS_CONFIG.Region = process.env.COS_REGION || 'ap-hongkong';
    COS_CONFIG.Domain = process.env.COS_DOMAIN || '';
    
    cosClient = new COS({
      SecretId: COS_CONFIG.SecretId,
      SecretKey: COS_CONFIG.SecretKey,
    });
    lastSecretKey = currentSecretKey;
  }
  return cosClient;
}

// 检查 Bucket 是否存在
export async function checkBucketExists(): Promise<{ exists: boolean; error?: string }> {
  const cos = getCOSClient();
  
  return new Promise((resolve) => {
    cos.headBucket(
      {
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
      },
      (err, data) => {
        if (err) {
          console.error('[COS] Bucket 检查失败:', {
            code: err.code,
            message: err.message,
            Bucket: COS_CONFIG.Bucket,
            Region: COS_CONFIG.Region,
          });
          resolve({ 
            exists: false, 
            error: `Bucket "${COS_CONFIG.Bucket}" 不存在或无权限访问。请确认：
1. Bucket 已在腾讯云控制台创建
2. Bucket 名称格式正确（bucketname-appid）
3. SecretId/SecretKey 有该 bucket 的访问权限
4. Region 配置正确（当前: ${COS_CONFIG.Region}）
5. 访问权限是否允许当前操作（私有读写需要签名访问）` 
          });
        } else {
          console.log('[COS] Bucket 存在:', data);
          resolve({ exists: true });
        }
      }
    );
  });
}

// 上传文件到 COS（自动添加环境前缀）
export async function uploadToCOS(
  key: string,
  buffer: Buffer,
  contentType: string = 'image/png'
): Promise<{ key: string; url: string }> {
  const cos = getCOSClient();
  
  // 🔧 环境隔离：自动添加 dev/ 或 prod/ 前缀
  const finalKey = key.startsWith(ENV_PREFIX) ? key : `${ENV_PREFIX}${key}`;
  
  console.log('[COS] 开始上传:', {
    Bucket: COS_CONFIG.Bucket,
    Region: COS_CONFIG.Region,
    Key: finalKey,
    ContentType: contentType,
    BufferSize: buffer.length,
    ENV_PREFIX,
  });
  
  return new Promise((resolve, reject) => {
    cos.putObject(
      {
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
        Key: finalKey,
        Body: buffer,
        ContentType: contentType,
      },
      async (err, data) => {
        if (err) {
          console.error('[COS] 上传失败:', {
            code: err.code,
            message: err.message,
            statusCode: (err as any).statusCode,
            Bucket: COS_CONFIG.Bucket,
            Region: COS_CONFIG.Region,
          });
          reject(err);
        } else {
          console.log('[COS] 上传成功:', data);
          // 🔧 #128 修复：返回签名 URL（私有桶需要签名才能访问）
          try {
            const signedUrl = await getSignedUrl(finalKey);
            console.log('[COS] 签名 URL 生成成功');
            resolve({ key: finalKey, url: signedUrl });
          } catch (signError) {
            console.warn('[COS] 签名 URL 生成失败，使用未签名 URL:', signError);
            // 回退到未签名 URL
            const url = `${COS_CONFIG.Domain}/${finalKey}`;
            resolve({ key: finalKey, url });
          }
        }
      }
    );
  });
}

// 获取签名URL（临时访问URL）
export async function getSignedUrl(
  key: string,
  expiresIn: number = 432000 // 默认5天
): Promise<string> {
  const cos = getCOSClient();
  
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
        Key: key,
        Sign: true,
        Expires: expiresIn,
      },
      (err, data) => {
        if (err) {
          console.error('[COS] getObjectUrl 失败:', err);
          reject(err);
        } else {
          // data 是 { Url: string } 格式
          console.log('[COS] getObjectUrl 完整返回:', JSON.stringify(data));
          const url = (data as any).Url || data;
          console.log('[COS] 提取的 URL:', url);
          resolve(url);
        }
      }
    );
  });
}

// 下载文件从 COS
export async function downloadFromCOS(key: string): Promise<Buffer> {
  const cos = getCOSClient();
  
  return new Promise((resolve, reject) => {
    cos.getObject(
      {
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
        Key: key,
      },
      (err, data) => {
        if (err) {
          reject(err);
        } else {
          // data.Body 可能是 Buffer 或 string
          if (Buffer.isBuffer(data.Body)) {
            resolve(data.Body);
          } else if (typeof data.Body === 'string') {
            resolve(Buffer.from(data.Body));
          } else {
            reject(new Error('Unexpected body type'));
          }
        }
      }
    );
  });
}

// 检查文件是否存在
export async function checkFileExists(key: string): Promise<boolean> {
  const cos = getCOSClient();
  
  return new Promise((resolve) => {
    cos.headObject(
      {
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
        Key: key,
      },
      (err) => {
        resolve(!err);
      }
    );
  });
}

// 删除文件
export async function deleteFromCOS(key: string): Promise<void> {
  const cos = getCOSClient();
  
  return new Promise((resolve, reject) => {
    cos.deleteObject(
      {
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
        Key: key,
      },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

// 批量删除文件
export async function deleteMultipleFromCOS(keys: string[]): Promise<void> {
  const cos = getCOSClient();
  
  return new Promise((resolve, reject) => {
    cos.deleteMultipleObject(
      {
        Bucket: COS_CONFIG.Bucket,
        Region: COS_CONFIG.Region,
        Objects: keys.map(key => ({ Key: key })),
      },
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}
