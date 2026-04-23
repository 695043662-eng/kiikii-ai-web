'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import LeftNav from '@/components/LeftNav';
import AuthModal from '@/components/AuthModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Download, Trash2, Image as ImageIcon, X, Loader2, Calendar, Cpu, FileImage, Type, Search, Filter, Star, StarOff, ChevronLeft, ChevronRight, Coins } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { safeSetItem } from '@/lib/safe-storage';
import { useHistoryStore, type HistoryRecord } from '@/store/historyStore';

// 本地存储键（仅用于收藏和确认状态）
const FAVORITES_KEY = 'favoriteRecords_v2';
const DELETE_CONFIRM_KEY = 'deleteConfirmTime';

export default function HistoryPage() {
  // ============================================
  // 【接入 AIGeneratorContext - 统一用户状态】
  // ============================================
  const { isLoggedIn: ctxIsLoggedIn, refreshUserInfo } = useAIGenerator();
  const isLoggedIn = ctxIsLoggedIn;
  
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  
  // #232 使用 Zustand store 获取历史记录
  const { records: storeRecords, isLoading, fetchRecords, deleteRecord, clearAllRecords } = useHistoryStore();
  const records = storeRecords;
  
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string | number>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem(FAVORITES_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [activeTab, setActiveTab] = useState<'history' | 'favorites'>('history');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmNoMore, setDeleteConfirmNoMore] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | number | null>(null);
  
  // 提示词悬浮提示
  const [hoveredPrompt, setHoveredPrompt] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const promptTooltipRef = useRef<HTMLDivElement>(null);
  const tooltipTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 搜索和筛选
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [filterModel, setFilterModel] = useState('');

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // 获取所有模型列表（用于筛选）
  const allModels = Array.from(new Set(records.map(r => r.model).filter(Boolean)));

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

  // 清理 tooltip timeout
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  const handleLoginSuccess = (user: any) => {
    // 【isLoggedIn 已由 AIGeneratorContext 统一管理】
    setAuthModalOpen(false);
    refreshUserInfo();
  };

  // #232 页面加载时从 store 获取数据（已从 API 加载）
  useEffect(() => {
    if (records.length === 0 && !isLoading) {
      fetchRecords();
    }
  }, []);

  const handleDeleteRecord = (id: string | number) => {
    // 检查是否需要显示确认弹窗
    try {
      const savedTime = localStorage.getItem(DELETE_CONFIRM_KEY);
      if (!savedTime) {
        // 没有保存过时间，需要显示确认弹窗
        setPendingDeleteId(id);
        setShowDeleteConfirm(true);
        return;
      }
      const confirmTime = new Date(savedTime).getTime();
      const now = Date.now();
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      
      // 检查是否在24小时内（北京时间）
      if (now < todayEnd.getTime() && now >= confirmTime) {
        // 在有效期内，直接删除
        performDelete(id);
      } else {
        // 已过期，需要显示确认弹窗
        setPendingDeleteId(id);
        setShowDeleteConfirm(true);
      }
    } catch {
      // 出错时显示确认弹窗
      setPendingDeleteId(id);
      setShowDeleteConfirm(true);
    }
  };

  const performDelete = async (id: string | number) => {
    // #232 使用 store 的 deleteRecord（强制转 string）
    await deleteRecord(String(id));
    // 更新收藏
    const newFavorites = new Set(favoriteIds);
    newFavorites.delete(id);
    setFavoriteIds(newFavorites);
    safeSetItem(FAVORITES_KEY, JSON.stringify(Array.from(newFavorites)));
    setShowDeleteConfirm(false);
    setPendingDeleteId(null);
  };

  const handleConfirmDelete = () => {
    if (deleteConfirmNoMore) {
      safeSetItem(DELETE_CONFIRM_KEY, new Date().toISOString());
    }
    if (pendingDeleteId !== null) {
      performDelete(pendingDeleteId);
    }
  };

  // 收藏和取消收藏
  const handleToggleFavorite = (id: string | number) => {
    setFavoriteIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      safeSetItem(FAVORITES_KEY, JSON.stringify(Array.from(newSet)));
      return newSet;
    });
  };

  const handleDownload = async (imageUrl: string, filename: string) => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('下载失败:', error);
    }
  };

  const handleClearAll = () => {
    setShowClearConfirm(true);
  };

  const performClearAll = async () => {
    try {
      // 调用批量清空 API
      // #108 修复：添加 credentials: 'include' 确保请求携带 cookie
      const response = await fetch('/api/generation-records/clear', {
        method: 'POST',
        credentials: 'include',
      });

      const result = await response.json();

      if (result.success) {
        // #232 清空 store 和服务器数据
        clearAllRecords();
        const newFavorites = new Set(favoriteIds);
        newFavorites.clear();
        setFavoriteIds(newFavorites);
        safeSetItem(FAVORITES_KEY, JSON.stringify([]));
        setShowClearConfirm(false);
      } else {
        console.error('清空失败:', result.error);
        toast.error('清空失败: ' + result.error);
      }
    } catch (error) {
      console.error('清空错误:', error);
      toast.error('清空失败，请重试');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 过滤记录
  // #247 支持所有生图来源：generate, regenerate, canvas, smart_split, video
  const filteredRecords = records.filter(record => {
    // #247 不再限制 source，只要是生图相关记录都显示
    // 旧逻辑：只显示 source === 'generate' 的记录
    // 新逻辑：显示所有生图来源的记录
    const validSources = ['generate', 'regenerate', 'canvas', 'smart_split', 'video'];
    if (record.source && !validSources.includes(record.source)) {
      return false;
    }
    // 关键词搜索
    if (searchKeyword) {
      const keyword = searchKeyword.toLowerCase();
      const matchPrompt = record.prompt?.toLowerCase().includes(keyword);
      const matchModel = record.model?.toLowerCase().includes(keyword);
      if (!matchPrompt && !matchModel) return false;
    }
    // 模型筛选
    if (filterModel && record.model !== filterModel) {
      return false;
    }
    // Tab 过滤
    if (activeTab === 'favorites' && !favoriteIds.has(record.id)) {
      return false;
    }
    return true;
  });

  // 分页逻辑
  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  // 当筛选条件变化时，重置到第一页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchKeyword, filterModel, activeTab]);

  // 重置筛选
  const handleResetFilter = () => {
    setSearchKeyword('');
    setFilterModel('');
  };

  // 图片预览处理
  const handlePreviewImage = (images: string[], index: number, isReference: boolean = false) => {
    if (isReference) {
      // 参考图：只显示当前点击的参考图，不支持切换
      setPreviewImages([images[index]]);
      setPreviewIndex(0);
    } else {
      // 生成图：收集所有记录的生成图，支持左右切换
      const allImages = filteredRecords.flatMap(r => r.images || []);
      setPreviewImages(allImages);
      setPreviewIndex(allImages.indexOf(images[index]));
    }
  };

  const handlePreviousImage = () => {
    setPreviewIndex(prev => prev > 0 ? prev - 1 : previewImages.length - 1);
  };

  const handleNextImage = () => {
    setPreviewIndex(prev => prev < previewImages.length - 1 ? prev + 1 : 0);
  };

  const handleClosePreview = () => {
    setPreviewImages([]);
    setPreviewIndex(0);
  };

  // 键盘事件处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (previewImages.length === 0) return;

      if (e.key === 'Escape') {
        handleClosePreview();
      } else if (e.key === 'ArrowLeft') {
        handlePreviousImage();
      } else if (e.key === 'ArrowRight') {
        handleNextImage();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewImages.length]);

  // 处理弹窗打开时的滚动锁定
  useEffect(() => {
    const handleScrollLock = (shouldLock: boolean) => {
      if (shouldLock) {
        document.body.setAttribute('data-scroll-locked', 'true');
      } else {
        document.body.removeAttribute('data-scroll-locked');
      }
    };

    const isAnyDialogOpen = showDeleteConfirm || showClearConfirm;
    handleScrollLock(isAnyDialogOpen);
  }, [showDeleteConfirm, showClearConfirm]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1E1F2F]">
      {/* 左侧导航 */}
      <LeftNav />
      
      {/* 主内容区 */}
      <main className="container mx-auto px-4 pl-20 pb-8">
        {/* 顶部固定栏目组 */}
        <div className="fixed top-0 left-64 right-0 z-50 bg-gray-50 dark:bg-[#1E1F2F] pt-8 pb-4 border-b border-gray-200 dark:border-gray-800">
        <div className="container mx-auto px-4 pl-0">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white">
              {activeTab === 'favorites' ? '我的收藏' : '生成记录'}
            </h1>
            <p className="text-sm text-orange-600 dark:text-orange-400 font-medium">
              ⚠️ 记录内容仅保存10天，请尽快下载
            </p>
            {isLoading && <Loader2 className="w-5 h-5 animate-spin text-[rgb(139,158,232)]" />}
          </div>
          <div className="flex items-center gap-2">
            {/* Tab 切换 */}
            <div className="flex items-center gap-2 mr-4">
              <Button
                variant={activeTab === 'history' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab('history')}
                className="h-9"
              >
                历史记录
              </Button>
              <Button
                variant={activeTab === 'favorites' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTab('favorites')}
                className="h-9"
              >
                我的收藏
              </Button>
            </div>
            
            {/* 搜索框 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="搜索提示词、模型..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="w-48 pl-9 h-9 text-sm"
              />
            </div>
            
            {/* 筛选按钮 */}
            <Button 
              variant="outline" 
              size="sm"
              className={`h-9 ${showFilter ? 'bg-[rgb(139,158,232)]/10 border-[rgb(139,158,232)] text-[rgb(139,158,232)]' : ''}`}
              onClick={() => setShowFilter(!showFilter)}
            >
              <Filter className="w-4 h-4 mr-1" />
              筛选
            </Button>
            
            <Button variant="outline" size="sm" className="h-9" onClick={() => fetchRecords()} disabled={isLoading}>
              {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              刷新
            </Button>
            <Button variant="outline" size="sm" className="h-9 text-red-600" onClick={handleClearAll} disabled={records.length === 0}>
              <Trash2 className="w-4 h-4 mr-1" />
              清空
            </Button>
          </div>
        </div>

        {/* 筛选面板 */}
        {showFilter && (
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4 mb-4">
            <div className="flex items-center gap-4 flex-wrap">
              {/* 提示词搜索 */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">提示词：</span>
                <Input
                  type="text"
                  placeholder="输入关键词..."
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className="w-40 h-8 text-sm"
                />
              </div>
              
              {/* 模型筛选 */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">模型：</span>
                <select
                  value={filterModel}
                  onChange={(e) => setFilterModel(e.target.value)}
                  className="h-8 px-2 text-sm border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                >
                  <option value="">全部</option>
                  {allModels.map(model => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </div>
              
              {/* 重置按钮 */}
              <Button variant="ghost" size="sm" onClick={handleResetFilter}>
                重置筛选
              </Button>
            </div>
          </div>
        )}
        </div>
        </div>

        {/* 内容区域 - 添加顶部 padding 避免被固定栏目遮挡 */}
        <div className="pt-36">
        {filteredRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <ImageIcon className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg">{records.length === 0 ? '暂无生成记录' : '没有匹配的记录'}</p>
            <p className="text-sm text-gray-400 mt-1">
              {records.length === 0 ? '生成图片后将自动保存到这里' : '尝试修改搜索条件'}
            </p>
          </div>
        ) : (
          <>
            {/* 记录列表 */}
            <div className="space-y-3">
            {paginatedRecords.map((record) => (
              <div key={record.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden hover:shadow-lg transition-shadow">
                <div className="flex items-center gap-4 p-3">
                  {/* 左侧：文本信息 */}
                  <div className="w-48 flex-shrink-0 space-y-1.5">
                    {/* 来源标签 + 提交时间 */}
                    <div className="flex items-center gap-1.5">
                      {/* #107 新增：来源标签 */}
                      {record.source === 'canvas' ? (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">画布</span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">生图</span>
                      )}
                      <Calendar className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-500">{formatDate(record.created_at)}</span>
                    </div>
                    
                    {/* 积分信息 - 扣费明细（移到时间后面） */}
                    {record.credits_charged != null && (
                      <div className="flex items-center gap-1.5">
                        <Coins className="w-3 h-3 text-amber-500" />
                        <span className="text-xs text-gray-700 dark:text-gray-300">
                          <span className="text-amber-600 font-medium">-{record.credits_charged}</span>
                          {record.credits_balance != null && (
                            <span className="text-gray-400 ml-1">余额 {record.credits_balance}</span>
                          )}
                        </span>
                      </div>
                    )}
                    
                    {/* 模型 + 参数 */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Cpu className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{record.model || '-'}</span>
                      {record.resolution && (
                        <span className="text-xs text-gray-500">{record.resolution}</span>
                      )}
                      {record.aspect_ratio && (
                        <span className="text-xs text-gray-500">{record.aspect_ratio}</span>
                      )}
                    </div>

                    {/* 提示词 */}
                    <div className="flex items-start gap-1.5 relative">
                      <Type className="w-3 h-3 text-gray-400 mt-0.5 flex-shrink-0" />
                      <p 
                        className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 flex-1 cursor-default"
                        onMouseEnter={(e) => {
                          if (record.prompt && record.prompt.length > 25) {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const viewportWidth = window.innerWidth;
                            const viewportHeight = window.innerHeight;
                            
                            // 位置：在提示词上方显示，避免挡住鼠标
                            let x = rect.left;
                            let y = rect.top - 2;
                            
                            // 防止超出右边界
                            if (x + 400 > viewportWidth) {
                              x = viewportWidth - 420;
                            }
                            
                            // 防止超出顶部边界
                            if (y < 10) {
                              y = rect.bottom + 2;
                            }

                            // 取消之前的消失定时器
                            if (tooltipTimeoutRef.current) {
                              clearTimeout(tooltipTimeoutRef.current);
                              tooltipTimeoutRef.current = null;
                            }

                            setTooltipPosition({ x, y });
                            setHoveredPrompt(record.prompt);
                          }
                        }}
                        onMouseLeave={() => {
                          // 延迟消失，让鼠标可以移动到弹窗上
                          if (tooltipTimeoutRef.current) {
                            clearTimeout(tooltipTimeoutRef.current);
                          }
                          tooltipTimeoutRef.current = setTimeout(() => {
                            setHoveredPrompt(null);
                          }, 300);
                        }}
                      >
                        {record.prompt || '无提示词'}
                      </p>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        className={`text-xs px-3 py-1 rounded border ${
                          favoriteIds.has(record.id)
                            ? 'border-yellow-400 text-yellow-600 bg-yellow-50 font-medium'
                            : 'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700'
                        }`}
                        onClick={() => handleToggleFavorite(record.id)}
                        title={favoriteIds.has(record.id) ? '取消收藏' : '收藏'}
                      >
                        {favoriteIds.has(record.id) ? '已收藏' : '收藏'}
                      </button>
                      <button
                        className="text-xs px-3 py-1 rounded border border-gray-300 text-red-500 hover:border-red-400 hover:bg-red-50"
                        onClick={() => handleDeleteRecord(record.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {/* 中间：参考图 */}
                  <div className="flex-shrink-0" style={{ minWidth: '80px' }}>
                    <div className="flex items-center gap-1 mb-1">
                      <FileImage className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-500">参考图</span>
                    </div>
                    {record.reference_images && record.reference_images.length > 0 ? (
                      <div className="flex gap-1 flex-wrap">
                        {record.reference_images.map((refImg: string, idx: number) => (
                          refImg ? (
                            <div
                              key={idx}
                              className="w-14 h-14 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer border border-gray-200 dark:border-gray-600"
                              onClick={() => handlePreviewImage(record.reference_images || [], idx, true)}
                            >
                              <img
                                src={refImg}
                                alt={`参考图${idx + 1}`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  target.parentElement!.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400 text-xs">失败</div>';
                                }}
                              />
                            </div>
                          ) : null
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">无参考图</span>
                    )}
                  </div>

                  {/* 右侧：生成图 */}
                  <div className="flex-1">
                    <div className="flex items-center gap-1 mb-1">
                      <ImageIcon className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-500">生成图 ({record.images?.length || 0}张)</span>
                    </div>
                    {/* 🔧 #123 修复：移除slice(0,6)限制，添加flex-wrap自动换行 */}
                    <div className="flex flex-wrap gap-1.5">
                      {record.images?.map((img, idx) => (
                        <div key={idx} className="relative group">
                          <div
                            className="w-16 h-16 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 cursor-pointer border border-gray-200 dark:border-gray-600"
                            onClick={() => handlePreviewImage(record.images, idx, false)}
                          >
                            <img
                              src={img}
                              alt={`生成图${idx + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                          <button
                            className="absolute top-0.5 right-0.5 p-1 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); handleDownload(img, `image-${record.id}-${idx + 1}.png`); }}
                          >
                            <Download className="w-2.5 h-2.5 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            </div>

            {/* 分页控件 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-6 pb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-9"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  上一页
                </Button>

                {/* 页码显示 */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }, (_, i) => {
                    const page = i + 1;
                    // 简化显示：只显示第一页、最后一页、当前页及其前后页
                    if (
                      page === 1 ||
                      page === totalPages ||
                      (page >= currentPage - 1 && page <= currentPage + 1) ||
                      (currentPage === 1 && page === 3) ||
                      (currentPage === totalPages && page === totalPages - 2)
                    ) {
                      return (
                        <Button
                          key={page}
                          variant={currentPage === page ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setCurrentPage(page)}
                          className={`h-9 w-9 ${currentPage === page ? 'bg-[rgb(139,158,232)] hover:bg-[rgb(139,158,232)]/90' : ''}`}
                        >
                          {page}
                        </Button>
                      );
                    } else if (
                      (page === currentPage - 2 && currentPage > 3) ||
                      (page === currentPage + 2 && currentPage < totalPages - 2)
                    ) {
                      return <span key={page} className="text-gray-400">...</span>;
                    }
                    return null;
                  })}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="h-9"
                >
                  下一页
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>

                {/* 页数信息 */}
                <span className="text-sm text-gray-600 dark:text-gray-400 ml-4">
                  第 {currentPage} / {totalPages} 页，共 {filteredRecords.length} 条
                </span>
              </div>
            )}

        {/* 图片预览 */}
        {previewImages.length > 0 && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={handleClosePreview}>
            <button className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors" onClick={(e) => { e.stopPropagation(); handleClosePreview(); }}>
              <X className="w-6 h-6 text-white" />
            </button>

            {/* 左右切换按钮 */}
            {previewImages.length > 1 && (
              <>
                <button
                  className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm"
                  onClick={(e) => { e.stopPropagation(); handlePreviousImage(); }}
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
                <button
                  className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm"
                  onClick={(e) => { e.stopPropagation(); handleNextImage(); }}
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
              </>
            )}

            <div className="relative">
              <img
                src={previewImages[previewIndex]}
                alt={`预览图 ${previewIndex + 1}`}
                className="max-w-[calc(100vw-16rem)] max-h-[calc(100vh-6rem)] object-contain"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* 底部提示 */}
            <div className="absolute bottom-4 left-0 right-0 text-center text-white/60 text-xs">
              {previewIndex + 1} / {previewImages.length} · 使用键盘 ← → 切换图片（跨组循环），ESC 关闭预览
            </div>
          </div>
        )}
          </>
        )}
        </div>
      </main>

      {/* 清空确认弹窗 */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent className="sm:max-w-[400px] p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold text-gray-900 dark:text-white mb-2">清空所有记录</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed space-y-2">
              <p>您即将清空所有生成记录，此操作不可恢复。</p>
              <p className="font-semibold text-red-600">请确认是否继续？</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex mt-6 gap-2">
            <AlertDialogCancel className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">取消</AlertDialogCancel>
            <AlertDialogAction onClick={performClearAll} className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white">确认清空</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认弹窗 */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="sm:max-w-[400px] p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-semibold text-gray-900 dark:text-white mb-2">确认删除</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              确定要删除这条记录吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 my-4">
            <Checkbox
              id="no-more-confirm"
              checked={deleteConfirmNoMore}
              onCheckedChange={(c) => setDeleteConfirmNoMore(!!c)}
            />
            <label htmlFor="no-more-confirm" className="text-sm text-gray-600 dark:text-gray-400">
              今天不再提示
            </label>
          </div>
          <AlertDialogFooter className="flex mt-6 gap-2">
            <AlertDialogCancel className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 登录/注册模态框 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* 提示词悬浮提示 */}
      {hoveredPrompt && (
        <div
          ref={promptTooltipRef}
          className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-3 max-w-[400px] max-h-[200px] overflow-auto select-text"
          style={{
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: 'translateY(-100%)',
          }}
          onMouseEnter={(e) => {
            // 鼠标进入弹窗，取消消失定时器
            e.stopPropagation();
            if (tooltipTimeoutRef.current) {
              clearTimeout(tooltipTimeoutRef.current);
              tooltipTimeoutRef.current = null;
            }
          }}
          onMouseLeave={() => {
            // 鼠标离开弹窗，立即消失
            setHoveredPrompt(null);
          }}
        >
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words select-text leading-relaxed">
            {hoveredPrompt}
          </p>
        </div>
      )}
    </div>
  );
}
