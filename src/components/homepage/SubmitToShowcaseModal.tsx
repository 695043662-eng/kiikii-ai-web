'use client';

import { useState } from 'react';
import { X, Check, Upload, AlertTriangle, Clock } from 'lucide-react';

interface HistoryRecord {
  id: string;
  imageUrl?: string;
  imageKey?: string;
  model?: string;
  prompt?: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
  createdAt?: string;
  isSubmitted?: boolean;
}

interface SubmitToShowcaseModalProps {
  record: HistoryRecord;
  onClose: () => void;
  onSubmitted?: () => void;
}

// #819 资产过期阈值：4.8天安全阈值（COS 5天自动销毁）
const ASSET_EXPIRY_MS = 4.8 * 24 * 60 * 60 * 1000;

export default function SubmitToShowcaseModal({
  record,
  onClose,
  onSubmitted,
}: SubmitToShowcaseModalProps) {
  const [tag, setTag] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // 判断资产是否过期
  const isExpired = record.createdAt
    ? Date.now() - new Date(record.createdAt).getTime() > ASSET_EXPIRY_MS
    : false;
  const isSubmitted = record.isSubmitted === true;
  const canSubmit = !isExpired && !isSubmitted;

  // 提交审核
  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/showcase/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          recordId: record.id,
          tag,
          title,
          subtitle,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error || '提交失败');
        return;
      }

      setSuccess(true);
      onSubmitted?.();
      // 2秒后自动关闭
      setTimeout(() => onClose(), 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '网络错误';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card text-card-foreground rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">投稿到展示区</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 功能说明 */}
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
            将你的作品投稿到首页展示区，审核通过后所有用户都能看到。每个作品只能投稿一次，超过4.8天的作品因源文件可能过期而无法投稿。
          </p>
          {success ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-base font-medium">投稿成功！</p>
              <p className="text-sm text-muted-foreground">管理员审核通过后，你的作品将在首页展示区展示</p>
            </div>
          ) : (
            <>
              {/* 资产预览 + 状态 */}
              <div className="space-y-3">
                {/* 预览图 */}
                <div className="relative aspect-video rounded-xl overflow-hidden bg-muted">
                  {record.imageUrl ? (
                    <img
                      src={record.imageUrl || (record.imageKey ? `/api/canvas/image?key=${encodeURIComponent(record.imageKey)}` : '')}
                      alt=""
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        const currentSrc = target.src;
                        if (record.imageKey && !currentSrc.includes('/api/canvas/image')) {
                          target.src = `/api/canvas/image?key=${encodeURIComponent(record.imageKey)}`;
                        }
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                      无预览图
                    </div>
                  )}
                  {/* 过期/已提交覆盖层 */}
                  {isSubmitted && (
                    <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-1">
                      <Clock className="w-5 h-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">已投稿</span>
                    </div>
                  )}
                  {isExpired && !isSubmitted && (
                    <div className="absolute inset-0 bg-background/80 flex flex-col items-center justify-center gap-1">
                      <AlertTriangle className="w-5 h-5 text-destructive" />
                      <span className="text-xs text-destructive">资产已过期</span>
                    </div>
                  )}
                </div>

                {/* 资产信息 */}
                <div className="text-xs text-muted-foreground space-y-1">
                  {record.model && <p>模型: {record.model}</p>}
                  {record.aspectRatio && <p>比例: {record.aspectRatio}</p>}
                  {record.resolution && <p>分辨率: {record.resolution}</p>}
                  {record.duration && <p>时长: {record.duration}秒</p>}
                  {record.prompt && <p className="truncate">提示词: {record.prompt}</p>}
                </div>
              </div>

              {/* 标签 */}
              <div>
                <label className="text-sm font-medium mb-1 block">分类标签</label>
                <input
                  type="text"
                  value={tag}
                  onChange={e => setTag(e.target.value)}
                  placeholder="如：电商营销、人像摄影..."
                  disabled={!canSubmit}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>

              {/* 标题 */}
              <div>
                <label className="text-sm font-medium mb-1 block">标题（可选）</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="给作品起个名字..."
                  disabled={!canSubmit}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>

              {/* 副标题 */}
              <div>
                <label className="text-sm font-medium mb-1 block">副标题（可选）</label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={e => setSubtitle(e.target.value)}
                  placeholder="简短描述..."
                  disabled={!canSubmit}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                />
              </div>

              {/* 不可提交原因 */}
              {!canSubmit && (
                <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  {isSubmitted ? '该作品已投稿，请勿重复提交' : '该作品已过期（超过4.8天），无法投稿'}
                </div>
              )}

              {/* 错误提示 */}
              {error && (
                <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  提交中...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  确认投稿
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
