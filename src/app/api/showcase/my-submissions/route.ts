/**
 * GET /api/showcase/my-submissions
 * 
 * 用户获取自己的投稿记录
 * 
 * 安全措施：requireAuth 验证，只能查自己的
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  try {
    // 1. 验证登录
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId } = auth;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // 可选过滤：pending/approved/rejected/expired
    const page = parseInt(searchParams.get('page') || '1');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

    const client = getSupabaseClient(undefined, true); // service_role

    // 2. 查询用户的投稿记录
    let query = client
      .from('canvas_config')
      .select('id, extra_data, created_at')
      .eq('config_type', 'showcase_card')
      .contains('extra_data', { author_id: userId }) // JSONB contains 查询
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    // 可选状态过滤
    if (status) {
      query = query.contains('extra_data', { status });
    }

    const { data: cards, error } = await query;

    if (error) {
      console.error('[showcase/my-submissions] 查询失败:', error.message);
      return NextResponse.json(
        { success: false, error: '查询投稿记录失败' },
        { status: 500 }
      );
    }

    // 3. 格式化返回数据
    const items = (cards || []).map(card => {
      const extra = card.extra_data || {};
      return {
        id: card.id,
        imageUrl: extra.source_image_key || extra.imageUrl || '',
        tag: extra.tag || '',
        title: extra.title || '',
        subtitle: extra.subtitle || '',
        model: extra.builtInModel || '',
        prompt: extra.builtInPrompt || '',
        status: extra.status || 'unknown',
        submittedAt: extra.submitted_at || card.created_at,
        reviewedAt: extra.reviewed_at || null,
        rejectReason: extra.reject_reason || null,
      };
    });

    return NextResponse.json({
      success: true,
      items,
      page,
      limit,
    });
  } catch (error) {
    console.error('[showcase/my-submissions] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}
