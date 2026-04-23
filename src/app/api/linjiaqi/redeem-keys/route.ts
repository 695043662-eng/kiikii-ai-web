import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// 管理员手机号
const ADMIN_PHONE = '13824085362';

// 生成随机兑换码
function generateKeyCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) {
      code += '-';
    }
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// GET /api/linjiaqi/redeem-keys - 获取所有兑换码列表
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

    // 获取查询参数
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');
    
    let query = client
      .from('redeem_keys')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (status) {
      query = query.eq('status', status);
    }
    
    if (channel) {
      query = query.eq('channel', channel);
    }
    
    const { data: keys, error } = await query;
    
    if (error) {
      console.error('获取兑换码列表失败:', error);
      return NextResponse.json({ error: '获取失败' }, { status: 500 });
    }
    
    // 获取限量渠道兑换统计
    let limitedStats: any = {};
    if (!channel || channel === 'limited') {
      const { data: stats } = await client
        .from('limited_channel_redemptions')
        .select('channel, count');
      
      if (stats) {
        stats.forEach((s: any) => {
          limitedStats[s.channel] = s.count;
        });
      }
    }
    
    return NextResponse.json({ data: keys, limitedStats });
  } catch (error) {
    console.error('Error fetching redeem keys:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// POST /api/linjiaqi/redeem-keys - 批量生成兑换码
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
    const { credits, count = 1, channel = 'normal', isLimited = false } = body;
    
    if (!credits || credits <= 0) {
      return NextResponse.json({ error: '积分数量必须大于0' }, { status: 400 });
    }
    
    if (count < 1 || count > 1000) {
      return NextResponse.json({ error: '生成数量必须在1-1000之间' }, { status: 400 });
    }
    
    // 批量生成兑换码
    const keys = [];
    const keyCodes = new Set<string>();
    
    while (keys.length < count) {
      const keyCode = generateKeyCode();
      
      // 检查是否重复
      if (keyCodes.has(keyCode)) continue;
      
      // 检查数据库中是否已存在
      const { data: existing } = await client
        .from('redeem_keys')
        .select('id')
        .eq('key_code', keyCode)
        .single();
      
      if (existing) continue;
      
      keyCodes.add(keyCode);
      keys.push({
        key_code: keyCode,
        credits,
        status: 'unused',
        created_by: userId,
        channel,
        is_limited: isLimited,
      });
    }
    
    // 批量插入
    const { data: insertedKeys, error } = await client
      .from('redeem_keys')
      .insert(keys)
      .select();
    
    if (error) {
      console.error('生成兑换码失败:', error);
      return NextResponse.json({ error: '生成失败' }, { status: 500 });
    }
    
    const channelName = channel === 'limited' ? '限量渠道' : '普通渠道';
    const limitNote = isLimited ? '（每个用户仅能兑换一次）' : '';
    
    return NextResponse.json({ 
      success: true,
      data: insertedKeys,
      message: `成功生成 ${count} 个${channelName}兑换码，每个 ${credits} 积分${limitNote}`
    });
  } catch (error) {
    console.error('Error creating redeem keys:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// DELETE /api/linjiaqi/redeem-keys - 删除未使用的兑换码
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
      return NextResponse.json({ error: '缺少兑换码ID' }, { status: 400 });
    }
    
    // 检查兑换码状态
    const { data: keyData } = await client
      .from('redeem_keys')
      .select('status')
      .eq('id', parseInt(id))
      .single();
    
    if (!keyData) {
      return NextResponse.json({ error: '兑换码不存在' }, { status: 404 });
    }
    
    if (keyData.status === 'used') {
      return NextResponse.json({ error: '已使用的兑换码不能删除' }, { status: 400 });
    }
    
    // 删除兑换码
    const { error } = await client
      .from('redeem_keys')
      .delete()
      .eq('id', parseInt(id));
    
    if (error) {
      console.error('删除兑换码失败:', error);
      return NextResponse.json({ error: '删除失败' }, { status: 500 });
    }
    
    return NextResponse.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('Error deleting redeem key:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
