import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// GET /api/model-credits-config - 获取所有启用的模型积分配置（公开接口）
export async function GET(request: NextRequest) {
  try {
    const client = getSupabaseClient(undefined, true);

    // 获取所有启用的模型配置
    const { data: configs, error } = await client
      .from('model_credits_config')
      .select('*')
      .eq('is_active', true)
      .order('id', { ascending: true });

    if (error) {
      throw error;
    }

    // 转换格式，方便前端使用
    const models = configs?.map((config: any) => {
      // 判断是否为视频模型
      const isVideo = config.model_key.includes('sora') || 
                      config.model_key.includes('veo') ||
                      config.model_key.includes('video');
      
      return {
        name: config.model_key,
        displayName: config.model_name,
        description: config.description || '',
        credits: config.credits,
        type: isVideo ? 'video' : 'image',
        tier: inferTier(config.model_key),
      };
    });

    return NextResponse.json({ success: true, data: models });
  } catch (error) {
    console.error('获取模型积分配置失败:', error);
    return NextResponse.json({ error: '获取失败' }, { status: 500 });
  }
}

// 根据模型名称推断等级
function inferTier(modelId: string): 'fast' | 'standard' | 'pro' | 'vip' {
  const id = modelId.toLowerCase();
  if (id.includes('vip')) return 'vip';
  if (id.includes('pro')) return 'pro';
  if (id.includes('fast')) return 'fast';
  return 'standard';
}
