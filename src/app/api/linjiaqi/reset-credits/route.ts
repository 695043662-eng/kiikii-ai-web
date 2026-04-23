import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// POST /api/linjiaqi/reset-credits - 清零所有用户积分
export async function POST(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 清零所有用户的积分
    const { data, error } = await client
      .from('users')
      .update({ credits: 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000') // 更新所有用户
      .select('id, phone, nickname, credits');
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: '所有用户积分已清零',
      affected_users: data?.length || 0,
      users: data 
    });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
