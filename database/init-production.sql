-- ============================================================
-- 【焦土重建】生产环境数据库初始化脚本
-- 执行前警告：此脚本会删除所有现有数据！
-- 版本: v2.0 - 2025-01-XX
-- ============================================================

-- ============================================================
-- 第一部分：彻底清场 (DROP CASCADE)
-- ============================================================

-- 删除所有业务表（ CASCADE 会自动删除依赖的索引、约束、触发器）
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS generation_records CASCADE;
DROP TABLE IF EXISTS generate_records CASCADE;
DROP TABLE IF EXISTS generation_history CASCADE;
DROP TABLE IF EXISTS credit_logs CASCADE;
DROP TABLE IF EXISTS credit_refund_logs CASCADE;
DROP TABLE IF EXISTS recharge_packages CASCADE;
DROP TABLE IF EXISTS recharge_records CASCADE;
DROP TABLE IF EXISTS api_tasks CASCADE;
DROP TABLE IF EXISTS api_models CASCADE;
DROP TABLE IF EXISTS api_configs CASCADE;
DROP TABLE IF EXISTS api_credentials CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS api_parameters CASCADE;
DROP TABLE IF EXISTS api_providers CASCADE;
DROP TABLE IF EXISTS api_services CASCADE;
DROP TABLE IF EXISTS email_verification_codes CASCADE;
DROP TABLE IF EXISTS reference_images CASCADE;
DROP TABLE IF EXISTS prompt_favorites CASCADE;
DROP TABLE IF EXISTS sms_codes CASCADE;
DROP TABLE IF EXISTS redeem_keys CASCADE;
DROP TABLE IF EXISTS redeem_usage CASCADE;
DROP TABLE IF EXISTS exchange_records CASCADE;
DROP TABLE IF EXISTS point_usage_records CASCADE;
DROP TABLE IF EXISTS limited_channel_redemptions CASCADE;
DROP TABLE IF EXISTS model_credits_config CASCADE;
DROP TABLE IF EXISTS health_check CASCADE;
DROP TABLE IF EXISTS canvas_config CASCADE;
DROP TABLE IF EXISTS app_config CASCADE;

-- 删除可能存在的旧备份表
DROP TABLE IF EXISTS api_models_backup CASCADE;
DROP TABLE IF EXISTS api_models_old CASCADE;
DROP TABLE IF EXISTS api_credentials_old CASCADE;
DROP TABLE IF EXISTS api_parameters_old CASCADE;
DROP TABLE IF EXISTS api_services_old CASCADE;

-- 删除可能存在的序列
DROP SEQUENCE IF EXISTS users_id_seq CASCADE;
DROP SEQUENCE IF EXISTS generation_records_id_seq CASCADE;
DROP SEQUENCE IF EXISTS credit_logs_id_seq CASCADE;
DROP SEQUENCE IF EXISTS recharge_packages_id_seq CASCADE;
DROP SEQUENCE IF EXISTS recharge_records_id_seq CASCADE;
DROP SEQUENCE IF EXISTS api_tasks_id_seq CASCADE;
DROP SEQUENCE IF EXISTS api_models_id_seq CASCADE;
DROP SEQUENCE IF EXISTS email_verification_codes_id_seq CASCADE;
DROP SEQUENCE IF EXISTS reference_images_id_seq CASCADE;
DROP SEQUENCE IF EXISTS prompt_favorites_id_seq CASCADE;

-- ============================================================
-- 第二部分：核心表重建
-- ============================================================

-- -----------------------------------------------------------
-- 1. 用户表 (users) - 核心
-- -----------------------------------------------------------
CREATE TABLE users (
  id VARCHAR(255) PRIMARY KEY,
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
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_created_at ON users(created_at);

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户只能查看自己的数据" ON users
  FOR SELECT USING (id::text = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "用户只能更新自己的数据" ON users
  FOR UPDATE USING (id::text = current_setting('request.jwt.claims', true)::json->>'sub');

COMMENT ON TABLE users IS '用户主表';
COMMENT ON COLUMN users.credits IS '积分余额';

-- -----------------------------------------------------------
-- 2. 生成记录表 (generation_records) - 最新结构
-- -----------------------------------------------------------
CREATE TABLE generation_records (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  images TEXT[] NOT NULL DEFAULT '{}',
  image_keys TEXT[] DEFAULT '{}',
  model TEXT,
  prompt TEXT,
  resolution TEXT,
  aspect_ratio TEXT,
  reference_images TEXT[] DEFAULT '{}',
  reference_image_keys TEXT[] DEFAULT '{}',
  reference_image_md5s TEXT[] DEFAULT '{}',
  task_id TEXT,
  videos TEXT[] DEFAULT '{}',
  requested_count INTEGER,
  success_count INTEGER,
  credits_per_image INTEGER,
  credits_charged INTEGER,
  credits_balance INTEGER,
  refund_amount INTEGER,
  source VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 生成记录索引
CREATE INDEX idx_generation_records_user_id ON generation_records(user_id);
CREATE INDEX idx_generation_records_task_id ON generation_records(task_id);
CREATE INDEX idx_generation_records_created_at ON generation_records(created_at);
CREATE INDEX idx_generation_records_source ON generation_records(source);

-- 启用 RLS
ALTER TABLE generation_records ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户只能查看自己的生成记录" ON generation_records
  FOR SELECT USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "用户只能插入自己的生成记录" ON generation_records
  FOR INSERT WITH CHECK (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

COMMENT ON TABLE generation_records IS '图片生成记录（最新版）';
COMMENT ON COLUMN generation_records.images IS '生成的图片URL列表';
COMMENT ON COLUMN generation_records.image_keys IS 'COS存储Key列表';
COMMENT ON COLUMN generation_records.reference_images IS '参考图URL列表';
COMMENT ON COLUMN generation_records.reference_image_keys IS '参考图COS Key列表';
COMMENT ON COLUMN generation_records.reference_image_md5s IS '参考图MD5哈希列表';
COMMENT ON COLUMN generation_records.credits_charged IS '本次扣除的积分';
COMMENT ON COLUMN generation_records.credits_balance IS '扣除后的余额';
COMMENT ON COLUMN generation_records.source IS '来源: generate(生图页), canvas(画布)';

-- -----------------------------------------------------------
-- 3. 积分日志表 (credit_logs)
-- -----------------------------------------------------------
CREATE TABLE credit_logs (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  amount INTEGER NOT NULL,
  type VARCHAR(50) NOT NULL,
  balance_after INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 积分日志索引
CREATE INDEX idx_credit_logs_user_id ON credit_logs(user_id);
CREATE INDEX idx_credit_logs_type ON credit_logs(type);
CREATE INDEX idx_credit_logs_created_at ON credit_logs(created_at);

-- 启用 RLS
ALTER TABLE credit_logs ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户只能查看自己的积分日志" ON credit_logs
  FOR SELECT USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

COMMENT ON TABLE credit_logs IS '积分变动日志';
COMMENT ON COLUMN credit_logs.amount IS '变动数量 (正数=收入, 负数=支出)';
COMMENT ON COLUMN credit_logs.type IS '类型: recharge(充值), consume(消费), refund(返还), gift(赠送)';

-- -----------------------------------------------------------
-- 4. 充值套餐表 (recharge_packages)
-- -----------------------------------------------------------
CREATE TABLE recharge_packages (
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
CREATE INDEX idx_recharge_packages_is_active ON recharge_packages(is_active);
CREATE INDEX idx_recharge_packages_sort_order ON recharge_packages(sort_order);

-- 启用 RLS
ALTER TABLE recharge_packages ENABLE ROW LEVEL SECURITY;

-- RLS 策略（公开只读）
CREATE POLICY "充值套餐对所有人公开" ON recharge_packages
  FOR SELECT USING (is_active = true);

COMMENT ON TABLE recharge_packages IS '充值套餐配置';
COMMENT ON COLUMN recharge_packages.price IS '价格 (单位: 分)';
COMMENT ON COLUMN recharge_packages.credits IS '获得的积分数量';

-- -----------------------------------------------------------
-- 5. 充值记录表 (recharge_records)
-- -----------------------------------------------------------
CREATE TABLE recharge_records (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  package_id INTEGER,
  package_name VARCHAR(100),
  credits INTEGER NOT NULL,
  price INTEGER,
  status VARCHAR(20) DEFAULT 'pending',
  payment_method VARCHAR(50),
  transaction_id VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- 充值记录索引
CREATE INDEX idx_recharge_records_user_id ON recharge_records(user_id);
CREATE INDEX idx_recharge_records_status ON recharge_records(status);
CREATE INDEX idx_recharge_records_created_at ON recharge_records(created_at);

-- 启用 RLS
ALTER TABLE recharge_records ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户只能查看自己的充值记录" ON recharge_records
  FOR SELECT USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

COMMENT ON TABLE recharge_records IS '充值订单记录';
COMMENT ON COLUMN recharge_records.status IS '订单状态: pending(待支付), completed(已完成), failed(失败)';

-- -----------------------------------------------------------
-- 6. 任务缓存表 (api_tasks) - SSE轮询恢复
-- -----------------------------------------------------------
CREATE TABLE api_tasks (
  id SERIAL PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  model TEXT,
  prompt TEXT,
  resolution TEXT,
  aspect_ratio TEXT,
  generation_count INTEGER,
  credits_deducted INTEGER,
  reference_images TEXT[],
  reference_image_keys TEXT[],
  result_images TEXT[],
  result_videos TEXT[],
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 任务缓存索引
CREATE INDEX idx_api_tasks_client_request_id ON api_tasks(client_request_id);
CREATE INDEX idx_api_tasks_user_id ON api_tasks(user_id);
CREATE INDEX idx_api_tasks_status ON api_tasks(status);
CREATE INDEX idx_api_tasks_created_at ON api_tasks(created_at);

-- 启用 RLS
ALTER TABLE api_tasks ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户只能查看自己的任务" ON api_tasks
  FOR SELECT USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

COMMENT ON TABLE api_tasks IS 'API任务缓存 (用于SSE轮询恢复)';

-- -----------------------------------------------------------
-- 7. API模型配置表 (api_models)
-- -----------------------------------------------------------
CREATE TABLE api_models (
  id SERIAL PRIMARY KEY,
  config_id INTEGER,
  model_id VARCHAR(100) NOT NULL UNIQUE,
  model_name VARCHAR(200) NOT NULL,
  description TEXT,
  parameters JSONB,
  credits_base INTEGER,
  is_active BOOLEAN DEFAULT true,
  is_visible BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  api_endpoint TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- API模型索引
CREATE INDEX idx_api_models_model_id ON api_models(model_id);
CREATE INDEX idx_api_models_is_active ON api_models(is_active);
CREATE INDEX idx_api_models_sort_order ON api_models(sort_order);

-- 启用 RLS
ALTER TABLE api_models ENABLE ROW LEVEL SECURITY;

-- RLS 策略（公开只读）
CREATE POLICY "模型配置对所有人公开" ON api_models
  FOR SELECT USING (is_active = true AND is_visible = true);

COMMENT ON TABLE api_models IS 'API模型配置表';

-- -----------------------------------------------------------
-- 8. 邮箱验证码表 (email_verification_codes)
-- -----------------------------------------------------------
CREATE TABLE email_verification_codes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(10) NOT NULL,
  type VARCHAR(20) NOT NULL,
  is_used BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 邮箱验证码索引
CREATE INDEX idx_email_verification_codes_email ON email_verification_codes(email);
CREATE INDEX idx_email_verification_codes_type ON email_verification_codes(type);
CREATE INDEX idx_email_verification_codes_expires_at ON email_verification_codes(expires_at);
-- #050 新增：email + code 联合索引（毫秒级查询）
CREATE INDEX idx_email_verification_codes_email_code ON email_verification_codes(email, code);

COMMENT ON TABLE email_verification_codes IS '邮箱验证码';
COMMENT ON COLUMN email_verification_codes.type IS '类型: register(注册), reset(重置密码)';

-- -----------------------------------------------------------
-- 9. 参考图表 (reference_images)
-- -----------------------------------------------------------
CREATE TABLE reference_images (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  md5_hash VARCHAR(32) NOT NULL,
  cos_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 参考图索引
CREATE INDEX idx_reference_images_user_id ON reference_images(user_id);
CREATE INDEX idx_reference_images_md5_hash ON reference_images(md5_hash);

-- 启用 RLS
ALTER TABLE reference_images ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户只能查看自己的参考图" ON reference_images
  FOR SELECT USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

COMMENT ON TABLE reference_images IS '参考图COS存储映射';

-- -----------------------------------------------------------
-- 10. 提示词收藏表 (prompt_favorites)
-- -----------------------------------------------------------
CREATE TABLE prompt_favorites (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- 提示词收藏索引
CREATE INDEX idx_prompt_favorites_user_id ON prompt_favorites(user_id);

-- 启用 RLS
ALTER TABLE prompt_favorites ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "用户只能查看自己的收藏" ON prompt_favorites
  FOR SELECT USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

CREATE POLICY "用户只能管理自己的收藏" ON prompt_favorites
  FOR ALL USING (user_id::text = current_setting('request.jwt.claims', true)::json->>'sub');

COMMENT ON TABLE prompt_favorites IS '用户提示词收藏';

-- ============================================================
-- 第三部分：数据库函数
-- ============================================================

-- 积分扣除函数（带乐观锁）
CREATE OR REPLACE FUNCTION deduct_credits(
  p_user_id VARCHAR(255),
  p_amount INTEGER,
  p_description TEXT DEFAULT NULL
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
    INSERT INTO credit_logs (user_id, amount, type, balance_after, description, created_at)
    VALUES (p_user_id, -p_amount, 'consume', v_new_credits, p_description, NOW());
    
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

-- 积分充值函数
CREATE OR REPLACE FUNCTION add_credits(
  p_user_id VARCHAR(255),
  p_amount INTEGER,
  p_type VARCHAR(50),
  p_description TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
  v_current_credits INTEGER;
  v_new_credits INTEGER;
BEGIN
  -- 获取当前积分
  SELECT credits INTO v_current_credits
  FROM users WHERE id = p_user_id;
  
  IF v_current_credits IS NULL THEN
    RETURN json_build_object('success', false, 'error', '用户不存在');
  END IF;
  
  -- 更新积分
  UPDATE users 
  SET credits = credits + p_amount, updated_at = NOW()
  WHERE id = p_user_id;
  
  v_new_credits := v_current_credits + p_amount;
  
  -- 记录日志
  INSERT INTO credit_logs (user_id, amount, type, balance_after, description, created_at)
  VALUES (p_user_id, p_amount, p_type, v_new_credits, p_description, NOW());
  
  RETURN json_build_object(
    'success', true, 
    'previous_credits', v_current_credits,
    'new_credits', v_new_credits,
    'added', p_amount
  );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION add_credits IS '积分充值函数';

-- ============================================================
-- 第四部分：初始数据
-- ============================================================

-- 插入默认充值套餐
INSERT INTO recharge_packages (name, price, credits, tag, savings, sort_order, is_active)
VALUES 
  ('体验包', 100, 10, '新人推荐', 0, 1, true),
  ('标准包', 1000, 120, '热销', 20, 2, true),
  ('专业包', 3000, 400, '超值', 100, 3, true),
  ('企业包', 10000, 1500, '最划算', 500, 4, true);

-- 插入 API 模型配置
INSERT INTO api_models (model_id, model_name, description, credits_base, is_active, is_visible, sort_order, parameters) VALUES
('nano-banana-fast', 'Nano Banana Fast', '快速出图，适合预览', 6, true, true, 1, '{"resolutions": [{"label": "1K", "value": "1K", "credits": 6}]}'),
('nano-banana', 'Nano Banana', '均衡性能，适合日常', 10, true, true, 2, '{"resolutions": [{"label": "1K", "value": "1K", "credits": 10}]}'),
('nano-banana-2', 'Nano Banana 2', '二代算法，多分辨率', 14, true, true, 3, '{"resolutions": [{"label": "1K", "value": "1K", "credits": 14}, {"label": "2K", "value": "2K", "credits": 15}, {"label": "4K", "value": "4K", "credits": 16}]}'),
('nano-banana-2-4k-cl', 'Nano Banana 2 4K', '二代4K超清输出', 17, true, true, 4, '{"resolutions": [{"label": "4K", "value": "4K", "credits": 17}]}'),
('nano-banana-pro', 'Nano Banana Pro', '专业高质量图像生成', 17, true, true, 5, '{"resolutions": [{"label": "1K", "value": "1K", "credits": 17}, {"label": "2K", "value": "2K", "credits": 18}, {"label": "4K", "value": "4K", "credits": 20}]}'),
('nano-banana-pro-vip', 'Nano Banana Pro VIP', 'VIP顶级质量', 88, true, true, 6, '{"resolutions": [{"label": "1K", "value": "1K", "credits": 88}, {"label": "2K", "value": "2K", "credits": 105}]}'),
('nano-banana-pro-4k-vip', 'Nano Banana Pro VIP 4K', 'VIP专属4K超高清', 120, true, true, 7, '{"resolutions": [{"label": "4K", "value": "4K", "credits": 120}]}'),
('smart_split', 'Smart Split', '智能分割图片', 5, true, true, 10, '{}'),
('grs-sora-2', 'Sora 2', 'OpenAI视频生成模型', 50, false, true, 20, '{"durations": [{"label": "5秒", "value": "5s", "credits": 50}, {"label": "10秒", "value": "10s", "credits": 100}]}');

-- ============================================================
-- 第五部分：验证
-- ============================================================

-- 验证表创建
SELECT 'Tables created:' as status, COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public';

-- 验证 RLS 策略
SELECT 'RLS policies:' as status, COUNT(*) as count FROM pg_policies WHERE schemaname = 'public';

-- 验证索引
SELECT 'Indexes:' as status, COUNT(*) as count FROM pg_indexes WHERE schemaname = 'public';

-- 验证初始数据
SELECT 'Recharge packages:' as status, COUNT(*) as count FROM recharge_packages;
SELECT 'API models:' as status, COUNT(*) as count FROM api_models;

-- ============================================================
-- 完成！
-- ============================================================
SELECT '✅ 焦土重建完成！数据库已初始化。' as status;
