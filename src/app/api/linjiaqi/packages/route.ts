import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// 管理员手机号
const ADMIN_PHONE = '13824085362';

// GET /api/linjiaqi/packages - 获取所有充值套餐
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    // 获取所有套餐，按排序顺序
    const { data: packages, error } = await client
      .from('recharge_packages')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data: packages });
  } catch (error) {
    console.error('获取充值套餐失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

// POST /api/linjiaqi/packages - 创建新套餐
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { name, price, credits, tag, savings, sort_order, is_active } = body;

    // 验证必填字段
    if (!name || price === undefined || credits === undefined) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const { data, error } = await client
      .from('recharge_packages')
      .insert({
        name,
        price, // 前端传入分，直接存储
        credits,
        tag: tag || null,
        savings: savings || null,
        sort_order: sort_order || 0,
        is_active: is_active !== undefined ? is_active : true,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('创建充值套餐失败:', error);
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}

// PUT /api/linjiaqi/packages - 更新套餐
export async function PUT(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const body = await request.json();
    const { id, name, price, credits, tag, savings, sort_order, is_active } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少套餐ID' }, { status: 400 });
    }

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (credits !== undefined) updateData.credits = credits;
    if (tag !== undefined) updateData.tag = tag || null;
    if (savings !== undefined) updateData.savings = savings || null;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data, error } = await client
      .from('recharge_packages')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('更新充值套餐失败:', error);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

// DELETE /api/linjiaqi/packages - 删除套餐
export async function DELETE(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    
    // 验证是否为管理员
    const { data: currentUser } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    if (!currentUser || currentUser.phone !== ADMIN_PHONE) {
      return NextResponse.json({ error: '无权限' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少套餐ID' }, { status: 400 });
    }

    const { error } = await client
      .from('recharge_packages')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除充值套餐失败:', error);
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
