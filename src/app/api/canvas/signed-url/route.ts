import { NextRequest, NextResponse } from 'next/server';
import { getSignedUrl } from '@/lib/cos';

/**
 * 批量获取 COS 签名 URL（用于画布图片恢复）
 * 不需要登录验证，因为 imageKey 来自本地存储
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { keys } = body as { keys: string[] };

    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return NextResponse.json({ success: false, error: '缺少 keys 参数' });
    }

    console.log('[signed-url] 批量获取签名 URL, keys 数量:', keys.length);

    // 并行获取所有签名 URL
    const results: Record<string, string> = {};
    const errors: string[] = [];

    await Promise.all(
      keys.map(async (key) => {
        try {
          // 验证 key 格式（防止恶意请求）
          if (!key || typeof key !== 'string' || key.includes('..') || key.startsWith('/')) {
            errors.push(`无效的 key: ${key}`);
            return;
          }
          
          const signedUrl = await getSignedUrl(key, 3600); // 1小时有效期（COS 可能不支持 5 天）
          results[key] = signedUrl;
        } catch (err) {
          console.error('[signed-url] 获取签名 URL 失败:', key, err);
          errors.push(`获取失败: ${key}`);
        }
      })
    );

    console.log('[signed-url] 成功获取', Object.keys(results).length, '个签名 URL');

    return NextResponse.json({
      success: true,
      urls: results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[signed-url] 请求处理失败:', error);
    return NextResponse.json({ success: false, error: '服务器错误' });
  }
}
