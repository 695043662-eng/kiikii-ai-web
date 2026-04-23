-- ============================================================
-- 生产环境数据库初始化脚本
-- 生成时间: 2025-01-XX
-- 版本: v1.0
-- ============================================================

-- ============================================================
-- 第一部分：核心用户与鉴权表
-- ============================================================

-- 1. 用户表（核心）
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  nickname VARCHAR(100),
  avatar VARCHAR(500),
  credits INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  email VARCHAR(255) UNIQUE
);

-- 用户表索引
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

-- 用户表注释
COMMENT ON TABLE users IS '用户主表';
COMMENT ON COLUMN users.id IS '用户唯一ID (UUID)';
COMMENT ON COLUMN users.phone IS '手机号 (唯一)';
COMMENT ON COLUMN users.email IS '邮箱 (唯一)';
COMMENT ON COLUMN users.credits IS '积分余额';
COMMENT ON COLUMN users.is_active IS '账号是否激活';

-- ============================================================
-- 第二部分：积分与账单系统
-- ============================================================

-- 2. 积分变动日志表
CREATE TABLE IF NOT EXISTS credit_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  amount INTEGER NOT NULL,
  type VARCHAR(50) NOT NULL,
  balance_after INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 积分日志索引
CREATE INDEX IF NOT EXISTS idx_credit_logs_user_id ON credit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_logs_type ON credit_logs(type);
CREATE INDEX IF NOT EXISTS idx_credit_logs_created_at ON credit_logs(created_at);

COMMENT ON TABLE credit_logs IS '积分变动日志';
COMMENT ON COLUMN credit_logs.amount IS '变动数量 (正数为充值/返还, 负数为消费)';
COMMENT ON COLUMN credit_logs.type IS '变动类型: recharge(充值), consume(消费), refund(返还), gift(赠送)';

-- 3. 充值套餐表
CREATE TABLE IF NOT EXISTS recharge_packages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  tag VARCHAR(50),
  savings INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 充值套餐索引
CREATE INDEX IF NOT EXISTS idx_recharge_packages_is_active ON recharge_packages(is_active);
CREATE INDEX IF NOT EXISTS idx_recharge_packages_sort_order ON recharge_packages(sort_order);

COMMENT ON TABLE recharge_packages IS '充值套餐配置';
COMMENT ON COLUMN recharge_packages.price IS '价格 (单位: 分)';
COMMENT ON COLUMN recharge_packages.credits IS '获得的积分数量';

-- 4. 充值记录表
CREATE TABLE IF NOT EXISTS recharge_records (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  package_name VARCHAR(100),
  credits INTEGER NOT NULL,
  price INTEGER,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 充值记录索引
CREATE INDEX IF NOT EXISTS idx_recharge_records_user_id ON recharge_records(user_id);
CREATE INDEX IF NOT EXISTS idx_recharge_records_status ON recharge_records(status);
CREATE INDEX IF NOT EXISTS idx_recharge_records_created_at ON recharge_records(created_at);

COMMENT ON TABLE recharge_records IS '充值订单记录';
COMMENT ON COLUMN recharge_records.status IS '订单状态: pending(待支付), completed(已完成), failed(失败)';

-- ============================================================
-- 第三部分：生成任务系统
-- ============================================================

-- 5. 生成记录表（历史）
CREATE TABLE IF NOT EXISTS generate_records (
  id BIGSERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  model_name VARCHAR(255) NOT NULL,
  task_id VARCHAR(255),
  prompt TEXT,
  status VARCHAR(50),
  result_url TEXT,
  credits_used INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 生成记录索引
CREATE INDEX IF NOT EXISTS idx_generate_records_user_id ON generate_records(user_id);
CREATE INDEX IF NOT EXISTS idx_generate_records_task_id ON generate_records(task_id);
CREATE INDEX IF NOT EXISTS idx_generate_records_status ON generate_records(status);
CREATE INDEX IF NOT EXISTS idx_generate_records_created_at ON generate_records(created_at);

COMMENT ON TABLE generate_records IS '图片生成记录';

-- 6. 任务缓存表（SSE轮询）
CREATE TABLE IF NOT EXISTS api_tasks (
  id SERIAL PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  prompt TEXT,
  resolution TEXT,
  aspect_ratio TEXT,
  generation_count INTEGER,
  credits_deducted INTEGER,
  reference_images TEXT[],
  result_images TEXT[],
  result_videos TEXT[],
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 任务缓存索引
CREATE INDEX IF NOT EXISTS idx_api_tasks_client_request_id ON api_tasks(client_request_id);
CREATE INDEX IF NOT EXISTS idx_api_tasks_user_id ON api_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tasks_status ON api_tasks(status);
CREATE INDEX IF NOT EXISTS idx_api_tasks_created_at ON api_tasks(created_at);

COMMENT ON TABLE api_tasks IS 'API任务缓存 (用于SSE轮询恢复)';

-- 7. 生成历史表（新版）
CREATE TABLE IF NOT EXISTS generation_history (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  images TEXT[],
  image_keys TEXT[],
  model TEXT,
  prompt TEXT,
  resolution TEXT,
  aspect_ratio TEXT,
  reference_images TEXT[],
  reference_image_keys TEXT[],
  reference_image_md5s TEXT[],
  task_id TEXT,
  videos TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 生成历史索引
CREATE INDEX IF NOT EXISTS idx_generation_history_user_id ON generation_history(user_id);
CREATE INDEX IF NOT EXISTS idx_generation_history_task_id ON generation_history(task_id);
CREATE INDEX IF NOT EXISTS idx_generation_history_created_at ON generation_history(created_at);

COMMENT ON TABLE generation_history IS '生成历史记录 (新版)';

-- ============================================================
-- 第四部分：模型配置系统
-- ============================================================

-- 8. API模型配置表
CREATE TABLE IF NOT EXISTS api_models (
  id SERIAL PRIMARY KEY,
  config_id INTEGER,
  model_id VARCHAR(100) NOT NULL UNIQUE,
  model_name VARCHAR(200) NOT NULL,
  description TEXT,
  parameters JSONB,
  credits_base INTEGER,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  api_endpoint TEXT,
  is_visible BOOLEAN DEFAULT true
);

-- API模型索引
CREATE INDEX IF NOT EXISTS idx_api_models_model_id ON api_models(model_id);
CREATE INDEX IF NOT EXISTS idx_api_models_is_active ON api_models(is_active);
CREATE INDEX IF NOT EXISTS idx_api_models_sort_order ON api_models(sort_order);

COMMENT ON TABLE api_models IS 'API模型配置表';

-- ============================================================
-- 第五部分：验证码系统
-- ============================================================

-- 9. 邮箱验证码表
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(10) NOT NULL,
  type VARCHAR(20) NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 邮箱验证码索引
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_type ON email_verification_codes(type);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_expires_at ON email_verification_codes(expires_at);

COMMENT ON TABLE email_verification_codes IS '邮箱验证码';
COMMENT ON COLUMN email_verification_codes.type IS '类型: register(注册), reset(重置密码)';

-- ============================================================
-- 第六部分：参考图存储
-- ============================================================

-- 10. 参考图表（COS Key映射）
CREATE TABLE IF NOT EXISTS reference_images (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  md5_hash VARCHAR(32) NOT NULL,
  cos_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 参考图索引
CREATE INDEX IF NOT EXISTS idx_reference_images_user_id ON reference_images(user_id);
CREATE INDEX IF NOT EXISTS idx_reference_images_md5_hash ON reference_images(md5_hash);

COMMENT ON TABLE reference_images IS '参考图COS存储映射';

-- ============================================================
-- 第七部分：提示词收藏
-- ============================================================

-- 11. 提示词收藏表
CREATE TABLE IF NOT EXISTS prompt_favorites (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 提示词收藏索引
CREATE INDEX IF NOT EXISTS idx_prompt_favorites_user_id ON prompt_favorites(user_id);

COMMENT ON TABLE prompt_favorites IS '用户提示词收藏';

-- ============================================================
-- 第八部分：RLS (Row Level Security) 策略
-- ============================================================

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recharge_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE generate_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE reference_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_favorites ENABLE ROW LEVEL SECURITY;

-- RLS 策略：用户只能查看自己的数据
-- users 表
CREATE POLICY "用户只能查看自己的数据" ON users
  FOR SELECT USING (id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "用户只能更新自己的数据" ON users
  FOR UPDATE USING (id = current_setting('request.jwt.claims', true)::json->>'sub');

-- credit_logs 表
CREATE POLICY "用户只能查看自己的积分日志" ON credit_logs
  FOR SELECT USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- recharge_records 表
CREATE POLICY "用户只能查看自己的充值记录" ON recharge_records
  FOR SELECT USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- generate_records 表
CREATE POLICY "用户只能查看自己的生成记录" ON generate_records
  FOR SELECT USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- generation_history 表
CREATE POLICY "用户只能查看自己的生成历史" ON generation_history
  FOR SELECT USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

-- api_tasks 表
CREATE POLICY "用户只能查看自己的任务" ON api_tasks
  FOR SELECT USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- reference_images 表
CREATE POLICY "用户只能查看自己的参考图" ON reference_images
  FOR SELECT USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- prompt_favorites 表
CREATE POLICY "用户只能查看自己的收藏" ON prompt_favorites
  FOR SELECT USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "用户只能管理自己的收藏" ON prompt_favorites
  FOR ALL USING (user_id = current_setting('request.jwt.claims', true)::json->>'sub');

-- ============================================================
-- 第九部分：公开表（无需RLS）
-- ============================================================

-- recharge_packages 是公开配置，所有用户可读
ALTER TABLE recharge_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "充值套餐对所有人公开" ON recharge_packages
  FOR SELECT USING (is_active = true);

-- api_models 是公开配置，所有用户可读
ALTER TABLE api_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "模型配置对所有人公开" ON api_models
  FOR SELECT USING (is_active = true AND is_visible = true);

-- ============================================================
-- 第十部分：初始数据
-- ============================================================

-- 插入默认充值套餐
INSERT INTO recharge_packages (name, price, credits, tag, savings, sort_order, is_active)
VALUES 
  ('体验包', 100, 10, '新人推荐', 0, 1, true),
  ('标准包', 1000, 120, '热销', 20, 2, true),
  ('专业包', 3000, 400, '超值', 100, 3, true),
  ('企业包', 10000, 1500, '最划算', 500, 4, true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 第十一部分：数据库函数
-- ============================================================

-- 积分扣除函数（带乐观锁）
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id VARCHAR(36),
  p_amount INTEGER
) RETURNS JSON AS $$
DECLARE
  v_current_credits INTEGER;
  v_new_credits INTEGER;
  v_success BOOLEAN := false;
BEGIN
  -- 获取当前积分
  SELECT credits INTO v_current_credits
  FROM users WHERE id = p_user_id;
  
  IF v_current_credits IS NULL THEN
    RETURN json_build_object('success', false, 'error', '用户不存在');
  END IF;
  
  IF v_current_credits < p_amount THEN
    RETURN json_build_object('success', false, 'error', '积分不足', 'current_credits', v_current_credits);
  END IF;
  
  -- 更新积分（乐观锁）
  UPDATE users 
  SET credits = credits - p_amount, updated_at = NOW()
  WHERE id = p_user_id AND credits >= p_amount;
  
  IF FOUND THEN
    v_success := true;
    v_new_credits := v_current_credits - p_amount;
    
    -- 记录日志
    INSERT INTO credit_logs (user_id, amount, type, balance_after, created_at)
    VALUES (p_user_id, -p_amount, 'consume', v_new_credits, NOW());
    
    RETURN json_build_object(
      'success', true, 
      'previous_credits', v_current_credits,
      'new_credits', v_new_credits,
      'deducted', p_amount
    );
  ELSE
    RETURN json_build_object('success', false, 'error', '并发冲突，请重试');
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION deduct_credits IS '积分扣除函数 (带乐观锁)';

-- ============================================================
-- 完成！
-- ============================================================

-- 验证表创建
SELECT table_name, 
       (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
ORDER BY table_name;
