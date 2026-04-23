import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    // 读取生产数据库配置
    const prodUrl = process.env.SUPABASE_URL;
    const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!prodUrl || !prodKey) {
      return NextResponse.json({ success: false, error: '生产数据库配置缺失' });
    }

    const prodClient = createClient(prodUrl, prodKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 获取 api_configs 数据
    const { data: configs } = await prodClient.from('api_configs').select('*');
    
    // 获取 api_models 数据
    const { data: models } = await prodClient.from('api_models').select('*');

    return NextResponse.json({
      success: true,
      api_configs: configs,
      api_models: models,
      prodUrl: prodUrl.substring(0, 40) + '...',
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
