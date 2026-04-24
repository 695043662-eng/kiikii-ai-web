-- ============================================
-- 补全缺失的表 - 开发库和生产库都需要执行
-- ============================================

-- 1. credit_refund_logs (积分返还记录)
CREATE TABLE IF NOT EXISTS credit_refund_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  task_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_refund_logs_created_at ON credit_refund_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_credit_refund_logs_task_id ON credit_refund_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_credit_refund_logs_user_id ON credit_refund_logs(user_id);

-- 2. generation_characters (视频角色)
CREATE TABLE IF NOT EXISTS generation_characters (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  character_id TEXT NOT NULL,
  source_type VARCHAR(50) DEFAULT 'upload',
  source_video TEXT,
  thumbnail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_characters_user_id ON generation_characters(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_characters_character_id ON generation_characters(character_id);

-- 3. exchange_records (积分兑换记录)
CREATE TABLE IF NOT EXISTS exchange_records (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_code VARCHAR(32),
  credits INTEGER NOT NULL,
  item_name TEXT,
  points_used INTEGER,
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_records_user_id ON exchange_records(user_id);
CREATE INDEX IF NOT EXISTS idx_exchange_records_created_at ON exchange_records(created_at);

-- 4. redeem_usage (兑换码使用记录)
CREATE TABLE IF NOT EXISTS redeem_usage (
  id SERIAL PRIMARY KEY,
  key_code VARCHAR(32) NOT NULL,
  user_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  channel VARCHAR(20),
  redeemed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redeem_usage_key_code ON redeem_usage(key_code);
CREATE INDEX IF NOT EXISTS idx_redeem_usage_user_id ON redeem_usage(user_id);

-- 5. api_keys (用户API密钥)
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  key TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. point_usage_records (积分使用记录)
CREATE TABLE IF NOT EXISTS point_usage_records (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  points_used INTEGER NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_usage_records_user_id ON point_usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_point_usage_records_created_at ON point_usage_records(created_at);

-- 7. limited_channel_redemptions (限量渠道兑换记录)
CREATE TABLE IF NOT EXISTS limited_channel_redemptions (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  channel VARCHAR(20) NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_limited_redemptions_channel ON limited_channel_redemptions(channel);
CREATE INDEX IF NOT EXISTS idx_limited_redemptions_user ON limited_channel_redemptions(user_id);

-- 8. sms_codes (短信验证码)
CREATE TABLE IF NOT EXISTS sms_codes (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(10) NOT NULL,
  type VARCHAR(20) NOT NULL,
  is_used BOOLEAN DEFAULT FALSE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS sms_codes_expires_at_idx ON sms_codes(expires_at);
CREATE INDEX IF NOT EXISTS sms_codes_phone_idx ON sms_codes(phone);

-- ============================================
-- 修复 credit_logs 表（添加缺失字段）
-- ============================================

ALTER TABLE credit_logs ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE credit_logs ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_logs_reference_id ON credit_logs(reference_id);
