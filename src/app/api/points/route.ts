import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

// GET /api/points - 获取积分使用记录
export async function GET(request: NextRequest) {
  try {
    // 🔒 P0 鉴权：必须登录才能查看积分记录
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
      .from('point_usage_records')
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
      ...record,
      users: userMap.get(record.user_id),
    }));
    
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching point usage records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch point usage records' },
      { status: 500 }
    );
  }
}

// POST /api/points - 创建积分使用记录
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { userId, modelName, pointsUsed, description } = body;
    
    if (!userId || !modelName || !pointsUsed) {
      return NextResponse.json(
        { error: 'userId, modelName, and pointsUsed are required' },
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
    
    // 创建积分使用记录
    const { data, error } = await client
      .from('point_usage_records')
      .insert({
        user_id: userId,
        model_name: modelName,
        points_used: pointsUsed,
        description,
      })
      .select()
      .single();
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // 更新用户积分
    await client
      .from('users')
      .update({ credits: user.credits - pointsUsed })
      .eq('id', userId);
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Error creating point usage record:', error);
    return NextResponse.json(
      { error: 'Failed to create point usage record' },
      { status: 500 }
    );
  }
}
