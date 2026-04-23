import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const prodUrl = process.env.SUPABASE_URL;
    const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!prodUrl || !prodKey) {
      return NextResponse.json({
        success: false,
        error: '未配置生产数据库连接',
      });
    }

    const prodClient = createClient(prodUrl, prodKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 获取生产库的 model_credits_config 数据
    const { data: modelCredits, error } = await prodClient
      .from('model_credits_config')
      .select('*')
      .order('id');

    // 获取 canvas_config 数据
    const { data: canvasConfig } = await prodClient
      .from('canvas_config')
      .select('*')
      .order('id');

    // app_config 已废弃，预设颜色等配置已硬编码到前端

    return NextResponse.json({
      success: true,
      model_credits_config: modelCredits,
      canvas_config: canvasConfig,
      error: error?.message,
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
