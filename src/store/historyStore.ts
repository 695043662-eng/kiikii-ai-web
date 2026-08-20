'use client';

/**
 * 历史记录全局状态管理 (Zustand Store)
 * 
 * 设计原则：
 * 1. 数据库为唯一真理之源 (Single Source of Truth)
 * 2. 内存缓存实现跨页面 0 延迟展示
 * 3. 所有 record.id 统一使用 taskId (string 类型)
 * 
 * #232 SSR 修复：使用 zustand/middleware 的 ssr 支持
 */

import { create } from 'zustand';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * 历史记录数据结构
 * 所有字段与数据库表 api_generation_records 保持一致
 */
export interface HistoryRecord {
  id: string;  // 统一使用 taskId (string)，禁止使用 Date.now()
  model: string;
  model_name?: string;  // #562 用户可见的模型名称（如"GPT Image 2"而非"t8star.gpt-image-2"）
  prompt: string;
  images: string[];  // 图片签名 URL 数组
  image_keys?: string[];  // 图片 COS key 数组（用于持久化）
  videos?: string[];  // 视频签名 URL 数组 (#561 视频历史记录支持)
  video_keys?: string[];  // 视频 COS key 数组 (#561)
  reference_images?: string[];  // 参考图 URL 数组
  reference_image_keys?: string[];  // 参考图 COS key 数组
  reference_image_md5s?: string[];  // 参考图 MD5 数组
  resolution: string;
  aspect_ratio: string;
  source?: 'canvas' | 'generate' | 'smart_split' | 'video' | 'regenerate';  // 来源标记
  created_at: string;  // ISO 格式时间戳
  credits_charged?: number;  // 消耗积分
  credits_balance?: number;  // 剩余积分
  refund_amount?: number;  // #488 返还积分
  viewed?: boolean;  // 是否已查看
  is_submitted?: boolean;  // #819 是否已提交展示审核
  dbId?: number;  // #819 数据库记录 ID（用于提交审核）
}

/**
 * 历史记录 Store 状态
 */
interface HistoryState {
  // 数据
  records: HistoryRecord[];
  
  // 状态
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  _fetchAbortController: AbortController | null;  // #840 翻页请求取消控制器
  
  // 分页信息（可选，用于无限滚动）
  totalCount: number;
  hasMore: boolean;
  
  // Actions
  
  /** 从 API 加载历史记录（页面初始化时调用，#841 支持日期范围筛选） */
  fetchRecords: (limit?: number, offset?: number, dateFrom?: string, dateTo?: string) => Promise<void>;
  
  /** 添加新记录（API 保存成功后调用） */
  addRecord: (record: HistoryRecord) => void;
  
  /** 更新已有记录（Upsert 语义，根据 id 判断） */
  updateRecord: (record: HistoryRecord) => void;
  
  /** 删除记录 */
  deleteRecord: (id: string) => Promise<void>;
  
  /** 清空记录（#841 支持 keepRecent/beforeDate 参数） */
  clearAllRecords: (options?: { keepRecent?: number; beforeDate?: string }) => Promise<void>;
  
  /** 标记记录为已查看 */
  markAsViewed: (id: string) => void;
  
  /** 重置状态 */
  reset: () => void;
}

// 初始状态
const initialState = {
  records: [],
  isLoading: false,
  isLoaded: false,
  error: null,
  totalCount: 0,
  hasMore: true,
  _fetchAbortController: null as AbortController | null,  // #840
};

/**
 * 历史记录 Zustand Store
 * 
 * 使用方式：
 * ```tsx
 * import { useHistoryStore } from '@/store/historyStore';
 * 
 * function MyComponent() {
 *   const { records, addRecord, fetchRecords } = useHistoryStore();
 *   
 *   useEffect(() => {
 *     if (!records.length) fetchRecords();
 *   }, []);
 *   
 *   return <div>...</div>;
 * }
 * ```
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  ...initialState,
  
  // 从 API 加载历史记录
  // #758 支持后端分页，每次加载 20 条
  // #840 修复翻页慢：用 AbortController 替代 isLoading 互斥锁，新请求取消旧请求
  // #841 支持日期范围筛选 dateFrom/dateTo
  fetchRecords: async (limit = 20, offset = 0, dateFrom?: string, dateTo?: string) => {
    // #840 取消上一个未完成的请求
    const prevController = get()._fetchAbortController;
    if (prevController) {
      prevController.abort();
    }
    const abortController = new AbortController();
    set({ isLoading: true, error: null, _fetchAbortController: abortController });
    
    try {
      // #841 构建带日期筛选的 URL
      let url = `/api/generation-records?limit=${limit}&offset=${offset}`;
      if (dateFrom) url += `&dateFrom=${encodeURIComponent(dateFrom)}`;
      if (dateTo) url += `&dateTo=${encodeURIComponent(dateTo)}`;

      const response = await fetch(url, { credentials: 'include', signal: abortController.signal });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && Array.isArray(data.records)) {
        // 转换数据格式，确保 id 是 string
        const records: HistoryRecord[] = data.records.map((r: any) => ({
          id: String(r.id || r.task_id),  // 强制转为 string
          dbId: r.id,  // #819 保留原始数字 ID 用于提交审核
          model: r.model || '',
          model_name: r.model_name || r.model || '',  // #562 优先使用用户可见名称
          prompt: r.prompt || '',
          images: r.images || [],
          image_keys: r.image_keys || [],
          videos: r.videos || [],  // #561 视频历史记录支持
          video_keys: r.video_keys || [],  // #561
          reference_images: r.reference_images || [],
          reference_image_keys: r.reference_image_keys || [],
          reference_image_md5s: r.reference_image_md5s || [],
          resolution: r.resolution || '',
          aspect_ratio: r.aspect_ratio || '',
          source: r.source || 'generate',
          created_at: r.created_at || new Date().toISOString(),
          credits_charged: r.credits_charged,
          credits_balance: r.credits_balance,  // #561 剩余积分
          refund_amount: r.refund_amount,  // #561 返还积分
          viewed: r.viewed || false,
          is_submitted: r.is_submitted || false,  // #819 展示审核提交状态
        }));
        
        set({
          records,
          isLoaded: true,
          isLoading: false,
          totalCount: data.total || records.length,
          hasMore: records.length >= limit,
        });
        
        console.log(`[HistoryStore] 加载了 ${records.length} 条历史记录`);
      } else {
        throw new Error(data.error || '加载失败');
      }
    } catch (error) {
      // #840 被取消的请求不是错误，静默忽略
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('[HistoryStore] 加载历史记录失败:', error);
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : '加载失败',
      });
    }
  },
  
  // 添加新记录
  addRecord: (record: HistoryRecord) => {
    // 验证 id 格式
    if (!record.id || typeof record.id !== 'string') {
      console.error('[HistoryStore] 无效的 record.id:', record.id);
      return;
    }
    
    set((state) => {
      // #251 自动清理机制：超过 200 条时自动删除最老的 50 条
      const MAX_RECORDS = 200;
      const CLEANUP_COUNT = 50;
      let currentRecords = state.records;
      
      if (currentRecords.length >= MAX_RECORDS) {
        // 按创建时间排序，删除最老的
        const sortedRecords = [...currentRecords].sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        currentRecords = sortedRecords.slice(0, MAX_RECORDS - CLEANUP_COUNT);
        console.log(`[HistoryStore] #251 自动清理：删除了 ${CLEANUP_COUNT} 条最老记录`);
      }
      
      // 检查是否已存在（Upsert 语义）
      const existingIndex = currentRecords.findIndex(r => r.id === record.id);
      
      if (existingIndex >= 0) {
        // 更新已有记录
        const newRecords = [...currentRecords];
        newRecords[existingIndex] = record;
        console.log(`[HistoryStore] 更新记录: id=${record.id}`);
        return { records: newRecords };
      } else {
        // 插入新记录（放在最前面）
        console.log(`[HistoryStore] 添加记录: id=${record.id}, source=${record.source}`);
        return { 
          records: [record, ...currentRecords],
          totalCount: state.totalCount + 1,
        };
      }
    });
  },
  
  // 更新已有记录
  updateRecord: (record: HistoryRecord) => {
    set((state) => {
      const index = state.records.findIndex(r => r.id === record.id);
      if (index >= 0) {
        const newRecords = [...state.records];
        newRecords[index] = record;
        console.log(`[HistoryStore] 更新记录: id=${record.id}`);
        return { records: newRecords };
      }
      // 不存在则添加
      return { 
        records: [record, ...state.records],
        totalCount: state.totalCount + 1,
      };
    });
  },
  
  // 删除记录
  deleteRecord: async (id: string) => {
    // 先从本地删除（乐观更新）
    set((state) => ({
      records: state.records.filter(r => r.id !== id),
      totalCount: Math.max(0, state.totalCount - 1),
    }));
    
    // 调用 API 删除
    try {
      await fetch(`/api/generation-records?id=${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      console.log(`[HistoryStore] 删除记录: id=${id}`);
    } catch (error) {
      console.error('[HistoryStore] 删除记录失败:', error);
      // 可选：回滚本地删除
    }
  },
  
  // 清空记录（#841 支持 keepRecent/beforeDate 参数）
  clearAllRecords: async (options?: { keepRecent?: number; beforeDate?: string }) => {
    const { keepRecent, beforeDate } = options || {};
    
    // 乐观更新本地状态
    if (keepRecent && keepRecent > 0) {
      // 保留最近 N 条
      set((state) => {
        const sorted = [...state.records].sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const kept = sorted.slice(0, keepRecent);
        return { records: kept, totalCount: kept.length, hasMore: false };
      });
    } else {
      // 全清
      set({ records: [], totalCount: 0, hasMore: false });
    }
    
    try {
      const body: Record<string, unknown> = {};
      if (keepRecent && keepRecent > 0) body.keepRecent = keepRecent;
      if (beforeDate) body.beforeDate = beforeDate;

      await fetch('/api/generation-records/clear', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
      });
      console.log(`[HistoryStore] 已清空记录 (keepRecent=${keepRecent}, beforeDate=${beforeDate})`);
    } catch (error) {
      console.error('[HistoryStore] 清空记录失败:', error);
    }
  },
  
  // 标记为已查看
  markAsViewed: (id: string) => {
    set((state) => {
      const index = state.records.findIndex(r => r.id === id);
      if (index >= 0 && !state.records[index].viewed) {
        const newRecords = [...state.records];
        newRecords[index] = { ...newRecords[index], viewed: true };
        return { records: newRecords };
      }
      return state;
    });
  },
  
  // 重置状态
  reset: () => {
    set(initialState);
  },
}));

// 导出便捷方法（供非 React 代码使用）
export const historyStore = {
  addRecord: (record: HistoryRecord) => useHistoryStore.getState().addRecord(record),
  updateRecord: (record: HistoryRecord) => useHistoryStore.getState().updateRecord(record),
  deleteRecord: (id: string) => useHistoryStore.getState().deleteRecord(id),
  getRecords: () => useHistoryStore.getState().records,
  fetchRecords: (limit?: number, offset?: number, dateFrom?: string, dateTo?: string) => 
    useHistoryStore.getState().fetchRecords(limit, offset, dateFrom, dateTo),
};
