import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth } from '@/lib/auth-middleware';

// GET /api/exchange - 获取兑换记录
export async function GET(request: NextRequest) {
  try {
    // 🔒 P0 鉴权：必须登录才能查看兑换记录
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
      .from('exchange_records')
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
    // 🔒 P0 鉴权：必须登录
    const auth = await requireAuth();
    if (auth instanceof NextResponse) return auth;
    const { userId: authUserId } = auth;

    const client = getSupabaseClient(undefined, true);
    const body = await request.json();
    
    const { userId, itemName, pointsUsed } = body;
    
    // 🔒 P0 IDOR 防护：只允许操作自己的账号
    if (userId !== authUserId) {
      return NextResponse.json({ error: '无权操作他人账号' }, { status: 403 });
    }
    
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
    
    // 🔒 P0 修复：使用 CAS 乐观锁替代脏写（与 deductCredits 一致）
    // 🔥 #849 修复：CAS 必须检查返回行数！PostgREST 在 0 行更新时 error=null 但 data=null
    // 旧 BUG：只检查 updateError，0 行更新时静默成功 → 用户拿到兑换记录但积分未扣 → 透支！
    const MAX_EXCHANGE_CAS_RETRIES = 3;
    let casSuccess = false;
    let currentCredits = user.credits;
    let newCredits = 0;

    for (let attempt = 1; attempt <= MAX_EXCHANGE_CAS_RETRIES; attempt++) {
      // 重新检查积分是否足够（可能在并发等待期间被其他请求扣除）
      if (currentCredits < pointsUsed) {
        // 积分不足，删除刚才创建的兑换记录，回滚
        await client.from('exchange_records').delete().eq('id', data.id);
        return NextResponse.json({ error: '积分不足' }, { status: 400 });
      }

      newCredits = currentCredits - pointsUsed;
      const { data: casData, error: updateError } = await client
        .from('users')
        .update({ credits: newCredits })
        .eq('id', userId)
        .eq('credits', currentCredits) // CAS WHERE 条件：精确匹配当前余额
        .select();

      if (updateError) {
        console.error('[exchange] CAS 更新失败:', updateError);
        // 删除兑换记录，回滚
        await client.from('exchange_records').delete().eq('id', data.id);
        return NextResponse.json({ error: '积分更新失败，请重试' }, { status: 409 });
      }

      // 🔥 关键：检查是否有行被更新！0 行 = CAS 冲突
      if (casData && casData.length > 0) {
        casSuccess = true;
        console.log(`[exchange] CAS 成功: attempt=${attempt}, old=${currentCredits}, new=${newCredits}`);
        break;
      }

      // CAS 冲突，重新读取最新余额
      console.warn(`[exchange] CAS 冲突: attempt=${attempt}, expected=${currentCredits}, 重试...`);
      const { data: retryUser } = await client
        .from('users')
        .select('credits')
        .eq('id', userId)
        .single();
      
      if (!retryUser) {
        await client.from('exchange_records').delete().eq('id', data.id);
        return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      }
      currentCredits = retryUser.credits;
    }

    if (!casSuccess) {
      // CAS 全部失败，删除兑换记录，回滚
      await client.from('exchange_records').delete().eq('id', data.id);
      console.error('[exchange] CAS 3 轮全部冲突，已回滚兑换记录');
      return NextResponse.json({ error: '积分操作冲突，请重试' }, { status: 409 });
    }
    
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
