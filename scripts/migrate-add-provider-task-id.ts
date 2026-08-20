/**
 * #852 迁移脚本：为 video_generation_tasks 表添加 provider_task_id + poll_url 列
 * 
 * 用途：离线巡检 Cron 通过 poll_url 向服务商查询视频生成状态
 * 
 * 运行方式（生产环境）：
 *   npx tsx scripts/migrate-add-provider-task-id.ts
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function migrate() {
  console.log('[迁移] 开始添加 provider_task_id + poll_url 列...');

  // 检查表是否存在
  const { error: tableError } = await supabase
    .from('video_generation_tasks')
    .select('task_id')
    .limit(1);

  if (tableError) {
    // 表不存在，创建它
    console.log('[迁移] video_generation_tasks 表不存在，正在创建...');
    const { error: createError } = await supabase.rpc('exec_sql', {
      sql: `CREATE TABLE IF NOT EXISTS video_generation_tasks (
        task_id TEXT PRIMARY KEY,
        user_id TEXT,
        model TEXT,
        prompt TEXT,
        status TEXT DEFAULT 'processing',
        video_url TEXT,
        duration INTEGER,
        resolution TEXT,
        aspect_ratio TEXT,
        credits_used INTEGER DEFAULT 0,
        client_request_id TEXT,
        provider_task_id TEXT,
        poll_url TEXT,
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        error_message TEXT
      );`
    });
    if (createError) {
      console.error('[迁移] 创建表失败:', createError.message);
      console.error('[迁移] 请手动执行以下 SQL:');
      console.error(`CREATE TABLE IF NOT EXISTS video_generation_tasks (
        task_id TEXT PRIMARY KEY,
        user_id TEXT,
        model TEXT,
        prompt TEXT,
        status TEXT DEFAULT 'processing',
        video_url TEXT,
        duration INTEGER,
        resolution TEXT,
        aspect_ratio TEXT,
        credits_used INTEGER DEFAULT 0,
        client_request_id TEXT,
        provider_task_id TEXT,
        poll_url TEXT,
        completed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        error_message TEXT
      );`);
    } else {
      console.log('[迁移] 表创建成功');
    }
  } else {
    // 表存在，添加 provider_task_id 和 poll_url 列
    console.log('[迁移] 表已存在，添加 provider_task_id + poll_url 列...');
    const { error: alterError1 } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS provider_task_id TEXT;`
    });
    if (alterError1) {
      console.error('[迁移] 添加 provider_task_id 列失败:', alterError1.message);
      console.error('[迁移] 请手动执行: ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS provider_task_id TEXT;');
    } else {
      console.log('[迁移] provider_task_id 列添加成功');
    }

    const { error: alterError2 } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS poll_url TEXT;`
    });
    if (alterError2) {
      console.error('[迁移] 添加 poll_url 列失败:', alterError2.message);
      console.error('[迁移] 请手动执行: ALTER TABLE video_generation_tasks ADD COLUMN IF NOT EXISTS poll_url TEXT;');
    } else {
      console.log('[迁移] poll_url 列添加成功');
    }
  }

  console.log('[迁移] 完成');
}

migrate().catch(console.error);
