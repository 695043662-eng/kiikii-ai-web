'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, X, AlertTriangle, Clock, Eye, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { toProxyUrl } from './AssetCard';

/**
 * #819 管理员展示区审核面板
 * 
 * 功能：
 * - 查看待审核列表
 * - 审核通过（COS跨桶Copy + 状态更新）
 * - 审核拒绝（填写原因）
 * - 源文件过期兜底
 */

interface PendingCard {
  id: string;
  imageUrl: string;
  sourceImageKey: string;
  tag: string;
  title: string;
  subtitle: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  duration: string;
  prompt: string;
  authorId: string;
  submittedAt: string;
  status: string;
}

interface ShowcaseReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onReviewComplete?: () => void;
}

export default function ShowcaseReviewPanel({ isOpen, onClose, onReviewComplete }: ShowcaseReviewPanelProps) {
  const [pendingCards, setPendingCards] = useState<PendingCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  // 加载待审核列表
  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/showcase/pending', { credentials: 'include' });
      const data = await res.json();
      if (data.success) {
        setPendingCards(data.items || []);
      }
    } catch (err) {
      console.error('[ReviewPanel] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) loadPending();
  }, [isOpen, loadPending]);

  // 审核通过
  const handleApprove = async (cardId: string) => {
    setProcessingId(cardId);
    setMessage(null);
    try {
      const res = await fetch('/api/showcase/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cardId, action: 'approve' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '审核通过！图片已转存至永久存储' });
        setPendingCards(prev => prev.filter(c => c.id !== cardId));
        onReviewComplete?.();
      } else {
        // 检查是否是过期文件
        if (data.status === 'expired') {
          setMessage({ type: 'error', text: data.error || '源文件已过期销毁' });
          setPendingCards(prev => prev.filter(c => c.id !== cardId));
          onReviewComplete?.();
        } else {
          setMessage({ type: 'error', text: data.error || '审核失败' });
        }
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '网络错误' });
    } finally {
      setProcessingId(null);
    }
  };

  // 审核拒绝
  const handleReject = async () => {
    if (!rejectId) return;
    setProcessingId(rejectId);
    setMessage(null);
    try {
      const res = await fetch('/api/showcase/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          cardId: rejectId,
          action: 'reject',
          rejectReason: rejectReason || '内容不符合展示要求',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '已拒绝' });
        setPendingCards(prev => prev.filter(c => c.id !== rejectId));
        onReviewComplete?.();
      } else {
        setMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || '网络错误' });
    } finally {
      setProcessingId(null);
      setRejectId(null);
      setRejectReason('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">展示区审核</h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
              {pendingCards.length} 待审核
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadPending}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="刷新"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-6 mt-3 text-sm rounded-lg px-3 py-2 ${
            message.type === 'success' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' :
            'bg-destructive/10 text-destructive'
          }`}>
            {message.text}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading && pendingCards.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin" />
              加载中...
            </div>
          ) : pendingCards.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Check className="w-8 h-8 mx-auto mb-2 text-green-500" />
              暂无待审核内容
            </div>
          ) : (
            pendingCards.map(card => (
              <div
                key={card.id}
                className="border border-border rounded-xl p-4 flex gap-4 hover:border-primary/30 transition-colors"
              >
                {/* 缩略图 */}
                <div className="w-24 h-24 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                  {card.imageUrl && !failedImages.has(card.id) ? (
                    <img
                      src={toProxyUrl(card.imageUrl, 'temp')}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const img = e.currentTarget;
                        const src = img.src;
                        // 兜底链：代理URL → 原始签名URL → 失败占位
                        if (!src.includes('/api/canvas/image')) {
                          // 原始签名URL失败，尝试代理URL
                          img.src = `/api/canvas/image?key=${encodeURIComponent(card.sourceImageKey)}&assetType=temp`;
                        } else {
                          // 代理URL也失败，显示占位图标
                          setFailedImages(prev => new Set(prev).add(card.id));
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-8 h-8 text-muted-foreground" />
                    </div>
                  )}
                </div>

                {/* 信息 */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {card.tag || '未分类'}
                    </span>
                    <span className="text-xs text-muted-foreground">{card.model}</span>
                  </div>
                  {card.title && <p className="text-sm font-medium truncate">{card.title}</p>}
                  <p className="text-xs text-muted-foreground truncate">{card.prompt || '无提示词'}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {card.aspectRatio && <span>{card.aspectRatio}</span>}
                    {card.resolution && <span>{card.resolution}</span>}
                    {card.duration && <span>{card.duration}秒</span>}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {card.submittedAt ? new Date(card.submittedAt).toLocaleDateString() : '未知'}
                    </span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleApprove(card.id)}
                    disabled={processingId === card.id}
                    className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    {processingId === card.id ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                    通过
                  </button>
                  <button
                    onClick={() => { setRejectId(card.id); setRejectReason(''); }}
                    disabled={processingId === card.id}
                    className="px-3 py-1.5 text-xs rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    <X className="w-3 h-3" />
                    拒绝
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 拒绝原因弹窗 */}
        {rejectId && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center rounded-2xl">
            <div className="bg-card rounded-xl shadow-xl p-6 w-80 space-y-4">
              <h3 className="text-sm font-semibold">拒绝原因</h3>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="请输入拒绝原因（将通知用户）"
                className="w-full h-24 px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setRejectId(null); setRejectReason(''); }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleReject}
                  className="px-3 py-1.5 text-xs rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  确认拒绝
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
