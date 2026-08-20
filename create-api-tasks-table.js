const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'REDACTED_PROD_DB_URL',
  'sb_secret_SRglR1ze11sIVHzlOrnPcw_frrHRAOH',
  {
    db: { timeout: 60000 },
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

async function createApiTasksTable() {
  console.log('创建 api_tasks 表...');

  try {
    // 使用 RPC 执行原始 SQL
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        -- 创建 api_tasks 表
        CREATE TABLE IF NOT EXISTS api_tasks (
          id SERIAL PRIMARY KEY,
          client_request_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          task_type TEXT NOT NULL DEFAULT 'image_generation',
          status TEXT NOT NULL DEFAULT 'pending',
          model TEXT,
          prompt TEXT,
          resolution TEXT,
          aspect_ratio TEXT,
          generation_count INTEGER DEFAULT 1,
          credits_deducted INTEGER DEFAULT 0,
          reference_images TEXT[],
          result_images TEXT[],
          result_videos TEXT[],
          error_message TEXT,
          retry_count INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        );

        -- 创建 client_request_id 唯一索引（核心防御）
        CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tasks_client_request_id 
        ON api_tasks(client_request_id);

        -- 创建 user_id 索引（快速查询用户任务）
        CREATE INDEX IF NOT EXISTS idx_api_tasks_user_id 
        ON api_tasks(user_id);

        -- 创建 status 索引（快速查询任务状态）
        CREATE INDEX IF NOT EXISTS idx_api_tasks_status 
        ON api_tasks(status);

        -- 创建 created_at 索引（时间范围查询）
        CREATE INDEX IF NOT EXISTS idx_api_tasks_created_at 
        ON api_tasks(created_at);
      `
    });

    if (error) {
      console.error('创建表失败:', error);
      
      // 尝试使用直接 SQL
      console.log('尝试使用 PostgreSQL 客户端...');
      
      // 由于 Supabase 不支持直接执行 DDL，我们需要通过 SQL Editor 手动执行
      console.log('\n请在 Supabase SQL Editor 中执行以下 SQL：');
      console.log(`
-- 创建 api_tasks 表
CREATE TABLE IF NOT EXISTS api_tasks (
  id SERIAL PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'image_generation',
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  prompt TEXT,
  resolution TEXT,
  aspect_ratio TEXT,
  generation_count INTEGER DEFAULT 1,
  credits_deducted INTEGER DEFAULT 0,
  reference_images TEXT[],
  result_images TEXT[],
  result_videos TEXT[],
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 创建 client_request_id 唯一索引（核心防御）
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tasks_client_request_id 
ON api_tasks(client_request_id);

-- 创建 user_id 索引（快速查询用户任务）
CREATE INDEX IF NOT EXISTS idx_api_tasks_user_id 
ON api_tasks(user_id);

-- 创建 status 索引（快速查询任务状态）
CREATE INDEX IF NOT EXISTS idx_api_tasks_status 
ON api_tasks(status);

-- 创建 created_at 索引（时间范围查询）
CREATE INDEX IF NOT EXISTS idx_api_tasks_created_at 
ON api_tasks(created_at);
      `);
      
      return;
    }

    console.log('✅ api_tasks 表创建成功！');
    
    // 验证表结构
    const { data: tableInfo, error: infoError } = await supabase
      .from('api_tasks')
      .select('id')
      .limit(1);
    
    if (infoError) {
      console.error('验证表失败:', infoError);
    } else {
      console.log('✅ 表验证成功，可以正常访问');
    }

  } catch (error) {
    console.error('创建过程出错:', error);
  }
}

createApiTasksTable();
