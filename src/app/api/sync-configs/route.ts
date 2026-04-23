import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    
    const parseEnv = (content: string) => {
      const result: Record<string, string> = {};
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0) {
          const key = trimmed.substring(0, eq).trim();
          let value = trimmed.substring(eq + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          result[key] = value;
        }
      }
      return result;
    };

    const localEnv = parseEnv(envContent);
    const devUrl = localEnv.SUPABASE_URL;
    const devKey = localEnv.SUPABASE_SERVICE_ROLE_KEY;
    const prodUrl = process.env.SUPABASE_URL;
    const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!devUrl || !devKey || !prodUrl || !prodKey) {
      return NextResponse.json({
        success: false,
        error: '未配置数据库连接',
      });
    }

    const devClient = createClient(devUrl, devKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const prodClient = createClient(prodUrl, prodKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: string[] = [];

    // ===== 1. 同步 model_credits_config =====
    const { data: prodModelCredits } = await prodClient
      .from('model_credits_config')
      .select('*')
      .order('id');
    
    if (prodModelCredits && prodModelCredits.length > 0) {
      await devClient.from('model_credits_config').delete().neq('id', 0);
      
      for (const item of prodModelCredits) {
        const { error } = await devClient.from('model_credits_config').insert({
          id: item.id,
          model_id: item.model_id,
          resolution: item.resolution,
          credits: item.credits,
          is_active: item.is_active,
          created_at: item.created_at,
          updated_at: item.updated_at,
        });
        if (error && !error.message.includes('duplicate')) {
          results.push(`model_credits_config[${item.id}] 失败: ${error.message}`);
        }
      }
      results.push(`model_credits_config: ${prodModelCredits.length} 条`);
    } else {
      results.push('model_credits_config: 生产库无数据');
    }

    // ===== 2. 同步 canvas_config =====
    const { data: prodCanvasConfig } = await prodClient
      .from('canvas_config')
      .select('*')
      .order('id');
    
    if (prodCanvasConfig && prodCanvasConfig.length > 0) {
      await devClient.from('canvas_config').delete().neq('id', 0);
      
      for (const item of prodCanvasConfig) {
        const { error } = await devClient.from('canvas_config').insert({
          id: item.id,
          config_key: item.config_key,
          config_value: item.config_value,
          sort_order: item.sort_order,
          created_at: item.created_at,
          updated_at: item.updated_at,
        });
        if (error && !error.message.includes('duplicate')) {
          results.push(`canvas_config[${item.id}] 失败: ${error.message}`);
        }
      }
      results.push(`canvas_config: ${prodCanvasConfig.length} 条`);
    } else {
      results.push('canvas_config: 生产库无数据');
    }

    // app_config 已废弃，预设颜色等配置已硬编码到前端

    return NextResponse.json({
      success: true,
      message: '✅ 配置同步完成',
      results,
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
