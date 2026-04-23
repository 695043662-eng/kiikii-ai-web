-- ==========================================
-- kiikii.me 数据库初始化 SQL 脚本
-- 用于自动填充 api_configs 和 api_models 表
-- ==========================================
-- 生成时间: 2025-01-XX
-- 适用版本: V3 API 通用架构
-- ==========================================

-- 清空现有数据（可选，生产环境慎用）
-- DELETE FROM api_models WHERE config_id IN (SELECT id FROM api_configs);
-- DELETE FROM api_configs;

-- ==========================================
-- 1. api_configs 表 - 接口配置
-- ==========================================

-- 配置 1: GRS AI (Dakka) - 图片生成服务
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
  1,
  'GRS AI (Dakka)',
  'image_generation',
  'https://grsai.dakka.com.cn/v1/draw/${model}',
  'POST',
  '{
    "Content-Type": "application/json",
    "Authorization": "Bearer ${apiKey}"
  }',
  '{
    "prompt": "${prompt}",
    "resolution": "${resolution}",
    "aspectRatio": "${aspectRatio}",
    "urls": "${urls}",
    "model": "${model}"
  }',
  'YOUR_API_KEY_HERE',
  '{
    "taskIdPath": "data.task_id",
    "statusPath": "data.status",
    "imageUrlPath": "data.imageUrls",
    "errorPath": "data.error"
  }',
  true,
  NOW(),
  NOW()
);

-- 配置 2: Google Gemini - 图片生成服务
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
  2,
  'Google Gemini',
  'image_generation',
  'https://generativelanguage.googleapis.com',
  'POST',
  '{
    "Content-Type": "application/json"
  }',
  '{}',
  'YOUR_API_KEY_HERE',
  '{
    "imageUrlPath": "candidates.0.content.parts.0.inlineData.data"
  }',
  true,
  NOW(),
  NOW()
);

-- ==========================================
-- 2. api_models 表 - 模型配置
-- ==========================================

-- ====== GRS AI (Dakka) 模型系列 ======

-- 模型 1: nano-banana-fast - 快速模型
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
  'nano-banana-fast',
  'Nano Banana 快速版',
  '快速生成图片，适合批量任务',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 2: nano-banana - 标准模型
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
  'nano-banana',
  'Nano Banana 标准版',
  '标准质量，性价比高',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 3: nano-banana-2 - 增强版
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
  'nano-banana-2',
  'Nano Banana 2.0',
  '增强版，支持多分辨率',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12},
      {"label": "4K", "value": "4K", "credits": 15}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 4: nano-banana-2-cl - 商业版
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
  'nano-banana-2-cl',
  'Nano Banana 2.0 商业版',
  '商业版本，支持 1K/2K 分辨率',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 5: nano-banana-2-4k-cl - 4K 商业版
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
  'nano-banana-2-4k-cl',
  'Nano Banana 2.0 4K 商业版',
  '专业版，仅支持 4K 超高清',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "4K", "value": "4K", "credits": 10}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 6: nano-banana-pro - Pro 版
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
  'nano-banana-pro',
  'Nano Banana Pro',
  '专业版，支持所有分辨率',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12},
      {"label": "4K", "value": "4K", "credits": 15}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 7: nano-banana-pro-cl - Pro 商业版
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
  'nano-banana-pro-cl',
  'Nano Banana Pro 商业版',
  '专业商业版，支持所有分辨率',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12},
      {"label": "4K", "value": "4K", "credits": 15}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 8: nano-banana-pro-vip - Pro VIP 版
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
  'nano-banana-pro-vip',
  'Nano Banana Pro VIP',
  'VIP 版本，支持 1K/2K 分辨率',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 9: nano-banana-pro-4k-vip - Pro 4K VIP 版
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
  'nano-banana-pro-4k-vip',
  'Nano Banana Pro 4K VIP',
  'VIP 版本，仅支持 4K 超高清',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "4K", "value": "4K", "credits": 10}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 10: nano-banana-pro-vt - Pro VT 版
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
  'nano-banana-pro-vt',
  'Nano Banana Pro VT',
  'Pro VT 版本，支持所有分辨率',
  NULL,
  1,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12},
      {"label": "4K", "value": "4K", "credits": 15}
    ],
    "aspectRatios": [
      {"label": "自动", "value": "auto"},
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"},
      {"label": "5:4", "value": "5:4"},
      {"label": "4:5", "value": "4:5"},
      {"label": "21:9", "value": "21:9"},
      {"label": "9:21", "value": "9:21"},
      {"label": "1:2", "value": "1:2"},
      {"label": "2:1", "value": "2:1"},
      {"label": "1:3", "value": "1:3"},
      {"label": "3:1", "value": "3:1"},
      {"label": "1:4", "value": "1:4"},
      {"label": "4:1", "value": "4:1"},
      {"label": "1:8", "value": "1:8"},
      {"label": "8:1", "value": "8:1"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- ====== Google Gemini 模型系列 ======

-- 模型 11: gemini-2.0-flash-exp - 闪电版
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
  'gemini-2.0-flash-exp',
  'Gemini 2.0 Flash Experimental',
  'Google Gemini 闪电版，快速生成',
  '/v1beta/models/gemini-2.0-flash-exp:generateContent',
  2,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12},
      {"label": "4K", "value": "4K", "credits": 15}
    ],
    "aspectRatios": [
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- 模型 12: gemini-2.0-pro-exp - Pro 版
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
  'gemini-2.0-pro-exp',
  'Gemini 2.0 Pro Experimental',
  'Google Gemini Pro 版，高质量生成',
  '/v1beta/models/gemini-2.0-pro-exp:generateContent',
  2,
  '{
    "resolutions": [
      {"label": "1K", "value": "1K", "credits": 10},
      {"label": "2K", "value": "2K", "credits": 12},
      {"label": "4K", "value": "4K", "credits": 15}
    ],
    "aspectRatios": [
      {"label": "1:1", "value": "1:1"},
      {"label": "16:9", "value": "16:9"},
      {"label": "9:16", "value": "9:16"},
      {"label": "4:3", "value": "4:3"},
      {"label": "3:4", "value": "3:4"},
      {"label": "3:2", "value": "3:2"},
      {"label": "2:3", "value": "2:3"}
    ]
  }',
  10,
  true,
  NOW(),
  NOW()
);

-- ==========================================
-- 3. 验证数据
-- ==========================================

-- 查看所有接口配置
-- SELECT * FROM api_configs WHERE is_active = true ORDER BY id;

-- 查看所有模型配置
-- SELECT id, model_id, model_name, config_id, credits_base, is_active 
-- FROM api_models 
-- WHERE is_active = true 
-- ORDER BY config_id, id;

-- 查看模型详情（关联接口配置）
-- SELECT 
--   am.id,
--   am.model_id,
--   am.model_name,
--   ac.name as config_name,
--   am.credits_base,
--   am.parameters->'resolutions' as resolutions,
--   am.is_active
-- FROM api_models am
-- LEFT JOIN api_configs ac ON am.config_id = ac.id
-- WHERE am.is_active = true
-- ORDER BY ac.id, am.id;

-- ==========================================
-- 4. 更新 API Key（替换占位符）
-- ==========================================

-- 更新 GRS AI 的 API Key
-- UPDATE api_configs SET api_key = 'YOUR_REAL_API_KEY_HERE' WHERE id = 1;

-- 更新 Google Gemini 的 API Key
-- UPDATE api_configs SET api_key = 'YOUR_GEMINI_API_KEY_HERE' WHERE id = 2;

-- ==========================================
-- 5. 批量更新积分（可选）
-- ==========================================

-- 例如：将所有模型的积分统一为 15
-- UPDATE api_models SET credits_base = 15 WHERE is_active = true;

-- ==========================================
-- 说明
-- ==========================================
-- 1. 所有 API Key 使用占位符 "YOUR_API_KEY_HERE"，请手动替换为真实密钥
-- 2. config_id 必须与 api_configs 表中的 id 对应
-- 3. parameters 字段存储为 JSONB，包含 resolutions 和 aspectRatios
-- 4. is_active 控制模型是否显示在前端
-- 5. Gemini 使用相对路径，会自动拼接 api_configs.api_endpoint

-- ==========================================
-- 使用方法
-- ==========================================
-- 1. 打开 Supabase SQL Editor
-- 2. 复制本脚本内容
-- 3. 替换 YOUR_API_KEY_HERE 为真实密钥
-- 4. 执行脚本
-- 5. 验证数据是否正确插入
