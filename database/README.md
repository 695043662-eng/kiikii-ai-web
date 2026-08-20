# 生产环境数据库部署指南

## 文件说明

| 文件 | 说明 | 使用场景 |
|------|------|----------|
| `init.sql` | 标准建表脚本 | 开发环境初始化 |
| `init-production.sql` | **焦土重建脚本** | 生产环境全新部署 |

## ⚠️ 重要警告

`init-production.sql` 会**彻底删除所有现有数据**，仅在以下情况使用：
- 新生产环境首次部署
- 确认所有旧数据可以废弃

## 执行步骤（生产环境）

### 1. 连接生产数据库

```bash
# 方式一：使用 psql 命令行
psql -h <生产数据库HOST> -U <用户名> -d <数据库名> -f init-production.sql

# 方式二：使用 Supabase Dashboard（推荐）
# 进入 SQL Editor → 粘贴 init-production.sql 内容 → 点击 Run
```

### 2. 验证执行结果

```sql
-- 检查表数量（应为 10 个）
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

-- 检查 RLS 策略数量
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';

-- 检查充值套餐初始数据（应为 4 个）
SELECT * FROM recharge_packages ORDER BY sort_order;

-- 检查 API 模型配置（应为 9 个）
SELECT model_id, model_name, is_active FROM api_models ORDER BY sort_order;
```

## 核心表清单（10张表）

| 表名 | 说明 | RLS | 外键 |
|------|------|-----|------|
| `users` | 用户主表 | ✅ | - |
| `generation_records` | 生成记录（最新版） | ✅ | → users |
| `credit_logs` | 积分变动日志 | ✅ | → users |
| `recharge_packages` | 充值套餐配置 | ✅ 公开只读 | - |
| `recharge_records` | 充值订单记录 | ✅ | → users, packages |
| `api_tasks` | 任务缓存（SSE轮询） | ✅ | → users |
| `api_models` | API模型配置 | ✅ 公开只读 | - |
| `email_verification_codes` | 邮箱验证码 | ❌ | - |
| `reference_images` | 参考图COS映射 | ✅ | → users |
| `prompt_favorites` | 提示词收藏 | ✅ | → users |

## generation_records 表字段说明

此表包含最新的字段设计：

| 字段 | 类型 | 说明 |
|------|------|------|
| `images` | TEXT[] | 生成的图片URL列表 |
| `image_keys` | TEXT[] | COS存储Key列表 |
| `reference_images` | TEXT[] | 参考图URL列表 |
| `reference_image_keys` | TEXT[] | 参考图COS Key列表 |
| `reference_image_md5s` | TEXT[] | 参考图MD5哈希列表 |
| `credits_charged` | INTEGER | 本次扣除的积分 |
| `credits_balance` | INTEGER | 扣除后的余额 |
| `source` | VARCHAR(50) | 来源: generate, canvas |

## 安全特性

### 1. RLS 策略

- **用户数据隔离**：每个用户只能查看和操作自己的数据
- **公开配置表**：`recharge_packages` 和 `api_models` 对所有用户只读
- **级联删除**：删除用户时自动删除关联数据

### 2. 积分并发安全

```sql
-- 使用乐观锁扣费
SELECT deduct_credits('user-uuid', 10, '生成图片消费');
-- 返回: {"success": true, "previous_credits": 100, "new_credits": 90, "deducted": 10}

-- 充值积分
SELECT add_credits('user-uuid', 100, 'recharge', '充值100积分');
-- 返回: {"success": true, "previous_credits": 90, "new_credits": 190, "added": 100}
```

### 3. 索引优化

所有高频查询字段已创建索引：
- `user_id` - 用户关联
- `task_id` - 任务查询
- `created_at` - 时间范围查询
- `status` / `is_active` - 状态筛选

## 初始数据

### 充值套餐（4个）

| 套餐 | 价格 | 积分 | 标签 |
|------|------|------|------|
| 体验包 | ¥1 | 10 | 新人推荐 |
| 标准包 | ¥10 | 120 | 热销 |
| 专业包 | ¥30 | 400 | 超值 |
| 企业包 | ¥100 | 1500 | 最划算 |

### API 模型（9个）

| 模型ID | 积分 | 状态 |
|--------|------|------|
| nano-banana-fast | 6 | ✅ 启用 |
| nano-banana | 10 | ✅ 启用 |
| nano-banana-2 | 14 | ✅ 启用 |
| nano-banana-2-4k-cl | 17 | ✅ 启用 |
| nano-banana-pro | 17 | ✅ 启用 |
| nano-banana-pro-vip | 88 | ✅ 启用 |
| nano-banana-pro-4k-vip | 120 | ✅ 启用 |
| smart_split | 5 | ✅ 启用 |
| grs-sora-2 | 50 | ⏸️ 禁用 |

## 执行后检查清单

- [ ] 表数量为 10 个
- [ ] RLS 策略已启用
- [ ] 充值套餐数据正确（4条）
- [ ] API 模型数据正确（9条）
- [ ] 数据库函数已创建（deduct_credits, add_credits）
