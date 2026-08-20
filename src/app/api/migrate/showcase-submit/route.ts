import { NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * POST /api/migrate/showcase-submit
 *
 * #820 一次性迁移：创建 model_spec_mapping 表 + generation_records.extra_data 列 + 110条种子数据
 * 使用 pg 模块直连 Supabase PostgreSQL 执行 DDL（Supabase JS 客户端只支持 DML）
 *
 * 连接方式优先级：
 *   1. 直连 db.{ref}.supabase.co:5432（需要 IPv6）
 *   2. Supavisor pooler aws-0-{region}.pooler.supabase.com:6543（需要项目启用连接池）
 *
 * ⚠️ 此接口仅限管理员调用，迁移完成后应删除或禁用
 */

// 动态导入 pg（避免 SSR 问题）
async function getPgClient() {
  const { Client } = await import('pg');
  return Client;
}

/** 尝试所有连接方式，返回已连接的 Client */
async function connectToDatabase(): Promise<InstanceType<typeof import('pg').Client>> {
  const Client = await getPgClient();

  const dbPassword = process.env.SUPABASE_DB_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';

  // 从 SUPABASE_URL 提取 project ref
  const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/);
  const projectRef = refMatch?.[1] || '';

  if (!projectRef) {
    throw new Error('无法从 SUPABASE_URL 提取 project ref');
  }

  if (!dbPassword) {
    throw new Error('缺少 SUPABASE_DB_PASSWORD 环境变量');
  }

  // 构造所有可能的连接字符串
  const connectionConfigs: Array<{ name: string; connStr: string }> = [];

  // 方式1：直连（需要 IPv6）
  connectionConfigs.push({
    name: `直连 db.${projectRef}.supabase.co:5432`,
    connStr: `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${projectRef}.supabase.co:5432/postgres`,
  });

  // 方式2：Supavisor pooler - 多区域（transaction mode port 6543）
  const regions = ['ap-southeast-1', 'us-east-1', 'us-west-1', 'ap-northeast-1', 'eu-west-1'];
  for (const region of regions) {
    connectionConfigs.push({
      name: `Supavisor aws-0-${region}:6543`,
      connStr: `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
    });
  }

  // 方式3：Supavisor session mode (port 5432)
  for (const region of regions.slice(0, 2)) {
    connectionConfigs.push({
      name: `Supavisor aws-0-${region}:5432 (session)`,
      connStr: `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-${region}.pooler.supabase.com:5432/postgres`,
    });
  }

  console.log(`[迁移] 尝试 ${connectionConfigs.length} 种连接方式...`);

  let lastError: Error | null = null;

  for (const config of connectionConfigs) {
    const client = new Client({
      connectionString: config.connStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      query_timeout: 30000,
      statement_timeout: 60000,
    });

    try {
      console.log(`[迁移] 尝试: ${config.name}`);
      await client.connect();
      const res = await client.query('SELECT current_database(), current_user');
      console.log(`[迁移] 连接成功: ${config.name} -> DB=${res.rows[0].current_database}, User=${res.rows[0].current_user}`);
      return client;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[迁移] 连接失败: ${config.name} -> ${msg.substring(0, 120)}`);
      lastError = err instanceof Error ? err : new Error(String(err));
      try { await client.end(); } catch { /* ignore */ }
    }
  }

  throw new Error(
    `所有 ${connectionConfigs.length} 种连接方式均失败。最后错误: ${lastError?.message || 'unknown'}\n` +
    '可能原因：1) 服务器无 IPv6 出口 2) Supavisor 连接池未启用 3) 数据库密码不正确'
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { adminKey } = body;

    // 简单鉴权
    if (adminKey !== 'migrate_819_showcase') {
      return NextResponse.json({ error: '无效的管理密钥' }, { status: 403 });
    }

    const results: string[] = [];
    let client: InstanceType<typeof import('pg').Client> | null = null;

    try {
      // 1. 连接数据库
      results.push('⏳ 正在连接 Supabase PostgreSQL...');
      client = await connectToDatabase();
      results.push('✅ 数据库连接成功');

      // 2. 读取迁移 SQL 文件
      const sqlPath = join(process.cwd(), 'sql', 'migration_819_showcase_submit.sql');
      let sql: string;
      try {
        sql = readFileSync(sqlPath, 'utf-8');
        results.push(`✅ 已读取迁移文件 (${sql.length} 字符)`);
      } catch {
        // 如果文件不存在，使用内联 SQL
        results.push('⚠️ sql/migration_819_showcase_submit.sql 文件不存在，使用内联 SQL');
        sql = getInlineSQL();
      }

      // 3. 执行迁移 SQL
      results.push('⏳ 正在执行迁移 SQL...');
      console.log('[迁移] 开始执行迁移 SQL...');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        results.push('✅ 迁移 SQL 执行成功');
        console.log('[迁移] SQL 执行成功');
      } catch (txErr: unknown) {
        await client.query('ROLLBACK');
        const msg = txErr instanceof Error ? txErr.message : String(txErr);
        // 某些 DDL 语句不支持事务（如 CREATE TABLE ... IF NOT EXISTS 在某些情况下）
        // 如果事务回滚失败，尝试不使用事务逐条执行
        console.log(`[迁移] 事务执行失败，尝试逐条执行: ${msg.substring(0, 200)}`);
        results.push(`⚠️ 事务模式失败: ${msg.substring(0, 100)}`);
        results.push('⏳ 尝试逐条执行...');

        // 逐条执行
        const statements = sql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        for (const stmt of statements) {
          try {
            await client!.query(stmt);
            successCount++;
          } catch (stmtErr: unknown) {
            failCount++;
            const stmtMsg = stmtErr instanceof Error ? stmtErr.message : String(stmtErr);
            // "already exists" 类型的错误不算失败
            if (stmtMsg.includes('already exists') || stmtMsg.includes('duplicate key')) {
              successCount++;
              failCount--;
            } else {
              errors.push(`${stmt.substring(0, 60)}... -> ${stmtMsg.substring(0, 80)}`);
            }
          }
        }

        results.push(`✅ 逐条执行完成: ${successCount} 成功, ${failCount} 失败`);
        if (errors.length > 0) {
          results.push(`⚠️ 错误详情: ${errors.slice(0, 5).join('; ')}`);
        }
      }

      // 4. 验证迁移结果
      results.push('⏳ 验证迁移结果...');

      // 检查 model_spec_mapping 表
      const tableCheck = await client.query(
        "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = 'model_spec_mapping'"
      );
      if (Number(tableCheck.rows[0].cnt) > 0) {
        const dataCheck = await client.query('SELECT COUNT(*) as cnt FROM model_spec_mapping');
        results.push(`✅ model_spec_mapping 表已创建，${dataCheck.rows[0].cnt} 条记录`);
      } else {
        results.push('❌ model_spec_mapping 表未创建');
      }

      // 检查 extra_data 列
      const colCheck = await client.query(
        "SELECT COUNT(*) as cnt FROM information_schema.columns WHERE table_name = 'generation_records' AND column_name = 'extra_data'"
      );
      if (Number(colCheck.rows[0].cnt) > 0) {
        results.push('✅ generation_records.extra_data 列已创建');
      } else {
        results.push('❌ generation_records.extra_data 列未创建');
      }

    } finally {
      if (client) {
        try { await client.end(); } catch { /* ignore */ }
      }
    }

    return NextResponse.json({
      success: true,
      message: '迁移执行完成',
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[迁移] 失败:', message);
    return NextResponse.json({
      success: false,
      error: `迁移失败: ${message}`,
      hint: '如果错误涉及 IPv6 或连接超时，请在生产服务器上调用此接口（生产服务器通常有 IPv6 出口）',
    }, { status: 500 });
  }
}

/** 内联 SQL（文件不存在时的备选方案） */
function getInlineSQL(): string {
  return `
-- 1. 创建 model_spec_mapping 字典表
CREATE TABLE IF NOT EXISTS model_spec_mapping (
  id BIGSERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,
  spec_type TEXT NOT NULL,
  spec_value TEXT NOT NULL,
  spec_label TEXT,
  is_enabled BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  UNIQUE(model_id, spec_type, spec_value)
);

CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_model_id ON model_spec_mapping(model_id);
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_spec_type ON model_spec_mapping(spec_type);
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_enabled ON model_spec_mapping(is_enabled);

ALTER TABLE model_spec_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "model_spec_mapping_public_read" ON model_spec_mapping
  FOR SELECT USING (is_enabled = true);

-- 2. generation_records 新增 extra_data 列
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'generation_records' AND column_name = 'extra_data'
  ) THEN
    ALTER TABLE generation_records ADD COLUMN extra_data JSONB DEFAULT '{}';
  END IF;
END $$;

-- 3. 初始数据请从 sql/migration_819_showcase_submit.sql 的 INSERT 语句中获取
-- 此处省略 110 条 INSERT 数据（文件存在时自动读取）
`;
}
