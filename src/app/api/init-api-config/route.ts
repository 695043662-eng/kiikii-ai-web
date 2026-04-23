import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function GET() {
  try {
    const client = getSupabaseClient(undefined, true);

    // 检查是否已有配置
    const { data: existingConfigs } = await client
      .from('api_configs')
      .select('id');

    if (existingConfigs && existingConfigs.length > 0) {
      return NextResponse.json({
        success: true,
        message: 'API 配置已存在',
        count: existingConfigs.length,
      });
    }

    // 从环境变量读取默认 API Key（符合军规第1条）
    const defaultApiKey = process.env.GRS_API_KEY || process.env.NEXT_PUBLIC_DEFAULT_API_KEY || '';
    
    if (!defaultApiKey) {
      return NextResponse.json({
        success: false,
        error: '未配置默认 API Key，请设置 GRS_API_KEY 或 NEXT_PUBLIC_DEFAULT_API_KEY 环境变量',
      });
    }

    // 插入默认 API 配置
    const { data: config, error: configError } = await client
      .from('api_configs')
      .insert({
        name: 'GRS AI 生图',
        service_type: 'image_generation',
        api_endpoint: 'https://grsai.dakka.com.cn/v1/draw/nano-banana',
        api_key: defaultApiKey,
        request_method: 'POST',
        request_headers: { 'Content-Type': 'application/json' },
        request_body_template: {
          model: 'nano-banana',
          prompt: '',
          aspectRatio: 'auto',
          imageSize: '1K',
          shutProgress: true,
        },
        response_parser: {
          taskIdPath: 'data.taskId',
          statusPath: 'data.status',
          imageUrlPath: 'data.results[0].url',
          errorPath: 'data.error',
        },
        sort_order: 1,
        is_active: true,
      })
      .select()
      .single();

    if (configError) {
      return NextResponse.json({
        success: false,
        error: `插入配置失败: ${configError.message}`,
      });
    }

    // 插入默认模型
    const models = [
      {
        config_id: config.id,
        model_id: 'nano-banana',
        model_name: 'Nano Banana',
        description: '基础生图模型',
        parameters: {
          resolutions: [
            { label: '1K', value: '1K', credits: 10 },
          ],
        },
        credits_base: 10,
        is_active: true,
        sort_order: 1,
      },
      {
        config_id: config.id,
        model_id: 'nano-banana-fast',
        model_name: 'Nano Banana Fast',
        description: '快速生图模型',
        parameters: {
          resolutions: [
            { label: '1K', value: '1K', credits: 8 },
          ],
        },
        credits_base: 8,
        is_active: true,
        sort_order: 2,
      },
      {
        config_id: config.id,
        model_id: 'nano-banana-2',
        model_name: 'Nano Banana 2',
        description: '进阶生图模型，支持高分辨率',
        parameters: {
          resolutions: [
            { label: '1K', value: '1K', credits: 10 },
            { label: '2K', value: '2K', credits: 12 },
            { label: '4K', value: '4K', credits: 15 },
          ],
        },
        credits_base: 10,
        is_active: true,
        sort_order: 3,
      },
    ];

    const { data: insertedModels, error: modelsError } = await client
      .from('api_models')
      .insert(models)
      .select();

    if (modelsError) {
      return NextResponse.json({
        success: false,
        error: `插入模型失败: ${modelsError.message}`,
      });
    }

    return NextResponse.json({
      success: true,
      message: '✅ API 配置和模型初始化成功！',
      config,
      models: insertedModels,
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
