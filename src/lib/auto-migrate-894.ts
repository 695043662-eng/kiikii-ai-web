/**
 * #894 数据库自动迁移：GRS GPT-Image-2.5 系列三模型接入
 *
 * 新增内容：
 *   1. api_configs: "GRS GPT-Image-2.5 (新API)"  → https://grsai.dakka.com.cn/v1/api/generate（文档新接口）
 *   2. api_models:
 *      - gpt-image-2.5           （对标 gpt-image-2：1K/10积分，quality 仅 auto）
 *      - gpt-image-2.5-flare     （对标 gpt-image-2-vip：1K/2K/4K，quality low/medium/high）
 *      - gpt-image-2.5-sunburst  （对标 gpt-image-2-vip：1K/2K/4K，quality low/medium/high/xhigh/max）
 *
 * 关键差异（相对 2.0）：
 *   - 新接口 /v1/api/generate，请求体: model/prompt/images/aspectRatio/quality/replyType
 *   - flare/sunburst 不支持比例字符串，仅像素值（buildRequest 已复用 GPT_IMAGE_2_VIP_MAP）
 *   - 2.5 普通 quality 仅 auto；sunburst 额外支持 xhigh/max
 *
 * 幂等性：按 name/model_id 查重，重复执行安全。
 * 双端：优先 PostgREST（沙盒/生产均可，IPv4 友好）。
 */

// 加载 .env.local（不覆盖已注入的环境变量）
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ path: '.env.local', override: false });
} catch {
  // dotenv 不可用时静默跳过（依赖已注入的环境变量）
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ 缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const restHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

const NEW_CONFIG_NAME = 'GRS GPT-Image-2.5 (新API)';

/** 2.5 普通款与 2.0 普通款同款比例表（16 种 + auto） */
const ASPECT_RATIOS_COMMON = [
  { label: '自动', value: 'auto' },
  { label: '1:1', value: '1:1' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '5:4', value: '5:4' },
  { label: '4:5', value: '4:5' },
  { label: '21:9', value: '21:9' },
  { label: '9:21', value: '9:21' },
  { label: '3:1', value: '3:1' },
  { label: '1:3', value: '1:3' },
  { label: '2:1', value: '2:1' },
  { label: '1:2', value: '1:2' },
];

const NEW_MODELS = [
  {
    model_id: 'gpt-image-2.5',
    model_name: 'GPT Image 2.5',
    description: 'OpenAI GPT Image 2.5（仅 1K）',
    sort_order: 0,
    credits_base: 10,
    parameters: {
      provider: 'GRS',
      resolutions: [{ label: '1K', value: '1K', credits: 10 }],
      aspectRatios: ASPECT_RATIOS_COMMON,
      qualityOptions: [{ label: '自动', value: 'auto' }],
      defaultResolution: '1K',
      defaultAspectRatio: 'auto',
      defaultQuality: 'auto',
    },
  },
  {
    model_id: 'gpt-image-2.5-flare',
    model_name: 'GPT Image 2.5 Flare',
    description: 'OpenAI GPT Image 2.5 Flare（1K-4K）',
    sort_order: 1,
    credits_base: 15,
    parameters: {
      provider: 'GRS',
      resolutions: [
        { label: '1K', value: '1K', credits: 15 },
        { label: '2K', value: '2K', credits: 17 },
        { label: '4K', value: '4K', credits: 18 },
      ],
      aspectRatios: ASPECT_RATIOS_COMMON,
      qualityOptions: [
        { label: '速度', value: 'low' },
        { label: '中等', value: 'medium' },
        { label: '高清', value: 'high' },
      ],
      defaultResolution: '1K',
      defaultAspectRatio: 'auto',
      defaultQuality: 'medium',
    },
  },
  {
    model_id: 'gpt-image-2.5-sunburst',
    model_name: 'GPT Image 2.5 Sunburst',
    description: 'OpenAI GPT Image 2.5 Sunburst（1K-4K 旗舰画质）',
    sort_order: 2,
    credits_base: 15,
    parameters: {
      provider: 'GRS',
      resolutions: [
        { label: '1K', value: '1K', credits: 15 },
        { label: '2K', value: '2K', credits: 17 },
        { label: '4K', value: '4K', credits: 18 },
      ],
      aspectRatios: ASPECT_RATIOS_COMMON,
      qualityOptions: [
        { label: '速度', value: 'low' },
        { label: '中等', value: 'medium' },
        { label: '高清', value: 'high' },
        { label: '超高', value: 'xhigh' },
        { label: '极限', value: 'max' },
      ],
      defaultResolution: '1K',
      defaultAspectRatio: 'auto',
      defaultQuality: 'medium',
    },
  },
];

async function findConfig(): Promise<any | null> {
  // 注意：括号必须编码，encodeURIComponent 不编码 ( )，必须用 URLSearchParams
  const qs = new URLSearchParams({ name: `eq.${NEW_CONFIG_NAME}`, select: '*' });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/api_configs?${qs.toString()}`, {
    headers: restHeaders,
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

async function createConfig(): Promise<any> {
  // 复用 GRS 既有密钥（从旧版 gpt-image-2 config 读取）
  const keyRes = await fetch(`${SUPABASE_URL}/rest/v1/api_configs?id=eq.22&select=api_key`, {
    headers: restHeaders,
  });
  const keyRows = await keyRes.json();
  const grsApiKey = keyRows?.[0]?.api_key || '';

  const payload = {
    name: NEW_CONFIG_NAME,
    service_type: 'image_generation',
    api_endpoint: 'https://grsai.dakka.com.cn/v1/api/generate',
    request_method: 'POST',
    request_headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ${apiKey}',
    },
    request_body_template: {
      model: '${model}',
      prompt: '${prompt}',
      images: '${images}',
      aspectRatio: '${aspectRatio}',
      quality: '${quality}',
      replyType: 'json',
    },
    api_key: grsApiKey,
    is_active: true,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/api_configs`, {
    method: 'POST',
    headers: { ...restHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  });
  const rows = await res.json();
  if (!res.ok) {
    throw new Error(`创建 api_configs 失败: ${JSON.stringify(rows)}`);
  }
  console.log(`✅ 新建 api_config: ${NEW_CONFIG_NAME} (id=${rows[0].id})`);
  return rows[0];
}

async function findModel(modelId: string): Promise<any | null> {
  const qs = new URLSearchParams({ model_id: `eq.${modelId}`, select: '*' });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/api_models?${qs.toString()}`, {
    headers: restHeaders,
  });
  const rows = await res.json();
  return rows && rows.length > 0 ? rows[0] : null;
}

async function upsertModel(configId: number, m: (typeof NEW_MODELS)[number]): Promise<void> {
  const existing = await findModel(m.model_id);
  const payload = {
    model_id: m.model_id,
    model_name: m.model_name,
    description: m.description,
    config_id: configId,
    is_active: true,
    is_visible: true,
    sort_order: m.sort_order,
    credits_base: m.credits_base,
    parameters: m.parameters,
  };

  if (existing) {
    const qsDel = new URLSearchParams({ model_id: `eq.${m.model_id}` });
    const res = await fetch(`${SUPABASE_URL}/rest/v1/api_models?${qsDel.toString()}`, {
      method: 'PATCH',
      headers: restHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`更新 api_models ${m.model_id} 失败: ${await res.text()}`);
    }
    console.log(`♻️  更新 api_model: ${m.model_id} (config_id=${configId})`);
  } else {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/api_models`, {
      method: 'POST',
      headers: { ...restHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`插入 api_models ${m.model_id} 失败: ${await res.text()}`);
    }
    console.log(`✅ 新建 api_model: ${m.model_id} (config_id=${configId})`);
  }
}

export async function runAutoMigrate894(): Promise<{ success: boolean; configId?: number; models?: string[] }> {
  try {
    console.log('[auto-migrate-894] 开始执行 GRS GPT-Image-2.5 系列迁移');

    let config = await findConfig();
    if (!config) {
      config = await createConfig();
    } else {
      console.log(`♻️  api_config 已存在: ${NEW_CONFIG_NAME} (id=${config.id})`);
      // 幂等修复：确保端点/模板/请求头与最新配置一致
      const res = await fetch(`${SUPABASE_URL}/rest/v1/api_configs?id=eq.${config.id}`, {
        method: 'PATCH',
        headers: restHeaders,
        body: JSON.stringify({
          api_endpoint: 'https://grsai.dakka.com.cn/v1/api/generate',
          request_headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ${apiKey}',
          },
          request_body_template: {
            model: '${model}',
            prompt: '${prompt}',
            images: '${images}',
            aspectRatio: '${aspectRatio}',
            quality: '${quality}',
            replyType: 'json',
          },
          is_active: true,
        }),
      });
      if (!res.ok) {
        throw new Error(`修复 api_config 失败: ${await res.text()}`);
      }
    }

    for (const m of NEW_MODELS) {
      await upsertModel(config.id, m);
    }

    console.log('[auto-migrate-894] 迁移完成');
    return {
      success: true,
      configId: config.id,
      models: NEW_MODELS.map((m) => m.model_id),
    };
  } catch (err) {
    console.error('[auto-migrate-894] 迁移失败:', err);
    return { success: false };
  }
}

// 直接执行
if (require.main === module) {
  runAutoMigrate894()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.success ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
