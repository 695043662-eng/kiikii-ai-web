'use client';

/* ============================================================
   军师 PRD - 瀑布流骨架屏 (SkeletonCard)
   
   在 API 数据加载期间，展示带有呼吸动效的骨架卡片，
   消除白屏视觉塌陷，完美契合瀑布流布局。
   
   - animate-pulse 呼吸灯效果
   - 通过 index % 3 循环分配不同高度，模拟瀑布流参差感
   - 适配深色/浅色主题
   ============================================================ */

interface SkeletonCardProps {
  index: number;
}

/** 瀑布流高度变体：通过 index 循环分配不同高度 */
const HEIGHT_VARIANTS = [
  'h-64',  // 256px
  'h-80',  // 320px
  'h-96',  // 384px
] as const;

export default function SkeletonCard({ index }: SkeletonCardProps) {
  const heightClass = HEIGHT_VARIANTS[index % HEIGHT_VARIANTS.length];

  return (
    <div className="w-full rounded-xl overflow-hidden">
      {/* 图片占位区 - 不同高度模拟瀑布流 */}
      <div
        className={`w-full ${heightClass} rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse`}
      />

      {/* 文字占位区 - 两行灰色小条 */}
      <div className="pt-2 px-1 space-y-1.5">
        <div className="h-2.5 w-3/4 rounded-full bg-gray-200 dark:bg-gray-800 animate-pulse" />
        <div className="h-2 w-1/2 rounded-full bg-gray-200 dark:bg-gray-800 animate-pulse" />
      </div>
    </div>
  );
}
