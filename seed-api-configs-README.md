# API 配置初始化 SQL 脚本使用说明

## 📋 概述

本脚本用于自动填充 `api_configs` 和 `api_models` 表，包含 GRS AI (Dakka) 和 Google Gemini 两个供应商的所有模型配置。

## 🗂️ 表结构说明

### api_configs 表

| 字段 | 说明 | 示例 |
|------|------|------|
| id | 接口配置 ID | 1, 2 |
| name | 接口名称 | GRS AI (Dakka), Google Gemini |
| service_type | 服务类型 | image_generation |
| api_endpoint | API 端点（支持模板变量） | https://grsai.dakka.com.cn/v1/draw/${model} |
| request_method | 请求方法 | POST |
| request_headers | 请求头模板 | JSON 格式 |
| request_body_template | 请求体模板 | JSON 格式 |
| api_key | API 密钥 | YOUR_API_KEY_HERE |
| response_parser | 响应解析器配置 | JSON 格式 |
| is_active | 是否启用 | true |
| created_at | 创建时间 | NOW() |
| updated_at | 更新时间 | NOW() |

### api_models 表

| 字段 | 说明 | 示例 |
|------|------|------|
| model_id | 模型 ID | nano-banana-fast |
| model_name | 模型名称 | Nano Banana 快速版 |
| description | 模型描述 | 快速生成图片，适合批量任务 |
| api_endpoint | 模型自定义端点（可选） | NULL 或相对路径 |
| config_id | 关联的接口配置 ID | 1 |
| parameters | 模型参数配置 | JSON 格式（包含 resolutions 和 aspectRatios） |
| credits_base | 基础积分 | 10 |
| is_active | 是否启用 | true |
| created_at | 创建时间 | NOW() |
| updated_at | 更新时间 | NOW() |

## 🚀 使用步骤

### 1. 替换 API Key

在执行脚本前，请先替换所有占位符：

```sql
-- 更新 GRS AI 的 API Key
UPDATE api_configs 
SET api_key = 'sk-your-real-grs-ai-key-here' 
WHERE id = 1;

-- 更新 Google Gemini 的 API Key
UPDATE api_configs 
SET api_key = 'AIzaSy-your-real-gemini-api-key-here' 
WHERE id = 2;
```

### 2. 执行脚本

在 Supabase SQL Editor 中执行：

```bash
# 1. 打开 Supabase Dashboard
# 2. 进入 SQL Editor
# 3. 复制 seed-api-configs.sql 内容
# 4. 粘贴并执行
```

### 3. 验证数据

执行验证查询：

```sql
-- 查看所有接口配置
SELECT * FROM api_configs WHERE is_active = true ORDER BY id;

-- 查看所有模型配置
SELECT id, model_id, model_name, config_id, credits_base, is_active 
FROM api_models 
WHERE is_active = true 
ORDER BY config_id, id;

-- 查看模型详情（关联接口配置）
SELECT 
  am.id,
  am.model_id,
  am.model_name,
  ac.name as config_name,
  am.credits_base,
  am.parameters->'resolutions' as resolutions,
  am.is_active
FROM api_models am
LEFT JOIN api_configs ac ON am.config_id = ac.id
WHERE am.is_active = true
ORDER BY ac.id, am.id;
```

## 📊 模型清单

### GRS AI (Dakka) 系列 (config_id = 1)

| 模型 ID | 模型名称 | 基础积分 | 分辨率 | 说明 |
|---------|---------|---------|--------|------|
| nano-banana-fast | Nano Banana 快速版 | 10 | 1K | 快速生成，适合批量任务 |
| nano-banana | Nano Banana 标准版 | 10 | 1K | 标准质量，性价比高 |
| nano-banana-2 | Nano Banana 2.0 | 10 | 1K/2K/4K | 增强版，支持多分辨率 |
| nano-banana-2-cl | Nano Banana 2.0 商业版 | 10 | 1K/2K | 商业版本，支持 1K/2K 分辨率 |
| nano-banana-2-4k-cl | Nano Banana 2.0 4K 商业版 | 10 | 4K | 专业版，仅支持 4K 超高清 |
| nano-banana-pro | Nano Banana Pro | 10 | 1K/2K/4K | 专业版，支持所有分辨率 |
| nano-banana-pro-cl | Nano Banana Pro 商业版 | 10 | 1K/2K/4K | 专业商业版，支持所有分辨率 |
| nano-banana-pro-vip | Nano Banana Pro VIP | 10 | 1K/2K | VIP 版本，支持 1K/2K 分辨率 |
| nano-banana-pro-4k-vip | Nano Banana Pro 4K VIP | 10 | 4K | VIP 版本，仅支持 4K 超高清 |
| nano-banana-pro-vt | Nano Banana Pro VT | 10 | 1K/2K/4K | Pro VT 版本，支持所有分辨率 |

### Google Gemini 系列 (config_id = 2)

| 模型 ID | 模型名称 | 基础积分 | 分辨率 | 说明 |
|---------|---------|---------|--------|------|
| gemini-2.0-flash-exp | Gemini 2.0 Flash Experimental | 10 | 1K/2K/4K | 闪电版，快速生成 |
| gemini-2.0-pro-exp | Gemini 2.0 Pro Experimental | 10 | 1K/2K/4K | Pro 版，高质量生成 |

## 🔧 模板变量说明

### api_configs 支持的变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| ${model} | 模型 ID | nano-banana-fast |
| ${apiKey} | API 密钥 | sk-xxx |
| ${prompt} | 提示词 | 一只猫 |
| ${resolution} | 分辨率 | 1K |
| ${aspectRatio} | 宽高比 | 1:1 |
| ${urls} | 参考图 URL 数组 | [url1, url2] |

### 模板变量替换示例

```javascript
// 模板
"https://grsai.dakka.com.cn/v1/draw/${model}"

// 替换后
"https://grsai.dakka.com.cn/v1/draw/nano-banana-fast"
```

## 🎯 参数配置说明

### parameters 字段结构

```json
{
  "resolutions": [
    {
      "label": "1K",
      "value": "1K",
      "credits": 10
    },
    {
      "label": "2K",
      "value": "2K",
      "credits": 12
    },
    {
      "label": "4K",
      "value": "4K",
      "credits": 15
    }
  ],
  "aspectRatios": [
    {
      "label": "1:1",
      "value": "1:1"
    },
    {
      "label": "16:9",
      "value": "16:9"
    }
  ]
}
```

### aspectRatios 支持的比例

- 自动: auto
- 正方形: 1:1
- 横屏: 16:9, 4:3, 3:2, 5:4, 21:9, 2:1, 3:1, 4:1, 8:1
- 竖屏: 9:16, 3:4, 2:3, 4:5, 9:21, 1:2, 1:3, 1:4, 1:8

## ⚙️ 常见操作

### 启用/禁用模型

```sql
-- 启用所有 GRS AI 模型
UPDATE api_models SET is_active = true WHERE config_id = 1;

-- 禁用所有 Gemini 模型
UPDATE api_models SET is_active = false WHERE config_id = 2;

-- 启用单个模型
UPDATE api_models SET is_active = true WHERE model_id = 'nano-banana-fast';
```

### 批量更新积分

```sql
-- 将所有模型的积分统一为 15
UPDATE api_models SET credits_base = 15 WHERE is_active = true;

-- 仅更新 GRS AI 模型的积分
UPDATE api_models SET credits_base = 12 WHERE config_id = 1;

-- 仅更新 4K 分辨率的积分（需要手动计算）
-- 注意：这需要手动修改 parameters JSON 字段
```

### 添加新模型

```sql
INSERT INTO api_models (
  model_id,
  model_name,
  description,
  api_endpoint,
  config_id,
  parameters,
  credits_base,
  is_active,
  created_at,
  updated_at
) VALUES (
  'new-model-id',
  '新模型名称',
  '模型描述',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10}
    ],
    "aspectRatios": [
      {"label": "1:1", "value": "1:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);
```

### 添加新接口配置

```sql
INSERT INTO api_configs (
  id,
  name,
  service_type,
  api_endpoint,
  request_method,
  request_headers,
  request_body_template,
  api_key,
  response_parser,
  is_active,
  created_at,
  updated_at
) VALUES (
  3,
  'New Provider',
  'image_generation',
  'https://api.example.com/v1/generate',
  'POST',
  '{
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiKey}"
  }',
  '{
    "prompt": "${prompt}",
    "resolution": "${resolution}"
  }',
  'YOUR_API_KEY_HERE',
  '{
    "imageUrlPath": "data.images"
  }',
  true,
  NOW(),
  NOW()
);
```

## 🔍 故障排查

### 问题 1：模型不显示在前端

**原因**：`is_active` 字段为 false

**解决**：
```sql
-- 检查模型状态
SELECT model_id, is_active FROM api_models WHERE model_id = 'nano-banana-fast';

-- 启用模型
UPDATE api_models SET is_active = true WHERE model_id = 'nano-banana-fast';
```

### 问题 2：API 请求失败

**原因**：API Key 未配置或配置错误

**解决**：
```sql
-- 检查 API Key
SELECT name, api_key FROM api_configs WHERE id = 1;

-- 更新 API Key
UPDATE api_configs SET api_key = 'your-real-api-key-here' WHERE id = 1;
```

### 问题 3：参数格式错误

**原因**：`parameters` 字段 JSON 格式错误

**解决**：
```sql
-- 检查参数格式
SELECT model_id, parameters FROM api_models WHERE model_id = 'nano-banana-fast';

-- 修正参数（参考脚本中的正确格式）
UPDATE api_models 
SET parameters = '{"resolutions": [...], "aspectRatios": [...]}'
WHERE model_id = 'nano-banana-fast';
```

## 📝 注意事项

1. **API Key 安全**：请勿将真实 API Key 提交到代码仓库
2. **config_id 对应**：确保 api_models.config_id 与 api_configs.id 一一对应
3. **JSON 格式**：parameters 和 request_body_template 必须是有效的 JSON
4. **相对路径**：Gemini 使用相对路径，会自动拼接 api_configs.api_endpoint
5. **积分计算**：credits_base 是基础积分，实际扣费会根据分辨率倍率计算

## 🔄 后续更新

每次更新 API 逻辑时，请同步提供更新 SQL 脚本：

```sql
-- 示例：添加新模型
INSERT INTO api_models (...) VALUES (...);

-- 示例：修改现有模型参数
UPDATE api_models SET parameters = '{...}' WHERE model_id = 'xxx';

-- 示例：禁用旧模型
UPDATE api_models SET is_active = false WHERE model_id = 'old-model';
```

## 📞 支持

如有问题，请检查：
1. Supabase 日志
2. 前端控制台错误
3. 后端 API 日志
4. `/api/config` 接口返回的数据
