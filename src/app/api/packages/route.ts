import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET /api/packages - 获取所有启用的充值套餐（公开接口）
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);

    // 获取所有启用的套餐，按排序顺序
    const { data: packages, error } = await client
      .from('recharge_packages')
      .select('id, name, price, credits, tag, savings, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, data: packages });
  } catch (error) {
    console.error('获取充值套餐失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}
