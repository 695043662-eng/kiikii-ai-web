import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET /api/recharge - 获取充值记录
export async function GET(request: NextRequest) {
  try {
    // 使用 service role 绕过 RLS
    const client = getSupabaseClient(undefined, true);
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('user_id');
    
    let query = client
      .from('recharge_records')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (userId) {
      query = query.eq('user_id', userId);
    }
    
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
    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { userId, amount, points, paymentMethod } = body;
    
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
      await client
        .from('users')
        .update({ credits: user.credits + points })
        .eq('id', userId);
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
