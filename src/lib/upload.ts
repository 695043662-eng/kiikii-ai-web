/**
 * 通用文件上传工具
 *
 * #804 大文件直传架构 + 双桶分离：
 * - 小文件（<5MB）：服务器中转 /api/canvas/upload（简单可靠）
 * - 大文件（>=5MB）：预签名URL直传COS（绕过服务器请求体限制）
 *
 * #804 双桶分离：
 * - assetType='temp' → 1号桶（AI临时素材，5天生命周期）
 * - assetType='perm' → 2号桶（VIP资产与系统固定资产，永久存储）
 *
 * 使用方式：
 * ```ts
 * const result = await uploadFile(file, 'perm');  // 首页卡片→永久桶
 * const result = await uploadFile(file, 'temp');  // 画布参考图→临时桶
 * ```
 */

import type { AssetType } from './cos';
import { safeJsonResponse } from './safe-json';
import { checkAuthExpired } from './auth-failure';

// 大小阈值：5MB 以上使用直传
const DIRECT_UPLOAD_THRESHOLD = 5 * 1024 * 1024;

export interface UploadResult {
  key: string;          // COS objectKey（持久化用）
  proxyUrl: string;     // 代理下载URL（/api/canvas/image?key=...）
  signedUrl?: string;   // 签名URL（临时，大文件直传后返回）
}

/**
 * 上传文件到 COS（自动选择中转/直传）
 * #804 双桶分离：assetType='temp'→1号桶, assetType='perm'→2号桶
 */
export async function uploadFile(
  file: File,
  assetType: AssetType = 'temp'
): Promise<UploadResult | null> {
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);

  if (file.size >= DIRECT_UPLOAD_THRESHOLD) {
    console.log(`[Upload] 大文件(${fileSizeMB}MB)，使用预签名URL直传 → ${assetType === 'perm' ? '2号桶(永久)' : '1号桶(临时)'}`);
    return await directUpload(file, assetType);
  } else {
    console.log(`[Upload] 小文件(${fileSizeMB}MB)，使用服务器中转 → ${assetType === 'perm' ? '2号桶(永久)' : '1号桶(临时)'}`);
    return await relayUpload(file, assetType);
  }
}

/**
 * 服务器中转上传（小文件，<5MB）
 * 流程：前端 → POST /api/canvas/upload → 服务器 → COS
 * #804 双桶分离：通过 assetType 参数告诉后端路由到哪个桶
 */
async function relayUpload(file: File, assetType: AssetType = 'temp'): Promise<UploadResult | null> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    // #804 告诉后端路由到哪个桶
    formData.append('assetType', assetType);

    const res = await fetch('/api/canvas/upload', {
      method: 'POST',
      body: formData,
    });

    // #887 鉴权终极加固：401 立即截断，绝不重试
    checkAuthExpired(res);

    const data = await safeJsonResponse<{ success: boolean; key?: string; url?: string; error?: string }>(res);

    if (data?.success && data.key) {
      // #804 双桶分离：perm桶的代理URL需要带assetType参数
      const assetTypeParam = assetType === 'perm' ? '&assetType=perm' : '';
      return {
        key: data.key,
        proxyUrl: `/api/canvas/image?key=${encodeURIComponent(data.key)}${assetTypeParam}`,
        signedUrl: data.url,
      };
    }

    console.error('[Upload] 服务器中转失败:', data.error);
    return null;
  } catch (e) {
    console.error('[Upload] 服务器中转异常:', e);
    return null;
  }
}

/**
 * 预签名URL直传（大文件，>=5MB）
 * 流程：
 * 1. 前端 → POST /api/canvas/presign → 获取预签名URL
 * 2. 前端 → PUT 预签名URL → 直传COS（绕过服务器限制）
 * #804 双桶分离：通过 assetType 参数告诉后端路由到哪个桶
 */
async function directUpload(file: File, assetType: AssetType = 'temp'): Promise<UploadResult | null> {
  try {
    // 第一步：获取预签名上传URL
    const presignRes = await fetch('/api/canvas/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType: file.type || 'application/octet-stream',
        extension: file.name.split('.').pop() || undefined,
        assetType,  // #804 告诉后端路由到哪个桶
      }),
    });

    // #887 鉴权终极加固：401 立即截断，绝不重试
    checkAuthExpired(presignRes);

    const presignData = await safeJsonResponse<{ success: boolean; uploadUrl?: string; objectKey?: string; cacheControl?: string; error?: string }>(presignRes);

    if (!presignData?.success || !presignData?.uploadUrl || !presignData?.objectKey) {
      console.error('[Upload] 获取预签名URL失败:', presignData?.error);
      // 降级：尝试服务器中转
      console.log('[Upload] 降级到服务器中转...');
      return await relayUpload(file, assetType);
    }

    const { objectKey, uploadUrl, cacheControl } = presignData;

    // 🔍 #804 诊断日志：打印预签名URL详情
    // ⚠️ 关键：前端发送的 Content-Type 必须与后端签名中的值完全一致！
    const signedContentType = file.type || 'application/octet-stream';
    console.log('[Upload] 🔍 预签名URL诊断:');
    console.log('[Upload]   - objectKey:', objectKey);
    console.log('[Upload]   - uploadUrl:', uploadUrl.substring(0, 100) + '...');
    console.log('[Upload]   - file.type:', file.type);
    console.log('[Upload]   - 签名Content-Type:', signedContentType);
    console.log('[Upload]   - assetType:', assetType, assetType === 'perm' ? '(2号桶永久)' : '(1号桶临时)');
    console.log('[Upload] 💡 军师正规军打法：前端必须发送相同的 Content-Type');
    console.log('[Upload] 💡 请在Network面板找到PUT请求，查看q-header-list是否包含content-type');

    // 第二步：直传COS
    console.log('[Upload] 开始直传COS, objectKey:', objectKey, 'assetType:', assetType);

    let uploadRes: Response;
    try {
      // ✅ #804 军师正规军打法：明确发送 Content-Type 头部
      // 后端签名包含 Content-Type，前端必须发送相同的值
      // 否则腾讯云会认为签名不匹配 → 直接断开 TCP 连接 → ERR_CONNECTION_CLOSED
      // 🛡️ #806 缓存策略：perm 桶上传时同时发送 Cache-Control（已签入 URL）
      const uploadHeaders: Record<string, string> = {
        // ⚠️ 关键：必须与后端签名的 Content-Type 完全一致！
        'Content-Type': signedContentType,
      };
      // 🛡️ #806 如果后端返回了 cacheControl，前端必须发送（已签入 URL，不发会签名不匹配）
      if (cacheControl) {
        uploadHeaders['Cache-Control'] = cacheControl;
      }

      uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: uploadHeaders,
        body: file,
      });
      
      // 🔍 #804 诊断日志：打印响应详情
      console.log('[Upload] 🔍 直传响应诊断:');
      console.log('[Upload]   - status:', uploadRes.status);
      console.log('[Upload]   - statusText:', uploadRes.statusText);
      console.log('[Upload]   - ok:', uploadRes.ok);
      console.log('[Upload]   - type:', uploadRes.type);
      // Headers遍历（兼容不同环境）
      const headerList: string[] = [];
      uploadRes.headers.forEach((v, k) => headerList.push(`${k}: ${v}`));
      console.log('[Upload]   - headers:', headerList.join(', ') || '(无CORS响应头=跨域问题)');
      
      // ✅ 成功判断：HTTP 200 = 上传成功
      if (uploadRes.ok) {
        console.log('[Upload] ✅ 直传COS成功！状态码:', uploadRes.status, 'assetType:', assetType);
        // #804 双桶分离：perm桶的代理URL需要带assetType参数
        const assetTypeParam = assetType === 'perm' ? '&assetType=perm' : '';
        const proxyUrl = `/api/canvas/image?key=${encodeURIComponent(objectKey)}${assetTypeParam}`;
        return { key: objectKey, proxyUrl };
      }
      
      // ❌ 失败：打印真实错误内容
      const errorText = await uploadRes.text();
      console.error('[Upload] 🔍 直传失败诊断:');
      console.error('[Upload]   - HTTP状态码:', uploadRes.status);
      console.error('[Upload]   - 响应内容:', errorText.substring(0, 500));
      
      // 🕵️ 军师嫌疑人判断：根据状态码定位问题
      if (uploadRes.status === 403) {
        console.error('[Upload] 💡 状态码403！这是权限问题！');
        console.error('[Upload] 💡 请检查腾讯云CAM权限，确保SecretKey有PutObject权限');
      } else if (uploadRes.status === 400) {
        console.error('[Upload] 💡 状态码400！可能是签名参数错误');
        console.error('[Upload] 💡 请检查Content-Type是否与签名一致');
      }
      
    } catch (fetchError: any) {
      // 🔍 #804 诊断日志：fetch异常（真正的CORS失败或403伪装）
      console.error('[Upload] 🔍 fetch异常诊断:');
      console.error('[Upload]   - errorType:', fetchError?.constructor?.name);
      console.error('[Upload]   - errorMessage:', fetchError?.message);
      console.error('[Upload]   - errorStack:', fetchError?.stack?.split('\n').slice(0,3).join('\n'));
      
      // 🕵️ 军师嫌疑人判断：如果错误消息含特定关键词，可能是权限问题
      if (fetchError?.message?.includes('Failed to fetch')) {
        console.error('[Upload] 💡 这是"真CORS失败"或"连接被断开"！');
        console.error('[Upload] 💡 请检查:');
        console.error('[Upload]   1. Network面板是否有PUT请求？如果没有=真CORS');
        console.error('[Upload]   2. 如果有PUT请求，状态码是403吗？=权限不足');
        console.error('[Upload]   3. 如果是ERR_CONNECTION_CLOSED=签名头部不匹配');
      }
      
      // 网络异常，降级到服务器中转
      console.log('[Upload] 网络异常，降级到服务器中转...');
      return await relayUpload(file, assetType);
    }

    // ❌ 如果直传失败，降级到服务器中转
    console.log('[Upload] 直传失败(HTTP', uploadRes.status, ')，降级到服务器中转...');
    return await relayUpload(file, assetType);
  } catch (e) {
    console.error('[Upload] uploadFile 总异常:', e);

    // 网络错误降级到服务器中转
    if (e instanceof TypeError && e.message.includes('Failed to fetch')) {
      console.log('[Upload] 网络异常，降级到服务器中转...');
      return await relayUpload(file, assetType);
    }

    return null;
  }
}
