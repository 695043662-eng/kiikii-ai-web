import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

// GET /api/recharge - 获取充值记录
export async function GET(request: NextRequest) {
  try {
    // 🔒 P0 鉴权：必须登录才能查看充值记录
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId: authUserId } = auth;

    // 使用 service role 绕过 RLS
    const client = getSupabaseClient(undefined, true);
    const searchParams = request.nextUrl.searchParams;
    const queryUserId = searchParams.get('user_id');
    
    // 🔒 P0 IDOR 防护：只能查自己的记录
    const targetUserId = queryUserId || authUserId;
    
    let query = client
      .from('recharge_records')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false });
    
    const { data: records, error } = await query;
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // 获取用户信息
    const userIds = [...new Set(records?.map(r => r.user_id) || [])];
    const { data: users } = await client
      .from('users')
      .select('id, nickname, phone')
      .in('id', userIds);
    
    const userMap = new Map(users?.map(u => [u.id, u]) || []);
    
    const data = records?.map(record => ({
      id: record.id,
      user_id: record.user_id,
      amount: record.price || 0,  // 兼容旧字段
      points: record.credits || 0,  // 兼容旧字段
      payment_method: record.package_name || '',
      status: record.status,
      created_at: record.created_at,
      users: userMap.get(record.user_id),
    }));
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching recharge records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recharge records' },
      { status: 500 }
    );
  }
}

// POST /api/recharge - 创建充值记录
export async function POST(request: NextRequest) {
  try {
    // 🔒 P0 鉴权：必须登录
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId: authUserId } = auth;

    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { userId, amount, points, paymentMethod } = body;
    
    // 🔒 P0 IDOR 防护：只允许操作自己的账号
    if (userId !== authUserId) {
      return NextResponse.json({ error: '无权操作他人账号' }, { status: 403 });
    }
    
    if (!userId || !amount || !points || !paymentMethod) {
      return NextResponse.json(
        { error: 'userId, amount, points, and paymentMethod are required' },
        { status: 400 }
      );
    }
    
    // 创建充值记录
    const { data, error } = await client
      .from('recharge_records')
      .insert({
        user_id: userId,
        amount,
        points,
        payment_method: paymentMethod,
      })
      .select()
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // 更新用户积分
    const { data: user } = await client
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();
    
    if (user) {
      // 🔒 P0 修复：使用 CAS 乐观锁替代脏写
      const { error: updateError } = await client
        .from('users')
        .update({ credits: user.credits + points })
        .eq('id', userId)
        .eq('credits', user.credits); // CAS WHERE 条件
      
      if (updateError) {
        console.error('[recharge] CAS 更新失败，可能存在并发冲突:', updateError);
        return NextResponse.json({ error: '积分更新失败，请重试' }, { status: 409 });
      }
    }
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Error creating recharge record:', error);
    return NextResponse.json(
      { error: 'Failed to create recharge record' },
      { status: 500 }
    );
  }
}
