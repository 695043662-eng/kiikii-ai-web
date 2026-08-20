import { NextRequest, NextResponse } from 'next/server';
import * as tencentcloud from 'tencentcloud-sdk-nodejs-sts';
import { COS_CONFIG } from '@/lib/cos';
import { extractClientIp } from '@/lib/ip-rate-limit';
import { requireAuth } from '@/lib/auth-middleware';

// 导入 STS Client
const StsClient = tencentcloud.sts.v20180813.Client;

// ==================== 第三道防线：发牌限流 ====================
// IP 限流：同一 IP 每分钟最多获取 5 次 STS 凭证
const ipRequestCounts = new Map<string, { count: number; resetTime: number }>();

// 检查并更新 IP 限流
function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now();
  const record = ipRequestCounts.get(ip);
  
  // 如果没有记录或已过重置时间，重置计数
  if (!record || now >= record.resetTime) {
    const resetTime = now + 60000; // 1分钟后重置
    ipRequestCounts.set(ip, { count: 1, resetTime });
    return { allowed: true, remaining: 4, resetTime };
  }
  
  // 如果未超过限制，增加计数
  if (record.count < 5) {
    record.count++;
    return { allowed: true, remaining: 5 - record.count, resetTime: record.resetTime };
  }
  
  // 超过限制
  return { allowed: false, remaining: 0, resetTime: record.resetTime };
}

// 定期清理过期的 IP 记录（每5分钟）
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of ipRequestCounts.entries()) {
    if (now >= record.resetTime) {
      ipRequestCounts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ==================== 第一道防线：STS 权限"紧箍咒" ====================
// 生成临时密钥，限制只能上传到 upload_tmp/ 目录，文件大小最大 5MB
async function getSTSToken(): Promise<{
  credentials: {
    tmpSecretId: string;
    tmpSecretKey: string;
    sessionToken: string;
    expiredTime: number;
  };
  bucket: string;
  region: string;
  uploadPath: string;
}> {
  // 创建 STS Client
  const client = new StsClient({
    credential: {
      secretId: COS_CONFIG.SecretId,
      secretKey: COS_CONFIG.SecretKey,
    },
    region: 'ap-guangzhou', // STS 服务区域
    profile: {
      httpProfile: {
        endpoint: 'sts.tencentcloudapi.com',
      },
    },
  });

  // Policy：限制只能上传到 upload_tmp/ 目录，文件大小最大 5MB
  // 腾讯云 COS 资源格式：qcs::cos:region:uid/appid:bucket/object
  // Bucket 格式：bucketname-appid，例如 kiikii-ai-1412916018
  const appId = COS_CONFIG.Bucket.split('-').pop() || '';
  const bucketName = COS_CONFIG.Bucket.replace(`-${appId}`, '');
  
  const policy = {
    version: '2.0',
    statement: [
      {
        effect: 'allow',
        action: [
          'name/cos:PutObject',
        ],
        resource: [
          `qcs::cos:${COS_CONFIG.Region}:uid/${appId}:${bucketName}-${appId}/upload_tmp/*`,
        ],
      },
    ],
  };

  const params = {
    Name: 'cos-direct-upload',
    Policy: JSON.stringify(policy),
    DurationSeconds: 3600, // 临时密钥有效期 1 小时
  };

  const response = await client.GetFederationToken(params);

  console.log('[STS] 获取临时密钥成功');

  return {
    credentials: {
      tmpSecretId: response.Credentials?.TmpSecretId || '',
      tmpSecretKey: response.Credentials?.TmpSecretKey || '',
      sessionToken: response.Credentials?.Token || '',
      expiredTime: Math.floor(Date.now() / 1000) + 3600, // 返回过期时间戳
    },
    bucket: COS_CONFIG.Bucket,
    region: COS_CONFIG.Region,
    uploadPath: 'upload_tmp',
  };
}

export async function GET(request: NextRequest) {
  // #890 终极清扫：STS 临时凭证必须鉴权，防匿名刷取
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  
  try {
    // ==================== 第三道防线：IP 限流检查 ====================
    // 🔥 #849 修复：使用 extractClientIp 防止 IP 欺骗绕过限流
    const ip = extractClientIp(request);
    
    const rateLimitResult = checkRateLimit(ip);
    
    if (!rateLimitResult.allowed) {
      console.warn(`[STS] IP 限流触发: ${ip}`);
      return NextResponse.json(
        { 
          success: false, 
          error: '请求过于频繁，请稍后再试',
          retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
        },
        { 
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)),
          },
        }
      );
    }

    // ==================== 获取 STS 临时凭证 ====================
    const stsData = await getSTSToken();

    console.log('[STS] 返回临时凭证:', {
      ip,
      remaining: rateLimitResult.remaining,
      uploadPath: stsData.uploadPath,
      expiredTime: stsData.credentials.expiredTime,
    });

    return NextResponse.json({
      success: true,
      data: stsData,
      rateLimit: {
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime,
      },
    });
  } catch (error: unknown) {
    console.error('[STS] 获取临时凭证失败:', error);
    const errorMessage = error instanceof Error ? error.message : '获取上传凭证失败，请稍后重试';
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
