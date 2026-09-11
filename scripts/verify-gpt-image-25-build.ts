/**
 * #894 GPT-Image-2.5 系列 buildRequest 验证脚本
 *
 * 关键认知：buildRequest(config, variables) 中
 *   - reqRatio  = variables.aspectRatio（如 '16:9'）
 *   - reqQuality = variables.resolution（分辨率档位 '1K'/'2K'/'4K'，并非画质 quality）
 *   - gpt-image-2.5      → GPT_IMAGE_2_1K_MAP（强制 1K，与 2.0 普通款一致）
 *   - flare/sunburst     → GPT_IMAGE_2_VIP_MAP（全画质，与 2.0-vip 一致）
 *   - 2.5 普通款 quality 强制 auto；flare 白名单 [low,medium,high]；sunburst 白名单 [low..max]
 */
import { buildRequest, ApiConfigFull } from '../src/lib/api-config';

const MOCK_CONFIG_BASE = {
  id: 34,
  name: 'GRS GPT-Image-2.5 (新API)',
  apiEndpoint: 'https://grsai.dakka.com.cn/v1/api/generate',
  requestMethod: 'POST',
  requestHeaders: { 'Content-Type': 'application/json', Authorization: 'Bearer ${apiKey}' },
  requestBodyTemplate: {
    model: '${model}',
    prompt: '${prompt}',
    images: '${images}',
    aspectRatio: '${aspectRatio}',
    quality: '${quality}',
    replyType: 'json',
  },
  apiKey: 'sk-test',
  isActive: true,
  serviceType: 'image_generation',
};

function makeConfig(modelId: string, template?: Record<string, unknown>) {
  return {
    ...MOCK_CONFIG_BASE,
    modelId,
    requestBodyTemplate: template ?? MOCK_CONFIG_BASE.requestBodyTemplate,
  } as unknown as ApiConfigFull;
}

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}`);
  if (!ok) {
    console.log('   期望:', JSON.stringify(expected));
    console.log('   实际:', JSON.stringify(actual));
  }
}

async function main() {
  // ===== 1. 2.0-vip 回归（证明原版逻辑 + 新分支不破坏旧模型）=====
  {
    const cfg = makeConfig('gpt-image-2-vip');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '9:16', resolution: '4K', quality: 'auto' });
    check('2.0-vip 9:16 + 4K → 2160x3840（回归）', r.body.aspectRatio, '2160x3840');
  }
  {
    const cfg = makeConfig('t8star.gpt-image-2');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '1:1', resolution: '2K', quality: 'auto' });
    check('t8star 1:1 + 2K → 2048x2048（回归）', r.body.aspectRatio, '2048x2048');
  }

  // ===== 2. gpt-image-2.5 普通款：强制 1K（与 2.0 普通款一致）=====
  {
    const cfg = makeConfig('gpt-image-2.5');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '16:9', resolution: '2K', quality: 'auto' });
    check('2.5 16:9 → 1K 强制 1280x720', r.body.aspectRatio, '1280x720');
  }

  // ===== 3. flare：VIP 映射 + quality 白名单 =====
  {
    const cfg = makeConfig('gpt-image-2.5-flare');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '16:9', resolution: '2K', quality: 'medium' });
    check('flare 16:9 + 2K → 2560x1440', r.body.aspectRatio, '2560x1440');
  }
  {
    const cfg = makeConfig('gpt-image-2.5-flare');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '9:16', resolution: '4K', quality: 'low' });
    check('flare 9:16 + 4K → 2160x3840', r.body.aspectRatio, '2160x3840');
  }
  {
    const cfg = makeConfig('gpt-image-2.5-flare');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '1:1', resolution: '1K', quality: 'xhigh' });
    check('flare xhigh（非法）→ 纠偏为 medium', r.body.quality, 'medium');
  }
  {
    const cfg = makeConfig('gpt-image-2.5-flare');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '1:1', resolution: '1K', quality: 'high' });
    check('flare high（合法）→ 透传', r.body.quality, 'high');
  }

  // ===== 4. sunburst：VIP 映射 + 五档 quality =====
  {
    const cfg = makeConfig('gpt-image-2.5-sunburst');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '16:9', resolution: '4K', quality: 'xhigh' });
    check('sunburst 16:9 + 4K + xhigh → 3840x2160', r.body.aspectRatio, '3840x2160');
  }
  {
    const cfg = makeConfig('gpt-image-2.5-sunburst');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '9:16', resolution: '4K', quality: 'max' });
    check('sunburst 9:16 + 4K + max → 2160x3840', r.body.aspectRatio, '2160x3840');
  }
  {
    const cfg = makeConfig('gpt-image-2.5-sunburst');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '1:1', resolution: '1K', quality: 'auto' });
    check('sunburst auto（非法）→ 纠偏为 medium', r.body.quality, 'medium');
  }
  {
    const cfg = makeConfig('gpt-image-2.5-sunburst');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '1:1', resolution: '1K', quality: 'max' });
    check('sunburst max（合法）→ 透传', r.body.quality, 'max');
  }

  // ===== 5. 2.5 普通款 quality 强制 auto =====
  {
    const cfg = makeConfig('gpt-image-2.5');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: '1:1', resolution: '1K', quality: 'high' });
    check('2.5 quality 强制 auto', r.body.quality, 'auto');
  }

  // ===== 6. auto 比例透传 =====
  {
    const cfg = makeConfig('gpt-image-2.5');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: 'auto', resolution: '1K', quality: 'auto' });
    check('2.5 auto 比例透传', r.body.aspectRatio, 'auto');
  }
  {
    const cfg = makeConfig('gpt-image-2.5-sunburst');
    const r = await buildRequest(cfg, { prompt: 't', aspectRatio: 'auto', resolution: '1K', quality: 'medium' });
    check('sunburst auto 比例透传', r.body.aspectRatio, 'auto');
  }

  // ===== 7. 模板字段完整性 =====
  {
    const cfg = makeConfig('gpt-image-2.5-flare');
    const r = await buildRequest(cfg, { prompt: '画一只猫', images: ['https://x.com/a.png'], aspectRatio: '1:1', resolution: '1K', quality: 'medium' });
    check('flare 模板 model 字段', r.body.model, 'gpt-image-2.5-flare');
    check('flare 模板 images 字段', JSON.stringify(r.body.images), '["https://x.com/a.png"]');
    check('flare 模板 replyType 字段', r.body.replyType, 'json');
    check('flare Authorization 头', r.headers.Authorization, 'Bearer sk-test');
  }

  console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error('❌ 脚本异常:', e); process.exit(1); });
