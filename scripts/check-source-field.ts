import { getSupabaseClient } from '../src/storage/database/supabase-client';

async function checkSource() {
  const supabase = getSupabaseClient();
  
  // 先检查总数
  const { count, error: countError } = await supabase
    .from('generation_records')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total records in DB: ${count}`);
  if (countError) console.log('Count error:', countError);
  
  // 再获取最近记录
  const { data, error } = await supabase
    .from('generation_records')
    .select('id, source, prompt')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.log('Error:', error);
    return;
  }
  
  console.log('Recent records with source:');
  if (!data || data.length === 0) {
    console.log('  (no records found)');
    return;
  }
  data.forEach(r => {
    const promptPreview = r.prompt?.substring(0, 30) || '(no prompt)';
    console.log(`  ID: ${r.id}, source: '${r.source}', prompt: ${promptPreview}...`);
  });
  console.log(`Total: ${data.length} records`);
}

checkSource().catch(console.error);
