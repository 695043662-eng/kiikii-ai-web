-- Supabase 数据库表结构
-- 根据旧数据库表结构生成

-- 1. users 表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE,
  password TEXT,
  nickname TEXT,
  avatar TEXT,
  credits INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  email TEXT
);

-- 2. redeem_keys 表
CREATE TABLE IF NOT EXISTS redeem_keys (
  id SERIAL PRIMARY KEY,
  key_code TEXT UNIQUE,
  credits INTEGER,
  status TEXT DEFAULT 'unused',
  used_by UUID REFERENCES users(id),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  channel TEXT DEFAULT 'normal',
  is_limited BOOLEAN DEFAULT false
);

-- 3. api_configs 表
CREATE TABLE IF NOT EXISTS api_configs (
  id SERIAL PRIMARY KEY,
  name TEXT,
  service_type TEXT,
  description TEXT,
  api_endpoint TEXT,
  request_method TEXT,
  request_headers JSONB,
  request_body_template JSONB,
  response_parser JSONB,
  api_key TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. api_models 表
CREATE TABLE IF NOT EXISTS api_models (
  id SERIAL PRIMARY KEY,
  config_id INTEGER REFERENCES api_configs(id),
  model_id TEXT,
  model_name TEXT,
  description TEXT,
  parameters JSONB,
  credits_base INTEGER,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  api_endpoint TEXT
);

-- 5. model_credits_config 表
CREATE TABLE IF NOT EXISTS model_credits_config (
  id SERIAL PRIMARY KEY,
  model_key TEXT UNIQUE,
  model_name TEXT,
  credits INTEGER,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  credits_2k INTEGER,
  credits_4k INTEGER,
  credits_5s INTEGER,
  credits_10s INTEGER,
  resolutions JSONB,
  service_type TEXT
);

-- 6. recharge_packages 表
CREATE TABLE IF NOT EXISTS recharge_packages (
  id SERIAL PRIMARY KEY,
  name TEXT,
  price INTEGER,
  credits INTEGER,
  tag TEXT,
  savings INTEGER,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. app_config 表
CREATE TABLE IF NOT EXISTS app_config (
  id SERIAL PRIMARY KEY,
  config_key TEXT UNIQUE,
  config_value TEXT,
  config_type TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. canvas_config 表
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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvas_config_key ON canvas_config(config_key);
CREATE INDEX IF NOT EXISTS idx_canvas_config_type ON canvas_config(config_type);

-- 9. exchange_records 表
CREATE TABLE IF NOT EXISTS exchange_records (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  key_code TEXT,
  credits INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. recharge_records 表
CREATE TABLE IF NOT EXISTS recharge_records (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  package_id INTEGER REFERENCES recharge_packages(id),
  package_name TEXT,
  price INTEGER,
  credits INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. generation_records 表
CREATE TABLE IF NOT EXISTS generation_records (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  model_id TEXT,
  model_name TEXT,
  prompt TEXT,
  resolution TEXT,
  aspect_ratio TEXT,
  credits_used INTEGER,
  image_urls TEXT[],
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  task_id TEXT
);

-- 12. prompt_favorites 表
CREATE TABLE IF NOT EXISTS prompt_favorites (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  prompt TEXT,
  model_id TEXT,
  model_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. prompt_history 表
CREATE TABLE IF NOT EXISTS prompt_history (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  prompt TEXT,
  model_id TEXT,
  model_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. api_keys 表
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  api_key TEXT UNIQUE,
  name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

-- 15. characters 表
CREATE TABLE IF NOT EXISTS characters (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  name TEXT,
  description TEXT,
  avatar TEXT,
  system_prompt TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. point_usage 表
CREATE TABLE IF NOT EXISTS point_usage (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  credits INTEGER,
  operation TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_redeem_keys_key_code ON redeem_keys(key_code);
CREATE INDEX IF NOT EXISTS idx_exchange_records_user_id ON exchange_records(user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_records_user_id ON recharge_records(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_records_user_id ON generation_records(user_id);

-- 17. ip_rate_limits 表（IP 频率限制）
CREATE TABLE IF NOT EXISTS ip_rate_limits (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  action_type VARCHAR(50) NOT NULL DEFAULT 'email_verification',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IP 频率限制索引
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_ip ON ip_rate_limits(ip);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_action_type ON ip_rate_limits(action_type);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_created_at ON ip_rate_limits(created_at);

-- 启用行级安全（可选，根据需要启用）
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
