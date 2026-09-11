/**
 * 查询真实数据库中 GRS GPT-image 系列的现有配置（只读）
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env.local') });

import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log('❌ 缺少数据库环境变量');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  // 1. 查询 api_models 中所有 GPT-image / GRS 相关模型
  const { data: models, error: mErr } = await supabase
    .from('api_models')
    .select('id, config_id, model_id, model_name, description, parameters, credits_base, is_active, sort_order')
    .or('model_id.ilike.%gpt-image%,model_id.ilike.%banana%')
    .order('id', { ascending: true });

  if (mErr) { console.log('❌ api_models 查询失败:', mErr.message); process.exit(1); }

  console.log('===== api_models（GPT-image / Banana 系列）=====');
  for (const m of models || []) {
    console.log(JSON.stringify(m, null, 2));
  }

  // 2. 查询这些模型关联的 api_configs
  const configIds = Array.from(new Set((models || []).map((m: any) => m.config_id)));
  if (configIds.length > 0) {
    const { data: configs, error: cErr } = await supabase
      .from('api_configs')
      .select('id, name, service_type, description, api_endpoint, request_method, request_headers, request_body_template, response_parser, api_key, is_active, sort_order')
      .in('id', configIds);
    if (cErr) { console.log('❌ api_configs 查询失败:', cErr.message); process.exit(1); }
    console.log('\n===== api_configs（关联配置）=====');
    for (const c of configs || []) {
      const masked = { ...c };
      if (masked.api_key) masked.api_key = masked.api_key.substring(0, 12) + '...MASKED';
      console.log(JSON.stringify(masked, null, 2));
    }
  }

  // 3. 查询 model_spec_mapping 中 gpt-image 相关规格
  const { data: specs, error: sErr } = await supabase
    .from('model_spec_mapping')
    .select('id, model_id, spec_type, spec_value, spec_label, is_enabled, sort_order')
    .ilike('model_id', '%gpt-image%')
    .order('model_id', { ascending: true });

  if (!sErr && specs && specs.length > 0) {
    console.log('\n===== model_spec_mapping（gpt-image 规格）=====');
    let currentModel = '';
    for (const s of specs) {
      if (s.model_id !== currentModel) {
        currentModel = s.model_id;
        console.log(`\n--- ${s.model_id} ---`);
      }
      console.log(`  [${s.spec_type}] ${s.spec_value} (${s.spec_label}) enabled=${s.is_enabled} sort=${s.sort_order}`);
    }
  } else {
    console.log('\n===== model_spec_mapping: 无 gpt-image 数据或查询失败 =====');
    if (sErr) console.log('错误:', sErr.message);
  }
}

main().catch(console.error);
