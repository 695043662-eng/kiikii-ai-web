/**
 * GET /api/model-specs
 * 
 * 获取模型规格映射字典
 * 支持按 model_id 过滤，返回该模型的可用尺寸/分辨率/时长
 * 公开接口，无需登录
 * 
 * 降级策略：如果数据库表 model_spec_mapping 不存在（未迁移），
 * 则从静态配置返回基础规格数据
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 静态降级数据（数据库表不存在时使用）
const FALLBACK_SPECS: Record<string, Record<string, Array<{ value: string; label: string }>>> = {
  'gpt-image-2': {
    aspect_ratio: [
      { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' }, { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' }, { value: '3:1', label: '3:1' },
      { value: '1:3', label: '1:3' },
    ],
    resolution: [
      { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' },
      { value: '4k', label: '4K' },
    ],
  },
  'flux-1.1-pro': {
    aspect_ratio: [
      { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' }, { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
    ],
    resolution: [{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }],
  },
  'flux-kontext': {
    aspect_ratio: [
      { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' }, { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
    ],
    resolution: [{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }],
  },
  'nano-banana': {
    aspect_ratio: [
      { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' }, { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
    ],
    resolution: [{ value: '1K', label: '1K' }],
  },
  'nano-banana-fast': {
    aspect_ratio: [
      { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' }, { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
    ],
    resolution: [{ value: '1K', label: '1K' }],
  },
  'nano-banana-2': {
    aspect_ratio: [
      { value: '1:1', label: '1:1' }, { value: '3:4', label: '3:4' },
      { value: '4:3', label: '4:3' }, { value: '9:16', label: '9:16' },
      { value: '16:9', label: '16:9' },
    ],
    resolution: [{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }, { value: '4K', label: '4K' }],
  },
  'seedance-2.0': {
    aspect_ratio: [
      { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' }, { value: '21:9', label: '21:9' },
    ],
    duration: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 4), label: `${i + 4}秒` })),
    resolution: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
  },
  'seedance-2.0-fast': {
    aspect_ratio: [
      { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' }, { value: '21:9', label: '21:9' },
    ],
    duration: Array.from({ length: 9 }, (_, i) => ({ value: String(i + 4), label: `${i + 4}秒` })),
    resolution: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
  },
  'happyhorse-1.0': {
    aspect_ratio: [
      { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' },
      { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' },
      { value: '3:4', label: '3:4' },
    ],
    duration: [
      { value: '3', label: '3秒' }, { value: '5', label: '5秒' },
      { value: '8', label: '8秒' }, { value: '10', label: '10秒' },
      { value: '15', label: '15秒' },
    ],
    resolution: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
  },
  'veo3': {
    aspect_ratio: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
    duration: [{ value: '8', label: '8秒' }],
    resolution: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '4k', label: '4K' }],
  },
  'veo3-fast': {
    aspect_ratio: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
    duration: [{ value: '8', label: '8秒' }],
    resolution: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
  },
  'sora-2': {
    aspect_ratio: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
    duration: [{ value: '5', label: '5秒' }, { value: '10', label: '10秒' }],
    resolution: [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }],
  },
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get('model_id');
    const specType = searchParams.get('spec_type');

    const client = getSupabaseClient(undefined, true); // service_role 绕过 RLS

    let query = client
      .from('model_spec_mapping')
      .select('id, model_id, spec_type, spec_value, spec_label, is_enabled, sort_order')
      .eq('is_enabled', true)
      .order('sort_order', { ascending: true });

    if (modelId) {
      query = query.eq('model_id', modelId);
    }
    if (specType) {
      query = query.eq('spec_type', specType);
    }

    const { data, error } = await query;

    if (error) {
      // 表不存在时降级到静态数据
      if (error.message?.includes('schema cache') || error.code === '42P01') {
        console.warn('[model-specs] 表不存在，使用静态降级数据');
        return NextResponse.json({
          success: true,
          data: filterFallback(FALLBACK_SPECS, modelId, specType),
          source: 'fallback',
        });
      }
      console.error('[model-specs] 查询失败:', error.message);
      return NextResponse.json(
        { success: false, error: '查询模型规格失败' },
        { status: 500 }
      );
    }

    // 按模型分组返回（方便前端使用）
    const grouped: Record<string, Record<string, Array<{ value: string; label: string }>>> = {};
    for (const row of data || []) {
      if (!grouped[row.model_id]) {
        grouped[row.model_id] = {};
      }
      if (!grouped[row.model_id][row.spec_type]) {
        grouped[row.model_id][row.spec_type] = [];
      }
      grouped[row.model_id][row.spec_type].push({
        value: row.spec_value,
        label: row.spec_label || row.spec_value,
      });
    }

    return NextResponse.json({
      success: true,
      data: grouped,
      source: 'database',
    });
  } catch (error) {
    console.error('[model-specs] 异常:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误' },
      { status: 500 }
    );
  }
}

/**
 * 过滤静态降级数据
 */
function filterFallback(
  specs: Record<string, Record<string, Array<{ value: string; label: string }>>>,
  modelId: string | null,
  specType: string | null
): Record<string, Record<string, Array<{ value: string; label: string }>>> {
  let filtered = specs;
  if (modelId) {
    const modelSpecs = specs[modelId];
    if (!modelSpecs) return {};
    filtered = { [modelId]: modelSpecs };
  }
  if (specType) {
    const result: typeof filtered = {};
    for (const [mid, types] of Object.entries(filtered)) {
      if (types[specType]) {
        result[mid] = { [specType]: types[specType] };
      }
    }
    return result;
  }
  return filtered;
}
