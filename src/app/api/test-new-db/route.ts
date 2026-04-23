import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    // 1. 检查 .env.local 文件
    const envPath = path.join(process.cwd(), '.env.local');
    let envFileContent = '';
    try {
      envFileContent = fs.readFileSync(envPath, 'utf-8');
    } catch {
      envFileContent = '(file not found)';
    }

    // 2. 解析 .env.local 中的值
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

    const envFileValues = parseEnv(envFileContent);

    // 3. 直接用 .env.local 中的值创建客户端
    const url = envFileValues.SUPABASE_URL;
    const anonKey = envFileValues.SUPABASE_ANON_KEY;
    const serviceKey = envFileValues.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey) {
      return NextResponse.json({
        success: false,
        error: 'Missing config in .env.local',
        envFileValues
      });
    }

    const client = createClient(url, serviceKey || anonKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 4. 测试查询
    const { data: users, error: usersError } = await client
      .from('users')
      .select('id, phone, nickname, credits')
      .limit(5);

    if (usersError) {
      return NextResponse.json({
        success: false,
        error: usersError.message,
        trying_url: url,
      });
    }

    const { count: redeemKeysCount } = await client
      .from('redeem_keys')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      success: true,
      message: '✅ 新数据库连接成功！',
      using_url: url,
      data: {
        users: users?.length || 0,
        redeem_keys: redeemKeysCount || 0,
      },
      sample_users: users,
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
