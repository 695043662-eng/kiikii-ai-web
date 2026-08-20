'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy, Trash2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { safeSetItem } from '@/lib/safe-storage';

interface PromptHistoryItem {
  id: number;
  prompt: string;
  reference_images: string[];
  reference_image_keys?: string[];  // 新增：持久化的 imageKey，用于重新获取签名 URL
}

interface HistoryPromptsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPrompt?: (prompt: string, referenceImages?: string[], referenceImageKeys?: string[]) => void;
}

// 本地存储键
const STORAGE_KEY = 'promptHistory_v2';

// 从本地存储读取
function loadLocalPrompts(): PromptHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error('读取本地提示词失败:', e);
  }
  return [];
}

// 保存提示词到本地
export function savePromptToLocal(prompt: string, reference_images: string[] = [], reference_image_keys: string[] = [], id?: number) {
  try {
    const prompts = loadLocalPrompts();
    const newItem: PromptHistoryItem = {
      id: id || Date.now(),
      prompt,
      reference_images,
      reference_image_keys: reference_image_keys.length > 0 ? reference_image_keys : undefined,
    };
    // 避免重复
    if (!prompts.find(p => p.prompt === prompt)) {
      prompts.unshift(newItem);
      // 最多保存100条
      if (prompts.length > 100) prompts.pop();
      safeSetItem(STORAGE_KEY, JSON.stringify(prompts));
    }
  } catch (e) {
    console.error('保存提示词失败:', e);
  }
}

// 预加载
let preloadedPrompts: PromptHistoryItem[] | null = null;
const preloadPrompts = () => {
  if (preloadedPrompts === null && typeof window !== 'undefined') {
    preloadedPrompts = loadLocalPrompts();
  }
  return preloadedPrompts || [];
};

if (typeof window !== 'undefined') {
  setTimeout(() => preloadPrompts(), 100);
}

export default function HistoryPromptsDialog({ 
  open, 
  onOpenChange,
  onSelectPrompt 
}: HistoryPromptsDialogProps) {
  const [historyPrompts, setHistoryPrompts] = useState<PromptHistoryItem[]>(() => preloadPrompts());
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // 弹窗打开时立即显示本地数据
  useEffect(() => {
    if (open) {
      const localPrompts = loadLocalPrompts();
      setHistoryPrompts(localPrompts);
      setCurrentPage(1);
      // 后台同步
      syncFromServer();
    }
  }, [open]);

  // 从服务器同步
  const syncFromServer = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch('/api/prompt-history?limit=100&offset=0');
      const data = await response.json();
      
      if (data.success && data.prompts?.length > 0) {
        const localPrompts = loadLocalPrompts();
        const serverIds = new Set(data.prompts.map((p: any) => p.id));
        const merged = [
          ...data.prompts.map((p: any) => ({
            id: p.id,
            prompt: p.prompt,
            reference_images: p.reference_images || [],
          })),
          ...localPrompts.filter(p => !serverIds.has(p.id))
        ];
        
        setHistoryPrompts(merged);
        safeSetItem(STORAGE_KEY, JSON.stringify(merged.slice(0, 100)));
        preloadedPrompts = merged;
      }
    } catch (error) {
      console.error('同步提示词失败:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const totalPages = Math.ceil(historyPrompts.length / itemsPerPage);
  const paginatedPrompts = historyPrompts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleOneClickPaste = (item: PromptHistoryItem) => {
    if (onSelectPrompt) {
      onSelectPrompt(item.prompt, item.reference_images, item.reference_image_keys);
    }
    onOpenChange(false);
  };

  const handleCopy = (prompt: string) => {
    navigator.clipboard.writeText(prompt);
  };

  const handleDelete = (id: number) => {
    if (!confirm('确定要删除这条记录吗？')) return;
    const newPrompts = historyPrompts.filter(p => p.id !== id);
    setHistoryPrompts(newPrompts);
    safeSetItem(STORAGE_KEY, JSON.stringify(newPrompts));
    preloadedPrompts = newPrompts;
    // 同时删除服务器数据
    fetch(`/api/generation-records?id=${id}`, { method: 'DELETE' }).catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] bg-clip-text text-transparent">
              历史提示词
              {isSyncing && <Loader2 className="inline w-4 h-4 ml-2 animate-spin" />}
            </DialogTitle>
            <Button variant="outline" size="sm" onClick={() => { setHistoryPrompts(loadLocalPrompts()); syncFromServer(); }} disabled={isSyncing}>
              <RefreshCw className={`w-3 h-3 mr-1 ${isSyncing ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </DialogHeader>

        <div className="mt-4">
          {historyPrompts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <p>暂无历史提示词</p>
              <p className="text-sm text-gray-400 mt-1">生成图片后提示词将自动保存</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {paginatedPrompts.map((item) => (
                  <div 
                    key={item.id} 
                    className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div 
                      className="flex-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words cursor-pointer hover:text-[rgb(139,158,232)]" 
                      title={item.prompt}
                      onClick={() => handleOneClickPaste(item)}
                    >
                      {item.prompt}
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <Button
                        size="sm"
                        className="text-xs h-7"
                        style={{ background: 'linear-gradient(to right, rgb(139,158,232), rgb(232,180,184))', color: '#fff' }}
                        onClick={() => handleOneClickPaste(item)}
                      >
                        粘贴
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7 w-7 p-0" onClick={() => handleCopy(item.prompt)} title="复制">
                        <Copy className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs h-7 w-7 p-0 text-red-600" onClick={() => handleDelete(item.id)} title="删除">
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between mt-4">
                <span className="text-sm text-gray-600">共 {historyPrompts.length} 条，第 {currentPage}/{totalPages || 1} 页</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="px-2" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                    const p = totalPages <= 5 ? i + 1 : currentPage <= 3 ? i + 1 : currentPage >= totalPages - 2 ? totalPages - 4 + i : currentPage - 2 + i;
                    return (
                      <Button key={p} variant={currentPage === p ? 'default' : 'outline'} size="sm" className="w-8 text-xs" style={currentPage === p ? { background: 'linear-gradient(to right, rgb(139,158,232), rgb(232,180,184))', color: '#fff' } : {}} onClick={() => setCurrentPage(p)}>
                        {p}
                      </Button>
                    );
                  })}
                  <Button variant="outline" size="sm" className="px-2" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// 导出RefreshCw用于上面的刷新按钮
import { RefreshCw } from 'lucide-react';
