-- 添加 last_login_at 字段到 users 表
-- 请在 Supabase Dashboard → SQL Editor 中执行
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 更新所有没有头像的用户，设置默认头像
UPDATE users SET avatar = 'https://kiikii-ai-1412916018.cos.ap-hongkong.myqcloud.com/dev/avatars/default-avatar.png' WHERE avatar IS NULL OR avatar = '';

-- 验证结果
SELECT id, phone, avatar, last_login_at FROM users LIMIT 5;
