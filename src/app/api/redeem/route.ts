import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// POST /api/redeem - 用户兑换积分码
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true); // 使用 service role 绕过 RLS
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }
    
    // 获取用户手机号
    const { data: userData } = await client
      .from('users')
      .select('phone')
      .eq('id', userId)
      .single();
    
    const phone = userData?.phone || '';
    
    const body = await request.json();
    const { key_code } = body;
    
    if (!key_code) {
      return NextResponse.json({ error: '请输入兑换码' }, { status: 400 });
    }
    
    // 格式化兑换码（去除空格和横线，转为大写）
    const formattedKey = key_code.toUpperCase().replace(/[\s-]/g, '');
    
    // 重新格式化为标准格式 XXXX-XXXX-XXXX-XXXX
    const standardKey = formattedKey.match(/.{1,4}/g)?.join('-') || formattedKey;
    
    // 查询兑换码（支持多种格式）
    const { data: keyData, error: queryError } = await client
      .from('redeem_keys')
      .select('*')
      .or(`key_code.eq.${standardKey},key_code.eq.${formattedKey},key_code.eq.${key_code.toUpperCase()}`)
      .single();
    
    if (queryError || !keyData) {
      return NextResponse.json({ error: '兑换码不存在' }, { status: 400 });
    }
    
    // 检查状态（仅对单人兑换码）
    if (keyData.status === 'used' && !keyData.max_usage) {
      return NextResponse.json({ error: '该兑换码已被使用' }, { status: 400 });
    }
    
    // 检查兑换码是否已被使用过（每个兑换码只能使用一次）
    const { data: existingUsage } = await client
      .from('redeem_usage')
      .select('id')
      .eq('key_code', keyData.key_code)
      .limit(1);
    
    if (existingUsage && existingUsage.length > 0) {
      return NextResponse.json({ error: '该兑换码已被使用过，已失效' }, { status: 400 });
    }
    
    // 检查限量兑换码的总量限制（基于channel统计）
    if (keyData.max_usage) {
      const { count } = await client
        .from('redeem_usage')
        .select('*', { count: 'exact', head: true })
        .eq('channel', keyData.channel || '');
      
      const usageCount = count || 0;
      if (usageCount >= keyData.max_usage) {
        return NextResponse.json({ error: '该兑换码已被全部兑换完' }, { status: 400 });
      }
    }
    
    // 检查是否是限量渠道兑换码，且用户已兑换过该渠道（已被上面的防重复检查覆盖）
    
    // 开始事务处理
    // 1. 更新用户积分
    const { data: userCreditsData, error: userError } = await client
      .from('users')
      .select('credits')
      .eq('id', userId)
      .single();
    
    if (userError || !userCreditsData) {
      return NextResponse.json({ error: '用户信息获取失败' }, { status: 500 });
    }
    
    const newCredits = (userCreditsData.credits || 0) + keyData.credits;
    
    const { error: updateError } = await client
      .from('users')
      .update({ credits: newCredits, updated_at: new Date().toISOString() })
      .eq('id', userId);
    
    if (updateError) {
      console.error('更新积分失败:', updateError);
      return NextResponse.json({ error: '积分兑换失败' }, { status: 500 });
    }
    
    // #271 双式记账：写入统一流水表
    try {
      await client.from('credit_logs').insert({
        user_id: userId,
        amount: keyData.credits,  // 正数，表示增加
        balance_after: newCredits,
        type: 'recharge',
        reference_id: keyData.key_code,
        description: `卡密兑换 ${keyData.credits} 积分`,
        created_at: new Date().toISOString(),
      });
    } catch (logErr) {
      console.error('#271 记录流水失败:', logErr);
      // 不影响主流程
    }
    
    // 3. 记录兑换使用（用于限量兑换码统计和防重复）
    try {
      await client.from('redeem_usage').insert({
        key_code: keyData.key_code,
        user_id: userId,
        credits: keyData.credits,
        channel: keyData.channel || null,
        redeemed_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error('记录兑换使用失败:', err);
      // 如果记录失败，回滚用户积分
      await client
        .from('users')
        .update({ credits: userCreditsData.credits, updated_at: new Date().toISOString() })
        .eq('id', userId);
      return NextResponse.json({ error: '兑换失败，请重试' }, { status: 500 });
    }
    
    // 4. 记录兑换记录
    try {
      await client.from('exchange_records').insert({
        user_id: userId,
        key_code: keyData.key_code,
        credits: keyData.credits,
        status: 'completed',
      });
    } catch (err) {
      console.error('记录兑换记录失败:', err);
      // 不影响主流程
    }
    
    // 5. 如果是单人兑换码，标记为已使用
    if (!keyData.max_usage) {
      await client
        .from('redeem_keys')
        .update({
          status: 'used',
          used_by: userId,
          used_at: new Date().toISOString(),
        })
        .eq('id', keyData.id);
    }
    
    return NextResponse.json({
      success: true,
      credits: keyData.credits,
      totalCredits: newCredits,
      message: `成功兑换 ${keyData.credits} 积分`,
    });
  } catch (error) {
    console.error('Error redeeming key:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// GET /api/redeem - 获取用户的兑换记录
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true); // 使用 service role 绕过 RLS
    
    // 获取当前用户
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;
    
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }
    
    // 查询用户的兑换记录（从exchange_records表）
    const { data: records, error } = await client
      .from('exchange_records')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('获取兑换记录失败:', error);
      return NextResponse.json({ error: '获取失败' }, { status: 500 });
    }
    
    return NextResponse.json({ success: true, data: records });
  } catch (error) {
    console.error('Error fetching redeem records:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
