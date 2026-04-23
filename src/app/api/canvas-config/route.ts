import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const supabase = getSupabaseClient(undefined, true);
    const { data, error } = await supabase
      .from('canvas_config')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('获取画布配置失败:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('获取画布配置异常:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
