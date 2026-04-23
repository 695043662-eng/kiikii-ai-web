const { createClient } = require('@supabase/supabase-js');

// 使用用户的 Supabase 账户配置
const supabase = createClient(
  'https://hrwoalchynrnwlcqdpxn.supabase.co',
  'sb_secret_SRglR1ze11sIVHzlOrnPcw_frrHRAOH',
  {
    db: {
      timeout: 60000,
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function restoreApiModels() {
  console.log('开始恢复 api_models 数据...');
  console.log('连接到:', 'https://hrwoalchynrnwlcqdpxn.supabase.co');

  try {
    // 1. 清空 api_models 表
    console.log('\n步骤 1: 清空 api_models 表...');
    const { error: deleteError } = await supabase
      .from('api_models')
      .delete()
      .neq('id', 0); // 删除所有记录

    if (deleteError) {
      console.error('删除失败:', deleteError);
      throw deleteError;
    }
    console.log('✅ api_models 表已清空');

    // 2. 从 model_credits_config 获取数据
    console.log('\n步骤 2: 从 model_credits_config 获取数据...');
    const { data: creditConfigs, error: fetchError } = await supabase
      .from('model_credits_config')
      .select('*')
      .eq('is_active', true)
      .order('id');

    if (fetchError) {
      console.error('获取配置失败:', fetchError);
      throw fetchError;
    }

    console.log(`✅ 获取到 ${creditConfigs.length} 个模型配置`);

    // 3. 转换并插入到 api_models
    console.log('\n步骤 3: 转换并插入数据...');
    const apiModelsData = creditConfigs.map((config) => {
      const configId = config.service_type === 'tool' ? 3
        : config.service_type === 'image_generation' ? 1
        : config.service_type === 'video_generation' ? 4
        : 1;

      let parameters = {};

      if (config.resolutions && Array.isArray(config.resolutions) && config.resolutions.length > 0) {
        const resolutions = config.resolutions.map((res) => ({
          label: res.label,
          value: res.value,
          credits: res.credits || res.credits_base || config.credits,
        }));
        parameters = { resolutions };
      } else {
        parameters = {
          resolutions: [{
            label: '1K',
            value: '1K',
            credits: config.credits
          }]
        };
      }

      return {
        model_id: config.model_key,
        model_name: config.model_name,
        description: config.description || '',
        config_id: configId,
        parameters,
        credits_base: config.credits,
        is_active: config.is_active,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    console.log('准备插入数据:', apiModelsData);

    const { error: insertError } = await supabase
      .from('api_models')
      .insert(apiModelsData);

    if (insertError) {
      console.error('插入失败:', insertError);
      throw insertError;
    }

    console.log(`✅ 成功插入 ${apiModelsData.length} 个模型`);

    // 4. 验证数据
    console.log('\n步骤 4: 验证数据...');
    const { data: verifiedData, error: verifyError } = await supabase
      .from('api_models')
      .select('id, model_id, model_name, config_id, credits_base, is_active')
      .order('id');

    if (verifyError) {
      console.error('验证失败:', verifyError);
      throw verifyError;
    }

    console.log('\n恢复后的数据：');
    console.table(verifiedData);

    console.log('\n✅ 恢复完成！');
  } catch (error) {
    console.error('恢复过程出错:', error);
    process.exit(1);
  }
}

// 执行恢复
restoreApiModels();
