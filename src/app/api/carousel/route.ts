import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';

// 🔥 强制动态渲染：禁止 Next.js 缓存此 API 的响应
// 解决"增删改后刷新页面数据回档"的问题
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * 轮播图配置 API
 * 
 * 架构原则：
 * 1. 数据库只存 COS ObjectKey（如 dev/canvas/2026-05/xxx.png），绝不存签名URL
 * 2. 前端渲染时通过 /api/canvas/image?key= 代理实时获取
 * 3. 所有用户通过 API 读取统一数据，不使用 localStorage
 * 
 * 存储方式：使用 canvas_config 表，config_type='carousel'
 * - config_key: ObjectKey（COS对象路径）
 * - config_type: 'carousel'（固定）
 * - title: 轮播标题
 * - content: 轮播副标题
 * - is_enabled: 是否启用
 * - sort_order: 排序
 * - extra_data: JSON { mediaType, tag }
 */

const TABLE = 'canvas_config';
const CAROUSEL_TYPE = 'carousel';

/** canvas_config 行 → 前端 CarouselItem */
function rowToItem(row: any) {
  const extra = row.extra_data || {};
  return {
    id: row.id,
    mediaType: extra.mediaType || 'image',
    objectKey: row.config_key,
    title: row.title || '',
    subtitle: row.content || '',
    tag: extra.tag || '',
    sortOrder: row.sort_order ?? 0,
    isActive: row.is_enabled ?? true,
  };
}

/** 前端 CarouselItem → canvas_config 行 */
function itemToRow(item: any) {
  return {
    config_key: item.objectKey,
    config_type: CAROUSEL_TYPE,
    title: item.title || '',
    content: item.subtitle || '',
    is_enabled: item.isActive ?? true,
    sort_order: item.sortOrder ?? 999,
    extra_data: {
      mediaType: item.mediaType || 'image',
      tag: item.tag || '',
    },
  };
}

// GET /api/carousel - 公开接口：获取启用的轮播项
export async function GET() {
  try {
    const client = getSupabaseClient(undefined, true);

    const { data, error } = await client
      .from(TABLE)
      .select('id, config_key, config_type, title, content, is_enabled, sort_order, extra_data')
      .eq('config_type', CAROUSEL_TYPE)
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[Carousel API] 查询失败:', error);
      // 兜底：返回空数组，确保首页不崩溃
      return NextResponse.json({ success: true, items: [] });
    }

    const items = (data || []).map(rowToItem);
    // #859 斩断浏览器 HTTP 缓存 + Debug 探针
    const response = NextResponse.json({ success: true, items, debug_server_time: new Date().toISOString() });
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch (error: any) {
    console.error('[Carousel API] GET 错误:', error);
    return NextResponse.json({ success: true, items: [] });
  }
}

// POST /api/carousel - 管理员：新增轮播项
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { mediaType, objectKey, title, subtitle, tag, sortOrder } = body;

    if (!objectKey) {
      return NextResponse.json(
        { success: false, error: 'objectKey 必填（COS 对象路径）' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true);
    const row = itemToRow({ mediaType, objectKey, title, subtitle, tag, sortOrder, isActive: true });

    const { data, error } = await client
      .from(TABLE)
      .insert(row)
      .select('id, config_key, config_type, title, content, is_enabled, sort_order, extra_data')
      .single();

    if (error) {
      console.error('[Carousel API] 新增失败:', error);
      throw error;
    }

    const item = rowToItem(data);
    console.log('[Carousel API] 新增轮播项:', item.id, item.title);
    return NextResponse.json({ success: true, data: item });
  } catch (error: any) {
    console.error('[Carousel API] POST 错误:', error);
    return NextResponse.json(
      { success: false, error: error.message || '新增轮播项失败' },
      { status: 500 }
    );
  }
}

// PUT /api/carousel - 管理员：更新轮播项
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { id, mediaType, objectKey, title, subtitle, tag, sortOrder, isActive } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id 必填' },
        { status: 400 }
      );
    }

    const client = getSupabaseClient(undefined, true);

    // 构建更新字段
    const updateFields: Record<string, any> = { updated_at: new Date().toISOString() };
    if (objectKey !== undefined) updateFields.config_key = objectKey;
    if (title !== undefined) updateFields.title = title;
    if (subtitle !== undefined) updateFields.content = subtitle;
    if (sortOrder !== undefined) updateFields.sort_order = sortOrder;
    if (isActive !== undefined) updateFields.is_enabled = isActive;

    // extra_data 需要合并更新
    if (mediaType !== undefined || tag !== undefined) {
      // 先读取当前 extra_data
      const { data: current } = await client
        .from(TABLE)
        .select('extra_data')
        .eq('id', id)
        .single();

      const currentExtra = current?.extra_data || {};
      updateFields.extra_data = {
        ...currentExtra,
        ...(mediaType !== undefined ? { mediaType } : {}),
        ...(tag !== undefined ? { tag } : {}),
      };
    }

    const { data, error } = await client
      .from(TABLE)
      .update(updateFields)
      .eq('id', id)
      .eq('config_type', CAROUSEL_TYPE)  // 安全：只更新轮播类型
      .select('id, config_key, config_type, title, content, is_enabled, sort_order, extra_data')
      .single();

    if (error) {
      console.error('[Carousel API] 更新失败:', error);
      throw error;
    }

    if (!data) {
      return NextResponse.json(
        { success: false, error: '未找到该轮播项' },
        { status: 404 }
      );
    }

    const item = rowToItem(data);
    console.log('[Carousel API] 更新轮播项:', id);
    return NextResponse.json({ success: true, data: item });
  } catch (error: any) {
    console.error('[Carousel API] PUT 错误:', error);
    return NextResponse.json(
      { success: false, error: error.message || '更新轮播项失败' },
      { status: 500 }
    );
  }
}

// DELETE /api/carousel - 管理员：删除轮播项
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
      } catch {}
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
      .eq('config_type', CAROUSEL_TYPE);  // 安全：只删除轮播类型

    if (error) {
      console.error('[Carousel API] 删除失败:', error);
      throw error;
    }

    console.log('[Carousel API] 删除轮播项:', id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Carousel API] DELETE 错误:', error);
    return NextResponse.json(
      { success: false, error: error.message || '删除轮播项失败' },
      { status: 500 }
    );
  }
}
