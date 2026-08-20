/**
 * 图片转存接口
 * 
 * 功能：将临时目录（upload_tmp/）的图片转存到正式目录（permanent/）
 * 
 * 使用场景：
 * - 用户上传图片后，先存储到 upload_tmp/（24小时自动删除）
 * - 用户真正提交生图时，调用此接口转存到 permanent/（永久保存）
 * 
 * 这样可以防止孤儿文件堆积：
 * - 用户上传后未提交 → 24小时自动清理
 * - 用户提交生图 → 转存到永久目录
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCOSClient, COS_CONFIG } from '@/lib/cos';
import { requireAuth } from '@/lib/auth-middleware';

export async function POST(request: NextRequest) {
  // #890 终极清扫：COS 文件操作必须鉴权，防匿名刷取预签名
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const userId = auth.userId;
  
  try {
    const body = await request.json();
    const { keys } = body as { keys: string[] };

    if (!keys || !Array.isArray(keys) || keys.length === 0) {
      return NextResponse.json(
        { success: false, error: '缺少 keys 参数' },
        { status: 400 }
      );
    }

    console.log('[图片转存] 开始转存:', keys);

    const cos = getCOSClient();
    const results: Array<{ originalKey: string; newKey: string; url: string }> = [];

    for (const key of keys) {
      // 检查是否是临时文件
      if (!key.startsWith('upload_tmp/')) {
        console.warn('[图片转存] 跳过非临时文件:', key);
        // 非临时文件，直接返回原 key
        results.push({
          originalKey: key,
          newKey: key,
          // #764 返回代理 URL（浏览器带 Origin 头会导致 COS 签名校验 403）
        url: `/api/canvas/image?key=${encodeURIComponent(key)}`,
        });
        continue;
      }

      // 生成新的永久路径：permanent/年月/原文件名
      const fileName = key.split('/').pop() || '';
      const newKey = `permanent/${new Date().toISOString().slice(0, 7)}/${fileName}`;

      console.log('[图片转存] 复制文件:', { from: key, to: newKey });

      // 复制文件到永久目录
      await new Promise<void>((resolve, reject) => {
        cos.putObjectCopy(
          {
            Bucket: COS_CONFIG.Bucket,
            Region: COS_CONFIG.Region,
            Key: newKey,
            CopySource: `${COS_CONFIG.Bucket}.cos.${COS_CONFIG.Region}.myqcloud.com/${encodeURIComponent(key)}`,
          },
          (err) => {
            if (err) {
              console.error('[图片转存] 复制失败:', err);
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });

      // 删除临时文件（可选，因为生命周期会自动清理）
      // 这里选择不删除，让生命周期规则处理，避免额外请求

      results.push({
        originalKey: key,
        newKey,
        // #764 返回代理 URL（浏览器带 Origin 头会导致 COS 签名校验 403）
        url: `/api/canvas/image?key=${encodeURIComponent(newKey)}`,
      });

      console.log('[图片转存] 转存成功:', { originalKey: key, newKey });
    }

    console.log('[图片转存] 全部完成:', results.length, '个文件');

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error: any) {
    console.error('[图片转存] 失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '转存失败' },
      { status: 500 }
    );
  }
}
