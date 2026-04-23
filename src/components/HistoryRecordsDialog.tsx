'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, Download, Trash2, Eye, ChevronLeft, ChevronRight, ThumbsDown, Loader2, Star, StarOff } from 'lucide-react';
import ImagePreview, { ImageData } from '@/components/ImagePreview';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getPresignedUrls } from '@/lib/presigned-url-cache';
import { safeSetItem } from '@/lib/safe-storage';
import { useHistoryStore, type HistoryRecord } from '@/store/historyStore';

// #232 Sprint 4: 从 historyStore 导出类型，废弃本地定义
export type { HistoryRecord } from '@/store/historyStore';

interface HistoryRecordsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: 'canvas' | 'generate' | 'regenerate' | 'smart_split' | 'video'; // #247 扩展：支持所有来源
}

// 本地存储键（仅用于收藏和确认状态）
const FAVORITES_KEY = 'favoriteRecords_v2';
const DELETE_CONFIRM_KEY = 'deleteConfirmTime';
const CLEAR_CONFIRM_KEY = 'clearConfirmTime';

// 获取不喜欢列表
const getDislikedImages = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const saved = localStorage.getItem('dislikedImages');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  } catch {
    return new Set();
  }
};

const saveDislikedImages = (disliked: Set<string>) => {
  safeSetItem('dislikedImages', JSON.stringify(Array.from(disliked)));
};

export default function HistoryRecordsDialog({ open, onOpenChange, source }: HistoryRecordsDialogProps) {
  // #232 Sprint 4: 从 Zustand store 读取历史记录
  const { records: storeRecords, fetchRecords, isLoading, deleteRecord, updateRecord } = useHistoryStore();
  
  // 本地过滤后的记录（用于 source 过滤）
  // #247 修复：generate 包含 regenerate，两者在 UI 上应显示在一起
  const historyRecords = useMemo(() => {
    if (source) {
      if (source === 'generate') {
        // generate 来源包括：generate, regenerate, smart_split, video
        return storeRecords.filter(r => 
          ['generate', 'regenerate', 'smart_split', 'video'].includes(r.source || '')
        );
      }
      return storeRecords.filter(r => r.source === source);
    }
    return storeRecords;
  }, [storeRecords, source]);
  
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showPreview, setShowPreview] = useState(false);
  const [expiredImages, setExpiredImages] = useState<Set<string>>(new Set());
  const [dislikedImages, setDislikedImages] = useState<Set<string>>(new Set());
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | number | null>(null);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<(string | number)[]>([]);
  const itemsPerPage = 10;

  // #232 Sprint 4: 弹窗打开时从 API 获取数据
  useEffect(() => {
    if (open) {
      setDislikedImages(getDislikedImages());
      // 从 API 获取最新数据
      fetchRecords();
    }
  }, [open, fetchRecords]);

  // #232 Sprint 4: 同步状态从 store 获取
  const isSyncing = isLoading;

  // #150 Local-First：先检查 IndexedDB 缓存，再使用签名 URL 缓存
  // 如果图片已在 IndexedDB 中（画布/生图页面缓存过），直接使用本地 URL
  // #209 新增：签名 URL 缓存作为第二层，触发浏览器 Disk Cache
  // #213 新增：同时检查参考图的缓存
  const checkCacheForRecords = async (records: HistoryRecord[]) => {
    try {
      const { loadImageFromCache } = await import('@/lib/canvas-image-db');
      
      // 收集所有需要检查的 imageKeys（生成的图片）
      const keyMap: Map<string, { recordId: string | number; imageIndex: number; type: 'image' | 'reference' }> = new Map();
      records.forEach(record => {
        // 生成的图片
        if (record.image_keys) {
          record.image_keys.forEach((key, idx) => {
            if (key) {
              keyMap.set(key, { recordId: record.id, imageIndex: idx, type: 'image' });
            }
          });
        }
        // 🔧 #213 新增：参考图
        if (record.reference_image_keys) {
          record.reference_image_keys.forEach((key, idx) => {
            if (key) {
              keyMap.set(key, { recordId: record.id, imageIndex: idx, type: 'reference' });
            }
          });
        }
      });
      
      if (keyMap.size === 0) return;
      
      let hitCount = 0;
      const updates: Map<string | number, { imageIndex: number; cachedUrl: string; type: 'image' | 'reference' }[]> = new Map();
      
      // 第一层：IndexedDB 缓存
      const missedKeys: string[] = [];
      for (const [key, info] of keyMap) {
        const cachedUrl = await loadImageFromCache(key);
        if (cachedUrl) {
          hitCount++;
          if (!updates.has(info.recordId)) {
            updates.set(info.recordId, []);
          }
          updates.get(info.recordId)!.push({ imageIndex: info.imageIndex, cachedUrl, type: info.type });
        } else {
          missedKeys.push(key);
        }
      }
      
      // 第二层：签名 URL 缓存（#209 新增）
      if (missedKeys.length > 0) {
        console.log('[HistoryRecords] IndexedDB 未命中，尝试签名 URL 缓存:', missedKeys.length, '张');
        
        try {
          const fetchNewUrls = async (keysToFetch: string[]): Promise<Record<string, string>> => {
            const response = await fetch('/api/canvas/signed-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ keys: keysToFetch })
            });
            const data = await response.json();
            if (!data.success || !data.urls) {
              throw new Error('获取签名 URL 失败');
            }
            return data.urls;
          };
          
          const signedUrls = await getPresignedUrls(missedKeys, fetchNewUrls);
          
          for (const key of missedKeys) {
            const info = keyMap.get(key);
            const signedUrl = signedUrls[key];
            
            if (info && signedUrl) {
              hitCount++;
              if (!updates.has(info.recordId)) {
                updates.set(info.recordId, []);
              }
              updates.get(info.recordId)!.push({ imageIndex: info.imageIndex, cachedUrl: signedUrl, type: info.type });
            }
          }
          
          console.log('[HistoryRecords] 签名 URL 缓存命中:', Object.keys(signedUrls).length, '张');
        } catch (e) {
          console.warn('[HistoryRecords] 签名 URL 缓存获取失败:', e);
        }
      }
      
      // 批量更新记录（#232 Sprint 4: 使用 store 的 updateRecord 方法）
      if (updates.size > 0) {
        updates.forEach((recordUpdates, recordId) => {
          const record = storeRecords.find(r => r.id === recordId);
          if (!record) return;
          
          // 分别更新生成的图片和参考图
          const newImages = [...record.images];
          const newRefImages = [...(record.reference_images || [])];
          
          recordUpdates.forEach(({ imageIndex, cachedUrl, type }) => {
            if (type === 'reference') {
              // 更新参考图
              while (newRefImages.length <= imageIndex) newRefImages.push('');
              newRefImages[imageIndex] = cachedUrl;
            } else {
              // 更新生成的图片
              if (imageIndex < newImages.length) {
                newImages[imageIndex] = cachedUrl;
              }
            }
          });
          
          updateRecord({ ...record, images: newImages, reference_images: newRefImages });
        });
        
        console.log('[历史记录] 总缓存命中:', hitCount, '/', keyMap.size, '张');
      }
    } catch (err) {
      console.error('[历史记录] 缓存检查失败:', err);
    }
  };

  const handleImageError = (src: string) => {
    setExpiredImages(prev => new Set(prev).add(src));
  };

  const handleToggleDislike = (imageUrl: string) => {
    setDislikedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageUrl)) newSet.delete(imageUrl);
      else newSet.add(imageUrl);
      saveDislikedImages(newSet);
      return newSet;
    });
  };

  // 图片组件
  const Img = ({ src, alt, className, onClick, isDisliked }: { 
    src: string; 
    alt: string; 
    className?: string;
    onClick?: () => void;
    isDisliked?: boolean;
  }) => {
    if (expiredImages.has(src)) {
      return (
        <div className={`${className} flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded`}>
          <span className="text-xs text-gray-400">加载失败</span>
        </div>
      );
    }
    return (
      <div className="relative group">
        <img src={src} alt={alt} className={`${className} ${isDisliked ? 'opacity-40 grayscale' : ''}`} onClick={onClick} loading="lazy" onError={() => handleImageError(src)} />
        {isDisliked && <span className="absolute bottom-0 right-0 px-1 py-0.5 bg-gray-600 text-white text-[8px] rounded">不喜欢</span>}
      </div>
    );
  };

  const handleSelectAll = (checked: boolean) => setSelectedIds(checked ? paginatedRecords.map(r => r.id) : []);
  const handleSelectOne = (id: string | number, checked: boolean) => setSelectedIds(checked ? [...selectedIds, id] : selectedIds.filter(i => i !== id));

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

  // 检查是否需要在删除时显示确认弹窗
  const checkDeleteConfirmNeeded = (): boolean => {
    try {
      const savedTime = localStorage.getItem(DELETE_CONFIRM_KEY);
      if (!savedTime) return true;
      const confirmTime = new Date(savedTime).getTime();
      const now = Date.now();
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      return now < todayEnd.getTime() && now >= confirmTime;
    } catch {
      return true;
    }
  };

  // 检查是否需要在清空时显示确认弹窗
  const checkClearConfirmNeeded = (): boolean => {
    try {
      const savedTime = localStorage.getItem(CLEAR_CONFIRM_KEY);
      if (!savedTime) return true;
      const confirmTime = new Date(savedTime).getTime();
      const now = Date.now();
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      return now < todayEnd.getTime() && now >= confirmTime;
    } catch {
      return true;
    }
  };

  const handleDelete = (id: string | number) => {
    if (checkDeleteConfirmNeeded()) {
      setPendingDeleteId(id);
      setShowDeleteConfirm(true);
    } else {
      performDelete(id);
    }
  };

  // #232 Sprint 4: 使用 store 的 deleteRecord 方法
  const performDelete = async (id: string | number) => {
    const idStr = String(id);
    // 更新收藏状态
    const newFavorites = new Set(favoriteIds);
    newFavorites.delete(idStr);
    setFavoriteIds(newFavorites);
    safeSetItem(FAVORITES_KEY, JSON.stringify(Array.from(newFavorites)));
    // 调用 store 删除（会同时更新内存和 API）
    await deleteRecord(idStr);
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

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return;
    if (checkDeleteConfirmNeeded()) {
      setPendingDeleteIds(selectedIds);
      setShowDeleteConfirm(true);
    } else {
      performDeleteSelected();
    }
  };

  // #232 Sprint 4: 使用 store 的 deleteRecord 方法批量删除
  const performDeleteSelected = async () => {
    const newFavorites = new Set(favoriteIds);
    selectedIds.forEach(id => newFavorites.delete(String(id)));
    setFavoriteIds(newFavorites);
    safeSetItem(FAVORITES_KEY, JSON.stringify(Array.from(newFavorites)));
    // 批量删除（调用 store）
    for (const id of selectedIds) {
      await deleteRecord(String(id));
    }
    setSelectedIds([]);
    setShowDeleteConfirm(false);
    setPendingDeleteIds([]);
  };

  const handleConfirmDeleteSelected = () => {
    if (deleteConfirmNoMore) {
      safeSetItem(DELETE_CONFIRM_KEY, new Date().toISOString());
    }
    performDeleteSelected();
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
    } catch (e) {
      console.error('下载失败:', e);
    }
  };

  const handleDownloadSelected = async () => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) {
      const record = historyRecords.find(r => r.id === id);
      if (record?.images) {
        for (let i = 0; i < record.images.length; i++) {
          await handleDownload(record.images[i], `image-${id}-${i + 1}.png`);
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }
  };

  const handlePreviewImage = (images: string[], index: number) => {
    const allImages = historyRecords.flatMap(r => r.images || []);
    setPreviewImages(allImages);
    setPreviewIndex(Math.max(0, allImages.indexOf(images[index])));
    setShowPreview(true);
  };

  const allRecordImages = useMemo(() => {
    return historyRecords.flatMap((r, idx) => (r.images || []).map((url, i) => ({ taskId: r.id.toString(), imageIndex: i, url })));
  }, [historyRecords]);

  const formatDate = (d: string) => new Date(d).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  // 根据 Tab 过滤记录
  const displayRecords = useMemo(() => {
    if (activeTab === 'favorites') {
      return historyRecords.filter(r => favoriteIds.has(r.id));
    }
    return historyRecords;
  }, [historyRecords, favoriteIds, activeTab]);

  const totalPages = Math.ceil(displayRecords.length / itemsPerPage);
  const paginatedRecords = displayRecords.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Tab 切换时重置页码
  const handleTabChange = (tab: 'history' | 'favorites') => {
    setActiveTab(tab);
    setCurrentPage(1);
    setSelectedIds([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold">
              {activeTab === 'favorites' ? '我的收藏' : '历史记录'}
              {isSyncing && <Loader2 className="inline w-4 h-4 ml-2 animate-spin" />}
            </DialogTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { fetchRecords(); }} disabled={isSyncing}>
                <RefreshCw className={`w-3 h-3 mr-1 ${isSyncing ? 'animate-spin' : ''}`} /> 刷新
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadSelected} disabled={selectedIds.length === 0}>
                <Download className="w-3 h-3 mr-1" /> 下载选中
              </Button>
              <Button variant="outline" size="sm" className="text-red-600" onClick={handleDeleteSelected} disabled={selectedIds.length === 0}>
                <Trash2 className="w-3 h-3 mr-1" /> 删除选中
              </Button>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <Button
              variant={activeTab === 'history' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleTabChange('history')}
            >
              历史记录
            </Button>
            <Button
              variant={activeTab === 'favorites' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleTabChange('favorites')}
            >
              我的收藏
            </Button>
          </div>
        </DialogHeader>

        <div className="mt-4">
          {displayRecords.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <p>{activeTab === 'favorites' ? '暂无收藏' : '暂无历史记录'}</p>
              <p className="text-sm text-gray-400 mt-1">{activeTab === 'favorites' ? '点击收藏按钮添加' : '生成图片后将自动保存'}</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px]"><Checkbox checked={selectedIds.length === paginatedRecords.length && paginatedRecords.length > 0} onCheckedChange={(c) => handleSelectAll(!!c)} /></TableHead>
                      <TableHead className="w-[150px]">模型</TableHead>
                      <TableHead className="w-[200px]">提示词</TableHead>
                      <TableHead className="w-[80px]">参考图</TableHead>
                      <TableHead className="w-[120px]">生成图片</TableHead>
                      <TableHead className="w-[80px]">扣费</TableHead>
                      <TableHead className="w-[80px]">分辨率</TableHead>
                      <TableHead className="w-[150px]">生成时间</TableHead>
                      <TableHead className="w-[100px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRecords.map((record) => (
                      <TableRow key={record.id}>
                        <TableCell><Checkbox checked={selectedIds.includes(record.id)} onCheckedChange={(c) => handleSelectOne(record.id, !!c)} /></TableCell>
                        <TableCell className="text-sm font-medium">{record.model || '-'}</TableCell>
                        <TableCell><div className="max-w-[200px] truncate text-sm" title={record.prompt}>{record.prompt || '-'}</div></TableCell>
                        <TableCell>
                          {record.reference_images && record.reference_images.length > 0 ? (
                            <div className="flex gap-1">
                              {record.reference_images.slice(0, 2).map((img, idx) => (
                                <img key={idx} src={img} alt="" className="w-10 h-10 object-cover rounded border cursor-pointer hover:opacity-80" loading="lazy" onClick={() => handlePreviewImage(record.reference_images!, idx)} />
                              ))}
                            </div>
                          ) : <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center"><span className="text-xs text-gray-400">无</span></div>}
                        </TableCell>
                        <TableCell>
                          {record.images?.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {record.images.map((img, idx) => (
                                <div key={idx} className="relative group">
                                  <Img src={img} alt="" className="w-10 h-10 object-cover rounded border cursor-pointer hover:opacity-80" onClick={() => handlePreviewImage(record.images, idx)} isDisliked={dislikedImages.has(img)} />
                                  <button className="absolute -top-1 -right-1 w-4 h-4 bg-gray-500 hover:bg-gray-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); handleToggleDislike(img); }}>
                                    <ThumbsDown className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center"><span className="text-xs text-gray-400">无</span></div>}
                        </TableCell>
                        <TableCell className="text-sm">
                          {record.credits_charged != null ? (
                            <div className="flex flex-col">
                              <span className="text-amber-600 font-medium">-{record.credits_charged}</span>
                              {record.credits_balance != null && (
                                <span className="text-xs text-gray-400">余额 {record.credits_balance}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{record.resolution || '-'}</TableCell>
                        <TableCell className="text-sm text-gray-500">{formatDate(record.created_at)}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {record.images?.length > 0 && <Button variant="ghost" size="sm" className="text-xs text-[rgb(139,158,232)]" onClick={() => handlePreviewImage(record.images, 0)}><Eye className="w-3 h-3" /></Button>}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`text-xs ${favoriteIds.has(record.id) ? 'text-yellow-500' : 'text-gray-400'}`}
                              onClick={() => handleToggleFavorite(record.id)}
                              title={favoriteIds.has(record.id) ? '取消收藏' : '收藏'}
                            >
                              {favoriteIds.has(record.id) ? <Star className="w-3 h-3 fill-yellow-500" /> : <StarOff className="w-3 h-3" />}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-xs text-red-600" onClick={() => handleDelete(record.id)}><Trash2 className="w-3 h-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between mt-4">
                <span className="text-sm text-gray-600">共 {displayRecords.length} 条，第 {currentPage}/{totalPages || 1} 页</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="px-2" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}><ChevronLeft className="w-4 h-4" /></Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const p = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i;
                    return <Button key={p} variant={currentPage === p ? 'default' : 'outline'} size="sm" className="w-8 text-xs" style={currentPage === p ? { background: 'linear-gradient(to right, rgb(139,158,232), rgb(232,180,184))', color: '#fff' } : {}} onClick={() => setCurrentPage(p)}>{p}</Button>;
                  })}
                  <Button variant="outline" size="sm" className="px-2" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0}><ChevronRight className="w-4 h-4" /></Button>
                </div>
              </div>
            </>
          )}
        </div>
        <ImagePreview images={previewImages} currentIndex={previewIndex} isOpen={showPreview} onClose={() => setShowPreview(false)} allImagesData={allRecordImages} />
        
        {/* 删除确认弹窗 */}
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingDeleteIds.length > 0
                  ? `确定要删除选中的 ${pendingDeleteIds.length} 条记录吗？删除后无法恢复。`
                  : '确定要删除这条记录吗？删除后无法恢复。'
                }
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex items-center gap-2 my-4">
              <Checkbox
                id="no-more-confirm"
                checked={deleteConfirmNoMore}
                onCheckedChange={(c) => setDeleteConfirmNoMore(!!c)}
              />
              <label htmlFor="no-more-confirm" className="text-sm text-gray-600">
                今天不再提示（北京时间24时前）
              </label>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={handleConfirmDelete || handleConfirmDeleteSelected} className="bg-red-600 hover:bg-red-700">
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
