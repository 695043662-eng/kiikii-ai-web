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

    if (!devUrl || !devKey) {
      return NextResponse.json({ success: false, error: '开发数据库配置缺失' });
    }

    const devClient = createClient(devUrl, devKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const results: string[] = [];

    // 检查 api_configs 是否有 description 列
    const { data: testConfig } = await devClient
      .from('api_configs')
      .select('id, name, description')
      .limit(1);

    if (testConfig) {
      results.push('api_configs.description 列已存在');
    }

    // 检查 model_credits_config 表是否存在
    const { error: tableCheckError } = await devClient
      .from('model_credits_config')
      .select('id')
      .limit(1);

    if (tableCheckError && tableCheckError.message.includes('Could not find the table')) {
      results.push('model_credits_config 表不存在，需要创建');
    } else {
      results.push('model_credits_config 表已存在');
    }

    // 获取当前 api_configs 列信息
    const { data: currentConfigs } = await devClient
      .from('api_configs')
      .select('*')
      .limit(1);

    return NextResponse.json({
      success: true,
      results,
      sampleConfig: currentConfigs?.[0] || null,
      note: '如果缺少列，请在 Supabase SQL Editor 执行 ALTER TABLE',
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
