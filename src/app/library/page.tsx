'use client';

/**
 * 我的图库 — 个人资产管理页
 * 路由: /library
 *
 * 功能：
 * - 顶部 Tab 切换：全部 / AI 生成 / 上传参考
 * - 响应式网格展示
 * - Hover 遮罩 + 发送到画布/删除 按钮
 * - IntersectionObserver 无限滚动
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import LeftNav from '@/components/LeftNav';
import AuthModal from '@/components/AuthModal';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Image as ImageIcon,
  Upload,
  LayoutGrid,
  Trash2,
  SendToBack,
  Loader2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ============================================================
// 类型
// ============================================================
interface Asset {
  id: string;
  url: string;
  imageKey: string;
  type: 'generated' | 'uploaded';
  prompt: string | null;
  model: string | null;
  created_at: string;
}

type FilterType = 'all' | 'generated' | 'uploaded';

// ============================================================
// 组件
// ============================================================
export default function LibraryPage() {
  const { isLoggedIn, userId } = useAIGenerator();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [total, setTotal] = useState(0);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 无限滚动哨兵
  const sentinelRef = useRef<HTMLDivElement>(null);

  const LIMIT = 24;

  // --------------------------------------------------------
  // 数据加载
  // --------------------------------------------------------
  const fetchAssets = useCallback(async (pageNum: number, type: FilterType, append: boolean) => {
    if (!isLoggedIn) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/library/assets?page=${pageNum}&limit=${LIMIT}&type=${type}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || '加载失败');
        return;
      }
      const data = await res.json();
      const newAssets: Asset[] = data.assets || [];

      if (append) {
        setAssets(prev => [...prev, ...newAssets]);
      } else {
        setAssets(newAssets);
      }
      setHasMore(data.hasMore ?? false);
      setTotal(data.total ?? 0);
    } catch (err) {
      console.error('[library] fetchAssets 异常:', err);
      toast.error('网络错误');
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, [isLoggedIn]);

  // 首次加载 & 切换 Tab
  useEffect(() => {
    if (!isLoggedIn) {
      setInitialLoading(false);
      return;
    }
    setPage(1);
    setAssets([]);
    setInitialLoading(true);
    fetchAssets(1, filterType, false);
  }, [isLoggedIn, filterType, fetchAssets]);

  // 加载更多
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchAssets(nextPage, filterType, true);
  }, [loading, hasMore, page, filterType, fetchAssets]);

  // IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  // --------------------------------------------------------
  // 删除
  // --------------------------------------------------------
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/library/assets/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: deleteTarget.id, type: deleteTarget.type }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        toast.error(errData.error || '删除失败');
        return;
      }
      // 前端移除
      setAssets(prev => prev.filter(a => a.id !== deleteTarget.id));
      setTotal(prev => prev - 1);
      toast.success('已删除');
    } catch {
      toast.error('网络错误');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  // --------------------------------------------------------
  // 发送到画布
  // --------------------------------------------------------
  const handleSendToCanvas = (asset: Asset) => {
    // 将图片信息存入 sessionStorage，画布页面读取后添加
    try {
      const pendingImages = JSON.parse(sessionStorage.getItem('canvas_pending_images') || '[]');
      pendingImages.push({
        url: asset.url,
        imageKey: asset.imageKey,
        prompt: asset.prompt,
      });
      sessionStorage.setItem('canvas_pending_images', JSON.stringify(pendingImages));
      toast.success('已加入画布队列，前往画布查看');
      // 跳转画布
      window.location.href = '/canvas';
    } catch {
      toast.error('操作失败');
    }
  };

  // --------------------------------------------------------
  // 渲染
  // --------------------------------------------------------

  // 未登录
  if (!isLoggedIn && !initialLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <ImageIcon className="w-16 h-16 mx-auto text-muted-foreground/40" />
          <h2 className="text-xl font-medium text-foreground">登录后查看你的图库</h2>
          <button
            onClick={() => setAuthModalOpen(true)}
            className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            立即登录
          </button>
        </div>
        <AuthModal
          isOpen={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          initialMode="login"
          onLoginSuccess={() => { setAuthModalOpen(false); window.location.reload(); }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {/* 左侧导航 */}
      <LeftNav />

      {/* 主内容 */}
      <div className="flex-1 min-h-screen">
        {/* 顶栏 */}
        <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <LayoutGrid className="w-5 h-5 text-primary" />
                <h1 className="text-lg font-semibold text-foreground">我的图库</h1>
                {!initialLoading && (
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {total} 项
                  </span>
                )}
              </div>
            </div>

            {/* Tab 切换 */}
            <div className="mt-3">
              <Tabs
                value={filterType}
                onValueChange={(v) => setFilterType(v as FilterType)}
                className="w-full"
              >
                <TabsList className="bg-muted/60 h-9">
                  <TabsTrigger value="all" className="text-xs px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    <LayoutGrid className="w-3.5 h-3.5 mr-1.5" />
                    全部
                  </TabsTrigger>
                  <TabsTrigger value="generated" className="text-xs px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                    AI 生成
                  </TabsTrigger>
                  <TabsTrigger value="uploaded" className="text-xs px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    上传参考
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </header>

        {/* 内容区 */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* 初始骨架屏 */}
          {initialLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square rounded-lg bg-muted animate-pulse"
                />
              ))}
            </div>
          )}

          {/* 空状态 */}
          {!initialLoading && assets.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 text-center">
              <div className="w-20 h-20 rounded-2xl bg-muted/60 flex items-center justify-center mb-5">
                <ImageIcon className="w-10 h-10 text-muted-foreground/50" />
              </div>
              <h3 className="text-base font-medium text-foreground mb-2">
                {filterType === 'generated' ? '还没有 AI 生成图片' :
                 filterType === 'uploaded' ? '还没有上传参考图' :
                 '图库是空的'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {filterType === 'generated'
                  ? '去生成页面创作你的第一张 AI 图片吧'
                  : filterType === 'uploaded'
                  ? '在生成时上传参考图，它们会出现在这里'
                  : '开始创作或上传，你的所有资产都会出现在这里'}
              </p>
            </div>
          )}

          {/* 图片网格 */}
          {!initialLoading && assets.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onSendToCanvas={handleSendToCanvas}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}

          {/* 无限滚动哨兵 */}
          {hasMore && !initialLoading && (
            <div ref={sentinelRef} className="flex justify-center py-8">
              {loading && (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              )}
            </div>
          )}

          {/* 没有更多 */}
          {!hasMore && assets.length > 0 && (
            <div className="text-center py-8 text-xs text-muted-foreground">
              — 已加载全部 {total} 项 —
            </div>
          )}
        </main>
      </div>

      {/* 删除确认弹窗 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复，确定要删除这张图片吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 登录弹窗 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode="login"
        onLoginSuccess={() => { setAuthModalOpen(false); window.location.reload(); }}
      />
    </div>
  );
}

// ============================================================
// 单个资产卡片
// ============================================================
function AssetCard({
  asset,
  onSendToCanvas,
  onDelete,
}: {
  asset: Asset;
  onSendToCanvas: (asset: Asset) => void;
  onDelete: (asset: Asset) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [hovered, setHovered] = useState(false);

  // 格式化时间
  const timeLabel = (() => {
    const d = new Date(asset.created_at);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}小时前`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}天前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
  })();

  return (
    <div
      className="group relative aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 图片 */}
      {imgError ? (
        <div className="w-full h-full flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground/40" />
        </div>
      ) : (
        <img
          src={asset.url}
          alt={asset.prompt || '图片'}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={() => setImgError(true)}
        />
      )}

      {/* 底部标签 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent px-2 py-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/80 truncate max-w-[70%]">
            {asset.type === 'generated'
              ? (asset.model || 'AI') + (asset.prompt ? ` · ${asset.prompt.slice(0, 12)}` : '')
              : '上传参考'}
          </span>
          <span className="text-[10px] text-white/60 shrink-0 ml-1">{timeLabel}</span>
        </div>
      </div>

      {/* Hover 遮罩层 */}
      <div
        className={`absolute inset-0 bg-black/40 flex items-center justify-center gap-3 transition-opacity duration-200 ${
          hovered ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* 发送到画布 */}
        <button
          onClick={(e) => { e.stopPropagation(); onSendToCanvas(asset); }}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/30 transition-colors"
          title="发送到画布"
        >
          <SendToBack className="w-4 h-4" />
        </button>

        {/* 删除 */}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(asset); }}
          className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-red-500/60 transition-colors"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
