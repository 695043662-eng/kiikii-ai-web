import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

async function checkMd5sData() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  console.log('查询 generation_records 表中 reference_image_md5s 的值...\n');
  
  // 查询有参考图的记录
  const { data, error } = await supabase
    .from('generation_records')
    .select('id, prompt, reference_images, reference_image_md5s')
    .not('reference_images', 'is', null)
    .limit(10);
  
  if (error) {
    console.log('查询错误：', error.message);
    return;
  }
  
  if (!data || data.length === 0) {
    console.log('没有找到有参考图的记录');
    return;
  }
  
  console.log(`找到 ${data.length} 条有参考图的记录：\n`);
  
  data.forEach((record, idx) => {
    console.log(`--- 记录 ${idx + 1} ---`);
    console.log(`  ID: ${record.id}`);
    console.log(`  Prompt: ${record.prompt?.substring(0, 50)}...`);
    console.log(`  reference_images: ${record.reference_images?.length || 0} 张`);
    console.log(`  reference_image_md5s: ${JSON.stringify(record.reference_image_md5s)}`);
    console.log('');
  });
}

checkMd5sData().catch(console.error);
