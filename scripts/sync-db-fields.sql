-- ============================================
-- 数据库字段同步脚本
-- 执行说明：
--   1. 开发环境 SQL -> 在开发 Supabase Dashboard 执行
--   2. 生产环境 SQL -> 在生产 Supabase Dashboard 执行
-- ============================================

-- ============================================
-- 【开发环境 SQL】在 ozdlvxxoufkiazddvxys.supabase.co 执行
-- ============================================

-- 1. prompt_favorites 添加 updated_at
ALTER TABLE prompt_favorites 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. redeem_keys 添加缺失字段（schema.ts 定义了，但数据库没有）
ALTER TABLE redeem_keys 
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_limited BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS used_by VARCHAR(255);

-- 3. recharge_records 添加缺失字段（代码暂未使用，可选）
ALTER TABLE recharge_records 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS package_id INTEGER REFERENCES recharge_packages(id);

-- 4. ip_rate_limits 确保字段存在（如果表结构不对）
-- 先检查表是否存在，如果不存在则创建
CREATE TABLE IF NOT EXISTS ip_rate_limits (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  action_type VARCHAR(50) NOT NULL DEFAULT 'email_verification',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_ip ON ip_rate_limits(ip);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_action_type ON ip_rate_limits(action_type);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_created_at ON ip_rate_limits(created_at);


-- ============================================
-- 【生产环境 SQL】在 hrwoalchynrnwlcqdpxn.supabase.co 执行
-- ============================================

-- 1. redeem_keys 添加 max_usage 字段（代码已使用）
ALTER TABLE redeem_keys 
ADD COLUMN IF NOT EXISTS max_usage INTEGER;

-- 2. model_credits_config 表创建（不存在）
CREATE TABLE IF NOT EXISTS model_credits_config (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(255) NOT NULL UNIQUE,
  credits_per_image INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加注释
COMMENT ON TABLE model_credits_config IS '模型积分自定义配置表';
COMMENT ON COLUMN model_credits_config.model_name IS '模型名称，对应 api_models.model';
COMMENT ON COLUMN model_credits_config.credits_per_image IS '每张图片消耗积分，覆盖 api_models 默认值';
