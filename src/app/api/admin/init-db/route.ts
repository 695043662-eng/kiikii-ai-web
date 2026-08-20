/**
 * #846 自动化建表路由
 * 创建 user_workspaces 表，支持多种数据库连接方式
 * 
 * 调用方式：GET/POST /api/admin/init-db?secret=YOUR_SECRET
 * 认证：需要 CRON_SECRET 或 ADMIN_PHONE
 */
import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// DDL: user_workspaces 建表 SQL
// ============================================================
const CREATE_USER_WORKSPACES_SQL = `
-- #887 迁移：先删除旧的外键约束（如果存在）
ALTER TABLE public.user_workspaces DROP CONSTRAINT IF EXISTS user_workspaces_user_id_fkey;

-- =====================================================
-- user_workspaces: 用户云画布工作台
-- 一个用户一个工作台，画布拓扑存储为 JSONB
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_workspaces (
  user_id UUID PRIMARY KEY,
  canvas_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- #887 移除外键约束：user_id 仅作为数据主键，不引用 auth.users
-- 原因：requireAuth() 已在后端验证用户身份，service_role 绕过 RLS，
-- 外键约束会导致开发环境白名单用户 ID 无法插入（不在 auth.users 表中）

-- RLS: 用户只能访问自己的工作台
ALTER TABLE public.user_workspaces ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- SELECT 策略
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_workspaces' AND policyname = 'Users can view own workspace'
  ) THEN
    CREATE POLICY "Users can view own workspace"
      ON public.user_workspaces FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- INSERT 策略
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_workspaces' AND policyname = 'Users can insert own workspace'
  ) THEN
    CREATE POLICY "Users can insert own workspace"
      ON public.user_workspaces FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  -- UPDATE 策略
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_workspaces' AND policyname = 'Users can update own workspace'
  ) THEN
    CREATE POLICY "Users can update own workspace"
      ON public.user_workspaces FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- 自动更新 updated_at 触发器
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_workspaces_updated_at ON public.user_workspaces;
CREATE TRIGGER update_user_workspaces_updated_at
  BEFORE UPDATE ON public.user_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 索引（主键已有隐式索引，此处额外添加 updated_at 索引用于维护查询）
CREATE INDEX IF NOT EXISTS idx_user_workspaces_updated_at ON public.user_workspaces(updated_at DESC);
`.trim();

export async function POST(request: NextRequest) {
  // 安全校验
  const cronSecret = process.env.CRON_SECRET;
  const adminPhone = process.env.ADMIN_PHONE;
  const authHeader = request.headers.get('authorization');
  const urlSecret = new URL(request.url).searchParams.get('secret');

  const isAuthorized =
    (cronSecret && (authHeader === `Bearer ${cronSecret}` || urlSecret === cronSecret)) ||
    (adminPhone && (authHeader === `Bearer ${adminPhone}` || urlSecret === adminPhone));

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized: 需要 CRON_SECRET 或 ADMIN_PHONE' }, { status: 401 });
  }

  console.log('[init-db] 开始创建 user_workspaces 表...');

  // ============================================================
  // 方式一：通过 pg 模块直连数据库（尝试 Pooler IPv4）
  // ============================================================
  try {
    const { Client } = await import('pg');
    
    const dbPassword = process.env.DEV_SUPABASE_DB_PASSWORD || process.env.PROD_SUPABASE_DB_PASSWORD;
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL
      ?.replace('https://', '')
      ?.replace('.supabase.co', '') || '';

    if (!dbPassword || !projectRef) {
      throw new Error('缺少数据库凭据 (DB_PASSWORD 或 SUPABASE_URL)');
    }

    // 尝试多个 Pooler 区域
    const regions = [
      'aws-0-ap-southeast-1',
      'aws-0-ap-northeast-1',
      'aws-0-us-east-1',
      'aws-0-us-west-1',
      'aws-0-eu-west-1',
    ];

    for (const region of regions) {
      const poolerHost = `${region}.pooler.supabase.com`;
      const user = `postgres.${projectRef}`;
      
      try {
        const client = new Client({
          host: poolerHost,
          port: 6543,
          database: 'postgres',
          user,
          password: dbPassword,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 5000,
        });
        
        await client.connect();
        console.log(`[init-db] Pooler 连接成功: ${region}`);
        
        await client.query(CREATE_USER_WORKSPACES_SQL);
        
        // 验证
        const { rows } = await client.query(
          "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'user_workspaces' ORDER BY ordinal_position"
        );
        
        await client.end();
        
        console.log('[init-db] user_workspaces 表创建成功! 列:', rows.map(r => `${r.column_name}(${r.data_type})`));
        return NextResponse.json({
          success: true,
          message: 'user_workspaces 表创建成功',
          method: `pooler (${region})`,
          columns: rows,
        });
      } catch (poolerErr: any) {
        const msg = poolerErr?.message || '';
        // "tenant not found" 是 Supavisor 不认此项目的标志，跳过
        if (msg.includes('not found') || msg.includes('ENOIDENTIFIER')) {
          continue; // 尝试下一个 region
        }
        // 其他错误（网络超时等）也继续尝试
        console.log(`[init-db] Pooler ${region} 失败:`, msg.substring(0, 100));
        continue;
      }
    }

    throw new Error('所有 Pooler 区域均连接失败（项目可能未注册 Supavisor）');
  } catch (pgErr: any) {
    console.log('[init-db] pg 直连失败:', pgErr?.message?.substring(0, 150));
  }

  // ============================================================
  // 方式二：通过 Supabase REST API + RPC 代理（如果已存在 exec_ddl 函数）
  // ============================================================
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey) {
      const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_ddl`, {
        method: 'POST',
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql: CREATE_USER_WORKSPACES_SQL }),
      });

      if (rpcRes.ok) {
        const data = await rpcRes.json();
        console.log('[init-db] RPC exec_ddl 成功:', data);
        return NextResponse.json({
          success: true,
          message: 'user_workspaces 表创建成功（via RPC）',
          method: 'rpc',
          data,
        });
      }
    }
  } catch (rpcErr: any) {
    console.log('[init-db] RPC 方式失败:', rpcErr?.message?.substring(0, 100));
  }

  // ============================================================
  // 所有自动化方式失败 → 返回 SQL 供手动执行
  // ============================================================
  console.log('[init-db] 所有自动化建表方式失败，返回 SQL 供手动执行');

  return NextResponse.json({
    success: true,
    autoCreated: false,
    message: '自动化建表受网络限制，SQL 已生成供手动执行',
    sql: CREATE_USER_WORKSPACES_SQL,
    instructions: [
      '1. 登录 Supabase Dashboard → SQL Editor',
      '2. 粘贴上方 sql 字段中的 SQL 并执行',
      '3. 或在生产服务器执行：curl -X POST https://your-domain/api/admin/init-db?secret=YOUR_CRON_SECRET',
    ],
  }, { status: 200 });
}

// 支持浏览器直接访问（GET）
export const GET = POST;
