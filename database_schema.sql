-- ===========================================
-- Kiikii AI 开发数据库建表 SQL
-- 在 Supabase SQL Editor 中执行
-- ===========================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE,
  email VARCHAR(255) UNIQUE,
  nickname VARCHAR(100),
  avatar TEXT,
  credits INTEGER DEFAULT 0,
  password VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  failed_attempts INTEGER DEFAULT 0,          -- 连续违规失败次数
  locked_until TIMESTAMPTZ DEFAULT NULL,     -- 账户锁定截止时间
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 2. 积分日志表
CREATE TABLE IF NOT EXISTS credit_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  type VARCHAR(50) NOT NULL,
  balance_after INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_logs_user_id ON credit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_logs_created_at ON credit_logs(created_at);

-- 3. 充值套餐表
CREATE TABLE IF NOT EXISTS recharge_packages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  tag VARCHAR(50),
  savings INTEGER,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 4. 充值记录表
CREATE TABLE IF NOT EXISTS recharge_records (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_name VARCHAR(100),
  credits INTEGER NOT NULL,
  price INTEGER NOT NULL,
  payment_method VARCHAR(50),
  transaction_id VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recharge_records_user_id ON recharge_records(user_id);

-- 5. 兑换码表
CREATE TABLE IF NOT EXISTS redeem_keys (
  id SERIAL PRIMARY KEY,
  key_code VARCHAR(50) UNIQUE NOT NULL,
  credits INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  channel VARCHAR(50),
  max_usage INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_redeem_keys_key_code ON redeem_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_redeem_keys_channel ON redeem_keys(channel);

-- 6. 兑换使用记录表
CREATE TABLE IF NOT EXISTS redeem_usage (
  id SERIAL PRIMARY KEY,
  key_code VARCHAR(50) NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50),
  credits INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_redeem_usage_key_code ON redeem_usage(key_code);
CREATE INDEX IF NOT EXISTS idx_redeem_usage_user_id ON redeem_usage(user_id);

-- 7. 限量渠道兑换统计表
CREATE TABLE IF NOT EXISTS limited_channel_redemptions (
  id SERIAL PRIMARY KEY,
  channel VARCHAR(50) NOT NULL,
  count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_limited_channel_redemptions_channel ON limited_channel_redemptions(channel);

-- 8. 生成记录表
CREATE TABLE IF NOT EXISTS generation_records (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  images JSONB DEFAULT '[]',
  image_keys JSONB,
  model VARCHAR(100),
  prompt TEXT,
  resolution VARCHAR(20),
  aspect_ratio VARCHAR(20),
  reference_images JSONB,
  reference_image_keys JSONB,
  reference_image_md5s JSONB,
  task_id VARCHAR(100),
  videos JSONB,
  credits_charged INTEGER,
  credits_balance INTEGER,
  requested_count INTEGER,
  success_count INTEGER,
  credits_per_image INTEGER,
  refund_amount INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_records_user_id ON generation_records(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_records_created_at ON generation_records(created_at);
CREATE INDEX IF NOT EXISTS idx_generation_records_task_id ON generation_records(task_id);

-- 9. API 配置表
CREATE TABLE IF NOT EXISTS api_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  service_type VARCHAR(50) NOT NULL,
  description TEXT,
  api_endpoint TEXT NOT NULL,
  api_key TEXT,
  request_method VARCHAR(10) DEFAULT 'POST',
  request_headers JSONB DEFAULT '{}',
  request_body_template JSONB DEFAULT '{}',
  response_parser JSONB,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 10. API 模型表
CREATE TABLE IF NOT EXISTS api_models (
  id SERIAL PRIMARY KEY,
  config_id INTEGER NOT NULL REFERENCES api_configs(id) ON DELETE CASCADE,
  model_id VARCHAR(100) NOT NULL UNIQUE,
  model_name VARCHAR(100) NOT NULL,
  description TEXT,
  api_endpoint TEXT,
  parameters JSONB DEFAULT '{}',
  credits_base INTEGER DEFAULT 10,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_models_config_id ON api_models(config_id);
CREATE INDEX IF NOT EXISTS idx_api_models_model_id ON api_models(model_id);

-- 11. API 任务表
CREATE TABLE IF NOT EXISTS api_tasks (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(100) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  model_id VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  prompt TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_tasks_task_id ON api_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_api_tasks_user_id ON api_tasks(user_id);

-- 12. API 密钥表
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  key VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. 积分使用记录表
CREATE TABLE IF NOT EXISTS point_usage_records (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  type VARCHAR(50) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_usage_records_user_id ON point_usage_records(user_id);

-- 14. 兑换记录表
CREATE TABLE IF NOT EXISTS exchange_records (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_code VARCHAR(50),
  credits INTEGER NOT NULL,
  channel VARCHAR(50),
  status VARCHAR(20) DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exchange_records_user_id ON exchange_records(user_id);

-- 15. 提示词收藏表
CREATE TABLE IF NOT EXISTS prompt_favorites (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_favorites_user_id ON prompt_favorites(user_id);

-- 16. 参考图表
CREATE TABLE IF NOT EXISTS reference_images (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  md5_hash VARCHAR(64) NOT NULL,
  cos_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_images_user_md5 ON reference_images(user_id, md5_hash);

-- 17. 短信验证码表
CREATE TABLE IF NOT EXISTS sms_codes (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(10) NOT NULL,
  type VARCHAR(20) NOT NULL,
  is_used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON sms_codes(phone);

-- 18. 应用配置表
CREATE TABLE IF NOT EXISTS app_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(100) UNIQUE NOT NULL,
  config_value JSONB,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 19. 画布配置表
CREATE TABLE IF NOT EXISTS canvas_config (
  id SERIAL PRIMARY KEY,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_type VARCHAR(50) NOT NULL,
  title VARCHAR(255),
  content TEXT,
  is_enabled BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  extra_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_canvas_config_key ON canvas_config(config_key);
CREATE INDEX IF NOT EXISTS idx_canvas_config_type ON canvas_config(config_type);

-- 20. 邮箱验证码表
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(10) NOT NULL,
  type VARCHAR(20) NOT NULL,
  is_used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);

-- 21. IP 频率限制表
CREATE TABLE IF NOT EXISTS ip_rate_limits (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  action_type VARCHAR(50) NOT NULL DEFAULT 'email_verification',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_ip ON ip_rate_limits(ip);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_action_type ON ip_rate_limits(action_type);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_created_at ON ip_rate_limits(created_at);

-- 22. 生成角色表
CREATE TABLE IF NOT EXISTS generation_characters (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image_url TEXT,
  image_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generation_characters_user_id ON generation_characters(user_id);

-- 22. 模型积分配置表
CREATE TABLE IF NOT EXISTS model_credits_config (
  id SERIAL PRIMARY KEY,
  model_id VARCHAR(100) NOT NULL,
  resolution VARCHAR(20),
  credits INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_model_credits_config_model_id ON model_credits_config(model_id);


-- ===========================================
-- 启用 RLS (Row Level Security)
-- ===========================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE redeem_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE point_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_characters ENABLE ROW LEVEL SECURITY;


-- ===========================================
-- 创建策略：允许 service_role 完全访问
-- ===========================================
CREATE POLICY "Service role full access" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON credit_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON recharge_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON redeem_usage FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON generation_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON api_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON point_usage_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON exchange_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON prompt_favorites FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON reference_images FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON generation_characters FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ===========================================
-- 插入测试管理员账号
-- 密码：123456（SHA-256 + salt）
-- ===========================================
-- 如果需要测试账号，取消下面的注释
-- INSERT INTO users (phone, nickname, credits, password, is_active) 
-- VALUES ('13800138000', '测试用户', 1000, 'e10adc3949ba59abbe56e057f20f883e', true);

-- ===========================================
-- 插入默认 API 配置（GRS 生图服务）
-- ===========================================
INSERT INTO api_configs (name, service_type, api_endpoint, api_key, request_method, request_headers, request_body_template, response_parser, sort_order, is_active)
VALUES (
  'GRS AI 生图',
  'image_generation',
  'https://grsai.dakka.com.cn/v1/draw/nano-banana',
  'sk-e7338c2ee4e642d18925f795a2c286ff',
  'POST',
  '{"Content-Type": "application/json"}',
  '{"model": "nano-banana", "prompt": "", "aspectRatio": "auto", "imageSize": "1K", "shutProgress": true}',
  '{"taskIdPath": "data.taskId", "statusPath": "data.status", "imageUrlPath": "data.results[0].url", "errorPath": "data.error"}',
  1,
  true
) ON CONFLICT DO NOTHING;

-- 插入默认模型配置
INSERT INTO api_models (config_id, model_id, model_name, description, parameters, credits_base, is_active, sort_order)
VALUES 
  (1, 'nano-banana', 'Nano Banana', '基础生图模型', '{"resolutions": [{"label": "1K", "value": "1K", "credits": 10}]}', 10, true, 1),
  (1, 'nano-banana-fast', 'Nano Banana Fast', '快速生图模型', '{"resolutions": [{"label": "1K", "value": "1K", "credits": 8}]}', 8, true, 2),
  (1, 'nano-banana-2', 'Nano Banana 2', '进阶生图模型', '{"resolutions": [{"label": "1K", "value": "1K", "credits": 10}, {"label": "2K", "value": "2K", "credits": 12}, {"label": "4K", "value": "4K", "credits": 15}]}', 10, true, 3)
ON CONFLICT (model_id) DO NOTHING;


-- ===========================================
-- 插入默认充值套餐
-- ===========================================
INSERT INTO recharge_packages (name, price, credits, tag, savings, sort_order, is_active)
VALUES 
  ('体验包', 100, 100, '入门', null, 1, true),
  ('标准包', 500, 600, '推荐', 100, 2, true),
  ('专业包', 1000, 1300, '超值', 300, 3, true),
  ('企业包', 5000, 7000, '热门', 2000, 4, true)
ON CONFLICT DO NOTHING;


-- ===========================================
-- 完成！
-- ===========================================
-- 执行完成后，请验证：
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
