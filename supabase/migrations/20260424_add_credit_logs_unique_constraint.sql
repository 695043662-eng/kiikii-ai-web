-- #285/#286 修复并发重复返还问题：添加唯一约束
-- ⚠️ 必须在 Supabase 控制台的 SQL Editor 中执行此脚本！

-- ============================================
-- 第一步：清理已存在的重复数据（保留最早的那条）
-- ============================================

-- 查看重复记录
SELECT reference_id, type, COUNT(*) as count, MIN(id) as keep_id
FROM credit_logs
WHERE reference_id IS NOT NULL
GROUP BY reference_id, type
HAVING COUNT(*) > 1
ORDER BY count DESC;

-- 删除重复记录（保留 ID 最小的那条）
-- 注意：如果之前已经清理过，这一步不会影响任何记录
DELETE FROM credit_logs a
USING credit_logs b
WHERE a.id > b.id
  AND a.reference_id = b.reference_id
  AND a.type = b.type
  AND a.reference_id IS NOT NULL;

-- ============================================
-- 第二步：创建唯一约束（关键！）
-- ============================================

-- 创建部分唯一索引（只对 reference_id IS NOT NULL 的记录生效）
-- 这将防止同一个任务被重复返还积分
CREATE UNIQUE INDEX IF NOT EXISTS credit_logs_reference_id_type_unique 
ON credit_logs (reference_id, type) 
WHERE reference_id IS NOT NULL;

-- ============================================
-- 第三步：验证唯一约束是否生效
-- ============================================

-- 尝试插入重复记录，应该会报错：
-- ERROR: duplicate key value violates unique constraint "credit_logs_reference_id_type_unique"
-- INSERT INTO credit_logs (user_id, amount, type, reference_id, description, created_at)
-- VALUES ('5bb66162-29de-4839-8726-54d217663506', 10, 'refund', 'test-task-id', 'test', NOW());

-- 查看索引是否创建成功
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'credit_logs' 
  AND indexname = 'credit_logs_reference_id_type_unique';

-- ============================================
-- 说明
-- ============================================
-- 创建此唯一约束后，并发返还积分的请求会被数据库自动拒绝
-- 这是防止积分重复返还的唯一可靠方式
-- 
-- 错误示例：
-- 并发请求 A 和 B 同时尝试返还任务 X 的积分
-- 1. 请求 A 插入日志成功，获得 ID 100
-- 2. 请求 B 插入日志失败（唯一约束冲突），返回 409 Conflict
-- 3. 只有请求 A 会更新用户积分
-- 
-- 如果没有此唯一约束：
-- 1. 请求 A 和 B 都插入日志成功
-- 2. 请求 A 和 B 都更新用户积分
-- 3. 用户收到双倍返还！
