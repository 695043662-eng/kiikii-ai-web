import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// 获取提示词收藏列表
export async function GET() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '未登录',
        favorites: []
      });
    }

    // 使用服务角色密钥绕过 RLS
    const client = getSupabaseClient(undefined, true);

    const { data: favorites, error } = await client
      .from('prompt_favorites')
      .select('*')
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('获取提示词收藏失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '获取失败',
        favorites: []
      });
    }

    return NextResponse.json({
      success: true,
      favorites: favorites || []
    });

  } catch (error) {
    console.error('获取提示词收藏错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误',
      favorites: []
    });
  }
}

// 添加提示词收藏
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '未登录'
      });
    }

    const body = await request.json();
    const { content } = body;

    if (!content || !content.trim()) {
      return NextResponse.json({ 
        success: false, 
        error: '内容不能为空'
      });
    }

    // 使用服务角色密钥绕过 RLS
    const client = getSupabaseClient(undefined, true);

    // 获取当前最大的 sort_order
    const { data: maxOrder } = await client
      .from('prompt_favorites')
      .select('sort_order')
      .eq('user_id', userId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const nextOrder = (maxOrder && maxOrder.length > 0 ? maxOrder[0].sort_order : 0) + 1;

    const { data: favorite, error } = await client
      .from('prompt_favorites')
      .insert({
        user_id: userId,
        content: content.trim(),
        sort_order: nextOrder
      })
      .select()
      .single();

    if (error) {
      console.error('添加提示词收藏失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '添加失败'
      });
    }

    return NextResponse.json({
      success: true,
      favorite
    });

  } catch (error) {
    console.error('添加提示词收藏错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误'
    });
  }
}

// 更新提示词收藏
export async function PUT(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '未登录'
      });
    }

    const body = await request.json();
    const { id, content, sort_order } = body;

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少ID'
      });
    }

    // 使用服务角色密钥绕过 RLS
    const client = getSupabaseClient(undefined, true);

    const updateData: { content?: string; sort_order?: number; updated_at: string } = {
      updated_at: new Date().toISOString()
    };

    if (content !== undefined) {
      updateData.content = content.trim();
    }

    if (sort_order !== undefined) {
      updateData.sort_order = sort_order;
    }

    const { error } = await client
      .from('prompt_favorites')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      console.error('更新提示词收藏失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '更新失败'
      });
    }

    return NextResponse.json({
      success: true
    });

  } catch (error) {
    console.error('更新提示词收藏错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误'
    });
  }
}

// 删除提示词收藏
export async function DELETE(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '未登录'
      });
    }

    // 优先从 body 获取，兼容 searchParams
    let id: string | null = null;
    
    // 尝试从 body 读取
    try {
      const body = await request.json();
      id = body.id?.toString();
    } catch {
      // body 解析失败，尝试从 URL 获取
      const { searchParams } = new URL(request.url);
      id = searchParams.get('id');
    }

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少ID'
      });
    }

    // 使用服务角色密钥绕过 RLS
    const client = getSupabaseClient(undefined, true);

    const { error } = await client
      .from('prompt_favorites')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      console.error('删除提示词收藏失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '删除失败'
      });
    }

    return NextResponse.json({
      success: true
    });

  } catch (error) {
    console.error('删除提示词收藏错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误'
    });
  }
}
