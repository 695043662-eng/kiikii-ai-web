/**
 * 图库资产删除 API
 * DELETE /api/library/assets/delete
 *
 * Body: { id: string, type: 'generated' | 'uploaded' }
 *
 * id 格式约定：
 *   - 生成图: "gen-{recordId}-{imageIndex}"  → 删除 generation_records 中对应记录的 images[idx] 和 image_keys[idx]
 *   - 参考图: "ref-{recordId}"               → 删除 reference_images 中对应记录
 *
 * 如果 generation_records 中该记录只剩最后一张图，则整条删除
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';
import { deleteFromCOS } from '@/lib/cos';

export async function DELETE(request: NextRequest) {
  try {
    // 认证
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const body = await request.json();
    const { id, type } = body as { id: string; type: 'generated' | 'uploaded' };

    if (!id || !type) {
      return NextResponse.json({ error: '缺少参数: id, type' }, { status: 400 });
    }

    const client = getSupabaseClient(undefined, true);

    // --------------------------------------------------------
    // 删除 AI 生成图
    // --------------------------------------------------------
    if (type === 'generated') {
      // 解析 id: "gen-{recordId}-{imageIndex}"
      const match = id.match(/^gen-(\d+)-(\d+)$/);
      if (!match) {
        return NextResponse.json({ error: '无效的生成图 ID 格式' }, { status: 400 });
      }

      const recordId = parseInt(match[1]);
      const imageIndex = parseInt(match[2]);

      // 查询该记录
      const { data: record, error: queryError } = await client
        .from('generation_records')
        .select('id, images, image_keys, user_id')
        .eq('id', recordId)
        .single();

      if (queryError || !record) {
        return NextResponse.json({ error: '记录不存在' }, { status: 404 });
      }

      // 安全校验：只能删自己的
      if (record.user_id !== userId) {
        return NextResponse.json({ error: '无权操作' }, { status: 403 });
      }

      const images: string[] = record.images || [];
      const imageKeys: string[] = record.image_keys || [];

      // 尝试删除 COS 上的文件
      const cosKeyToDelete = imageKeys[imageIndex];
      if (cosKeyToDelete) {
        try {
          // #867 dev/prod/perm/ 前缀用 perm，其他用 temp
          const assetType = (cosKeyToDelete.startsWith('dev/') || cosKeyToDelete.startsWith('prod/') || cosKeyToDelete.startsWith('perm/')) ? 'perm' : 'temp';
          await deleteFromCOS(cosKeyToDelete, assetType as 'perm' | 'temp');
        } catch (cosErr) {
          console.warn('[library/delete] COS 删除失败，继续删除数据库记录:', cosErr);
        }
      }

      // 如果只剩一张图，直接删除整条记录
      if (images.length <= 1) {
        const { error: deleteError } = await client
          .from('generation_records')
          .delete()
          .eq('id', recordId);

        if (deleteError) {
          console.error('[library/delete] 删除记录失败:', deleteError.message);
          return NextResponse.json({ error: '删除失败' }, { status: 500 });
        }
      } else {
        // 移除指定索引的图片和 key
        const newImages = images.filter((_, i) => i !== imageIndex);
        const newKeys = imageKeys.filter((_, i) => i !== imageIndex);

        const { error: updateError } = await client
          .from('generation_records')
          .update({ images: newImages, image_keys: newKeys })
          .eq('id', recordId);

        if (updateError) {
          console.error('[library/delete] 更新记录失败:', updateError.message);
          return NextResponse.json({ error: '删除失败' }, { status: 500 });
        }
      }

      return NextResponse.json({ success: true, message: '已删除' });
    }

    // --------------------------------------------------------
    // 删除上传参考图
    // --------------------------------------------------------
    if (type === 'uploaded') {
      const match = id.match(/^ref-(\d+)$/);
      if (!match) {
        return NextResponse.json({ error: '无效的参考图 ID 格式' }, { status: 400 });
      }

      const recordId = parseInt(match[1]);

      // 查询该记录
      const { data: record, error: queryError } = await client
        .from('reference_images')
        .select('id, cos_key, user_id')
        .eq('id', recordId)
        .single();

      if (queryError || !record) {
        return NextResponse.json({ error: '记录不存在' }, { status: 404 });
      }

      if (record.user_id !== userId) {
        return NextResponse.json({ error: '无权操作' }, { status: 403 });
      }

      // 删除 COS 文件
      if (record.cos_key) {
        try {
          // #867 dev/prod/perm/ 前缀用 perm，其他用 temp
          const assetType = (record.cos_key.startsWith('dev/') || record.cos_key.startsWith('prod/') || record.cos_key.startsWith('perm/')) ? 'perm' : 'temp';
          await deleteFromCOS(record.cos_key, assetType as 'perm' | 'temp');
        } catch (cosErr) {
          console.warn('[library/delete] COS 删除失败，继续删除数据库记录:', cosErr);
        }
      }

      // 删除数据库记录
      const { error: deleteError } = await client
        .from('reference_images')
        .delete()
        .eq('id', recordId);

      if (deleteError) {
        console.error('[library/delete] 删除参考图记录失败:', deleteError.message);
        return NextResponse.json({ error: '删除失败' }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: '已删除' });
    }

    return NextResponse.json({ error: '不支持的 type' }, { status: 400 });

  } catch (error) {
    console.error('[library/delete] 异常:', error);
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
  }
}
