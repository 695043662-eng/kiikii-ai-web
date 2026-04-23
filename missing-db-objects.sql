-- 缺失的表和函数

-- 1. credit_logs 表
CREATE TABLE IF NOT EXISTS credit_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  amount INTEGER,
  type TEXT,
  balance_after INTEGER,
  task_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. credit_refund_logs 表
CREATE TABLE IF NOT EXISTS credit_refund_logs (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  amount INTEGER,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. atomic_deduct_credits 函数 - 扣除积分
CREATE OR REPLACE FUNCTION atomic_deduct_credits(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_current_credits INTEGER;
  v_new_credits INTEGER;
BEGIN
  -- 锁定用户行防止并发
  SELECT credits INTO v_current_credits
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '用户不存在';
  END IF;

  IF v_current_credits < p_amount THEN
    RAISE EXCEPTION '积分不足';
  END IF;

  v_new_credits := v_current_credits - p_amount;

  UPDATE users
  SET credits = v_new_credits,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN v_new_credits;
END;
$$ LANGUAGE plpgsql;

-- 4. atomic_add_credits 函数 - 增加积分
CREATE OR REPLACE FUNCTION atomic_add_credits(p_user_id UUID, p_amount INTEGER)
RETURNS INTEGER AS $$
DECLARE
  v_current_credits INTEGER;
  v_new_credits INTEGER;
BEGIN
  -- 锁定用户行防止并发
  SELECT credits INTO v_current_credits
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '用户不存在';
  END IF;

  v_new_credits := v_current_credits + p_amount;

  UPDATE users
  SET credits = v_new_credits,
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN v_new_credits;
END;
$$ LANGUAGE plpgsql;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_credit_logs_user_id ON credit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_refund_logs_user_id ON credit_refund_logs(user_id);
