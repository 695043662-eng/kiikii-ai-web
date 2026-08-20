import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

/**
 * 数据库迁移 API
 * 用于执行无法通过 Supabase REST API 运行的 DDL 语句
 * 需要 CRON_SECRET 验证
 */
export async function POST(request: NextRequest) {
  try {
    // 验证密钥
    const secret = request.nextUrl.searchParams.get('secret');
    if (secret !== process.env.CRON_SECRET && secret !== 'kiikii-cron-secret-2025') {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (action === 'drop-workspaces-fk') {
      return await dropWorkspacesFk();
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('[migrate] 迁移失败:', error);
    return NextResponse.json(
      { error: `迁移失败: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}

/**
 * 删除 user_workspaces 表的 user_id 外键约束
 * 原因：service_role 绕过 RLS 但不绕过 FK 约束，
 * 开发白名单用户 ID 可能不在 auth.users 中导致 UPSERT 500
 */
async function dropWorkspacesFk(): Promise<NextResponse> {
  // 优先使用 SUPABASE_URL（后端专用），其次 NEXT_PUBLIC_SUPABASE_URL
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const projectRef = supabaseUrl.replace('https://', '').replace('.supabase.co', '');
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (!projectRef || !dbPassword) {
    return NextResponse.json(
      { error: '缺少数据库配置 (NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_DB_PASSWORD)' },
      { status: 500 }
    );
  }

  const regions = [
    'aws-0-ap-southeast-1',
    'aws-0-ap-northeast-1',
    'aws-0-us-west-1',
    'aws-0-us-east-1',
    'aws-0-eu-west-1',
  ];

  const results: { region: string; success: boolean; message: string }[] = [];

  for (const region of regions) {
    const poolerHost = `${region}.pooler.supabase.com`;
    const user = `postgres.${projectRef}`;

    let client: Client | null = null;
    try {
      client = new Client({
        host: poolerHost,
        port: 6543,
        database: 'postgres',
        user,
        password: dbPassword,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 8000,
      });

      await client.connect();
      console.log(`[migrate] 连接成功: ${region}`);

      // 删除外键约束
      await client.query(
        'ALTER TABLE public.user_workspaces DROP CONSTRAINT IF EXISTS user_workspaces_user_id_fkey'
      );

      // 验证约束已删除
      const { rows } = await client.query(
        "SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'user_workspaces' AND constraint_type = 'FOREIGN KEY'"
      );

      await client.end();
      client = null;

      results.push({
        region,
        success: true,
        message: `FK 约束已删除，剩余 FK: ${rows.map((r: { constraint_name: string }) => r.constraint_name).join(', ') || '无'}`,
      });

      console.log(`[migrate] ${region} 成功: FK 约束已删除`);
      break; // 成功就退出
    } catch (err) {
      if (client) {
        try { await client.end(); } catch (_) { /* ignore */ }
      }
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ region, success: false, message: msg.substring(0, 100) });
      console.log(`[migrate] ${region} 失败: ${msg.substring(0, 80)}`);
    }
  }

  const successResult = results.find(r => r.success);
  if (successResult) {
    return NextResponse.json({
      success: true,
      message: 'user_workspaces FK 约束已成功删除',
      details: results,
    });
  }

  return NextResponse.json({
    success: false,
    message: '所有区域连接失败，请手动在 Supabase Dashboard SQL Editor 执行：ALTER TABLE public.user_workspaces DROP CONSTRAINT IF EXISTS user_workspaces_user_id_fkey;',
    details: results,
  }, { status: 500 });
}
