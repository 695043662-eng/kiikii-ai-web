import { createClient } from '@supabase/supabase-js';

const client = createClient(
  'https://ozdlvxxoufkiazddvxys.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk'
);

// 使用 Supabase 内置的 SQL 执行函数（如果有的话）
// 尝试调用 pg_catalog
const response = await fetch('https://ozdlvxxoufkiazddvxys.supabase.co/rest/v1/', {
  method: 'POST',
  headers: {
    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk',
    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96ZGx2eHhvdWZraWF6ZGR2eHlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjYwMTk1MCwiZXhwIjoyMDkyMTc3OTUwfQ.IkglsGE7zNOxAtBHgS9bnGj9oapDz3UXLlpClXwIOwk',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: "ALTER TABLE generation_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'generate';" })
});
console.log('Response:', await response.text());
