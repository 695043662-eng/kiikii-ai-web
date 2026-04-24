import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET /api/exchange - 获取兑换记录
export async function GET(request: NextRequest) {
  try {
    // 使用 service role 绕过 RLS
    const client = getSupabaseClient(undefined, true);
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('user_id');
    
    let query = client
      .from('exchange_records')
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
      ...record,
      users: userMap.get(record.user_id),
    }));
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching exchange records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exchange records' },
      { status: 500 }
    );
  }
}

// POST /api/exchange - 创建兑换记录
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { userId, itemName, pointsUsed } = body;
    
    if (!userId || !itemName || !pointsUsed) {
      return NextResponse.json(
        { error: 'userId, itemName, and pointsUsed are required' },
        { status: 400 }
      );
    }
    
    // 检查用户积分是否足够
    const { data: user, error: userError } = await client
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();
    
    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    if (user.credits < pointsUsed) {
      return NextResponse.json(
        { error: 'Insufficient credits' },
        { status: 400 }
      );
    }
    
    // 创建兑换记录
    const { data, error } = await client
      .from('exchange_records')
      .insert({
        user_id: userId,
        item_name: itemName,
        points_used: pointsUsed,
      })
      .select()
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // 更新用户积分
    const newCredits = user.credits - pointsUsed;
    await client
      .from('users')
      .update({ credits: newCredits })
      .eq('id', userId);
    
    // #271 双式记账：写入统一流水表
    try {
      await client.from('credit_logs').insert({
        user_id: userId,
        amount: -pointsUsed, // 负数，表示扣减
        balance_after: newCredits,
        type: 'exchange',
        reference_id: `exchange_${data.id}`,
        description: `兑换 ${itemName}，消耗 ${pointsUsed} 积分`,
        created_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error('#271 记录流水失败:', logErr);
      // 不影响主流程
    }
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Error creating exchange record:', error);
    return NextResponse.json(
      { error: 'Failed to create exchange record' },
      { status: 500 }
    );
  }
}
