'use client';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import AuthModal from '@/components/AuthModal';
import LeftNav from '@/components/LeftNav';
import Header from '@/components/homepage/Header';
import HeroCarousel from '@/components/homepage/HeroCarousel';
import type { CarouselItem } from '@/components/homepage/HeroCarousel';
import CardGrid from '@/components/homepage/CardGrid';
import type { CardData } from '@/components/homepage/AssetCard';
import AddCardModal from '@/components/homepage/AddCardModal';
import AddCarouselModal from '@/components/homepage/AddCarouselModal';
import ShowcaseReviewPanel from '@/components/homepage/ShowcaseReviewPanel';
import { toast } from 'sonner';

/* ============================================================
   Kiikii AI 主页 - AI 视觉资产和工作流聚合平台
   - 左侧悬浮导航栏（与生图页面一致）
   - 3D景深视频轮播（Hero Section）
   - 顶部吸顶操作区（大类目 + 搜索 + 风格标签 + 排序筛选）
   - 瀑布流卡片展示
   
   #803 轮播架构重构：
   - 配置数据从数据库读取（/api/carousel），不再使用 localStorage
   - 只存 ObjectKey（如 dev/canvas/xxx.png），不存签名 URL
   - 渲染时通过 /api/canvas/image?key=xxx 代理获取最新有效 URL
   ============================================================ */

// mockCards 已删除：展示区数据完全由 /api/showcase API 驱动，无硬编码

export default function HomePage() {
  return (
    <Suspense>
      <HomePageContent />
    </Suspense>
  );
}

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn: ctxIsLoggedIn, refreshUserInfo } = useAIGenerator();
  const isLoggedIn = ctxIsLoggedIn;

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // 轮播数据状态 — 从数据库 API 读取，不再使用 localStorage
  const [carouselItems, setCarouselItems] = useState<CarouselItem[]>([]);
  
  // 从 API 拉取轮播数据
  const fetchCarouselItems = useCallback(async () => {
    try {
      // 🛡️ #816 移除 Date.now() + no-store 双重缓存破坏（与 showcase 同理）
      // #859 斩断浏览器 HTTP 缓存：显式 cache: 'no-store'
      const res = await fetch('/api/carousel', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        const items: CarouselItem[] = data.items.map((row: any) => ({
          id: String(row.id),
          mediaType: row.mediaType || 'image',
          objectKey: row.objectKey,
          title: row.title || '',
          subtitle: row.subtitle || '',
          tag: row.tag || '',
          sortOrder: row.sortOrder ?? 0,
        }));
        setCarouselItems(items);
        // #859 Debug 探针：打印服务端时间戳，判断是否拿到最新数据
        console.log('[Carousel] 从 API 加载', items.length, '条轮播数据 | 服务端时间:', data.debug_server_time);
      }
    } catch (e) {
      console.error('[Carousel] 拉取轮播数据失败:', e);
    }
  }, []);
  
  // 🔥 展示卡片：从数据库 API 加载，不再使用 localStorage
  const [cards, setCards] = useState<CardData[]>([]);
  const [cardsLoaded, setCardsLoaded] = useState(false);

  const fetchShowcaseCards = useCallback(async () => {
    try {
      // 🛡️ #816 移除 Date.now() + no-store 双重缓存破坏
      // 根因：每次渲染生成唯一 URL + 禁止缓存 = 每次页面加载都穿透到后端
      // showcase API 本身是轻量的 DB 查询，不需要极端的防缓存策略
      // #859 斩断浏览器 HTTP 缓存：显式 cache: 'no-store'
      const res = await fetch('/api/showcase', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        setCards(data.items);
        // #859 Debug 探针：打印服务端时间戳，判断是否拿到最新数据
        console.log('[Showcase] 从 API 加载', data.items.length, '条展示卡片 | 服务端时间:', data.debug_server_time);
      }
    } catch (e) {
      console.error('[Showcase] 拉取展示卡片失败:', e);
    } finally {
      setCardsLoaded(true);
    }
  }, []);

  // 清除旧的 localStorage 缓存（一次性迁移）+ #859 清除可能残留的模型缓存
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('homepage_cards_full');
      localStorage.removeItem('homepage_custom_cards');
      // #859 清除可能残留的旧模型配置缓存
      localStorage.removeItem('model_config_cache');
      localStorage.removeItem('api_config_cache');
      localStorage.removeItem('defaultModels');
      console.log('[Homepage] #859 旧缓存清理完成');
    }
  }, []);

  // 初次加载轮播 + 展示卡片数据
  useEffect(() => {
    fetchCarouselItems();
    fetchShowcaseCards();
  }, [fetchCarouselItems, fetchShowcaseCards]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');  // #815 修复：初始值用 ''（精选=全部），不用 '精选'（label≠value，导致初始过滤为空）
  const [activeTag, setActiveTag] = useState('全部');
  // 开发调节模式
  // #820 环境变量硬门控：NEXT_PUBLIC_ENABLE_ADJUST_MODE 不为 'true' 时，调节模式永远关闭
  const canAdjustMode = process.env.NEXT_PUBLIC_ENABLE_ADJUST_MODE === 'true';
  const [isAdjustMode, setIsAdjustMode] = useState(false);
  // 实际生效的调节模式：环境变量门控 + 用户开关
  const effectiveAdjustMode = canAdjustMode && isAdjustMode;
  // 调节模式 - 添加卡片弹窗
  const [isAddCardModalOpen, setIsAddCardModalOpen] = useState(false);
  // 调节模式 - 编辑卡片弹窗
  const [editCard, setEditCard] = useState<CardData | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  // 调节模式 - 轮播上传弹窗
  const [isAddCarouselModalOpen, setIsAddCarouselModalOpen] = useState(false);
  const [isShowcaseReviewOpen, setIsShowcaseReviewOpen] = useState(false);
  const [editCarouselItem, setEditCarouselItem] = useState<CarouselItem | null>(null);
  const [isEditCarouselModalOpen, setIsEditCarouselModalOpen] = useState(false);

  // 检测 URL 参数开启调节模式（仅在环境变量允许时生效）
  useEffect(() => {
    if (canAdjustMode && searchParams.get('devAdjust') === 'true') {
      setIsAdjustMode(true);
      console.log('[Dev] 调节模式已开启（URL参数触发）');
    }
  }, [searchParams]);

  // 暴露全局函数供控制台调用（仅环境变量允许时）
  useEffect(() => {
    if (!canAdjustMode) return;
    (window as any).enableHomepageAdjustMode = () => {
      setIsAdjustMode(true);
      console.log('[Dev] 调节模式已开启');
    };
    (window as any).disableHomepageAdjustMode = () => {
      setIsAdjustMode(false);
      console.log('[Dev] 调节模式已关闭');
    };
    return () => {
      delete (window as any).enableHomepageAdjustMode;
      delete (window as any).disableHomepageAdjustMode;
    };
  }, []);

  // 监听调节模式开启/关闭事件（仅环境变量允许时）
  useEffect(() => {
    if (!canAdjustMode) return;
    const handleEnableAdjustMode = () => {
      setIsAdjustMode(true);
      console.log('[Dev] 调节模式已开启');
    };
    const handleDisableAdjustMode = () => {
      setIsAdjustMode(false);
      console.log('[Dev] 调节模式已关闭');
    };

    window.addEventListener('enableAdjustMode', handleEnableAdjustMode);
    window.addEventListener('disableAdjustMode', handleDisableAdjustMode);

    return () => {
      window.removeEventListener('enableAdjustMode', handleEnableAdjustMode);
      window.removeEventListener('disableAdjustMode', handleDisableAdjustMode);
    };
  }, []);

  // 监听登录/注册事件
  useEffect(() => {
    const handleOpenLogin = () => {
      setAuthMode('login');
      setAuthModalOpen(true);
    };
    const handleOpenRegister = () => {
      setAuthMode('register');
      setAuthModalOpen(true);
    };

    window.addEventListener('openLogin', handleOpenLogin);
    window.addEventListener('openRegister', handleOpenRegister);

    return () => {
      window.removeEventListener('openLogin', handleOpenLogin);
      window.removeEventListener('openRegister', handleOpenRegister);
    };
  }, []);

  const handleLoginSuccess = () => {
    setAuthModalOpen(false);
    refreshUserInfo();
  };

  // 搜索过滤
  const filteredCards = useMemo(() => {
    let result = cards;

    // #813 大类目过滤（空字符串=精选=全部）
    if (activeCategory) {
      result = result.filter((card) => card.category === activeCategory);
    }

    // 搜索过滤
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (card) =>
          card.title?.toLowerCase().includes(query) ||
          card.subtitle?.toLowerCase().includes(query) ||
          card.tag?.toLowerCase().includes(query),
      );
    }

    // 标签过滤
    if (activeTag !== '全部') {
      result = result.filter((card) => card.tag === activeTag);
    }

    return result;
  }, [cards, searchQuery, activeTag, activeCategory]);

  // 回调函数
  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleCategoryChange = useCallback((category: string) => {
    setActiveCategory(category);
  }, []);

  const handleTagChange = useCallback((tag: string) => {
    setActiveTag(tag);
  }, []);

  const handleLikeClick = useCallback((id: string) => {
    console.log('Like clicked:', id);
  }, []);

  const handleDownloadClick = useCallback((id: string) => {
    console.log('Download clicked:', id);
  }, []);

  const handleAddClick = useCallback(
    (id: string) => {
      console.log('Add to canvas clicked:', id);
      // 可以跳转到画布页面
      router.push('/canvas');
    },
    [router],
  );

  const handleDuplicateClick = useCallback((id: string) => {
    console.log('Duplicate clicked:', id);
    // 一键同款功能
  }, []);

  const handleSendToAgent = useCallback(
    (id: string) => {
      console.log('[SendToAgent] clicked, cardId:', id);
      // 查找卡片内置素材数据
      const card = cards.find((c) => c.id === id);
      if (!card) {
        console.warn('[SendToAgent] 卡片未找到:', id);
        return;
      }

      // 🔥 #811 修复：将完整的参考图和提示词数据传递给画布
      // 使用 sessionStorage 传递数据（避免 URL 长度限制，参考图 URL 可能很长）
      // #815 修复：只传递有效的参考图，空字符串/空数组不传（避免画布端渲染破图）
      const validRefImages = (card.referenceImages || []).filter((u: string) => u && u.length > 0);
      const validRefImage = card.builtInReferenceImage && card.builtInReferenceImage.length > 0
        ? card.builtInReferenceImage : '';
      const agentData: Record<string, any> = {
        from: 'homepage',
        model: card.builtInModel || '',
        prompt: card.builtInPrompt || '',
        aspectRatio: card.builtInAspectRatio || '',
        resolution: card.builtInResolution || '',
        timestamp: Date.now(),
      };
      // 只在有有效参考图时才传递（避免画布端渲染空 src 破图）
      if (validRefImage) agentData.referenceImage = validRefImage;
      if (validRefImages.length > 0) agentData.referenceImages = validRefImages;
      sessionStorage.setItem('agent_transfer_data', JSON.stringify(agentData));

      // URL 中只放标记参数，实际数据走 sessionStorage
      const params = new URLSearchParams();
      params.set('from', 'homepage');
      params.set('agent', '1'); // 标记：画布页面需要读取 sessionStorage

      console.log('[SendToAgent] 传递数据:', {
        model: agentData.model,
        prompt: agentData.prompt?.substring(0, 50),
        refImgCount: agentData.referenceImages?.length || 0,
        aspectRatio: agentData.aspectRatio,
      });

      router.push(`/canvas?${params.toString()}`);
    },
    [router, cards],
  );

  const handleViewInspiration = useCallback((id: string) => {
    console.log('View inspiration clicked:', id);
  }, []);

  // 🔥 展示卡片不再使用 localStorage，所有增删改通过 API
  // saveCards 已废弃，保留空函数签名兼容旧调用
  const saveCards = (_allCards: CardData[]) => {
    // 不再操作 localStorage
  };

  // 轮播操作：全部通过 API，不再操作 localStorage
  // 添加/编辑由 AddCarouselModal 直接调用 API，这里只做删除和刷新
  
  // 调节模式 - 删除轮播项（调 API）
  const handleDeleteCarouselItem = useCallback(async (id: string | number) => {
    // 确认弹窗
    if (!confirm('确定删除此轮播项？')) return;

    try {
      // 使用 query params 方式，避免 JSON body 兼容性问题
      const res = await fetch(`/api/carousel?id=${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        console.log('[Carousel] 删除成功, id:', id);
        toast.success('删除成功');
        fetchCarouselItems(); // 刷新列表
        router.refresh();     // 🔥 刷新服务端组件缓存，防止刷新页面回档
      } else {
        console.error('[Carousel] 删除失败:', data.error);
        toast.error('删除失败: ' + (data.error || '未知错误'));
      }
    } catch (e) {
      console.error('[Carousel] 删除异常:', e);
      toast.error('删除异常，请重试');
    }
  }, [fetchCarouselItems, router]);

  // 调节模式 - 添加新卡片（通过 API 持久化到数据库）
  const handleAddCard = useCallback(async (newCard: CardData) => {
    try {
      const res = await fetch('/api/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCard),
      });
      const data = await res.json();
      if (data.success) {
        console.log('[Showcase] 新增卡片成功:', data.data?.id);
        fetchShowcaseCards(); // 刷新列表
        router.refresh();
      } else {
        console.error('[Showcase] 新增卡片失败:', data.error);
      }
    } catch (e) {
      console.error('[Showcase] 新增卡片异常:', e);
    }
  }, [fetchShowcaseCards]);

  // 调节模式 - 删除卡片（调 API）
  const handleDeleteCard = useCallback(async (id: string) => {
    if (!confirm('确认删除此卡片？')) return;
    try {
      // 用 query params 传 id（DELETE + body 兼容性差）
      const res = await fetch(`/api/showcase?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        console.log('[Showcase] 删除卡片成功, id:', id);
        fetchShowcaseCards();
        router.refresh();
      } else {
        console.error('[Showcase] 删除卡片失败:', data.error);
        toast.error('删除失败: ' + (data.error || '未知错误'));
      }
    } catch (e) {
      console.error('[Showcase] 删除卡片异常:', e);
      toast.error('删除异常，请重试');
    }
  }, [fetchShowcaseCards]);

  // 调节模式 - 双击编辑卡片
  const handleDoubleClick = useCallback((id: string) => {
    const card = cards.find((c) => c.id === id);
    if (card) {
      setEditCard(card);
      setIsEditModalOpen(true);
      console.log('[Dev] 双击编辑卡片:', id);
    }
  }, [cards]);

  // 调节模式 - 双击编辑轮播项
  const handleCarouselDoubleClick = useCallback((id: string | number) => {
    const item = carouselItems.find((c) => c.id === id);
    if (item) {
      setEditCarouselItem(item);
      setIsEditCarouselModalOpen(true);
      console.log('[Dev] 双击编辑轮播项:', id);
    }
  }, [carouselItems]);

  // 调节模式 - 更新卡片（通过 API 持久化到数据库）
  const handleUpdateCard = useCallback(async (updatedCard: CardData) => {
    try {
      const res = await fetch('/api/showcase', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...updatedCard, id: updatedCard.id }),
      });
      const data = await res.json();
      if (data.success) {
        console.log('[Showcase] 更新卡片成功:', updatedCard.id);
        fetchShowcaseCards(); // 刷新列表
        router.refresh();
      } else {
        console.error('[Showcase] 更新卡片失败:', data.error);
      }
    } catch (e) {
      console.error('[Showcase] 更新卡片异常:', e);
    }
    setIsEditModalOpen(false);
    setEditCard(null);
  }, [fetchShowcaseCards]);

  return (
    <div className="min-h-screen bg-[#F8F9FA] dark:bg-gray-950 overflow-x-hidden transition-colors">
      {/* 左侧悬浮导航栏 - 与生图页面一致 */}
      <LeftNav showFullNav={true} withPadding={false} />

      {/* 导航栏与展示区分界线 - 从logo下方开始，z-[25]确保穿过Header时不断开 */}
      <div className="fixed bottom-0 w-[1.5px] bg-gray-300/70 dark:bg-gray-600/50 z-[25]" style={{ left: '85px', top: '64px' }} />

      {/* 主内容区 - #803 军师修复：统一视觉基准线 */}
      {/* #818 轮播区和卡片区在 w-[90%] 容器内，Header 全宽消除白色矩形 */}
      <div className="w-[90%] mx-auto px-4 pl-5">
          {/* 3D 景深视频轮播 - Hero Section（放在最上方，顶部留白更多） */}
          <section className="pt-16">
          <HeroCarousel
            items={carouselItems}
            autoPlayInterval={6000}
            onDoubleClick={handleCarouselDoubleClick}
            onDelete={handleDeleteCarouselItem}
            isAdjustMode={effectiveAdjustMode}
          />
        </section>
      </div>

        {/* 顶部吸顶操作区 - #818 全宽背景 + 内容居中对齐 */}
        <Header
          onSearch={handleSearch}
          onCategoryChange={handleCategoryChange}
          onTagChange={handleTagChange}
          canAdjustMode={canAdjustMode}
          isAdjustMode={isAdjustMode}
          onToggleAdjustMode={() => setIsAdjustMode(prev => !prev)}
        />

      <div className="w-[90%] mx-auto px-4 pl-5">
          {/* 主内容区 - 瀑布流卡片 */}
          <main className="pt-2 pb-8">
            <CardGrid
            cards={filteredCards}
            isLoading={!cardsLoaded}
            onLikeClick={handleLikeClick}
            onDownloadClick={handleDownloadClick}
            onAddClick={handleAddClick}
            onDuplicateClick={handleDuplicateClick}
            onSendToAgent={handleSendToAgent}
            onViewInspiration={handleViewInspiration}
            isAdjustMode={effectiveAdjustMode}
            onDeleteClick={handleDeleteCard}
            onCardsChange={async (newCards) => {
              // 🔥 检测哪些卡片被删除了
              const deletedIds = cards
                .filter(c => !newCards.some(nc => nc.id === c.id))
                .map(c => c.id);

              console.log('[Showcase] onCardsChange 触发:', {
                oldCount: cards.length,
                newCount: newCards.length,
                deletedIds,
                deletedIdTypes: deletedIds.map(id => typeof id),
              });

              // 先更新前端 State（即时反馈）
              setCards(newCards);

              // 删除操作：调 API 持久化到数据库（用 query 参数，避免 body 解析问题）
              for (const id of deletedIds) {
                try {
                  const numericId = parseInt(id as string, 10);
                  console.log('[Showcase] 发送 DELETE, id:', numericId);
                  const res = await fetch(`/api/showcase?id=${numericId}`, {
                    method: 'DELETE',
                  });
                  const data = await res.json();
                  if (data.success) {
                    console.log('[Showcase] 删除卡片成功:', id);
                  } else {
                    console.error('[Showcase] 删除卡片失败:', data.error, 'id=', id);
                  }
                } catch (e) {
                  console.error('[Showcase] 删除卡片异常:', e);
                }
              }

              // 排序变更：批量更新 sort_order
              if (deletedIds.length === 0 && newCards.length === cards.length) {
                // 是排序操作，不是删除
                console.log('[Showcase] 排序变更: 开始批量更新 sort_order, 共', newCards.length, '张卡片');
                for (let i = 0; i < newCards.length; i++) {
                  try {
                    const res = await fetch('/api/showcase', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: newCards[i].id, sortOrder: i + 1 }),
                    });
                    if (!res.ok) {
                      const errData = await res.json().catch(() => ({}));
                      console.error('[Showcase] 排序更新失败:', newCards[i].id, 'HTTP', res.status, errData.error || '');
                    }
                  } catch (e) {
                    console.error('[Showcase] 排序更新异常:', newCards[i].id, e);
                  }
                }
                console.log('[Showcase] 排序变更: 批量更新完成');
              }

              // 刷新确保数据一致
              if (deletedIds.length > 0) {
                router.refresh();
              }
            }}
            onDoubleClick={handleDoubleClick}
          />
          </main>
      </div>

      {/* 登录/注册模态框 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* 调节模式 - 浮动上传按钮（仅环境变量允许且用户开启时显示） */}
      {effectiveAdjustMode && (
        <div className="fixed bottom-8 right-8 z-50 flex gap-3">
          {/* 审核管理按钮 */}
          <button
            onClick={() => setIsShowcaseReviewOpen(true)}
            className="w-14 h-14 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-110"
            title="展示审核管理"
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {/* 轮播上传按钮 */}
          <button
            onClick={() => setIsAddCarouselModalOpen(true)}
            className="w-14 h-14 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-110"
            title="添加轮播视频"
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.5-4.5m0 0l-4.5-4.5m4.5 4.5H3m18 9l-4.5 4.5m0 0l4.5 4.5m-4.5-4.5H3" />
            </svg>
          </button>
          {/* 卡片上传按钮 */}
          <button
            onClick={() => setIsAddCardModalOpen(true)}
            className="w-14 h-14 bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-110"
            title="添加展示素材"
          >
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      )}

      {/* 调节模式 - 添加卡片弹窗 */}
      <AddCardModal
        isOpen={isAddCardModalOpen}
        onClose={() => setIsAddCardModalOpen(false)}
        onAddCard={handleAddCard}
      />

      {/* 调节模式 - 编辑卡片弹窗 */}
      <AddCardModal
        isOpen={isEditModalOpen}
        onClose={() => { setIsEditModalOpen(false); setEditCard(null); }}
        onAddCard={handleAddCard}
        editCard={editCard}
        onUpdateCard={handleUpdateCard}
      />

      {/* 调节模式 - 添加轮播弹窗 */}
      <AddCarouselModal
        isOpen={isAddCarouselModalOpen}
        onClose={() => setIsAddCarouselModalOpen(false)}
        onSuccess={() => { fetchCarouselItems(); router.refresh(); }}
      />

      {/* 调节模式 - 编辑轮播弹窗 */}
      <AddCarouselModal
        isOpen={isEditCarouselModalOpen}
        onClose={() => { setIsEditCarouselModalOpen(false); setEditCarouselItem(null); }}
        onSuccess={() => { fetchCarouselItems(); router.refresh(); }}
        editItem={editCarouselItem}
      />

      {/* 调节模式 - 展示审核管理面板 */}
      <ShowcaseReviewPanel
        isOpen={isShowcaseReviewOpen}
        onClose={() => setIsShowcaseReviewOpen(false)}
        onReviewComplete={() => { fetchShowcaseCards(); }}
      />
    </div>
  );
}