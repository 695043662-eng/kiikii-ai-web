import { getSupabaseClient } from '../src/storage/database/supabase-client';

async function checkFields() {
  const supabase = getSupabaseClient();
  
  // 查询一条记录的所有字段
  const { data, error } = await supabase
    .from('generation_records')
    .select('*')
    .limit(1);
  
  if (error) {
    console.log('Error:', error);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('数据库所有字段名:');
    Object.keys(data[0]).forEach(k => console.log('  -', k));
    console.log('\n参考图相关字段值:');
    console.log('  reference_images:', data[0].reference_images);
    console.log('  reference_image_urls:', (data[0] as any).reference_image_urls);
    console.log('  reference_image_md5s:', data[0].reference_image_md5s);
  } else {
    console.log('No records found');
  }
}

checkFields().catch(console.error);
