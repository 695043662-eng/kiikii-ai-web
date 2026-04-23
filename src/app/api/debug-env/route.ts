import { NextResponse } from 'next/server';
import { loadEnv } from '@/storage/database/supabase-client';

export async function GET() {
  // 确保 .env.local 被加载
  loadEnv();
  
  // 获取 Supabase 相关环境变量
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const nodeEnv = process.env.NODE_ENV;
  const projectDomain = process.env.NEXT_PUBLIC_SITE_URL;
  const grsApiKey = process.env.GRS_API_KEY;

  return NextResponse.json({
    success: true,
    data: {
      NODE_ENV: nodeEnv || '(未设置)',
      NEXT_PUBLIC_SITE_URL: projectDomain || '(未设置)',
      SUPABASE_URL: supabaseUrl || '(未设置)',
      SUPABASE_ANON_KEY: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 20)}...` : '(未设置)',
      SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRoleKey ? `${supabaseServiceRoleKey.substring(0, 20)}...` : '(未设置)',
      GRS_API_KEY: grsApiKey ? `${grsApiKey.substring(0, 10)}...` : '(未设置)',
    }
  });
}
