import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

export async function GET() {
  try {
    // 读取 .env.local 配置
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

    const env = parseEnv(envContent);
    const url = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return NextResponse.json({ success: false, error: 'Missing config' });
    }

    const client = createClient(url, serviceKey, {
      db: { timeout: 60000 },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 检查管理员是否已存在
    const { data: existingAdmin } = await client
      .from('users')
      .select('id, phone, nickname')
      .eq('phone', '13824085362')
      .single();

    if (existingAdmin) {
      return NextResponse.json({
        success: true,
        message: '管理员账号已存在',
        admin: existingAdmin,
      });
    }

    // 创建管理员账号
    // 密码: 123456 (SHA-256 + salt)
    const hashedPassword = '7457e9ed066c870823aa57e0de3c307e1b9703898dca9a6ef9078efaef500d75';

    const { data: newAdmin, error: insertError } = await client
      .from('users')
      .insert({
        phone: '13824085362',
        nickname: '管理员',
        password: hashedPassword,
        credits: 10000,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({
        success: false,
        error: insertError.message,
      });
    }

    return NextResponse.json({
      success: true,
      message: '✅ 管理员账号创建成功！',
      admin: newAdmin,
      login_info: {
        account: '13824085362',
        password: '123456',
      },
    });

  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
    });
  }
}
