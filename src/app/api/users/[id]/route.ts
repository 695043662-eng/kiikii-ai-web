import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 管理员手机号
const ADMIN_PHONE = '13824085362';

// 供应商接口配置
const SUPPLIER_API_URL = process.env.SUPPLIER_API_URL || 'https://api.mmw.ink';
const SUPPLIER_API_TOKEN = process.env.SUPPLIER_API_TOKEN || 'e27a9d830e4e46cc9a2957ea2c84e1fc';

// 从供应商获取管理员积分
async function getAdminCreditsFromSupplier(): Promise<{ supplierCredits: number; localCredits: number } | null> {
  if (!SUPPLIER_API_TOKEN) {
    return null;
  }

  try {
    const response = await fetch(`${SUPPLIER_API_URL}/client/openapi/getCredits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: SUPPLIER_API_TOKEN }),
    });

    if (!response.ok) {
      return null;
    }

    const result = await response.json();
    if (result.code === 0 && result.data?.credits !== undefined) {
      const supplierCredits = result.data.credits;
      // 本地积分 = 供应商积分 / 100，取整数
      const localCredits = Math.floor(supplierCredits / 100);
      return { supplierCredits, localCredits };
    }
    return null;
  } catch {
    return null;
  }
}

// GET /api/users/[id] - 获取用户详情
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient(undefined, true);
    const { id } = await params;
    
    // 获取用户基本信息
    const { data: user, error: userError } = await client
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    
    if (userError) {
      if (userError.code === 'PGRST116') {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
      return NextResponse.json({ error: userError.message }, { status: 500 });
    }

    // 如果是管理员，从供应商获取真实积分
    let finalUser = { ...user };
    if (user.phone === ADMIN_PHONE) {
      const adminCredits = await getAdminCreditsFromSupplier();
      if (adminCredits !== null) {
        finalUser.credits = adminCredits.localCredits;
        finalUser.supplierCredits = adminCredits.supplierCredits;
        finalUser.isAdmin = true;
      }
    }
    
    // 获取充值记录
    const { data: rechargeRecords } = await client
      .from('recharge_records')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false });
    
    // 获取兑换记录
    const { data: exchangeRecords } = await client
      .from('exchange_records')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false });
    
    // 获取积分使用记录
    const { data: pointUsageRecords } = await client
      .from('point_usage_records')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false });
    
    return NextResponse.json({
      data: {
        ...finalUser,
        rechargeRecords: rechargeRecords || [],
        exchangeRecords: exchangeRecords || [],
        pointUsageRecords: pointUsageRecords || [],
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user' },
      { status: 500 }
    );
  }
}

// PUT /api/users/[id] - 更新用户
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient(undefined, true);
    const { id } = await params;
    const body = await request.json();
    
    const { nickname, phone, email, credits, isActive } = body;
    
    const updateData: Record<string, unknown> = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (credits !== undefined) updateData.credits = credits;
    if (isActive !== undefined) updateData.is_active = isActive;
    updateData.updated_at = new Date().toISOString();
    
    const { data, error } = await client
      .from('users')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Phone number already exists' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    if (!data) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

// DELETE /api/users/[id] - 删除用户
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = getSupabaseClient(undefined, true);
    const { id } = await params;
    
    // 删除相关记录
    await client.from('recharge_records').delete().eq('user_id', id);
    await client.from('exchange_records').delete().eq('user_id', id);
    await client.from('point_usage_records').delete().eq('user_id', id);
    
    // 删除用户
    const { error } = await client
      .from('users')
      .delete()
      .eq('id', id);
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
