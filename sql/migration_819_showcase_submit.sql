-- ============================================================
-- #819 展示区动态参数 + 用户历史资产一键提交审核
-- SQL 迁移脚本
-- ============================================================

-- 1. 创建 model_spec_mapping 字典表（模型规格映射）
CREATE TABLE IF NOT EXISTS model_spec_mapping (
  id BIGSERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,           -- 模型ID（对应 api_models.model_id）
  spec_type TEXT NOT NULL,          -- 规格类型：'aspect_ratio' | 'resolution' | 'duration'
  spec_value TEXT NOT NULL,         -- 规格值：'1:1' | '720p' | '5' 等
  spec_label TEXT,                  -- 显示标签：'1:1' | '720p' | '5秒' 等
  is_enabled BOOLEAN DEFAULT true,  -- 是否启用
  sort_order INT DEFAULT 0,         -- 排序
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  
  -- 唯一约束：同一模型同一规格类型下，值不能重复
  UNIQUE(model_id, spec_type, spec_value)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_model_id ON model_spec_mapping(model_id);
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_spec_type ON model_spec_mapping(spec_type);
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_enabled ON model_spec_mapping(is_enabled);

-- RLS 策略
ALTER TABLE model_spec_mapping ENABLE ROW LEVEL SECURITY;

-- 公开读取：所有用户可读取启用的规格
CREATE POLICY "model_spec_mapping_public_read" ON model_spec_mapping
  FOR SELECT USING (is_enabled = true);

-- 管理员全权：通过 service_role_key 访问（后端 API 用 service_role 绕过 RLS）
-- 无需额外策略，后端直接用 serviceRole 客户端


-- 2. 在 generation_records 表新增 is_submitted 字段（防重复提交标记）
-- 使用 JSONB extra_data 扩展方式，避免 ALTER TABLE（更安全）
-- 如果 generation_records 已有 extra_data 列，直接使用；否则新增
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'generation_records' AND column_name = 'extra_data'
  ) THEN
    ALTER TABLE generation_records ADD COLUMN extra_data JSONB DEFAULT '{}';
  END IF;
END $$;

-- 注释：is_submitted 标记存在 extra_data JSONB 中
-- 格式：extra_data.is_submitted = true / false
-- 格式：extra_data.submitted_showcase_id = 42（展示卡片ID）


-- 3. 在 canvas_config 表的 extra_data JSONB 中扩展审核流字段
-- 不需要 ALTER TABLE，直接在 JSONB 中新增字段：
-- extra_data.status: 'pending' | 'approved' | 'rejected' | 'expired'
-- extra_data.author_id: uuid
-- extra_data.source_image_key: text (Temp 桶原始 key)
-- extra_data.source_type: 'user_submission' | 'admin_upload'
-- extra_data.reviewed_at: timestamp
-- extra_data.reviewer_id: uuid
-- extra_data.reject_reason: text
-- extra_data.submitted_at: timestamp


-- ============================================================
-- 初始数据：为现有模型插入规格映射
-- ⚠️ 这些数据也可以在 Supabase 后台手动插入
-- ============================================================

-- GPT Image 2 规格
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('gpt-image-2', 'aspect_ratio', '1:1', '1:1', 1),
('gpt-image-2', 'aspect_ratio', '3:4', '3:4', 2),
('gpt-image-2', 'aspect_ratio', '4:3', '4:3', 3),
('gpt-image-2', 'aspect_ratio', '9:16', '9:16', 4),
('gpt-image-2', 'aspect_ratio', '16:9', '16:9', 5),
('gpt-image-2', 'aspect_ratio', '3:1', '3:1', 6),
('gpt-image-2', 'aspect_ratio', '1:3', '1:3', 7),
('gpt-image-2', 'resolution', '720p', '720p', 1),
('gpt-image-2', 'resolution', '1080p', '1080p', 2),
('gpt-image-2', 'resolution', '4k', '4K', 3)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Flux 1.1 Pro 规格
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('flux-1.1-pro', 'aspect_ratio', '1:1', '1:1', 1),
('flux-1.1-pro', 'aspect_ratio', '3:4', '3:4', 2),
('flux-1.1-pro', 'aspect_ratio', '4:3', '4:3', 3),
('flux-1.1-pro', 'aspect_ratio', '9:16', '9:16', 4),
('flux-1.1-pro', 'aspect_ratio', '16:9', '16:9', 5),
('flux-1.1-pro', 'resolution', '1K', '1K', 1),
('flux-1.1-pro', 'resolution', '2K', '2K', 2)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Flux Kontext 规格
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('flux-kontext', 'aspect_ratio', '1:1', '1:1', 1),
('flux-kontext', 'aspect_ratio', '3:4', '3:4', 2),
('flux-kontext', 'aspect_ratio', '4:3', '4:3', 3),
('flux-kontext', 'aspect_ratio', '9:16', '9:16', 4),
('flux-kontext', 'aspect_ratio', '16:9', '16:9', 5),
('flux-kontext', 'resolution', '1K', '1K', 1),
('flux-kontext', 'resolution', '2K', '2K', 2)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Seedance 2.0 规格（视频模型）
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('seedance-2.0', 'aspect_ratio', '16:9', '16:9', 1),
('seedance-2.0', 'aspect_ratio', '9:16', '9:16', 2),
('seedance-2.0', 'aspect_ratio', '1:1', '1:1', 3),
('seedance-2.0', 'aspect_ratio', '4:3', '4:3', 4),
('seedance-2.0', 'aspect_ratio', '3:4', '3:4', 5),
('seedance-2.0', 'aspect_ratio', '21:9', '21:9', 6),
('seedance-2.0', 'duration', '4', '4秒', 1),
('seedance-2.0', 'duration', '5', '5秒', 2),
('seedance-2.0', 'duration', '6', '6秒', 3),
('seedance-2.0', 'duration', '7', '7秒', 4),
('seedance-2.0', 'duration', '8', '8秒', 5),
('seedance-2.0', 'duration', '9', '9秒', 6),
('seedance-2.0', 'duration', '10', '10秒', 7),
('seedance-2.0', 'duration', '11', '11秒', 8),
('seedance-2.0', 'duration', '12', '12秒', 9),
('seedance-2.0', 'duration', '13', '13秒', 10),
('seedance-2.0', 'duration', '14', '14秒', 11),
('seedance-2.0', 'duration', '15', '15秒', 12),
('seedance-2.0', 'resolution', '720p', '720p', 1),
('seedance-2.0', 'resolution', '1080p', '1080p', 2)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Seedance 2.0 Fast 规格（视频模型）
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('seedance-2.0-fast', 'aspect_ratio', '16:9', '16:9', 1),
('seedance-2.0-fast', 'aspect_ratio', '9:16', '9:16', 2),
('seedance-2.0-fast', 'aspect_ratio', '1:1', '1:1', 3),
('seedance-2.0-fast', 'aspect_ratio', '4:3', '4:3', 4),
('seedance-2.0-fast', 'aspect_ratio', '3:4', '3:4', 5),
('seedance-2.0-fast', 'aspect_ratio', '21:9', '21:9', 6),
('seedance-2.0-fast', 'duration', '4', '4秒', 1),
('seedance-2.0-fast', 'duration', '5', '5秒', 2),
('seedance-2.0-fast', 'duration', '6', '6秒', 3),
('seedance-2.0-fast', 'duration', '7', '7秒', 4),
('seedance-2.0-fast', 'duration', '8', '8秒', 5),
('seedance-2.0-fast', 'duration', '9', '9秒', 6),
('seedance-2.0-fast', 'duration', '10', '10秒', 7),
('seedance-2.0-fast', 'duration', '11', '11秒', 8),
('seedance-2.0-fast', 'duration', '12', '12秒', 9),
('seedance-2.0-fast', 'resolution', '720p', '720p', 1),
('seedance-2.0-fast', 'resolution', '1080p', '1080p', 2)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Happy Horse 1.0 规格（视频模型）
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('happyhorse-1.0', 'aspect_ratio', '16:9', '16:9', 1),
('happyhorse-1.0', 'aspect_ratio', '9:16', '9:16', 2),
('happyhorse-1.0', 'aspect_ratio', '1:1', '1:1', 3),
('happyhorse-1.0', 'aspect_ratio', '4:3', '4:3', 4),
('happyhorse-1.0', 'aspect_ratio', '3:4', '3:4', 5),
('happyhorse-1.0', 'duration', '3', '3秒', 1),
('happyhorse-1.0', 'duration', '5', '5秒', 2),
('happyhorse-1.0', 'duration', '8', '8秒', 3),
('happyhorse-1.0', 'duration', '10', '10秒', 4),
('happyhorse-1.0', 'duration', '15', '15秒', 5),
('happyhorse-1.0', 'resolution', '720p', '720p', 1),
('happyhorse-1.0', 'resolution', '1080p', '1080p', 2)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Veo 3 规格（视频模型）
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('veo3', 'aspect_ratio', '16:9', '16:9', 1),
('veo3', 'aspect_ratio', '9:16', '9:16', 2),
('veo3', 'duration', '8', '8秒', 1),
('veo3', 'resolution', '720p', '720p', 1),
('veo3', 'resolution', '1080p', '1080p', 2),
('veo3', 'resolution', '4k', '4K', 3)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Veo 3 Fast 规格
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('veo3-fast', 'aspect_ratio', '16:9', '16:9', 1),
('veo3-fast', 'aspect_ratio', '9:16', '9:16', 2),
('veo3-fast', 'duration', '8', '8秒', 1),
('veo3-fast', 'resolution', '720p', '720p', 1),
('veo3-fast', 'resolution', '1080p', '1080p', 2)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Sora 2 规格（视频模型）
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('sora-2', 'aspect_ratio', '16:9', '16:9', 1),
('sora-2', 'aspect_ratio', '9:16', '9:16', 2),
('sora-2', 'duration', '5', '5秒', 1),
('sora-2', 'duration', '10', '10秒', 2),
('sora-2', 'resolution', '720p', '720p', 1),
('sora-2', 'resolution', '1080p', '1080p', 2)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Nano Banana 规格
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('nano-banana', 'aspect_ratio', '1:1', '1:1', 1),
('nano-banana', 'aspect_ratio', '3:4', '3:4', 2),
('nano-banana', 'aspect_ratio', '4:3', '4:3', 3),
('nano-banana', 'aspect_ratio', '9:16', '9:16', 4),
('nano-banana', 'aspect_ratio', '16:9', '16:9', 5),
('nano-banana', 'resolution', '1K', '1K', 1)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Nano Banana Fast 规格
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('nano-banana-fast', 'aspect_ratio', '1:1', '1:1', 1),
('nano-banana-fast', 'aspect_ratio', '3:4', '3:4', 2),
('nano-banana-fast', 'aspect_ratio', '4:3', '4:3', 3),
('nano-banana-fast', 'aspect_ratio', '9:16', '9:16', 4),
('nano-banana-fast', 'aspect_ratio', '16:9', '16:9', 5),
('nano-banana-fast', 'resolution', '1K', '1K', 1)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;

-- Nano Banana 2 规格
INSERT INTO model_spec_mapping (model_id, spec_type, spec_value, spec_label, sort_order) VALUES
('nano-banana-2', 'aspect_ratio', '1:1', '1:1', 1),
('nano-banana-2', 'aspect_ratio', '3:4', '3:4', 2),
('nano-banana-2', 'aspect_ratio', '4:3', '4:3', 3),
('nano-banana-2', 'aspect_ratio', '9:16', '9:16', 4),
('nano-banana-2', 'aspect_ratio', '16:9', '16:9', 5),
('nano-banana-2', 'resolution', '1K', '1K', 1),
('nano-banana-2', 'resolution', '2K', '2K', 2),
('nano-banana-2', 'resolution', '4K', '4K', 3)
ON CONFLICT (model_id, spec_type, spec_value) DO NOTHING;
