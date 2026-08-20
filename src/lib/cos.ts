// #全局域名大一统 下发域名配置
// 自定义源站域名（CNAME 指向 COS Bucket），仅用于前端浏览器下载
// 上传通道仍走腾讯云内网（putObject / getPresignedUploadUrl），不受影响
const CDN_DOMAIN = process.env.COS_CDN_DOMAIN || 'img.kiikii.me';

// 🔥 #826 2号桶(perm) CDN 域名：配置后 perm 资产返回纯净 CDN 静态 URL（不带签名参数）
// 前提条件（运维侧）：
//   1. 腾讯云控制台：2号桶 ACL 改为「公有读、私有写」(public-read)
//   2. 腾讯云控制台：2号桶绑定此 CDN 域名（CNAME 指向 2号桶）
//   3. Cloudflare：添加 DNS 解析 + 缓存规则
// 未配置时：perm 资产仍走签名 URL（向后兼容，无破坏性变更）
const PERM_CDN_DOMAIN = process.env.COS_CDN_DOMAIN_PERM || '';

// 🔥 #826 签名 URL LRU 缓存（1号桶 temp 专用）
// 核心价值：同一 objectKey 在缓存窗口内返回完全相同的签名 URL（q-sign-time 不变），
// 让 Cloudflare CDN 识别为同一 Cache Key，大幅提升命中率，斩断 COS 源站流量。
// 缓存 Key = ${objectKey}:${assetType}:${expiresIn}（三元组，防止长短效签名互相污染）
// 缓存 TTL = expiresIn * 0.75（如 1h 签名缓存 45min，留 15min 安全 Buffer 防过期裂图）
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const inflightRequests = new Map<string, Promise<string>>();
const CACHE_MAX_ENTRIES = 500; // 2C2G 内存安全上限
const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 分钟清理周期
let lastCacheCleanup = Date.now();

function cleanupSignedUrlCache() {
  const now = Date.now();
  if (now - lastCacheCleanup < CACHE_CLEANUP_INTERVAL) return;
  lastCacheCleanup = now;

  // 清理过期条目
  for (const [key, entry] of signedUrlCache) {
    if (now >= entry.expiresAt) {
      signedUrlCache.delete(key);
    }
  }

  // 超过最大条目数时，删除最早的一半（FIFO 策略，Map 保持插入顺序）
  if (signedUrlCache.size > CACHE_MAX_ENTRIES) {
    const keysToDelete = Array.from(signedUrlCache.keys()).slice(0, Math.floor(CACHE_MAX_ENTRIES / 2));
    for (const k of keysToDelete) {
      signedUrlCache.delete(k);
    }
  }
}

/**
 * 🔥 #826 获取签名 URL（带 LRU 缓存 + 并发去重 + perm CDN 静态化）
 *
 * 三条路径：
 * 1. perm + CDN域名已配置 → 返回纯净 CDN URL（不带签名，100% 命中 CF 缓存）
 * 2. 缓存命中 → 返回缓存的签名 URL（q-sign-time 不变，CF 可缓存）
 * 3. 缓存未命中 → 调用 COS SDK 生成新签名 URL，写入缓存
 *
 * #872 新增 forceSigned 参数：AI 服务商必须用签名 URL，跳过 CDN 静态化
 */
export async function getSignedUrl(
  key: string,
  expiresIn: number = 3600,
  assetType: AssetType = 'temp',
  forceSigned: boolean = false
): Promise<string> {
  // 🚀 路径1：perm 桶 CDN 静态化（生产环境 + CDN域名已配置）
  // 返回纯净 CDN URL，不带签名参数，Cloudflare 100% 缓存命中
  // 沙箱环境(DEV)不走 CDN（Cloudflare 拦截），回退到签名 URL
  // #872 forceSigned=true 时跳过 CDN 静态化，强制返回签名 URL（AI 服务商需要）
  if (!forceSigned && assetType === 'perm' && PERM_CDN_DOMAIN && !shouldUseRawCOSDomain()) {
    return `https://${PERM_CDN_DOMAIN}/${key}`;
  }

  // 路径2/3：temp 桶（或 perm 桶无 CDN）走签名 URL + LRU 缓存
  const cacheKey = `${key}:${assetType}:${expiresIn}`;

  // 检查缓存
  const cached = signedUrlCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.url;
  }

  // 检查并发请求（去重：同一 key 的 in-flight 请求共享同一个 Promise）
  const inflight = inflightRequests.get(cacheKey);
  if (inflight) return inflight;

  // 发起新请求
  const promise = _generateSignedUrl(key, expiresIn, assetType)
    .then(url => {
      // 缓存结果：TTL = expiresIn * 0.75（如 1h 签名缓存 45min）
      signedUrlCache.set(cacheKey, {
        url,
        expiresAt: Date.now() + Math.floor(expiresIn * 750), // expiresIn秒 * 0.75 * 1000ms
      });
      inflightRequests.delete(cacheKey);
      cleanupSignedUrlCache();
      return url;
    })
    .catch(err => {
      inflightRequests.delete(cacheKey);
      throw err;
    });

  inflightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * 内部实现：调用 COS SDK 生成签名 URL（不缓存）
 * 原 getSignedUrl 逻辑完整保留，仅改名隔离
 */
async function _generateSignedUrl(
  key: string,
  expiresIn: number = 3600,
  assetType: AssetType = 'temp'
): Promise<string> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);

  return new Promise((resolve, reject) => {
    // 关键：使用 ForceSignHost: false，签名不包含 Host 头部
    // 这样替换为 CDN 域名后签名仍然有效
    cos.getObjectUrl(
      {
        Bucket: bucketConfig.Bucket,
        Region: bucketConfig.Region,
        Key: key,
        Sign: true,
        Expires: expiresIn,
        ForceSignHost: false,  // 签名不包含 Host，支持域名替换
      } as any,
      (err, data) => {
        if (err) {
          console.error('[COS] getObjectUrl 失败:', err);
          reject(err);
        } else {
          const originalUrl = (data as any).Url || data;

          let finalUrl: string;
          if (assetType === 'perm') {
            // 2号桶(VIP)：CDN未绑定此桶时，直接使用原始COS域名
            // 🔥 #826 注意：perm+CDN 的短路径已在新 getSignedUrl 中处理，
            //    到这里的 perm 走签名 URL（无 CDN 或沙箱环境）
            finalUrl = originalUrl;
          } else {
            // 1号桶(temp)：根据环境决定是否替换为 CDN 域名
            // 🔧 #825 沙箱环境保留原始 COS 域名（绕过 Cloudflare），生产环境替换为 CDN 域名
            if (shouldUseRawCOSDomain()) {
              finalUrl = originalUrl; // 保留 *.myqcloud.com 原始域名
            } else {
              // ForceSignHost: false 确保签名不依赖 Host，替换域名后签名仍有效
              finalUrl = originalUrl.replace(
                /https?:\/\/[^\/]+\.myqcloud\.com/i,
                `https://${CDN_DOMAIN}`
              );
            }
          }

          console.log('[COS] 签名URL生成成功:', {
            下载域名: assetType === 'perm' ? '(perm走签名URL)' : (shouldUseRawCOSDomain() ? '原始COS域名(绕过CF)' : CDN_DOMAIN),
            key,
            assetType,
            bucket: bucketConfig.Bucket,
            缓存命中: '否(新生成)',
          });
          resolve(finalUrl);
        }
      }
    );
  });
}

// 🔧 #825 沙箱环境直连腾讯云（绕过 Cloudflare 拦截）
// 沙箱浏览器/服务端无法访问 img.kiikii.me（Cloudflare 防爬机制导致 ERR_CONNECTION_CLOSED）
// 开发环境强制使用腾讯云原始域名直连，生产环境继续走 CDN 域名
function shouldUseRawCOSDomain(): boolean {
  // 1. 显式环境变量开关（最高优先级）
  if (process.env.USE_RAW_COS_URL === 'true') return true;
  if (process.env.USE_RAW_COS_URL === 'false') return false;
  // 2. 自动检测沙箱环境（COZE_PROJECT_ENV 由沙箱自动注入）
  if (process.env.COZE_PROJECT_ENV === 'DEV') return true;
  // 3. 默认走 CDN 域名
  return false;
}

// 🔧 #825 获取实际使用的下载域名（开发环境用原始域名，生产环境用 CDN 域名）
function getDownloadDomain(): string {
  return shouldUseRawCOSDomain() ? '' : CDN_DOMAIN; // 空字符串表示不替换，保留原始 COS 域名
}

// 腾讯云 COS 配置模块
import COS from 'cos-nodejs-sdk-v5';

// 环境判断
const isProd = process.env.NODE_ENV === 'production';
const ENV_PREFIX = isProd ? 'prod/' : 'dev/';

// #762 内网域名支持：生产环境（香港服务器）走内网免费流量
// COZE_PROJECT_ENV 环境变量：DEV = 沙箱开发环境，PROD = 生产环境
const isProductionServer = process.env.COZE_PROJECT_ENV === 'PROD';

// 内网域名格式：cos-internal.<region>.myqcloud.com
// 公网域名格式：cos.<region>.myqcloud.com

// ========================================
// #804 双桶分离架构：AssetType 类型定义
// ========================================
// 'temp' → 1号桶（AI 临时素材，5天生命周期）
// 'perm' → 2号桶（VIP 资产与系统固定资产，永久存储）
export type AssetType = 'temp' | 'perm';

// 根据资产类型获取桶配置
function getBucketConfig(assetType: AssetType = 'temp') {
  if (assetType === 'perm') {
    const region = process.env.COS_REGION_PERM || process.env.COS_REGION || 'ap-hongkong';
    return {
      Bucket: process.env.COS_BUCKET_PERM || process.env.COS_BUCKET || '',
      Region: region,
      Domain: parseCOSDomain(process.env.COS_DOMAIN_PERM, region),
    };
  }
  // 默认走1号桶（temp）
  const region = process.env.COS_REGION_TEMP || process.env.COS_REGION || 'ap-hongkong';
  return {
    Bucket: process.env.COS_BUCKET_TEMP || process.env.COS_BUCKET || '',
    Region: region,
    Domain: parseCOSDomain(process.env.COS_DOMAIN_TEMP, region),
  };
}

// COS 配置（优先从环境变量读取，向后兼容）
// ⚠️ COS_CONFIG 保留为默认配置（1号桶），向后兼容
export const COS_CONFIG = {
  SecretId: process.env.COS_SECRET_ID || '',
  SecretKey: process.env.COS_SECRET_KEY || '',
  Bucket: process.env.COS_BUCKET_TEMP || process.env.COS_BUCKET || '',
  Region: process.env.COS_REGION_TEMP || process.env.COS_REGION || 'ap-hongkong',
  Domain: parseCOSDomain(process.env.COS_DOMAIN_TEMP || process.env.COS_DOMAIN, process.env.COS_REGION_TEMP || process.env.COS_REGION || 'ap-hongkong'),
  UseInternal: isProductionServer, // 标记是否使用内网
};

console.log('[COS] 双桶架构配置:', {
  NODE_ENV: process.env.NODE_ENV,
  COZE_PROJECT_ENV: process.env.COZE_PROJECT_ENV,
  isProd,
  isProductionServer,
  ENV_PREFIX,
  tempBucket: process.env.COS_BUCKET_TEMP || process.env.COS_BUCKET || '(未配置)',
  permBucket: process.env.COS_BUCKET_PERM || '(未配置)',
  defaultBucket: COS_CONFIG.Bucket,
  Region: COS_CONFIG.Region,
  Domain: COS_CONFIG.Domain,
  UseInternal: COS_CONFIG.UseInternal,
  domainType: COS_CONFIG.UseInternal ? '内网(免费)' : '公网',
  '#825_使用原始COS域名': shouldUseRawCOSDomain(),
  '#825_下载域名': shouldUseRawCOSDomain() ? '原始COS域名(绕过Cloudflare)' : `CDN域名(${CDN_DOMAIN})`,
  SecretId: COS_CONFIG.SecretId ? `${COS_CONFIG.SecretId.substring(0, 8)}...` : '未配置',
  SecretKey: COS_CONFIG.SecretKey ? `${COS_CONFIG.SecretKey.substring(0, 4)}***` : '❌ 未配置',
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

// #763 COS_DOMAIN 格式自动解析
// 用户可能配置完整 URL（如 https://bucket.cos.region.myqcloud.com）
// COS SDK Domain 参数只需要纯域名（如 cos.region.myqcloud.com）
function parseCOSDomain(domainInput: string | undefined, region: string): string {
  if (!domainInput) {
    // 未配置时自动选择内网/公网
    return isProductionServer 
      ? `cos-internal.${region}.myqcloud.com`
      : `cos.${region}.myqcloud.com`;
  }
  
  // 去掉 https:// 或 http:// 前缀
  let domain = domainInput.replace(/^https?:\/\//, '');
  
  // 去掉 bucket 名前缀（如 kiikii-ai-1412916018.cos.ap-hongkong.myqcloud.com → cos.ap-hongkong.myqcloud.com）
  // 匹配模式：<bucket>.cos(-internal).<region>.myqcloud.com
  const cosDomainMatch = domain.match(/cos(-internal)?\.[a-z0-9-]+\.myqcloud\.com/i);
  if (cosDomainMatch) {
    return cosDomainMatch[0].toLowerCase();
  }
  
  // 如果已经是纯域名格式，直接返回
  if (domain.match(/^cos(-internal)?\.[a-z0-9-]+\.myqcloud\.com$/i)) {
    return domain.toLowerCase();
  }
  
  // 无法解析时回退到自动选择
  console.warn('[COS] #763 无法解析 COS_DOMAIN 格式:', domainInput, '| 回退到自动选择');
  return isProductionServer 
    ? `cos-internal.${region}.myqcloud.com`
    : `cos.${region}.myqcloud.com`;
}

// 从 Bucket 名称提取 Appid（格式：<bucketname>-<appid>）
function extractAppidFromBucket(bucket: string): string {
  const parts = bucket.split('-');
  if (parts.length >= 2) {
    // Appid 是最后一部分（数字）
    const appid = parts[parts.length - 1];
    if (/^\d+$/.test(appid)) {
      return appid;
    }
  }
  console.warn('[COS] 无法从 Bucket 提取 Appid:', bucket);
  return '';
}

// 创建 COS 客户端实例
let cosClient: COS | null = null;
let lastSecretKey: string = '';

export function getCOSClient(): COS {
  // #261 修复：每次都检查 SecretKey 是否变化，避免使用旧的空配置客户端
  // #762 内网域名：生产服务器走内网免费流量
  // #763 COS_DOMAIN 格式自动解析
  // #763 自定义 Domain 需要传入 Appid
  const currentSecretKey = process.env.COS_SECRET_KEY || '';
  const currentRegion = process.env.COS_REGION || 'ap-hongkong';
  const currentDomain = parseCOSDomain(process.env.COS_DOMAIN, currentRegion);
  const currentIsProductionServer = process.env.COZE_PROJECT_ENV === 'PROD';
  const currentBucket = process.env.COS_BUCKET || '';
  const currentAppid = extractAppidFromBucket(currentBucket);
  
  if (!cosClient || lastSecretKey !== currentSecretKey) {
    console.log('[COS] 创建新的 COS 客户端');
    console.log('[COS] SecretKey 来源:', currentSecretKey ? `process.env (${currentSecretKey.substring(0, 4)}***)` : '空');
    console.log('[COS] #762/#763 域名:', currentDomain, '| 类型:', currentIsProductionServer ? '内网(免费)' : '公网');
    console.log('[COS] #763 Bucket:', currentBucket, '| Appid:', currentAppid);
    
    // 更新 COS_CONFIG（以防环境变量后来加载）
    COS_CONFIG.SecretId = process.env.COS_SECRET_ID || '';
    COS_CONFIG.SecretKey = currentSecretKey;
    COS_CONFIG.Bucket = currentBucket;
    COS_CONFIG.Region = currentRegion;
    COS_CONFIG.Domain = currentDomain;
    COS_CONFIG.UseInternal = currentIsProductionServer;
    
    // #764 初始化 COS 客户端（不使用 Domain 参数）
    // SDK 会自动处理内网/公网路由（服务器在内网时自动走内网）
    cosClient = new COS({
      SecretId: COS_CONFIG.SecretId,
      SecretKey: COS_CONFIG.SecretKey,
      // 不传 Domain 参数，让 SDK 用标准模式
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
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
export async function uploadToCOS(
  key: string,
  buffer: Buffer,
  contentType: string = 'image/png',
  assetType: AssetType = 'temp'
): Promise<{ key: string; url: string }> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);
  
  // 🔧 环境隔离：自动添加 dev/ 或 prod/ 前缀
  const finalKey = key.startsWith(ENV_PREFIX) ? key : `${ENV_PREFIX}${key}`;
  
  console.log('[COS] 开始上传:', {
    Bucket: bucketConfig.Bucket,
    Region: bucketConfig.Region,
    Key: finalKey,
    ContentType: contentType,
    BufferSize: buffer.length,
    ENV_PREFIX,
    assetType,
  });
  
  return new Promise((resolve, reject) => {
    // 🛡️ #806 缓存策略：perm 桶设置长期缓存头，减少刷新时的重复下载
    const putParams: any = {
      Bucket: bucketConfig.Bucket,
      Region: bucketConfig.Region,
      Key: finalKey,
      Body: buffer,
      ContentType: contentType,
    };
    if (assetType === 'perm') {
      putParams.CacheControl = 'max-age=31536000, public'; // 1 年缓存
    }

    cos.putObject(
      putParams,
      async (err, data) => {
        if (err) {
          console.error('[COS] 上传失败:', {
            code: err.code,
            message: err.message,
            statusCode: (err as any).statusCode,
            Bucket: bucketConfig.Bucket,
            Region: bucketConfig.Region,
          });
          reject(err);
        } else {
          console.log('[COS] 上传成功:', data);
          // 🔧 #128 修复：返回签名 URL（私有桶需要签名才能访问）
          try {
            const signedUrl = await getSignedUrl(finalKey, 3600, assetType);
            console.log('[COS] 签名 URL 生成成功(CDN域名:', CDN_DOMAIN, ', assetType:', assetType, ')');
            resolve({ key: finalKey, url: signedUrl });
          } catch (signError) {
            console.warn('[COS] 签名 URL 生成失败，使用CDN域名拼接:', signError);
            // 🔧 #825 沙箱环境使用原始 COS 域名，生产环境使用 CDN 域名
            const fallbackDomain = shouldUseRawCOSDomain()
              ? `${bucketConfig.Bucket}.cos.${bucketConfig.Region}.myqcloud.com`
              : CDN_DOMAIN;
            const url = `https://${fallbackDomain}/${finalKey}`;
            resolve({ key: finalKey, url });
          }
        }
      }
    );
  });
}

// 🔥 流式上传文件到 COS（避免大文件 OOM）
// 不将整个文件加载到内存，而是通过 Node.js Stream 边读边传
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
export async function uploadToCOSFromStream(
  key: string,
  stream: import('stream').Readable,
  contentLength: number,
  contentType: string = 'image/png',
  assetType: AssetType = 'temp'
): Promise<{ key: string; url: string }> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);

  // 🔧 环境隔离：自动添加 dev/ 或 prod/ 前缀
  const finalKey = key.startsWith(ENV_PREFIX) ? key : `${ENV_PREFIX}${key}`;

  console.log('[COS] 开始流式上传:', {
    Bucket: bucketConfig.Bucket,
    Region: bucketConfig.Region,
    Key: finalKey,
    ContentType: contentType,
    ContentLength: contentLength,
    ENV_PREFIX,
    assetType,
  });

  return new Promise((resolve, reject) => {
    // 🛡️ #806 缓存策略：perm 桶设置长期缓存头
    const putParams: any = {
      Bucket: bucketConfig.Bucket,
      Region: bucketConfig.Region,
      Key: finalKey,
      Body: stream,
      ContentLength: contentLength,
      ContentType: contentType,
    };
    if (assetType === 'perm') {
      putParams.CacheControl = 'max-age=31536000, public';
    }

    cos.putObject(
      putParams,
      async (err, data) => {
        if (err) {
          console.error('[COS] 流式上传失败:', {
            code: err.code,
            message: err.message,
            statusCode: (err as any).statusCode,
          });
          reject(err);
        } else {
          console.log('[COS] 流式上传成功:', data);
          try {
            const signedUrl = await getSignedUrl(finalKey, 3600, assetType);
            resolve({ key: finalKey, url: signedUrl });
          } catch (signError) {
            console.warn('[COS] 签名 URL 生成失败，使用CDN域名拼接:', signError);
            // 🔧 #825 沙箱环境使用原始 COS 域名，生产环境使用 CDN 域名
            const fallbackDomain = shouldUseRawCOSDomain()
              ? `${bucketConfig.Bucket}.cos.${bucketConfig.Region}.myqcloud.com`
              : CDN_DOMAIN;
            const url = `https://${fallbackDomain}/${finalKey}`;
            resolve({ key: finalKey, url });
          }
        }
      }
    );
  });
}

// 🔥 #826 旧的 getSignedUrl 已重构为：
//   - 新 getSignedUrl（带 perm CDN 静态化 + LRU 缓存 + 并发去重）
//   - _generateSignedUrl（内部实现，调用 COS SDK 生成签名 URL）
// batchGetSignedUrls 自动受益于 getSignedUrl 的缓存层

// 批量获取签名URL（并行处理，自动过滤失败项）
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
// 🔥 #826 批量接口自动受益于 getSignedUrl 的 LRU 缓存层
export async function batchGetSignedUrls(
  keys: string[],
  expiresIn: number = 432000,
  assetType: AssetType = 'temp'
): Promise<(string | null)[]> {
  if (!keys || keys.length === 0) return [];
  
  // 🔥 #830 关键修复：保留 null 占位，保证返回数组与输入 keys 等长
  // 调用方（generation-records/route.ts）通过 slice(start, start+count) 按索引映射，
  // 如果过滤掉 null，后续所有记录的图片 URL 全部错位！
  const urls = await Promise.all(
    keys.map(async (key: string) => {
      try {
        return await getSignedUrl(key, expiresIn, assetType);
      } catch {
        console.error('[COS] batchGetSignedUrls 单项失败, key:', key, 'assetType:', assetType);
        return null;
      }
    })
  );
  return urls; // 保留 null 占位，不做 filter
}

// 下载文件从 COS
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
export async function downloadFromCOS(key: string, assetType: AssetType = 'temp'): Promise<Buffer> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);
  
  return new Promise((resolve, reject) => {
    cos.getObject(
      {
        Bucket: bucketConfig.Bucket,
        Region: bucketConfig.Region,
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
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
export async function checkFileExists(key: string, assetType: AssetType = 'temp'): Promise<boolean> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);
  
  return new Promise((resolve) => {
    cos.headObject(
      {
        Bucket: bucketConfig.Bucket,
        Region: bucketConfig.Region,
        Key: key,
      },
      (err) => {
        resolve(!err);
      }
    );
  });
}

// 删除文件
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
export async function deleteFromCOS(key: string, assetType: AssetType = 'temp'): Promise<void> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);
  
  return new Promise((resolve, reject) => {
    cos.deleteObject(
      {
        Bucket: bucketConfig.Bucket,
        Region: bucketConfig.Region,
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
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
export async function deleteMultipleFromCOS(keys: string[], assetType: AssetType = 'temp'): Promise<void> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);
  
  return new Promise((resolve, reject) => {
    cos.deleteMultipleObject(
      {
        Bucket: bucketConfig.Bucket,
        Region: bucketConfig.Region,
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

// #819 跨桶拷贝：从 Temp 桶 Copy 到 Perm 桶（审核通过时调用）
// 用于用户提交审核后，管理员审核通过时将文件从临时桶迁移到永久桶
export async function copyObjectBetweenBuckets(
  sourceKey: string,
  destKey: string,
  sourceAssetType: AssetType = 'temp',
  destAssetType: AssetType = 'perm'
): Promise<{ success: boolean; destKey: string; error?: string }> {
  const cos = getCOSClient();
  const sourceBucket = getBucketConfig(sourceAssetType);
  const destBucket = getBucketConfig(destAssetType);

  // 环境隔离前缀处理
  const finalSourceKey = sourceKey.startsWith(ENV_PREFIX) ? sourceKey : `${ENV_PREFIX}${sourceKey}`;
  const finalDestKey = destKey.startsWith(ENV_PREFIX) ? destKey : `${ENV_PREFIX}${destKey}`;

  console.log('[COS] 跨桶拷贝:', {
    source: `${sourceBucket.Bucket}/${finalSourceKey}`,
    dest: `${destBucket.Bucket}/${finalDestKey}`,
  });

  return new Promise((resolve) => {
    cos.putObjectCopy(
      {
        Bucket: destBucket.Bucket,
        Region: destBucket.Region,
        Key: finalDestKey,
        CopySource: `${sourceBucket.Bucket}.cos.${sourceBucket.Region}.myqcloud.com/${finalSourceKey}`,
      },
      (err, data) => {
        if (err) {
          const errorCode = err.code || '';
          const errorMessage = err.message || '';
          console.error('[COS] 跨桶拷贝失败:', {
            code: errorCode,
            message: errorMessage,
            sourceKey: finalSourceKey,
          });

          // 404 兜底：源文件已被生命周期规则物理销毁
          if (errorCode === 'NoSuchKey' || errorCode === '404' || errorMessage.includes('NoSuchKey') || errorMessage.includes('404')) {
            resolve({
              success: false,
              destKey: finalDestKey,
              error: 'SOURCE_FILE_EXPIRED',
            });
            return;
          }

          resolve({
            success: false,
            destKey: finalDestKey,
            error: `COS CopyObject failed: ${errorCode} - ${errorMessage}`,
          });
          return;
        }

        console.log('[COS] 跨桶拷贝成功:', finalDestKey);
        resolve({
          success: true,
          destKey: finalDestKey,
        });
      }
    );
  });
}

// 🔧 #802 前端直传架构：生成预签名上传 URL
// 后端只发"护照"（签名URL），不碰"行李"（文件实体）
// 前端拿到签名URL后直接PUT上传到腾讯云，彻底解决服务端内存崩溃
// #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
export async function getPresignedUploadUrl(
  key: string,
  contentType: string = 'image/png',
  expiresIn: number = 3600, // 签名有效期1小时
  assetType: AssetType = 'temp'
): Promise<{ objectKey: string; uploadUrl: string }> {
  const cos = getCOSClient();
  const bucketConfig = getBucketConfig(assetType);
  
  // 环境隔离：自动添加 dev/ 或 prod/ 前缀
  const finalKey = key.startsWith(ENV_PREFIX) ? key : `${ENV_PREFIX}${key}`;
  
  console.log('[COS] 生成预签名上传URL:', {
    Bucket: bucketConfig.Bucket,
    Region: bucketConfig.Region,
    Key: finalKey,
    ContentType: contentType,
    Expires: expiresIn,
    ENV_PREFIX,
    assetType,
  });

  // 🔧 #804 军师正规军打法：光明正大将 Content-Type 签进去！
  // 
  // ⚠️ 关键认知：浏览器发送 File 对象时会自动添加 Content-Type 头部
  // 这是浏览器底层机制，前端代码无法阻止！
  // 
  // 如果后端签名不包含 Content-Type（q-header-list=host），而请求带有 Content-Type，
  // 腾讯云会认为签名不匹配 → 直接断开 TCP 连接 → ERR_CONNECTION_CLOSED
  // 
  // 正确方案：
  // 1. 后端签名必须包含 Content-Type
  // 2. 前端必须明确发送 Content-Type（与签名值完全一致）
  
  // 🛡️ #806 缓存策略：perm 桶上传时将 Cache-Control 也签进 URL
  const signedHeaders: Record<string, string> = {
    'Content-Type': contentType,
  };
  if (assetType === 'perm') {
    signedHeaders['Cache-Control'] = 'max-age=31536000, public';
  }
  
  return new Promise((resolve, reject) => {
    cos.getObjectUrl(
      {
        Bucket: bucketConfig.Bucket,
        Region: bucketConfig.Region,
        Key: finalKey,
        Method: 'PUT',  // 上传用 PUT 方法
        Sign: true,
        Expires: expiresIn,
        // ✅ 正规军打法：明确将 Content-Type 加入签名
        // 腾讯云会生成 q-header-list=content-type;host
        Headers: signedHeaders,
      },
      (err, data) => {
        if (err) {
          console.error('[COS] 生成预签名上传URL失败:', {
            code: err.code,
            message: err.message,
          });
          reject(err);
        } else {
          const uploadUrl = (data as any).Url || data;
          console.log('[COS] 预签名上传URL生成成功, objectKey:', finalKey);
          // 🔍 诊断：检查签名中的 q-header-list 是否包含 content-type
          const headerListMatch = uploadUrl.match(/q-header-list=([^&]+)/);
          console.log('[COS] 🔍 签名中的q-header-list:', headerListMatch?.[1] || '(未找到)');
          console.log('[COS] 🔍 签名中的Content-Type:', contentType);
          console.log('[COS] 💡 前端上传时必须发送相同的 Content-Type:', contentType);
          resolve({ objectKey: finalKey, uploadUrl });
        }
      }
    );
  });
}
