import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET /api/linjiaqi/credit-logs - 获取积分流水记录
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    const searchParams = request.nextUrl.searchParams;
    
    const userId = searchParams.get('user_id');
    const type = searchParams.get('type');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('page_size') || '50');
    
    // 构建查询
    let query = client
      .from('credit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });
    
    // 用户筛选
    if (userId) {
      query = query.eq('user_id', userId);
    }
    
    // 类型筛选
    if (type && type !== 'all') {
      query = query.eq('type', type);
    }
    
    // 时间范围筛选
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate + 'T23:59:59');
    }
    
    // 分页
    const offset = (page - 1) * pageSize;
    query = query.range(offset, offset + pageSize - 1);
    
    const { data: logs, error, count } = await query;
    
    if (error) {
      console.error('获取积分流水失败:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // 获取用户信息
    const userIds = [...new Set(logs?.map(l => l.user_id) || [])];
    const { data: users } = await client
      .from('users')
      .select('id, nickname, phone')
      .in('id', userIds);
    
    const userMap = new Map(users?.map(u => [u.id, u]) || []);
    
    // 组装数据
    const data = logs?.map(log => ({
      ...log,
      users: userMap.get(log.user_id),
    }));
    
    return NextResponse.json({
      data,
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
    });
  } catch (error) {
    console.error('Error fetching credit logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch credit logs' },
      { status: 500 }
    );
  }
}
