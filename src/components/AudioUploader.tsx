'use client';

import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { safeJsonResponse } from '@/lib/safe-json';

/**
 * AudioUploader - Seedance 2.0 参考音频上传组件
 * 
 * 支持 wav/mp3 格式，单个 ≤15MB，最多 3 段
 * 上传到 COS 并返回签名 URL
 */

export interface AudioRef {
  url: string;       // COS 签名 URL
  name: string;      // 文件名
  size: number;      // 文件大小(bytes)
}

interface AudioUploaderProps {
  /** 已上传的音频列表 */
  audios: AudioRef[];
  /** 更新音频列表 */
  onAudiosChange: (audios: AudioRef[]) => void;
  /** 最大数量，默认 3 */
  maxCount?: number;
  /** 单文件最大大小(bytes)，默认 15MB */
  maxSize?: number;
  /** 是否禁用（模式不可用时） */
  disabled?: boolean;
  /** 自定义类名 */
  className?: string;
}

const DEFAULT_MAX_COUNT = 3;
const DEFAULT_MAX_SIZE = 15 * 1024 * 1024; // 15MB
const ACCEPTED_FORMATS = ['wav', 'mp3'];

export default function AudioUploader({
  audios,
  onAudiosChange,
  maxCount = DEFAULT_MAX_COUNT,
  maxSize = DEFAULT_MAX_SIZE,
  disabled = false,
  className = '',
}: AudioUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // 校验文件
  const validateFile = useCallback((file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ACCEPTED_FORMATS.includes(ext)) {
      return `不支持的音频格式，仅支持 ${ACCEPTED_FORMATS.join('/')}`;
    }
    if (file.size > maxSize) {
      return `文件 ${file.name} 超过 ${formatSize(maxSize)} 限制`;
    }
    return null;
  }, [maxSize]);

  // 处理上传
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // 重置 input 以便重复选择
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (disabled) {
      toast.error('当前模式不支持音频上传');
      return;
    }

    // 数量检查
    if (audios.length + files.length > maxCount) {
      toast.error(`最多上传 ${maxCount} 段参考音频`);
      return;
    }

    // 逐个校验
    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        toast.error(error);
        return;
      }
    }

    setIsUploading(true);
    try {
      // 服务端中转上传（串行，避免并发冲突）
      const newAudios: AudioRef[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
        const data = await safeJsonResponse<{ key?: string; url?: string }>(res);
        if (data.success && data.url) {
          newAudios.push({ url: data.url!, name: file.name, size: file.size });
        } else {
          toast.error(`音频 ${file.name} 上传失败`);
        }
      }

      if (newAudios.length > 0) {
        onAudiosChange([...audios, ...newAudios]);
        toast.success(`已上传 ${newAudios.length} 段参考音频`);
      }
    } catch (err) {
      console.error('[AudioUploader] 上传异常:', err);
      toast.error('音频上传失败');
    }
    setIsUploading(false);
  }, [audios, onAudiosChange, maxCount, disabled, validateFile]);

  // 删除音频
  const handleRemove = useCallback((index: number) => {
    const newAudios = audios.filter((_, i) => i !== index);
    onAudiosChange(newAudios);
  }, [audios, onAudiosChange]);

  return (
    <div className={`audio-uploader ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}>
      {/* 上传按钮 */}
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isUploading || audios.length >= maxCount}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted/50 hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? (
            <span className="inline-block w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
          参考音频
          {audios.length > 0 && (
            <span className="text-muted-foreground">({audios.length}/{maxCount})</span>
          )}
        </button>
        <span className="text-[10px] text-muted-foreground">wav/mp3, ≤15MB, 最多{maxCount}段</span>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/wav,audio/mp3,audio/mpeg,.wav,.mp3"
        multiple
        onChange={handleUpload}
        className="hidden"
      />

      {/* 音频列表 */}
      {audios.length > 0 && (
        <div className="space-y-1.5">
          {audios.map((audio, index) => (
            <div
              key={index}
              className="flex items-center gap-2 p-2 rounded-md bg-muted/30 border border-border/50 group"
            >
              {/* 音频图标 */}
              <svg className="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>

              {/* 文件名 + 大小 */}
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate">{audio.name}</p>
                <p className="text-[10px] text-muted-foreground">{formatSize(audio.size)}</p>
              </div>

              {/* 播放按钮 */}
              <audio
                src={audio.url}
                controls
                className="h-6 w-20 scale-90 origin-right"
                preload="none"
              />

              {/* 删除按钮 */}
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
