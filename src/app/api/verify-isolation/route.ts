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

    const devClient = createClient(devUrl, devKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 检查用户业务数据表
    const { count: usersCount } = await devClient
      .from('users')
      .select('*', { count: 'exact', head: true });

    const { count: generationRecordsCount } = await devClient
      .from('generation_records')
      .select('*', { count: 'exact', head: true });

    const { count: rechargeRecordsCount } = await devClient
      .from('recharge_records')
      .select('*', { count: 'exact', head: true });

    const { count: creditLogsCount } = await devClient
      .from('credit_logs')
      .select('*', { count: 'exact', head: true });

    // 获取用户列表
    const { data: users } = await devClient
      .from('users')
      .select('phone, nickname, credits, created_at')
      .order('created_at', { ascending: false });

    return NextResponse.json({
      success: true,
      database: devUrl.substring(0, 40) + '...',
      businessData: {
        users: usersCount || 0,
        generation_records: generationRecordsCount || 0,
        recharge_records: rechargeRecordsCount || 0,
        credit_logs: creditLogsCount || 0,
      },
      users: users || [],
      verdict: (generationRecordsCount || 0) === 0 ? '✅ 生图记录为空，隔离正确！' : '❌ 生图记录不为空，需要清理！',
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
