-- ========================================
-- 创建 payment_orders 表（支付订单表）
-- ========================================
-- 
-- 执行方式：
-- 1. Supabase Dashboard → SQL Editor → 复制粘贴执行
-- 2. 或使用 Supabase CLI: supabase db push
-- 
-- 表结构说明：
-- - out_trade_no: 商户订单号（唯一，防重复）
-- - user_id: 用户ID（关联 users 表）
-- - price: 订单金额（元）
-- - credits: 积分数量（后端映射，防篡改）
-- - status: 订单状态（unpaid/paid，幂等控制）
-- - trade_no: 支付平台订单号（支付成功后写入）
-- - paid_at: 支付成功时间
-- ========================================

-- 创建支付订单表
CREATE TABLE IF NOT EXISTS payment_orders (
  id BIGSERIAL PRIMARY KEY,
  out_trade_no VARCHAR(100) UNIQUE NOT NULL,
  user_id VARCHAR(100) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  credits INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'unpaid',
  trade_no VARCHAR(100),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引（加速查询）
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_orders_out_trade_no ON payment_orders(out_trade_no);

-- 添加注释
COMMENT ON TABLE payment_orders IS '支付订单表';
COMMENT ON COLUMN payment_orders.out_trade_no IS '商户订单号（唯一）';
COMMENT ON COLUMN payment_orders.user_id IS '用户ID';
COMMENT ON COLUMN payment_orders.price IS '订单金额（元）';
COMMENT ON COLUMN payment_orders.credits IS '积分数量';
COMMENT ON COLUMN payment_orders.status IS '订单状态：unpaid-未支付，paid-已支付';
COMMENT ON COLUMN payment_orders.trade_no IS '支付平台订单号';
COMMENT ON COLUMN payment_orders.paid_at IS '支付成功时间';

-- 创建触发器：自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_payment_orders_updated_at ON payment_orders;
CREATE TRIGGER update_payment_orders_updated_at
  BEFORE UPDATE ON payment_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ========================================
-- 验证表创建结果
-- ========================================
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default 
FROM information_schema.columns 
WHERE table_name = 'payment_orders' 
ORDER BY ordinal_position;