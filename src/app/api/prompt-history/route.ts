import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { cookies } from 'next/headers';

// 获取提示词历史（去重后，只返回提示词内容）
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get('user_id')?.value;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: '未登录',
        prompts: [],
        total: 0
      });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '15');
    const offset = parseInt(searchParams.get('offset') || '0');

    const client = getSupabaseClient(undefined, true);

    // 只查询id和prompt字段
    const { data: records, error } = await client
      .from('generation_records')
      .select('id, prompt, reference_images')
      .eq('user_id', userId)
      .not('prompt', 'is', null)
      .neq('prompt', '')
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('获取提示词历史失败:', error);
      return NextResponse.json({ 
        success: false, 
        error: '获取失败',
        prompts: [],
        total: 0
      });
    }

    // 按提示词去重，保留最新的记录
    const promptMap = new Map<string, { id: number; prompt: string; reference_images: string[] }>();
    
    for (const record of records || []) {
      if (record.prompt && record.prompt.trim()) {
        const key = record.prompt.trim();
        if (!promptMap.has(key)) {
          promptMap.set(key, {
            id: record.id,
            prompt: record.prompt,
            reference_images: record.reference_images || [],
          });
        }
      }
    }

    const uniquePrompts = Array.from(promptMap.values());
    const total = uniquePrompts.length;
    
    // 分页
    const paginatedPrompts = uniquePrompts.slice(offset, offset + limit);

    return NextResponse.json({
      success: true,
      prompts: paginatedPrompts,
      total,
    });

  } catch (error) {
    console.error('获取提示词历史错误:', error);
    return NextResponse.json({ 
      success: false, 
      error: '服务器错误',
      prompts: [],
      total: 0
    });
  }
}
