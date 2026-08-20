import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAdmin } from '@/lib/admin-middleware';

// 管理员手机号
const ADMIN_PHONE = process.env.ADMIN_PHONE;

// 供应商接口配置
const SUPPLIER_API_URL = process.env.SUPPLIER_API_URL;
const SUPPLIER_API_TOKEN = process.env.SUPPLIER_API_TOKEN;
if (!SUPPLIER_API_URL || !SUPPLIER_API_TOKEN) {
  console.error('[安全] SUPPLIER_API_URL 或 SUPPLIER_API_TOKEN 环境变量未配置');
}

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
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

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
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

    const client = getSupabaseClient(undefined, true);
    const { id } = await params;
    const body = await request.json();
    
    const { nickname, phone, email, credits, isActive } = body;
    
    const updateData: Record<string, unknown> = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (phone !== undefined) updateData.phone = phone;
    if (email !== undefined) updateData.email = email;
    if (credits !== undefined) updateData.credits = credits;
    if (isActive !== undefined) {
      updateData.is_active = isActive;
      // 🚀 #505 管理后台联动：
      // 解封：清除 locked_until 和 failed_attempts（与零写入解封兼容）
      // 禁用：设置 is_active=false + locked_until=null（表示永久禁用）
      if (isActive === true) {
        updateData.locked_until = null;
        updateData.failed_attempts = 0;
        console.log(`[管理后台解封] #505 用户 ${id} 被管理员手动解封，清除禁用时间和违规计数`);
      }
      if (isActive === false) {
        updateData.locked_until = null;  // null = 管理员手动禁用，非自动禁用
        console.log(`[管理后台禁用] #505 用户 ${id} 被管理员手动禁用`);
      }
    }
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
    const auth = await requireAdmin();
    if (auth instanceof NextResponse) return auth;

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
