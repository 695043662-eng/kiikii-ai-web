/**
 * GET /api/showcase/pending
 * 
 * 管理员获取待审核的展示卡片列表
 * 
 * 安全措施：requireAdmin 验证
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';

export async function GET(request: NextRequest) {
  try {
    // 1. 验证管理员
    const admin = await requireAdmin();
    if (admin instanceof NextResponse) return admin;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'pending'; // 默认只看 pending
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    const client = getSupabaseClient(undefined, true); // service_role

    // 2. 查询展示卡片（按 extra_data.status 过滤）
    const { data: cards, error } = await client
      .from('canvas_config')
      .select('id, extra_data, created_at')
      .eq('config_type', 'showcase_card')
      .contains('extra_data', { status }) // JSONB contains 查询
      .order('created_at', { ascending: true }) // 先提交的先审核
      .range((page - 1) * limit, page * limit - 1);

    if (error) {
      console.error('[showcase/pending] 查询失败:', error.message);
      return NextResponse.json(
        { success: false, error: '查询待审核列表失败' },
        { status: 500 }
      );
    }

    // 3. 将 COS key 转换为签名 URL（解决破图问题）
    const { getSignedUrl } = await import('@/lib/cos');
    const items = await Promise.all((cards || []).map(async card => {
      const extra = card.extra_data || {};
      const sourceKey = extra.source_image_key || '';
      let imageUrl = '';

      if (sourceKey) {
        try {
          imageUrl = await getSignedUrl(sourceKey, 3600, 'temp');
        } catch (e) {
          console.error('[showcase/pending] 签名URL生成失败:', sourceKey, e);
          imageUrl = ''; // 签名失败则留空
        }
      }

      return {
        id: card.id,
        imageUrl,
        tag: extra.tag || '',
        title: extra.title || '',
        subtitle: extra.subtitle || '',
        model: extra.builtInModel || '',
        prompt: extra.builtInPrompt || '',
        aspectRatio: extra.aspectRatio || '',
        resolution: extra.resolution || '',
        duration: extra.duration || '',
        status: extra.status || 'unknown',
        authorId: extra.author_id || '',
        submittedAt: extra.submitted_at || card.created_at,
        reviewedAt: extra.reviewed_at || null,
        reviewerId: extra.reviewer_id || null,
        rejectReason: extra.reject_reason || null,
        sourceType: extra.source_type || 'unknown',
      };
    }));

    return NextResponse.json({
      success: true,
      items,
      page,
      limit,
    });
  } catch (error) {
    console.error('[showcase/pending] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
