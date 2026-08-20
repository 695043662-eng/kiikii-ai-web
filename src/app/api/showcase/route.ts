import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';

// 🔥 强制动态渲染：禁止 Next.js 缓存此 API 的响应
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 展示区卡片配置 API
 * 
 * 架构原则（与轮播图一致）：
 * 1. 数据库 canvas_config 表，config_type='showcase_card'
 * 2. 前端渲染时从 API 实时获取，不使用 localStorage
 * 3. 增删改通过 API 操作，确保跨标签页/跨设备数据一致
 * 
 * 数据映射：
 * - config_key: 卡片唯一标识（card-${id}）
 * - config_type: 'showcase_card'（固定）
 * - title: 卡片标题
 * - content: 卡片副标题
 * - is_enabled: 是否启用
 * - sort_order: 排序
 * - extra_data: JSON { imageUrl, tag, likes, aspectRatio, category, builtInModel, builtInPrompt, ... }
 */

const TABLE = 'canvas_config';
const CARD_TYPE = 'showcase_card';

/** #834 解析 aspectRatio：兼容 "9:16" 字符串格式 → 数字 */
function parseAspectRatio(value: any): number {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 1;
  if (typeof value === 'string' && value.includes(':')) {
    const parts = value.split(':').map(Number);
    if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
  }
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

/** 数据库行 → 前端 CardData */
function rowToCard(row: any) {
  const extra = row.extra_data || {};
  return {
    id: String(row.id),
    imageUrl: extra.imageUrl || '',
    tag: extra.tag || '',
    title: row.title || '',
    subtitle: row.content || '',
    likes: extra.likes || 0,
    aspectRatio: parseAspectRatio(extra.aspectRatio),
    gridSpan: extra.gridSpan || 1, // 🔥 新增：网格宽度 span
    category: extra.category || '',
    builtInModel: extra.builtInModel || undefined,
    builtInPrompt: extra.builtInPrompt || undefined,
    builtInReferenceImage: extra.builtInReferenceImage || undefined,
    referenceImages: extra.referenceImages || undefined,
    displayReferenceImage: extra.displayReferenceImage || undefined,
    builtInAspectRatio: extra.builtInAspectRatio || undefined,
    builtInResolution: extra.builtInResolution || undefined,
    builtInDuration: extra.builtInDuration || undefined,
    builtInVideoUrl: extra.builtInVideoUrl || undefined,
    // #819 审核流字段
    status: extra.status || 'approved',
    authorId: extra.author_id || undefined,
    sourceType: extra.source_type || 'admin_upload',
    submittedAt: extra.submitted_at || undefined,
  };
}

/** 前端 CardData → 数据库行 */
function cardToRow(card: any) {
  return {
    config_key: `card-${card.id || Date.now()}`,
    config_type: CARD_TYPE,
    title: card.title || '',
    content: card.subtitle || '',
    is_enabled: true,
    sort_order: card.sortOrder ?? 999,
    extra_data: {
      imageUrl: card.imageUrl || '',
      tag: card.tag || '',
      likes: card.likes || 0,
      aspectRatio: parseAspectRatio(card.aspectRatio),
      gridSpan: card.gridSpan || 1, // 🔥 新增：网格宽度 span
      category: card.category || '',
      builtInModel: card.builtInModel || null,
      builtInPrompt: card.builtInPrompt || null,
      builtInReferenceImage: card.builtInReferenceImage || null,
      referenceImages: card.referenceImages || null,
      displayReferenceImage: card.displayReferenceImage || null,
      builtInAspectRatio: card.builtInAspectRatio || null,
      builtInResolution: card.builtInResolution || null,
      builtInDuration: card.builtInDuration || null,
      builtInVideoUrl: card.builtInVideoUrl || null,
      // #819 审核流字段
      status: card.status || 'approved',
      author_id: card.authorId || null,
      source_type: card.sourceType || 'admin_upload',
      source_image_key: card.sourceImageKey || null,
      submitted_at: card.submittedAt || null,
    },
  };
}

// GET /api/showcase - 获取启用的展示卡片
export async function GET() {
  try {
    const client = getSupabaseClient(undefined, true);

    const { data, error } = await client
      .from(TABLE)
      .select('id, config_key, config_type, title, content, is_enabled, sort_order, extra_data')
      .eq('config_type', CARD_TYPE)
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[Showcase API] 查询失败:', error);
      return NextResponse.json({ success: true, items: [] });
    }

    // #819 只展示已审核通过的卡片（兼容旧数据无 status 字段）
    const filtered = (data || []).filter(row => {
      const status = row.extra_data?.status;
      return !status || status === 'approved';
    });

    const items = filtered.map(rowToCard);
    // #859 斩断浏览器 HTTP 缓存 + Debug 探针
    const response = NextResponse.json({ success: true, items, debug_server_time: new Date().toISOString() });
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch (error: any) {
    console.error('[Showcase API] GET 错误:', error);
    return NextResponse.json({ success: true, items: [] });
  }
}

// POST /api/showcase - 管理员：新增展示卡片
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { imageUrl } = body;

    if (!imageUrl) {
      return NextResponse.json(
        { success: false, error: 'imageUrl 必填' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true);
    const row = cardToRow(body);

    const { data, error } = await client
      .from(TABLE)
      .insert(row)
      .select('id, config_key, config_type, title, content, is_enabled, sort_order, extra_data')
      .single();

    if (error) {
      console.error('[Showcase API] 新增失败:', error);
      throw error;
    }

    const item = rowToCard(data);
    console.log('[Showcase API] 新增展示卡片:', item.id, item.title);
    return NextResponse.json({ success: true, data: item });
  } catch (error: any) {
    console.error('[Showcase API] POST 错误:', error);
    return NextResponse.json(
      { success: false, error: error.message || '新增展示卡片失败' },
      { status: 500 }
    );
  }
}

// PUT /api/showcase - 管理员：更新展示卡片
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id 必填' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true);

    // 构建更新字段
    const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
    if (body.title !== undefined) updateFields.title = body.title;
    if (body.subtitle !== undefined) updateFields.content = body.subtitle;
    if (body.sortOrder !== undefined) updateFields.sort_order = body.sortOrder;
    if (body.isActive !== undefined) updateFields.is_enabled = body.isActive;

    // extra_data 需要合并更新
    const extraFields = ['imageUrl', 'tag', 'likes', 'aspectRatio', 'gridSpan', 'category',
      'builtInModel', 'builtInPrompt', 'builtInReferenceImage', 'referenceImages',
      'displayReferenceImage', 'builtInAspectRatio', 'builtInResolution', 'builtInVideoUrl'];
    
    const hasExtraUpdate = extraFields.some(f => body[f] !== undefined);
    if (hasExtraUpdate) {
      const { data: current } = await client
        .from(TABLE)
        .select('extra_data')
        .eq('id', id)
        .single();

      const currentExtra = current?.extra_data || {};
      const newExtra: Record<string, any> = { ...currentExtra };
      extraFields.forEach(f => {
        if (body[f] !== undefined) {
          newExtra[f] = body[f];
        }
      });
      updateFields.extra_data = newExtra;
    }

    const { data, error } = await client
      .from(TABLE)
      .update(updateFields)
      .eq('id', id)
      .eq('config_type', CARD_TYPE)
      .select('id, config_key, config_type, title, content, is_enabled, sort_order, extra_data')
      .single();

    if (error) {
      console.error('[Showcase API] 更新失败:', error);
      throw error;
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: '未找到该展示卡片' },
        { status: 404 }
      );
    }

    const item = rowToCard(data);
    console.log('[Showcase API] 更新展示卡片:', id);
    return NextResponse.json({ success: true, data: item });
  } catch (error: any) {
    console.error('[Showcase API] PUT 错误:', error);
    return NextResponse.json(
      { success: false, error: error.message || '更新展示卡片失败' },
      { status: 500 }
    );
  }
}

// DELETE /api/showcase - 管理员：删除展示卡片
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get('id');

    if (!id) {
      try {
        const body = await request.json();
        id = body.id;
        console.log('[Showcase DELETE] body 解析成功, id:', id, 'type:', typeof id);
      } catch (e) {
        console.error('[Showcase DELETE] body 解析失败:', e);
      }
    } else {
      console.log('[Showcase DELETE] query 参数 id:', id);
    }

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id 参数必填' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true);

    const { error } = await client
      .from(TABLE)
      .delete()
      .eq('id', parseInt(id, 10))
      .eq('config_type', CARD_TYPE);

    if (error) {
      console.error('[Showcase API] 删除失败:', error);
      throw error;
    }

    console.log('[Showcase API] 删除展示卡片:', id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Showcase API] DELETE 错误:', error);
    return NextResponse.json(
      { success: false, error: error.message || '删除展示卡片失败' },
      { status: 500 }
    );
  }
}
