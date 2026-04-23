import { NextRequest, NextResponse } from 'next/server';

// 模型状态缓存（5分钟有效）
const modelStatusCache = new Map<string, { status: boolean; error: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5分钟

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const model = searchParams.get('model');

    if (!model) {
      return NextResponse.json({ 
        code: 1, 
        msg: '缺少模型参数', 
        data: { status: false, error: '缺少模型参数' } 
      }, { status: 400 });
    }

    // 检查缓存
    const cached = modelStatusCache.get(model);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        code: 0,
        msg: 'success',
        data: {
          status: cached.status,
          error: cached.error,
        },
      });
    }

    // 调用外部API检查模型状态
    const apiEndpoint = `${process.env.SUPPLIER_API_URL || 'https://grsai.dakka.com.cn'}/client/common/getModelStatus?model=${encodeURIComponent(model)}`;
    
    const response = await fetch(apiEndpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    // 更新缓存
    modelStatusCache.set(model, {
      status: data.data?.status ?? false,
      error: data.data?.error ?? '',
      timestamp: Date.now(),
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error('获取模型状态失败:', error);
    return NextResponse.json({ 
      code: 1, 
      msg: '获取模型状态失败', 
      data: { status: false, error: '网络错误' } 
    }, { status: 500 });
  }
}

// 批量获取所有模型状态
export async function POST(request: NextRequest) {
  try {
    const { models } = await request.json();

    if (!models || !Array.isArray(models)) {
      return NextResponse.json({ 
        code: 1, 
        msg: '缺少模型列表参数', 
        data: {} 
      }, { status: 400 });
    }

    const results: Record<string, { status: boolean; error: string }> = {};

    // 并行获取所有模型状态
    await Promise.all(
      models.map(async (model) => {
        // 检查缓存
        const cached = modelStatusCache.get(model);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          results[model] = { status: cached.status, error: cached.error };
          return;
        }

        try {
          const apiEndpoint = `${process.env.SUPPLIER_API_URL || 'https://grsai.dakka.com.cn'}/client/common/getModelStatus?model=${encodeURIComponent(model)}`;
          const response = await fetch(apiEndpoint, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });

          const data = await response.json();
          const status = data.data?.status ?? false;
          const error = data.data?.error ?? '';

          // 更新缓存
          modelStatusCache.set(model, {
            status,
            error,
            timestamp: Date.now(),
          });

          results[model] = { status, error };
        } catch (error) {
          results[model] = { status: false, error: '网络错误' };
        }
      })
    );

    return NextResponse.json({
      code: 0,
      msg: 'success',
      data: results,
    });
  } catch (error) {
    console.error('批量获取模型状态失败:', error);
    return NextResponse.json({ 
      code: 1, 
      msg: '批量获取模型状态失败', 
      data: {} 
    }, { status: 500 });
  }
}
