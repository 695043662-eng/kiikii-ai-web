-- ═══════════════════════════════════════════════════════════════════════════
-- 数据库字段同步脚本 - 立即执行
-- ═══════════════════════════════════════════════════════════════════════════

-- ========================================
-- 【生产环境】hrwoalchynrnwlcqdpxn.supabase.co
-- 执行地址: https://supabase.com/dashboard/project/hrwoalchynrnwlcqdpxn/sql
-- ========================================

-- 🔴 高优先级：添加 max_usage 字段（代码已使用！）
ALTER TABLE redeem_keys ADD COLUMN IF NOT EXISTS max_usage INTEGER;

-- 🟡 中优先级：创建 model_credits_config 表
CREATE TABLE IF NOT EXISTS model_credits_config (
  id SERIAL PRIMARY KEY,
  model_name VARCHAR(255) NOT NULL UNIQUE,
  credits_per_image INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_model_credits_config_model_name ON model_credits_config(model_name);

-- 添加注释
COMMENT ON TABLE model_credits_config IS '模型积分自定义配置表';
COMMENT ON COLUMN model_credits_config.model_name IS '模型名称，对应 api_models.model';
COMMENT ON COLUMN model_credits_config.credits_per_image IS '每张图片消耗积分，覆盖 api_models 默认值';


-- ========================================
-- 【开发环境】ozdlvxxoufkiazddvxys.supabase.co
-- 执行地址: https://supabase.com/dashboard/project/ozdlvxxoufkiazddvxys/sql
-- ========================================

-- 🟡 中优先级：redeem_keys 添加缺失字段
ALTER TABLE redeem_keys 
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_limited BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS used_by VARCHAR(255);

-- 🟢 低优先级：prompt_favorites 添加 updated_at
ALTER TABLE prompt_favorites 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 🟢 低优先级：recharge_records 添加预留字段
ALTER TABLE recharge_records 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS package_id INTEGER REFERENCES recharge_packages(id);
