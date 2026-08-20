========================================
支付订单表创建指南
========================================

## 📋 方法一：Supabase Dashboard（推荐）

1. 打开 Supabase Dashboard
   https://supabase.com/dashboard/project/ozdlvxxoufkiazddvxys

2. 进入 SQL Editor
   左侧菜单 → SQL Editor → New query

3. 复制粘贴 scripts/create-payment-orders-table.sql 内容并执行

========================================
## 📋 方法二：使用 pg 脚本（需要数据库密码）

1. 从 Supabase Dashboard 获取数据库密码
   Project Settings → Database → Database Password

2. 在 .env.local 中添加
   SUPABASE_DB_PASSWORD=你的密码

3. 执行脚本
   pnpm add pg
   node scripts/create-payment-orders-table-pg.js

========================================
## 📋 表结构说明

payment_orders 表：
- id: 主键（自增）
- out_trade_no: 商户订单号（唯一，防重复）
- user_id: 用户ID
- price: 订单金额（元）
- credits: 积分数量（后端映射，防篡改）
- status: 订单状态（unpaid/paid，幂等控制）
- trade_no: 支付平台订单号
- paid_at: 支付成功时间
- created_at/updated_at: 时间戳

========================================
## ⚠️ 军规 #235 提醒

禁止使用 exec_sql 工具（连接沙盒数据库）！
必须使用 Node.js 脚本连接真实数据库！