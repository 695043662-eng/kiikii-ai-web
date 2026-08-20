/**
 * 添加 is_visible 字段到 api_models 和 api_configs 表
 * 
 * 由于沙箱环境限制，无法直接连接数据库执行 DDL
 * 需要在 Supabase 控制台手动执行 SQL
 * 
 * 执行地址: https://supabase.com/dashboard/project/ozdlvxxoufkiazddvxys/sql/new
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

console.log('========================================');
console.log('添加 is_visible 字段');
console.log('========================================\n');

console.log('❌ 沙箱环境无法直接连接数据库执行 DDL\n');

console.log('请在 Supabase 控制台手动执行以下 SQL：');
console.log('========================================');
console.log(`
-- 添加 is_visible 字段到 api_models 表
ALTER TABLE api_models ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- 添加 is_visible 字段到 api_configs 表
ALTER TABLE api_configs ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- 更新现有记录的默认值
UPDATE api_models SET is_visible = TRUE WHERE is_visible IS NULL;
UPDATE api_configs SET is_visible = TRUE WHERE is_visible IS NULL;
`);
console.log('========================================');
console.log('\n控制台地址: https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
console.log('\n执行完成后，管理后台的"展示"按钮就能正常工作了。');
