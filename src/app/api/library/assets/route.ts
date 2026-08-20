/**
 * 图库资产聚合查询 API
 * GET /api/library/assets?page=1&limit=24&type=all|generated|uploaded
 *
 * 数据源：
 *   1. generation_records → 展平 images 数组为单张资产
 *   2. reference_images   → 每条记录即一张参考图
 *
 * 返回统一 Asset 结构，按 created_at 倒序分页
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';
import { getSignedUrl } from '@/lib/cos';

// ============================================================
// 类型
// ============================================================
interface Asset {
  id: string;            // 复合 ID: "gen-{recordId}-{idx}" 或 "ref-{recordId}"
  url: string;           // 签名 URL
  imageKey: string;      // COS key（用于删除）
  type: 'generated' | 'uploaded';
  prompt: string | null;
  model: string | null;
  created_at: string;
}

interface AssetResponse {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ============================================================
// GET handler
// ============================================================
export async function GET(request: NextRequest) {
  try {
    // 认证
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    // 解析参数
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '24')));
    const type = searchParams.get('type') || 'all'; // all | generated | uploaded
    const offset = (page - 1) * limit;

    const client = getSupabaseClient(undefined, true);

    // --------------------------------------------------------
    // 1. 查询 AI 生成记录
    // --------------------------------------------------------
    type GenRecord = {
      id: number;
      images: string[];
      image_keys: string[];
      model: string | null;
      prompt: string | null;
      created_at: string;
    };

    const generatedAssets: Asset[] = [];

    if (type === 'all' || type === 'generated') {
      // 拉取足够多的记录以展平后覆盖分页范围
      // 策略：拉取 limit*5 条记录，展平后取前 offset+limit 条
      const fetchLimit = limit * 5;

      const { data: genRecords, error: genError } = await client
        .from('generation_records')
        .select('id, images, image_keys, model, prompt, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(fetchLimit);

      if (genError) {
        console.error('[library] 查询 generation_records 失败:', genError.message);
        // 回退：image_keys 列可能不存在
        const { data: fallbackRecords, error: fbError } = await client
          .from('generation_records')
          .select('id, images, model, prompt, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(fetchLimit);

        if (fbError) {
          console.error('[library] 回退查询也失败:', fbError.message);
        } else if (fallbackRecords) {
          for (const rec of fallbackRecords as (Omit<GenRecord, 'image_keys'> & { image_keys?: string[] })[]) {
            if (!rec.images || rec.images.length === 0) continue;
            for (let idx = 0; idx < rec.images.length; idx++) {
              const imgUrl = rec.images[idx];
              if (!imgUrl) continue;
              generatedAssets.push({
                id: `gen-${rec.id}-${idx}`,
                url: imgUrl,
                imageKey: rec.image_keys?.[idx] || '',
                type: 'generated',
                prompt: rec.prompt,
                model: rec.model,
                created_at: rec.created_at,
              });
            }
          }
        }
      } else if (genRecords) {
        for (const rec of genRecords as GenRecord[]) {
          if (!rec.images || rec.images.length === 0) continue;
          for (let idx = 0; idx < rec.images.length; idx++) {
            const imgUrl = rec.images[idx];
            if (!imgUrl) continue;
            generatedAssets.push({
              id: `gen-${rec.id}-${idx}`,
              url: imgUrl,
              imageKey: rec.image_keys?.[idx] || '',
              type: 'generated',
              prompt: rec.prompt,
              model: rec.model,
              created_at: rec.created_at,
            });
          }
        }
      }
    }

    // --------------------------------------------------------
    // 2. 查询上传参考图
    // --------------------------------------------------------
    type RefRecord = {
      id: number;
      cos_key: string;
      created_at: string;
    };

    const uploadedAssets: Asset[] = [];

    if (type === 'all' || type === 'uploaded') {
      const { data: refRecords, error: refError } = await client
        .from('reference_images')
        .select('id, cos_key, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit * 5);

      if (refError) {
        console.error('[library] 查询 reference_images 失败:', refError.message);
      } else if (refRecords) {
        for (const rec of refRecords as RefRecord[]) {
          if (!rec.cos_key) continue;
          // #867 判断资产类型：dev/prod/perm/ 前缀用 perm，其他(temp/showcase)用 temp
          const assetType = (rec.cos_key.startsWith('dev/') || rec.cos_key.startsWith('prod/') || rec.cos_key.startsWith('perm/')) ? 'perm' : 'temp';
          const signedUrl = await getSignedUrl(rec.cos_key, 3600, assetType as 'perm' | 'temp');
          uploadedAssets.push({
            id: `ref-${rec.id}`,
            url: signedUrl,
            imageKey: rec.cos_key,
            type: 'uploaded',
            prompt: null,
            model: null,
            created_at: rec.created_at,
          });
        }
      }
    }

    // --------------------------------------------------------
    // 3. 合并排序 + 分页
    // --------------------------------------------------------
    const allAssets = [...generatedAssets, ...uploadedAssets]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const total = allAssets.length;
    const pagedAssets = allAssets.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    // --------------------------------------------------------
    // 4. 为生成图补充签名 URL（如果是 COS key 格式则替换为签名 URL）
    // --------------------------------------------------------
    const finalAssets = await Promise.all(
      pagedAssets.map(async (asset) => {
        // 如果 URL 已经是 http 开头的完整 URL，直接返回
        if (asset.url.startsWith('http')) return asset;
        // 否则尝试用 imageKey 生成签名 URL
        if (asset.imageKey) {
          try {
            // #867 dev/prod/perm/ 前缀用 perm，其他用 temp
            const assetType = (asset.imageKey.startsWith('dev/') || asset.imageKey.startsWith('prod/') || asset.imageKey.startsWith('perm/')) ? 'perm' : 'temp';
            const signedUrl = await getSignedUrl(asset.imageKey, 3600, assetType as 'perm' | 'temp');
            return { ...asset, url: signedUrl };
          } catch {
            return asset;
          }
        }
        return asset;
      })
    );

    return NextResponse.json({
      assets: finalAssets,
      total,
      page,
      limit,
      hasMore,
    } as AssetResponse);

  } catch (error) {
    console.error('[library] 聚合查询异常:', error);
    return NextResponse.json(
      { error: '服务器内部错误' },
      { status: 500 }
    );
  }
}
