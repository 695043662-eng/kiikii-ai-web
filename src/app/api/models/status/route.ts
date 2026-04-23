import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/**
 * 获取模型在线状态
 * 返回格式: { model_name: { status: true/false } }
 */
export async function GET() {
  try {
    const client = getSupabaseClient(undefined, true);
    
    // 从 api_models 表获取所有模型
    const { data: models, error } = await client
      .from('api_models')
      .select('model_id, model_name, is_active');
    
    if (error) {
      console.error('[API] 获取模型状态失败:', error);
      return NextResponse.json({ error: '获取模型状态失败' }, { status: 500 });
    }
    
    // 构建状态对象，默认所有模型都在线
    const statuses: Record<string, { status: boolean }> = {};
    
    for (const model of models || []) {
      statuses[model.model_id] = {
        status: model.is_active !== false, // is_active 为 false 时离线
      };
    }
    
    return NextResponse.json({ data: statuses });
  } catch (error) {
    console.error('[API] 获取模型状态异常:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
