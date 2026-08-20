import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * #837 读风暴修复：添加服务端内存缓存，2分钟 TTL
 * canvas_config 数据变化频率极低（仅在管理后台操作时才变）
 * 2分钟缓存足够，读请求从每页面1次降至每2分钟1次
 */
let canvasConfigCache: { data: any; timestamp: number } | null = null;
const CANVAS_CONFIG_CACHE_TTL = 2 * 60 * 1000; // 2 分钟

export async function GET() {
  try {
    // #837 检查缓存
    if (canvasConfigCache && Date.now() - canvasConfigCache.timestamp < CANVAS_CONFIG_CACHE_TTL) {
      return NextResponse.json(canvasConfigCache.data);
    }

    const supabase = getSupabaseClient(undefined, true);
    const { data, error } = await supabase
      .from('canvas_config')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('获取画布配置失败:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const responseData = { success: true, data };

    // #837 写入缓存
    canvasConfigCache = { data: responseData, timestamp: Date.now() };

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error('获取画布配置异常:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
