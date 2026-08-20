# 项目配置说明

> ⚠️ 请妥善保管此文档，部署时需要用到

---

## 1. 对象存储 - 腾讯云 COS

文件存储服务，用于存储生成的图片、视频等

| 配置项 | 值 |
|--------|-----|
| SecretId | `<见.env.local COS_SECRET_ID>` |
| SecretKey | `REDACTED_COS_KEY` |
| Bucket | `kiikii-ai-1412916018` |
| Region | `ap-hongkong` |
| Domain | `https://kiikii-ai-1412916018.cos.ap-hongkong.myqcloud.com` |

**配置位置**: `src/lib/cos.ts`

**获取方式**:
1. 登录 [腾讯云控制台](https://console.cloud.tencent.com)
2. 访问管理 → API密钥管理 → 创建/查看密钥
3. 对象存储 → 存储桶列表 → 查看存储桶名称和地域

---

## 2. 数据库 - Supabase

PostgreSQL 数据库，存储用户数据、积分、记录等

| 配置项 | 环境变量名 |
|--------|-----------|
| URL | `SUPABASE_URL` |
| Anon Key | `SUPABASE_ANON_KEY` |

**配置位置**: `src/storage/database/supabase-client.ts`

**获取方式**:
1. 登录 [Supabase](https://supabase.com)
2. 选择项目 → Settings → API
3. 复制 `Project URL` 和 `anon public` key

**部署时需要设置环境变量**:
```bash
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=YOUR_JWT_KEY_HERE
```

---

## 3. AI 服务 API

图片/视频生成服务

| 配置项 | 值 |
|--------|-----|
| API Endpoint | `https://api.mmw.ink` |
| API Key | `sk-Ui3K0bVZPONWsBxW30MVyFJYMElVOUerDe23JvZeqfxucAun` |

**配置位置**: `.env.local`

---

## 部署检查清单

部署到新服务器时，确保以下环境变量已配置：

```bash
# 必需
SUPABASE_URL=<你的Supabase项目URL>
SUPABASE_ANON_KEY=<你的Supabase anon key>

# 可选（代码中有默认值）
COS_SECRET_ID=<腾讯云SecretId>
COS_SECRET_KEY=<腾讯云SecretKey>
COS_BUCKET=kiikii-ai-1412916018
COS_REGION=ap-hongkong

# AI服务
NEXT_PUBLIC_API_ENDPOINT=https://api.mmw.ink
NEXT_PUBLIC_DEFAULT_API_KEY=sk-xxx
```

---

## 常见问题

### Q: 忘记 Supabase 账号密码怎么办？
A: 访问 https://supabase.com 使用邮箱找回密码

### Q: 如何查看数据库表结构？
A: Supabase 控制台 → Table Editor

### Q: 如何查看存储的文件？
A: 腾讯云控制台 → 对象存储 → kiikii-ai-1412916018

---

*最后更新: 2026-03-30*
