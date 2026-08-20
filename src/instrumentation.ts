/**
 * Next.js Instrumentation Hook
 * 
 * 在 Next.js 服务器启动时自动执行，用于：
 * - #819 展示区投稿 + 动态参数 自动迁移
 * - #821 展示区+轮播图 种子数据自动初始化
 * 
 * 注意：此文件在 Node.js 服务器端执行，不在浏览器中运行
 * 迁移失败不会阻塞服务器启动
 */
export async function register() {
  // 仅在 Node.js 服务器端执行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] 服务器启动，检查自动迁移...');

    // #819 迁移
    try {
      const { checkMigrationNeeded, runMigration } = await import('./lib/auto-migrate-819');

      const needed = await checkMigrationNeeded();
      if (needed) {
        console.log('[Instrumentation] 检测到需要执行 #819 迁移，开始执行...');
        const result = await runMigration();
        if (result.success) {
          console.log('[Instrumentation] #819 迁移成功:', result.message);
        } else {
          console.warn('[Instrumentation] #819 迁移失败（不阻塞启动）:', result.message);
        }
      } else {
        console.log('[Instrumentation] #819 迁移检查通过，无需执行');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[Instrumentation] 自动迁移异常（不阻塞启动）:', msg.substring(0, 200));
    }

    // #821 展示区+轮播图种子数据
    try {
      const { checkSeedNeeded, runSeedShowcase } = await import('./lib/auto-seed-showcase');

      const seedNeeded = await checkSeedNeeded();
      if (seedNeeded) {
        console.log('[Instrumentation] 检测到展示区/轮播图数据为空，开始插入种子数据...');
        const result = await runSeedShowcase();
        if (result.success) {
          console.log('[Instrumentation] #821 种子数据完成:', result.message);
          result.details.forEach(d => console.log('  -', d));
        } else {
          console.warn('[Instrumentation] #821 种子数据失败（不阻塞启动）:', result.message);
          result.details.forEach(d => console.log('  -', d));
        }
      } else {
        console.log('[Instrumentation] #821 展示区/轮播图数据检查通过，无需种子数据');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[Instrumentation] #821 种子数据异常（不阻塞启动）:', msg.substring(0, 200));
    }
  }
}
