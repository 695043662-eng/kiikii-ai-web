'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import AssetCard, { type CardData } from './AssetCard';
import SkeletonCard from './SkeletonCard';

/* ============================================================
   军师 PRD - 展示区瀑布流布局 (CardGrid)
   
   核心架构：绝对定位瀑布流
   - JavaScript 计算每张卡片的 (x, y, width, height)
   - 容器 relative + 子元素 absolute → 精确控制位置
   - 天然支持 gridSpan=2（双列宽度）
   - 不同 aspectRatio 卡片紧凑排列，无白边间隙
   
   #811 新增：虚拟滚动懒加载
   - 只渲染视口 ± buffer 内的卡片
   - Intersection Observer 驱动，滚动时按需加载
   - 非可见区域用空白占位符，保持布局稳定
   
   #813 拖拽排序重构（用户反馈 #812 按钮方案被否决）
   - 真正的拖拽移动：拖拽过程中其他卡片实时让出空间
   - 原理：拖拽时用临时排序数组重算布局，非拖拽卡片
     用 CSS transform 动画移到新位置
   - 拖拽卡片跟随鼠标，其他卡片流畅避让
   - 松开鼠标后才同步到真实数据（onCardsChange）
   - 删除上/下按钮，只保留拖拽把手
   ============================================================ */

interface CardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  colIndex: number;
  colSpan: number;
}

interface CardGridProps {
  cards: CardData[];
  isLoading?: boolean;
  onLikeClick?: (id: string) => void;
  onDownloadClick?: (id: string) => void;
  onAddClick?: (id: string) => void;
  onDuplicateClick?: (id: string) => void;
  onSendToAgent?: (id: string) => void;
  onViewInspiration?: (id: string) => void;
  isAdjustMode?: boolean;
  onCardsChange?: (cards: CardData[]) => void;
  onDoubleClick?: (id: string) => void;
  onDeleteClick?: (id: string) => void;
}

/** 瀑布流布局计算函数（抽离出来供拖拽时复用） */
function computeLayout(cardList: CardData[], effectiveWidth: number, effectiveColCount: number, gap: number) {
  if (effectiveWidth === 0 || cardList.length === 0) {
    return { positions: new Map<string, CardLayout>(), totalHeight: 0 };
  }

  const positions = new Map<string, CardLayout>();
  const colHeights = Array(effectiveColCount).fill(0);
  const colWidth = (effectiveWidth - (effectiveColCount - 1) * gap) / effectiveColCount;

  cardList.forEach((card) => {
    const span = card.gridSpan === 2 ? 2 : 1;
    // #834 修复：aspectRatio 运行时可能是字符串（如 "9:16"，数据库存入），
    // 虽然 TS 类型是 number，但 DB 实际数据可能不一致，需防御性解析
    // "9:16" → 9/16=0.5625，纯数字字符串 → parseFloat，无效 → 1
    let ratio: number | string = (card as any).aspectRatio || 1;
    if (typeof ratio === 'string') {
      if (ratio.includes(':')) {
        const parts = ratio.split(':').map(Number);
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
          ratio = parts[0] / parts[1];
        } else {
          ratio = 1;
        }
      } else {
        ratio = parseFloat(ratio) || 1;
      }
    }
    if (!Number.isFinite(ratio) || ratio <= 0) ratio = 1;

    const cardWidth = colWidth * span + (span - 1) * gap;
    const cardHeight = cardWidth / ratio;

    let bestCol = 0;
    if (span === 1) {
      let minH = Infinity;
      for (let i = 0; i < effectiveColCount; i++) {
        if (colHeights[i] < minH) {
          minH = colHeights[i];
          bestCol = i;
        }
      }
    } else {
      let minCombinedH = Infinity;
      for (let i = 0; i <= effectiveColCount - span; i++) {
        const combinedH = Math.max(...colHeights.slice(i, i + span));
        if (combinedH < minCombinedH) {
          minCombinedH = combinedH;
          bestCol = i;
        }
      }
    }

    const y = Math.max(...colHeights.slice(bestCol, bestCol + span));
    const x = bestCol * (colWidth + gap);

    for (let i = bestCol; i < bestCol + span && i < effectiveColCount; i++) {
      colHeights[i] = y + cardHeight + gap;
    }

    positions.set(card.id, { x, y, width: cardWidth, height: cardHeight, colIndex: bestCol, colSpan: span });
  });

  const totalHeight = Math.max(...colHeights);
  return { positions, totalHeight };
}

export default function CardGrid({
  cards,
  isLoading = false,
  onLikeClick,
  onDownloadClick,
  onAddClick,
  onDuplicateClick,
  onSendToAgent,
  onViewInspiration,
  isAdjustMode = false,
  onCardsChange,
  onDoubleClick,
  onDeleteClick,
}: CardGridProps) {
  // #813 拖拽排序状态
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [insertIndex, setInsertIndex] = useState<number>(-1);
  // 🔥 修复闭包陷阱：document 级事件监听捕获的是旧 insertIndex，导致拖拽永远无法完成
  // 用 ref 实时同步最新 insertIndex，在 onDocUp 中读取 ref 而非闭包中的旧值
  const insertIndexRef = useRef(insertIndex);
  useEffect(() => { insertIndexRef.current = insertIndex; }, [insertIndex]);
  // 同理，cards 也需要 ref 避免闭包陷阱
  const cardsRef = useRef(cards);
  useEffect(() => { cardsRef.current = cards; }, [cards]);
  // 拖拽卡片的实时位置（跟随鼠标）
  const [dragPos, setDragPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  // 每张非拖拽卡片的 CSS transform 偏移量（拖拽过程中实时更新）
  const [cardTransforms, setCardTransforms] = useState<Map<string, { dx: number; dy: number }>>(new Map());

  const dragRef = useRef<{
    draggedId: string;
    startIndex: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    isDragging: boolean;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  
  // #811 懒加载：追踪可见卡片 ID 集合
  const [visibleCardIds, setVisibleCardIds] = useState<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const cardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // 瀑布流容器宽度
  // #821 修复 Hydration Mismatch：不在初始 state 中使用 window.innerWidth
  // 服务端无 window → 1734，客户端有 window → 实际宽度 → 两者不一致导致 hydration 报错
  // 改为固定默认值 + useEffect + ResizeObserver 实时更新，保证 SSR/CSR 一致
  const [containerWidth, setContainerWidth] = useState(1734);
  const GAP = 8;

  // 监听容器宽度变化（首次 mount 也会触发，获取真实宽度）
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    // 立即同步一次真实宽度
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setContainerWidth(Math.round(rect.width));
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      if (width > 0) setContainerWidth(Math.round(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 列数
  const colCount = useMemo(() => {
    if (containerWidth >= 1024) return 5;
    if (containerWidth >= 768) return 3;
    return 2;
  }, [containerWidth]);

  // 正常布局（无拖拽时）
  const layout = useMemo(() => {
    return computeLayout(cards, containerWidth, colCount, GAP);
  }, [cards, colCount, containerWidth]);

  // layout.positions 的 ref，避免 handlePointerMove 闭包陷阱
  const layoutPositionsRef = useRef(layout.positions);
  useEffect(() => { layoutPositionsRef.current = layout.positions; }, [layout.positions]);

  // #813 拖拽时临时布局：将拖拽卡片从原位置取出，插入到 insertIndex
  // 用来计算其他卡片应该移到哪里
  const dragLayout = useMemo(() => {
    if (!draggedId || insertIndex < 0) return null;
    const startIdx = cards.findIndex(c => c.id === draggedId);
    if (startIdx === -1) return null;

    // 构造临时排序数组：把拖拽卡片移到 insertIndex
    const tempCards = cards.filter(c => c.id !== draggedId);
    const adjustedIndex = startIdx < insertIndex ? insertIndex - 1 : insertIndex;
    const dragCard = cards[startIdx];
    tempCards.splice(adjustedIndex, 0, dragCard);

    return computeLayout(tempCards, containerWidth, colCount, GAP);
  }, [cards, draggedId, insertIndex, containerWidth, colCount]);

  // #813 计算每张非拖拽卡片的 transform 偏移
  // 从正常布局位置 → 拖拽布局位置的差值
  useEffect(() => {
    if (!draggedId || !dragLayout || insertIndex < 0) {
      setCardTransforms(new Map());
      return;
    }

    const transforms = new Map<string, { dx: number; dy: number }>();
    // 对于每张非拖拽卡片，计算它在正常布局和拖拽布局中的位置差
    for (const card of cards) {
      if (card.id === draggedId) continue;
      const normalPos = layout.positions.get(card.id);
      const dragPos = dragLayout.positions.get(card.id);
      if (normalPos && dragPos) {
        const dx = dragPos.x - normalPos.x;
        const dy = dragPos.y - normalPos.y;
        // 只有实际有偏移时才记录（避免不必要的 transform）
        if (dx !== 0 || dy !== 0) {
          transforms.set(card.id, { dx, dy });
        }
      }
    }
    setCardTransforms(transforms);
  }, [draggedId, dragLayout, insertIndex, layout.positions, cards]);

  // #811 懒加载：IntersectionObserver
  useEffect(() => {
    if (isAdjustMode) {
      setVisibleCardIds(new Set(cards.map(c => c.id)));
      return;
    }
    if (observerRef.current) observerRef.current.disconnect();

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleCardIds(prev => {
          const next = new Set(prev);
          for (const entry of entries) {
            const cardId = entry.target.getAttribute('data-card-id');
            if (cardId && entry.isIntersecting) next.add(cardId);
          }
          if (next.size === prev.size) return prev;
          return next;
        });
      },
      { root: null, rootMargin: '300px 0px', threshold: 0 },
    );
    observerRef.current = observer;
    cardElementsRef.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [cards, isAdjustMode, layout]);

  // 注册/取消注册卡片 DOM
  const registerCardElement = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      cardElementsRef.current.set(id, el);
      if (observerRef.current && !isAdjustMode) observerRef.current.observe(el);
    } else {
      const oldEl = cardElementsRef.current.get(id);
      if (oldEl && observerRef.current) observerRef.current.unobserve(oldEl);
      cardElementsRef.current.delete(id);
    }
  }, [isAdjustMode]);

  // #813 拖拽移动：计算插入位置 + 其他卡片实时偏移
  // 🔥 修复闭包陷阱：从 ref 读取最新 cards 和 layout.positions
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const gridEl = gridRef.current;
    if (!gridEl) return;

    // 超过阈值才开始拖拽
    if (!drag.isDragging) {
      const distX = Math.abs(e.clientX - drag.startX);
      const distY = Math.abs(e.clientY - drag.startY);
      if (distX < 5 && distY < 5) return;
      drag.isDragging = true;
      setDraggedId(drag.draggedId);
      setInsertIndex(drag.startIndex); // 初始插入位置就是自己当前位置
      insertIndexRef.current = drag.startIndex; // 🔥 立即同步 ref，不等 useEffect（防 pointerup 时序竞争）
    }

    const gridRect = gridEl.getBoundingClientRect();
    const ghostX = e.clientX - gridRect.left - drag.offsetX;
    const ghostY = e.clientY - gridRect.top - drag.offsetY;

    const currentPositions = layoutPositionsRef.current;
    const pos = currentPositions.get(drag.draggedId);
    const w = pos?.width ?? 200;
    const h = pos?.height ?? 200;

    setDragPos({ x: ghostX, y: ghostY, w, h });

    // 计算插入位置：用幽灵中心点与每张卡片中心点比较
    const ghostCenterX = ghostX + w / 2;
    const ghostCenterY = ghostY + h / 2;

    // 先按 Y 排序所有卡片的中心点，找到幽灵中心最接近的插入位置
    let bestIndex = drag.startIndex; // 默认不移动
    let minDist = Infinity;

    const currentCards = cardsRef.current;
    currentCards.forEach((card, idx) => {
      if (card.id === drag.draggedId) return;

      const cardPos = currentPositions.get(card.id);
      if (!cardPos) return;

      const cardCenterX = cardPos.x + cardPos.width / 2;
      const cardCenterY = cardPos.y + cardPos.height / 2;

      const dist = Math.abs(ghostCenterX - cardCenterX) * 0.3 +
                   Math.abs(ghostCenterY - cardCenterY) * 0.7;

      if (dist < minDist) {
        minDist = dist;
        bestIndex = ghostCenterY < cardCenterY ? idx : idx + 1;
      }
    });

    setInsertIndex(bestIndex);
    insertIndexRef.current = bestIndex; // 🔥 立即同步 ref，不等 useEffect（防 pointerup 时序竞争）
  }, []);

  // #813 拖拽结束：同步排序到数据
  // 🔥 修复闭包陷阱：从 ref 读取最新 insertIndex 和 cards，而非闭包中的旧值
  const handlePointerUp = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    const currentInsertIndex = insertIndexRef.current;
    const currentCards = cardsRef.current;

    console.log('[CardGrid] pointerup:', {
      isDragging: drag.isDragging,
      currentInsertIndex,
      startIndex: drag.startIndex,
      willReorder: drag.isDragging && currentInsertIndex >= 0 && currentInsertIndex !== drag.startIndex,
    });

    if (drag.isDragging && currentInsertIndex >= 0 && currentInsertIndex !== drag.startIndex) {
      const startIndex = drag.startIndex;
      const newCards = [...currentCards];
      const [draggedCard] = newCards.splice(startIndex, 1);
      const adjustedIndex = startIndex < currentInsertIndex ? currentInsertIndex - 1 : currentInsertIndex;
      newCards.splice(adjustedIndex, 0, draggedCard);
      newCards.forEach((card, i) => { card.sortOrder = i; });

      console.log('[CardGrid] 拖拽完成:', drag.draggedId, '从位置', startIndex, '→ 位置', adjustedIndex);
      onCardsChange?.(newCards);
    }

    setDraggedId(null);
    setInsertIndex(-1);
    setDragPos(null);
    setCardTransforms(new Map());
    dragRef.current = null;
  }, [onCardsChange]);

  // #813 拖拽开始 — 使用 document 级事件监听，绕过 setPointerCapture + React 18 事件委托兼容问题
  const handlePointerDragStart = useCallback((id: string, e: React.PointerEvent) => {
    if (!isAdjustMode) return; // 只在编辑模式允许拖拽
    const startIndex = cards.findIndex(c => c.id === id);
    if (startIndex === -1) return;

    const pos = layout.positions.get(id);
    if (!pos) return;
    const gridEl = gridRef.current;
    if (!gridEl) return;

    const gridRect = gridEl.getBoundingClientRect();

    dragRef.current = {
      draggedId: id,
      startIndex,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - (gridRect.left + pos.x),
      offsetY: e.clientY - (gridRect.top + pos.y),
      isDragging: false,
    };

    // #818 用 document 级监听替代 setPointerCapture，避免 React 18 事件委托冲突
    const onDocMove = (ev: PointerEvent) => {
      handlePointerMove(ev as unknown as React.PointerEvent);
    };
    const onDocUp = () => {
      handlePointerUp();
      document.removeEventListener('pointermove', onDocMove);
      document.removeEventListener('pointerup', onDocUp);
    };
    document.addEventListener('pointermove', onDocMove);
    document.addEventListener('pointerup', onDocUp);
  }, [cards, layout.positions, isAdjustMode, handlePointerMove, handlePointerUp]);
  // handlePointerMove/handlePointerUp 依赖为 [] 或 [onCardsChange]，引用稳定，不会频繁重建

  // #813 骨架屏：加载前预留空间防跳动（基于卡片数量估算最小高度）
  const estimatedMinHeight = useMemo(() => {
    if (layout.totalHeight > 0) return 0; // 已有布局就不需要
    const cardCount = cards.length || 0;
    if (cardCount === 0) return 0;
    // 估算：每张卡片约 200px 高，按列数分行
    const rows = Math.ceil(cardCount / colCount);
    return rows * 220 + (rows - 1) * GAP;
  }, [cards.length, colCount, layout.totalHeight, GAP]);

  // #818 骨架屏：加载中时展示 12 张骨架卡片，消除白屏视觉塌陷
  const SKELETON_COUNT = 12;
  const skeletonHeights = useMemo(() => {
    // 预计算每张骨架卡片的像素高度，与 SkeletonCard 的 HEIGHT_VARIANTS 对齐
    const pxMap = [256, 320, 384]; // h-64, h-80, h-96
    return Array.from({ length: SKELETON_COUNT }, (_, i) => pxMap[i % 3]);
  }, []);

  // #818 骨架屏布局预计算（必须在条件外调用，遵守 Hook 规则）
  const skeletonColWidth = (containerWidth - (colCount - 1) * GAP) / colCount;
  const skeletonLayout = useMemo(() => {
    const colHeights = Array(colCount).fill(0);
    const positions: { x: number; y: number; width: number; height: number }[] = [];

    for (let i = 0; i < SKELETON_COUNT; i++) {
      const cardHeight = skeletonHeights[i];
      // 找最短列
      let minH = Infinity, bestCol = 0;
      for (let c = 0; c < colCount; c++) {
        if (colHeights[c] < minH) { minH = colHeights[c]; bestCol = c; }
      }
      const x = bestCol * (skeletonColWidth + GAP);
      const y = colHeights[bestCol];
      colHeights[bestCol] = y + cardHeight + GAP;
      positions.push({ x, y, width: skeletonColWidth, height: cardHeight });
    }

    return { positions, totalHeight: Math.max(...colHeights) };
  }, [skeletonColWidth, colCount, GAP, skeletonHeights]);

  if (isLoading) {
    // 加载中：渲染骨架屏瀑布流

    return (
      <div className="w-full min-h-[300px] relative pb-6" style={{ minHeight: skeletonLayout.totalHeight || undefined }}>
        {skeletonLayout.positions.map((pos, i) => (
          <div
            key={`skeleton-${i}`}
            className="absolute animate-pulse"
            style={{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${pos.width}px` }}
          >
            {/* 图片占位区 */}
            <div
              className="w-full rounded-xl bg-gray-200 dark:bg-gray-800"
              style={{ height: `${pos.height}px` }}
            />
            {/* 文字占位区 */}
            <div className="pt-2 px-1 space-y-1.5">
              <div className="h-2.5 w-3/4 rounded-full bg-gray-200 dark:bg-gray-800" />
              <div className="h-2 w-1/2 rounded-full bg-gray-200 dark:bg-gray-800" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-400">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <p className="text-sm">暂无相关内容</p>
        <p className="text-xs text-gray-300 mt-1">换个关键词试试吧</p>
      </div>
    );
  }

  const isVisible = (cardId: string) => {
    if (isAdjustMode) return true;
    return visibleCardIds.has(cardId);
  };
  
  return (
    <div
      ref={gridRef}
      className="w-full min-h-[300px] relative pb-6"
      style={{ minHeight: layout.totalHeight > 0 ? undefined : estimatedMinHeight || undefined }}
    >
      {cards.map((card, index) => {
        const pos = layout.positions.get(card.id);
        if (!pos) return null;

        const isDragged = draggedId === card.id;
        const cardVisible = isVisible(card.id);
        const transform = cardTransforms.get(card.id);

        return (
          <div
            key={card.id}
            ref={(el) => registerCardElement(card.id, el)}
            data-card-id={card.id}
            data-card-index={index}
            className={isDragged ? 'opacity-0 pointer-events-none' : ''}
            style={{
              position: 'absolute',
              left: pos.x,
              top: pos.y + (isAdjustMode ? 20 : 0),
              width: pos.width,
              height: pos.height,
              // #813 拖拽时实时偏移动画（300ms ease-out 让其他卡片流畅让位）
              transform: transform ? `translate(${transform.dx}px, ${transform.dy}px)` : undefined,
              transition: draggedId ? 'transform 300ms ease-out' : 'transform 300ms ease-out',
              zIndex: isDragged ? -1 : undefined,
            }}
          >
            {/* 🔥 调节模式下显示卡片ID */}
            {isAdjustMode && (
              <div className="absolute -top-5 left-0 text-xs text-gray-500 font-mono bg-white/80 px-1 rounded z-40">
                ID: {card.id}
              </div>
            )}
            {/* #811 懒加载：可见时渲染完整 AssetCard，不可见时只渲染占位背景 */}
            {cardVisible ? (
              <AssetCard
                data={card}
                onLikeClick={onLikeClick}
                onDownloadClick={onDownloadClick}
                onAddClick={onAddClick}
                onDuplicateClick={onDuplicateClick}
                onSendToAgent={onSendToAgent}
                onViewInspiration={onViewInspiration}
                isAdjustMode={isAdjustMode}
                onDoubleClick={onDoubleClick}
                onDeleteClick={() => onDeleteClick?.(card.id)}
                onPointerDragStart={handlePointerDragStart}
              />
            ) : (
              <div className="w-full h-full rounded-xl bg-gray-100 animate-pulse" />
            )}
          </div>
        );
      })}

      {/* #813 拖拽幽灵卡片：跟随鼠标移动，半透明卡片预览 */}
      {draggedId && dragPos && (() => {
        const pos = layout.positions.get(draggedId);
        if (!pos) return null;
        const dragCard = cards.find(c => c.id === draggedId);
        return (
          <div
            className="absolute pointer-events-none z-[9999] rounded-xl shadow-2xl ring-2 ring-blue-400"
            style={{
              left: dragPos.x,
              top: dragPos.y + (isAdjustMode ? 20 : 0),
              width: dragPos.w,
              height: dragPos.h,
              opacity: 0.85,
              background: 'rgba(255,255,255,0.95)',
            }}
          >
            {/* 幽灵卡片内显示缩略图预览 */}
            {dragCard?.imageUrl && (
              <img
                src={dragCard.imageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover rounded-xl"
                style={{ opacity: 0.6 }}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-blue-500 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
                移动中...
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
