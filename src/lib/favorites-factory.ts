/**
 * 收藏 API 工厂函数
 * 
 * 统一处理 prompt_favorites / video_favorites / text_panel_favorites 三张表
 * 的 GET / POST / PUT / DELETE 逻辑，消除 500+ 行重复代码
 * 
 * @example
 * // src/app/api/prompt-favorites/route.ts
 * import { createFavoritesRoutes } from '@/lib/favorites-factory';
 * export const { GET, POST, PUT, DELETE } = createFavoritesRoutes('prompt_favorites');
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from './auth-middleware';

/**
 * 创建收藏 API 路由处理函数
 * 
 * @param tableName Supabase 表名（prompt_favorites / video_favorites / text_panel_favorites）
 * @returns { GET, POST, PUT, DELETE } 四个路由处理函数
 */
export function createFavoritesRoutes(tableName: string) {

  // GET - 获取收藏列表
  async function GET(request: NextRequest) {
    try {
      const auth = await requireAuth();
      if (auth instanceof NextResponse) {
        return NextResponse.json({
          success: false,
          error: '未登录',
          favorites: [],
        });
      }
      const { userId } = auth;

      const client = getSupabaseClient(undefined, true);
      const { data, error } = await client
        .from(tableName)
        .select('*')
        .eq('user_id', userId)
        .order('sort_order', { ascending: true });

      if (error) {
        console.error(`[${tableName}] 获取失败:`, error);
        return NextResponse.json({
          success: false,
          error: '获取收藏失败',
          favorites: [],
        });
      }

      return NextResponse.json({
        success: true,
        favorites: data || [],
      });
    } catch (error) {
      console.error(`[${tableName}] 获取异常:`, error);
      return NextResponse.json({
        success: false,
        error: '服务器错误',
        favorites: [],
      });
    }
  }

  // POST - 添加收藏
  async function POST(request: NextRequest) {
    try {
      const auth = await requireAuth();
      if (auth instanceof NextResponse) return auth;
      const { userId } = auth;

      const body = await request.json();
      const { content, name } = body;

      if (!content) {
        return NextResponse.json(
          { success: false, error: '内容不能为空' },
          { status: 400 }
        );
      }

      const client = getSupabaseClient(undefined, true);

      // 获取当前最大 sort_order
      const { data: maxSortData } = await client
        .from(tableName)
        .select('sort_order')
        .eq('user_id', userId)
        .order('sort_order', { ascending: false })
        .limit(1);

      const nextSortOrder = maxSortData && maxSortData.length > 0
        ? (maxSortData[0].sort_order || 0) + 1
        : 1;

      // 检查是否已存在相同内容
      const { data: existing } = await client
        .from(tableName)
        .select('id')
        .eq('user_id', userId)
        .eq('content', content)
        .single();

      if (existing) {
        return NextResponse.json(
          { success: false, error: '该内容已收藏' },
          { status: 409 }
        );
      }

      const { data, error } = await client
        .from(tableName)
        .insert({
          user_id: userId,
          content,
          name: name || content.substring(0, 50),
          sort_order: nextSortOrder,
        })
        .select()
        .single();

      if (error) {
        console.error(`[${tableName}] 添加失败:`, error);
        return NextResponse.json(
          { success: false, error: '添加收藏失败' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, favorite: data });
    } catch (error) {
      console.error(`[${tableName}] 添加异常:`, error);
      return NextResponse.json(
        { success: false, error: '服务器错误' },
        { status: 500 }
      );
    }
  }

  // PUT - 更新收藏
  async function PUT(request: NextRequest) {
    try {
      const auth = await requireAuth();
      if (auth instanceof NextResponse) return auth;
      const { userId } = auth;

      const body = await request.json();
      const { id, content, name, sort_order } = body;

      if (!id) {
        return NextResponse.json(
          { success: false, error: '缺少收藏ID' },
          { status: 400 }
        );
      }

      const client = getSupabaseClient(undefined, true);

      const updateData: Record<string, unknown> = {};
      if (content !== undefined) updateData.content = content;
      if (name !== undefined) updateData.name = name;
      if (sort_order !== undefined) updateData.sort_order = sort_order;

      const { data, error } = await client
        .from(tableName)
        .update(updateData)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        console.error(`[${tableName}] 更新失败:`, error);
        return NextResponse.json(
          { success: false, error: '更新收藏失败' },
          { status: 500 }
        );
      }

      if (!data) {
        return NextResponse.json(
          { success: false, error: '收藏不存在或无权限' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, favorite: data });
    } catch (error) {
      console.error(`[${tableName}] 更新异常:`, error);
      return NextResponse.json(
        { success: false, error: '服务器错误' },
        { status: 500 }
      );
    }
  }

  // DELETE - 删除收藏
  async function DELETE(request: NextRequest) {
    try {
      const auth = await requireAuth();
      if (auth instanceof NextResponse) return auth;
      const { userId } = auth;

      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');

      if (!id) {
        return NextResponse.json(
          { success: false, error: '缺少收藏ID' },
          { status: 400 }
        );
      }

      const client = getSupabaseClient(undefined, true);

      const { error } = await client
        .from(tableName)
        .delete()
        .eq('id', parseInt(id))
        .eq('user_id', userId);

      if (error) {
        console.error(`[${tableName}] 删除失败:`, error);
        return NextResponse.json(
          { success: false, error: '删除收藏失败' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      console.error(`[${tableName}] 删除异常:`, error);
      return NextResponse.json(
        { success: false, error: '服务器错误' },
        { status: 500 }
      );
    }
  }

  return { GET, POST, PUT, DELETE };
}
