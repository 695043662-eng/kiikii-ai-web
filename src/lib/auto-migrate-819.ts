/**
 * #819 展示区投稿 + 动态参数 自动迁移工具
 * 
 * 功能：
 * 1. 检查 model_spec_mapping 表是否存在，不存在则创建
 * 2. 检查 generation_records.extra_data 列是否存在，不存在则添加
 * 3. 插入初始种子数据（12个模型的规格映射）
 * 4. 所有操作幂等，可安全重复执行
 * 
 * 连接方式：pg 直连 Supabase PostgreSQL
 * - 优先使用 SUPABASE_DB_PASSWORD（直接密码）
 * - 回退使用 SUPABASE_SERVICE_ROLE_KEY + PostgREST（仅DML）
 * 
 * 限制：沙盒环境无 IPv6 出口，直连 Supabase db.* 域名失败
 *       此脚本在生产服务器（有IPv6）上自动执行
 */

import { Client } from 'pg';

// ====== DDL SQL: 建表 ======
const DDL_CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS model_spec_mapping (
  id SERIAL PRIMARY KEY,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'image',
  aspect_ratios TEXT[] DEFAULT '{}',
  resolutions TEXT[] DEFAULT '{}',
  durations INTEGER[] DEFAULT '{}',
  default_aspect_ratio TEXT DEFAULT '1:1',
  default_resolution TEXT DEFAULT '1024x1024',
  default_duration INTEGER DEFAULT 5,
  credits_per_generation INTEGER DEFAULT 10,
  video_pricing JSONB DEFAULT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_id)
);
`;

const DDL_CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_category ON model_spec_mapping(category);
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_is_active ON model_spec_mapping(is_active);
CREATE INDEX IF NOT EXISTS idx_model_spec_mapping_sort ON model_spec_mapping(sort_order);
`;

// ====== DDL SQL: RLS 策略 ======
const DDL_ENABLE_RLS = `
ALTER TABLE model_spec_mapping ENABLE ROW LEVEL SECURITY;
`;

const DDL_RLS_POLICIES = `
-- 允许所有人读取活跃的模型规格
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'model_spec_mapping_select_active'
  ) THEN
    CREATE POLICY model_spec_mapping_select_active ON model_spec_mapping
      FOR SELECT USING (is_active = true);
  END IF;
END $$;

-- 允许认证用户读取所有模型规格
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'model_spec_mapping_select_auth'
  ) THEN
    CREATE POLICY model_spec_mapping_select_auth ON model_spec_mapping
      FOR SELECT USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- 允许管理员完整操作
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'model_spec_mapping_admin_all'
  ) THEN
    CREATE POLICY model_spec_mapping_admin_all ON model_spec_mapping
      FOR ALL USING (auth.jwt() ->> 'role' = 'admin');
  END IF;
END $$;
`;

// ====== DDL SQL: generation_records.extra_data 列 ======
const DDL_ADD_EXTRA_DATA = `
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'generation_records' AND column_name = 'extra_data'
  ) THEN
    ALTER TABLE generation_records ADD COLUMN extra_data JSONB DEFAULT NULL;
    COMMENT ON COLUMN generation_records.extra_data IS '额外数据：投稿状态、审核信息等';
  END IF;
END $$;
`;

// ====== 种子数据（12个模型的规格映射）======
const SEED_DATA: Array<{
  model_id: string;
  display_name: string;
  category: string;
  aspect_ratios: string[];
  resolutions: string[];
  durations: number[];
  default_aspect_ratio: string;
  default_resolution: string;
  default_duration: number;
  credits_per_generation: number;
  video_pricing: Record<string, unknown> | null;
  sort_order: number;
}> = [
  {
    model_id: 'doubao-seed-1-6-vision-250815',
    display_name: '豆包 Seed 1.6',
    category: 'image',
    aspect_ratios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    resolutions: ['1024x1024', '768x1024', '1024x768', '576x1024', '1024x576'],
    durations: [],
    default_aspect_ratio: '1:1',
    default_resolution: '1024x1024',
    default_duration: 0,
    credits_per_generation: 10,
    video_pricing: null,
    sort_order: 1,
  },
  {
    model_id: 'gpt-image-2',
    display_name: 'GPT Image 2',
    category: 'image',
    aspect_ratios: ['auto', '1:1', '3:4', '4:3', '9:16', '16:9', '3:1', '1:3', '2:1', '1:2', '5:4', '4:5', '2:3', '3:2', '21:9', '9:21'],
    resolutions: ['1024x1024', '768x1024', '1024x768', '576x1024', '1024x576', '1024x341', '341x1024'],
    durations: [],
    default_aspect_ratio: '1:1',
    default_resolution: '1024x1024',
    default_duration: 0,
    credits_per_generation: 15,
    video_pricing: null,
    sort_order: 2,
  },
  {
    model_id: 'gpt-image-2-high',
    display_name: 'GPT Image 2 高清',
    category: 'image',
    aspect_ratios: ['auto', '1:1', '3:4', '4:3', '9:16', '16:9', '3:1', '1:3', '2:1', '1:2', '5:4', '4:5', '2:3', '3:2', '21:9', '9:21'],
    resolutions: ['1024x1024', '768x1024', '1024x768', '576x1024', '1024x576', '1024x341', '341x1024'],
    durations: [],
    default_aspect_ratio: '1:1',
    default_resolution: '1024x1024',
    default_duration: 0,
    credits_per_generation: 30,
    video_pricing: null,
    sort_order: 3,
  },
  {
    model_id: 'gpt-image-2-vip',
    display_name: 'GPT Image 2 VIP',
    category: 'image',
    aspect_ratios: ['auto', '1:1', '3:4', '4:3', '9:16', '16:9', '3:1', '1:3', '2:1', '1:2', '5:4', '4:5', '2:3', '3:2', '21:9', '9:21'],
    resolutions: ['1024x1024', '768x1024', '1024x768', '576x1024', '1024x576', '1024x341', '341x1024'],
    durations: [],
    default_aspect_ratio: '1:1',
    default_resolution: '1024x1024',
    default_duration: 0,
    credits_per_generation: 18,
    video_pricing: null,
    sort_order: 4,
  },
  {
    model_id: 't8star-banana',
    display_name: 'Banana',
    category: 'image',
    aspect_ratios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    resolutions: ['1024x1024', '768x1024', '1024x768', '576x1024', '1024x576'],
    durations: [],
    default_aspect_ratio: '1:1',
    default_resolution: '1024x1024',
    default_duration: 0,
    credits_per_generation: 8,
    video_pricing: null,
    sort_order: 4,
  },
  {
    model_id: 'flux-pro-v1.1',
    display_name: 'Flux Pro 1.1',
    category: 'image',
    aspect_ratios: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    resolutions: ['1024x1024', '768x1024', '1024x768', '576x1024', '1024x576'],
    durations: [],
    default_aspect_ratio: '1:1',
    default_resolution: '1024x1024',
    default_duration: 0,
    credits_per_generation: 10,
    video_pricing: null,
    sort_order: 5,
  },
  {
    model_id: 'sora-2-all-vip',
    display_name: 'Sora 2 VIP',
    category: 'video',
    aspect_ratios: ['16:9', '9:16', '1:1'],
    resolutions: ['720p', '1080p'],
    durations: [5, 10, 15, 20],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 5,
    credits_per_generation: 0,
    video_pricing: { mode: 'dynamic', base720p5s: 50, perSecond720p: 8, perSecond1080p: 15 },
    sort_order: 10,
  },
  {
    model_id: 'topais-veo3',
    display_name: 'Veo 3',
    category: 'video',
    aspect_ratios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p', '4k'],
    durations: [8],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 8,
    credits_per_generation: 80,
    video_pricing: null,
    sort_order: 11,
  },
  {
    model_id: 'topais-veo3-fast',
    display_name: 'Veo 3 Fast',
    category: 'video',
    aspect_ratios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    durations: [8],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 8,
    credits_per_generation: 40,
    video_pricing: null,
    sort_order: 12,
  },
  {
    model_id: 'topais-seedance-2.0',
    display_name: 'Seedance 2.0',
    category: 'video',
    aspect_ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolutions: ['720p', '1080p'],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 5,
    credits_per_generation: 0,
    video_pricing: { mode: 'dynamic', base720p: 30, perSecond720p: 5, perSecond1080p: 10 },
    sort_order: 13,
  },
  {
    model_id: 'topais-seedance-2.0-fast',
    display_name: 'Seedance 2.0 Fast',
    category: 'video',
    aspect_ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolutions: ['720p', '1080p'],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 5,
    credits_per_generation: 0,
    video_pricing: { mode: 'dynamic', base720p: 20, perSecond720p: 3, perSecond1080p: 7 },
    sort_order: 14,
  },
  {
    model_id: 'topais-happyhorse-1.1',
    display_name: 'HappyHorse 1.1',
    category: 'video',
    aspect_ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    resolutions: ['720p', '1080p'],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 5,
    credits_per_generation: 0,
    video_pricing: { mode: 'dynamic', base720p: 25, perSecond720p: 4, perSecond1080p: 8 },
    sort_order: 15,
  },
  {
    model_id: 'topais-gemini-omni-flash',
    display_name: 'Gemini Omni Flash',
    category: 'video',
    aspect_ratios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    durations: [4, 6, 10],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 6,
    credits_per_generation: 0,
    video_pricing: { mode: 'dynamic', base720p: 15, perSecond720p: 3, perSecond1080p: 6 },
    sort_order: 17,
  },
  {
    model_id: 'lingya-veo3.1',
    display_name: '灵芽 Veo 3.1',
    category: 'video',
    aspect_ratios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
    durations: [8],
    default_aspect_ratio: '16:9',
    default_resolution: '720p',
    default_duration: 8,
    credits_per_generation: 60,
    video_pricing: null,
    sort_order: 16,
  },
];

// ====== 构建连接字符串 ======
function buildConnectionString(): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (!supabaseUrl || !dbPassword) {
    console.log('[Migration] 缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_DB_PASSWORD，跳过直连迁移');
    return null;
  }

  // 从 SUPABASE_URL 提取 project ref
  // https://ozdlvxxoufkiazddvxys.supabase.co -> ozdlvxxoufkiazddvxys
  const match = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (!match) {
    console.log('[Migration] 无法从 SUPABASE_URL 提取 project ref:', supabaseUrl);
    return null;
  }
  const ref = match[1];

  // 直接连接格式：db.{ref}.supabase.co:5432
  return `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${ref}.supabase.co:5432/postgres`;
}

// ====== 执行迁移 ======
export async function runMigration(): Promise<{ success: boolean; message: string; details: string[] }> {
  const details: string[] = [];
  
  const connStr = buildConnectionString();
  if (!connStr) {
    return {
      success: false,
      message: '缺少数据库连接配置（SUPABASE_DB_PASSWORD），跳过自动迁移',
      details: ['需要在 .env.local 中设置 SUPABASE_DB_PASSWORD'],
    };
  }

  let client: Client | null = null;
  try {
    console.log('[Migration] 尝试连接 Supabase 数据库...');
    client = new Client({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });

    await client.connect();
    details.push('数据库连接成功');
    console.log('[Migration] 数据库连接成功');

    // Step 1: 创建 model_spec_mapping 表
    console.log('[Migration] Step 1: 创建 model_spec_mapping 表...');
    await client.query(DDL_CREATE_TABLE);
    details.push('model_spec_mapping 表已创建/已存在');

    // Step 2: 创建索引
    console.log('[Migration] Step 2: 创建索引...');
    await client.query(DDL_CREATE_INDEXES);
    details.push('索引已创建');

    // Step 3: 启用 RLS
    console.log('[Migration] Step 3: 启用 RLS...');
    try {
      await client.query(DDL_ENABLE_RLS);
      details.push('RLS 已启用');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already enabled')) {
        details.push('RLS 已启用（之前已开启）');
      } else {
        details.push(`RLS: ${msg.substring(0, 100)}`);
      }
    }

    // Step 4: 创建 RLS 策略
    console.log('[Migration] Step 4: 创建 RLS 策略...');
    try {
      await client.query(DDL_RLS_POLICIES);
      details.push('RLS 策略已创建');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`RLS策略: ${msg.substring(0, 100)}`);
    }

    // Step 5: 添加 extra_data 列
    console.log('[Migration] Step 5: 添加 generation_records.extra_data 列...');
    try {
      await client.query(DDL_ADD_EXTRA_DATA);
      details.push('extra_data 列已添加/已存在');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      details.push(`extra_data: ${msg.substring(0, 100)}`);
    }

    // Step 6: 插入种子数据（幂等：ON CONFLICT DO UPDATE）
    console.log('[Migration] Step 6: 插入种子数据...');
    let insertedCount = 0;
    let updatedCount = 0;

    for (const row of SEED_DATA) {
      const result = await client.query(`
        INSERT INTO model_spec_mapping (
          model_id, display_name, category, aspect_ratios, resolutions, durations,
          default_aspect_ratio, default_resolution, default_duration,
          credits_per_generation, video_pricing, sort_order, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true)
        ON CONFLICT (model_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          category = EXCLUDED.category,
          aspect_ratios = EXCLUDED.aspect_ratios,
          resolutions = EXCLUDED.resolutions,
          durations = EXCLUDED.durations,
          default_aspect_ratio = EXCLUDED.default_aspect_ratio,
          default_resolution = EXCLUDED.default_resolution,
          default_duration = EXCLUDED.default_duration,
          credits_per_generation = EXCLUDED.credits_per_generation,
          video_pricing = EXCLUDED.video_pricing,
          sort_order = EXCLUDED.sort_order,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted
      `, [
        row.model_id, row.display_name, row.category,
        row.aspect_ratios, row.resolutions, row.durations,
        row.default_aspect_ratio, row.default_resolution, row.default_duration,
        row.credits_per_generation, JSON.stringify(row.video_pricing), row.sort_order,
      ]);

      if (result.rows[0]?.inserted) {
        insertedCount++;
      } else {
        updatedCount++;
      }
    }
    details.push(`种子数据: ${insertedCount} 条新增, ${updatedCount} 条更新`);

    // 验证
    const countResult = await client.query('SELECT COUNT(*) as cnt FROM model_spec_mapping');
    details.push(`验证: model_spec_mapping 共 ${countResult.rows[0].cnt} 条记录`);


    // ====== 补充迁移：确保 gpt-image-2 / gpt-image-2-vip 的 parameters 包含 qualityOptions ======
    try {
      const qualityOptionsValue = JSON.stringify(['auto', 'low', 'medium', 'high']);
      for (const modelId of ['gpt-image-2', 'gpt-image-2-vip']) {
        const modelResult = await client.query(
          `SELECT model_id, parameters FROM api_models WHERE model_id = $1`,
          [modelId]
        );
        if (modelResult.rows.length > 0) {
          const params = modelResult.rows[0].parameters || {};
          if (!params.qualityOptions) {
            params.qualityOptions = ['auto', 'low', 'medium', 'high'];
            await client.query(
              `UPDATE api_models SET parameters = $1, updated_at = NOW() WHERE model_id = $2`,
              [JSON.stringify(params), modelId]
            );
            details.push(`${modelId} parameters 已添加 qualityOptions`);
            console.log(`[Migration] ${modelId} 已添加 qualityOptions`);
          }
        }
      }
    } catch (qualityErr) {
      const errMsg = qualityErr instanceof Error ? qualityErr.message : String(qualityErr);
      details.push(`qualityOptions 迁移跳过: ${errMsg.substring(0, 100)}`);
    }

    // ====== 补充迁移：api_models 模型同步 ======
    // 1. topais-happyhorse-1.0 → topais-happyhorse-1.1（版本升级）
    // 2. 禁用旧 happyhorse-1.0（LingYa 通道已废弃）
    // 3. 添加 topais-gemini-omni-flash（如果不存在）
    try {
      console.log('[Migration] Step 7: 同步 api_models 模型...');

      // 1. 升级 topais-happyhorse-1.0 → topais-happyhorse-1.1
      const hhUpdateResult = await client.query(
        `UPDATE api_models SET model_id = 'topais-happyhorse-1.1', model_name = 'HappyHorse 1.1', updated_at = NOW() WHERE model_id = 'topais-happyhorse-1.0'`
      );
      if (hhUpdateResult.rowCount && hhUpdateResult.rowCount > 0) {
        details.push('topais-happyhorse-1.0 → topais-happyhorse-1.1 升级完成');
        console.log('[Migration] topais-happyhorse 升级完成');
      }

      // 2. 禁用旧 happyhorse-1.0（LingYa）
      const hhDisableResult = await client.query(
        `UPDATE api_models SET is_active = false, is_visible = false, updated_at = NOW() WHERE model_id = 'happyhorse-1.0' AND is_visible = true`
      );
      if (hhDisableResult.rowCount && hhDisableResult.rowCount > 0) {
        details.push('happyhorse-1.0 (LingYa) 已禁用');
        console.log('[Migration] happyhorse-1.0 已禁用');
      }

      // 3. 添加 topais-gemini-omni-flash（如果不存在）
      const geminiCheck = await client.query(
        `SELECT model_id FROM api_models WHERE model_id = 'topais-gemini-omni-flash'`
      );
      if (geminiCheck.rows.length === 0) {
        // 查找 TOPAIS Veo3.1 的 config_id 作为 Gemini Omni 的归属配置
        const topaisConfig = await client.query(
          `SELECT id FROM api_configs WHERE name LIKE '%TOPAIS%' AND service_type = 'video_generation' LIMIT 1`
        );
        const topaisConfigId = topaisConfig.rows[0]?.id || 28;
        await client.query(
          `INSERT INTO api_models (model_id, model_name, description, is_active, is_visible, sort_order, config_id, parameters, credits_base)
           VALUES ('topais-gemini-omni-flash', 'Gemini Omni Flash', 'Google Gemini Omni Flash 视频生成', true, true, 52, $1,
             '{"aspectRatios":[{"label":"16:9","value":"16:9"},{"label":"9:16","value":"9:16"}],"resolutions":[{"label":"720P","value":"720P","credits":50},{"label":"1080P","value":"1080p","credits":80}],"durations":[{"label":"4秒","value":"4","credits":0},{"label":"6秒","value":"6","credits":0},{"label":"10秒","value":"10","credits":0}],"maxImages":3,"imageMode":"flexible","supportsDuration":true,"showDuration":true,"showResolution":true}',
             15)`,
          [topaisConfigId]
        );
        details.push('topais-gemini-omni-flash 已添加');
        console.log('[Migration] topais-gemini-omni-flash 已添加');
      } else {
        details.push('topais-gemini-omni-flash 已存在');
      }
    } catch (modelSyncErr) {
      const errMsg = modelSyncErr instanceof Error ? modelSyncErr.message : String(modelSyncErr);
      details.push(`模型同步跳过: ${errMsg.substring(0, 100)}`);
      console.log('[Migration] 模型同步跳过:', errMsg.substring(0, 100));
    }

    console.log('[Migration] 迁移完成!', details.join(' | '));

    return {
      success: true,
      message: '#819 迁移成功完成',
      details,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Migration] 迁移失败:', msg);
    details.push(`错误: ${msg.substring(0, 200)}`);
    return {
      success: false,
      message: `#819 迁移失败: ${msg.substring(0, 100)}`,
      details,
    };
  } finally {
    if (client) {
      try { await client.end(); } catch (_) { /* ignore */ }
    }
  }
}

// ====== 检查迁移是否需要执行 ======
export async function checkMigrationNeeded(): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const dbPassword = process.env.SUPABASE_DB_PASSWORD;

  if (!supabaseUrl || !dbPassword) {
    console.log('[Migration] 缺少数据库密码配置，跳过迁移检查');
    return false;
  }

  const connStr = buildConnectionString();
  if (!connStr) return false;

  let client: Client | null = null;
  try {
    client = new Client({
      connectionString: connStr,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000,
    });
    await client.connect();

    // 检查 model_spec_mapping 表是否存在
    const tableCheck = await client.query(
      "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = 'model_spec_mapping'"
    );

    if (Number(tableCheck.rows[0].cnt) > 0) {
      // 表已存在，检查数据量
      const dataCheck = await client.query('SELECT COUNT(*) as cnt FROM model_spec_mapping');
      if (Number(dataCheck.rows[0].cnt) > 0) {
        console.log('[Migration] model_spec_mapping 已存在且有数据，跳过迁移');
        return false;
      }
    }

    console.log('[Migration] model_spec_mapping 不存在或无数据，需要执行迁移');
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('[Migration] 检查迁移状态失败（可能是IPv6限制）:', msg.substring(0, 100));
    return false; // 无法连接时不执行迁移，避免阻塞启动
  } finally {
    if (client) {
      try { await client.end(); } catch (_) { /* ignore */ }
    }
  }
}
