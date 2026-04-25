# 数据库字段同步报告

## 一、差异汇总

### 开发环境需要添加的字段

| 表名 | 缺失字段 | 类型 | 说明 |
|------|----------|------|------|
| `prompt_favorites` | `updated_at` | TIMESTAMP WITH TIME ZONE | 更新时间 |
| `redeem_keys` | `created_by` | VARCHAR(255) | 创建人 |
| `redeem_keys` | `is_limited` | BOOLEAN | 是否限制渠道 |
| `redeem_keys` | `used_by` | VARCHAR(255) | 使用者 |
| `recharge_records` | `completed_at` | TIMESTAMP WITH TIME ZONE | 完成时间 |
| `recharge_records` | `package_id` | INTEGER | 套餐ID |

### 生产环境需要添加的字段

| 表名 | 缺失字段/表 | 说明 |
|------|-------------|------|
| `redeem_keys` | `max_usage` | 最大使用次数（代码已使用） |
| `model_credits_config` | **整表缺失** | 模型积分自定义配置 |

---

## 二、同步 SQL（复制到 Supabase Dashboard SQL Editor 执行）

### 开发环境 SQL
```
-- 在 https://supabase.com/dashboard/project/ozdlvxxoufkiazddvxys/sql 执行

-- 1. prompt_favorites 添加 updated_at
ALTER TABLE prompt_favorites 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. redeem_keys 添加缺失字段
ALTER TABLE redeem_keys 
ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_limited BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS used_by VARCHAR(255);

-- 3. recharge_records 添加缺失字段
ALTER TABLE recharge_records 
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS package_id INTEGER REFERENCES recharge_packages(id);
```

### 生产环境 SQL
```
-- 在 https://supabase.com/dashboard/project/hrwoalchynrnwlcqdpxn/sql 执行

-- 1. redeem_keys 添加 max_usage
ALTER TABLE redeem_keys 
ADD COLUMN IF NOT EXISTS max_usage INTEGER;

-- 2. 创建 model_credits_config 表
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
```

---

## 三、字段完整对比

### redeem_keys

| 字段 | 开发 | 生产 | 代码使用 |
|------|------|------|----------|
| id | ✅ | ✅ | - |
| key_code | ✅ | ✅ | ✅ |
| credits | ✅ | ✅ | ✅ |
| status | ✅ | ✅ | ✅ |
| used_at | ✅ | ✅ | ✅ |
| created_at | ✅ | ✅ | - |
| channel | ✅ | ✅ | ✅ |
| **created_by** | ❌ | ✅ | ✅ |
| **is_limited** | ❌ | ✅ | ✅ |
| **used_by** | ❌ | ✅ | ✅ |
| **max_usage** | ✅ | ❌ | ✅ |

### recharge_records

| 字段 | 开发 | 生产 | 代码使用 |
|------|------|------|----------|
| id | ✅ | ✅ | - |
| user_id | ✅ | ✅ | ✅ |
| credits | ✅ | ✅ | ✅ |
| price | ✅ | ✅ | ✅ |
| status | ✅ | ✅ | ✅ |
| created_at | ✅ | ✅ | ✅ |
| package_name | ✅ | ✅ | ✅ |
| payment_method | ✅ | ✅ | ✅ |
| transaction_id | ✅ | ✅ | ✅ |
| **completed_at** | ❌ | ✅ | ❌ 预留 |
| **package_id** | ❌ | ✅ | ❌ 预留 |

### prompt_favorites

| 字段 | 开发 | 生产 | 代码使用 |
|------|------|------|----------|
| id | ✅ | ✅ | - |
| user_id | ✅ | ✅ | ✅ |
| content | ✅ | ✅ | ✅ |
| sort_order | ✅ | ✅ | ✅ |
| created_at | ✅ | ✅ | - |
| **updated_at** | ❌ | ✅ | ❌ 预留 |

### ip_rate_limits

| 字段 | 开发 | 生产 | 代码使用 |
|------|------|------|----------|
| id | ✅ | ✅ | - |
| ip | ✅ | ✅ | ✅ |
| action_type | ✅ | ✅ | ✅ |
| created_at | ✅ | ✅ | ✅ |

### model_credits_config

| 环境 | 状态 |
|------|------|
| 开发 | ✅ 存在 |
| 生产 | ❌ 不存在 |
