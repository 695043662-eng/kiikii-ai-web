-- ==========================================
-- kiikii.me 生产环境防御 - 数据库迁移脚本
-- 创建 api_tasks 表（支付级幂等校验）
-- ==========================================

-- 1. 创建 api_tasks 表
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

-- 2. 创建 client_request_id 唯一索引（核心防御）
-- ⚠️ 即使网络波动导致请求发送两次，数据库会像铁闸门一样把第二个请求弹回去
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_tasks_client_request_id 
ON api_tasks(client_request_id);

-- 3. 创建 user_id 索引（快速查询用户任务）
CREATE INDEX IF NOT EXISTS idx_api_tasks_user_id 
ON api_tasks(user_id);

-- 4. 创建 status 索引（快速查询任务状态）
CREATE INDEX IF NOT EXISTS idx_api_tasks_status 
ON api_tasks(status);

-- 5. 创建 created_at 索引（时间范围查询）
CREATE INDEX IF NOT EXISTS idx_api_tasks_created_at 
ON api_tasks(created_at);

-- 6. 添加注释
COMMENT ON TABLE api_tasks IS 'API 任务表 - 用于幂等性检查和任务状态管理';
COMMENT ON COLUMN api_tasks.client_request_id IS '前端生成的唯一 UUID，用于幂等性检查';
COMMENT ON COLUMN api_tasks.status IS '任务状态：pending/processing/completed/failed';
COMMENT ON COLUMN api_tasks.credits_deducted IS '已扣除的积分';

-- ==========================================
-- 验证表结构
-- ==========================================
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default
FROM information_schema.columns
WHERE table_name = 'api_tasks'
ORDER BY ordinal_position;

-- 验证索引
SELECT 
  indexname, 
  indexdef
FROM pg_indexes
WHERE tablename = 'api_tasks';

-- ==========================================
-- 使用说明
-- ==========================================
-- 1. 在 Supabase Dashboard 中打开 SQL Editor
-- 2. 复制本脚本内容
-- 3. 粘贴并执行
-- 4. 验证表和索引是否创建成功

-- ==========================================
-- 测试插入（可选）
-- ==========================================
-- INSERT INTO api_tasks (client_request_id, user_id, task_type, model, prompt, credits_deducted)
-- VALUES ('test-uuid-123', 'test-user', 'image_generation', 'nano-banana-fast', 'test prompt', 10);

-- ==========================================
-- 清理测试数据（可选）
-- ==========================================
-- DELETE FROM api_tasks WHERE client_request_id = 'test-uuid-123';
