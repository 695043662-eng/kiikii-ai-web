'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Image as ImageIcon, Video, AtSign } from 'lucide-react';

// ====== 媒体素材类型 ======
interface MediaItem {
  type: 'image' | 'video';
  url: string;     // 用于显示缩略图
  label?: string;  // 显示名称，如 "图1"、"视频1"
}

// ====== 胶囊标签类型 ======
interface MediaCapsule {
  id: string;
  mediaIndex: number;
  label: string;
  type: 'image' | 'video';
}

// ====== 组件 Props ======
interface RichPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 已上传的媒体素材列表，用于 @ 引用 */
  images?: MediaItem[];
  videos?: MediaItem[];
  placeholder?: string;
  maxLength?: number;
  className?: string;
  textareaClassName?: string;
  /** 提交时获取翻译后的完整 prompt（含媒体引用文本） */
  onGetFullPrompt?: (rawText: string, capsules: MediaCapsule[]) => string;
  /** #549 隐藏底部@引用提示（视频页面不需要@功能） */
  hideMentionHint?: boolean;
}

let capsuleIdCounter = 0;

export default function RichPromptEditor({
  value,
  onChange,
  images = [],
  videos = [],
  placeholder = '请输入画面描述，输入 @ 可引用已上传的参考素材',
  maxLength = 1800,
  className = '',
  textareaClassName = '',
  onGetFullPrompt,
  hideMentionHint = false,
}: RichPromptEditorProps) {
  // ====== @ 弹出菜单状态 ======
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionStartPos, setMentionStartPos] = useState(-1); // @ 符号在文本中的位置
  const [selectedCapsules, setSelectedCapsules] = useState<MediaCapsule[]>([]);
  const [mentionMenuPosition, setMentionMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);

  // ====== 合并所有媒体素材 ======
  const allMedia: MediaItem[] = [
    ...images.map((img, idx) => ({
      ...img,
      label: img.label || `图${idx + 1}`,
      type: 'image' as const,
    })),
    ...videos.map((vid, idx) => ({
      ...vid,
      label: vid.label || `视频${idx + 1}`,
      type: 'video' as const,
    })),
  ];

  // ====== 过滤匹配的素材 ======
  const filteredMedia = allMedia.filter(m =>
    m.label?.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  // ====== 监听输入，检测 @ 符号 ======
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;

    onChange(newValue);

    // 检测是否刚输入了 @
    if (newValue[cursorPos - 1] === '@' && allMedia.length > 0) {
      // 检查 @ 前面是否是空格或文本开头（避免邮箱等误触发）
      const charBefore = cursorPos >= 2 ? newValue[cursorPos - 2] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || cursorPos === 1) {
        setMentionStartPos(cursorPos - 1);
        setMentionSearch('');
        setShowMentionMenu(true);

        // 计算弹出菜单位置
        if (textareaRef.current) {
          const textarea = textareaRef.current;
          const rect = textarea.getBoundingClientRect();
          // 简单定位：在 textarea 下方
          setMentionMenuPosition({
            top: rect.bottom + 4,
            left: rect.left + Math.min(cursorPos * 8, rect.width - 200),
          });
        }
        return;
      }
    }

    // 如果菜单已打开，更新搜索词
    if (showMentionMenu && mentionStartPos >= 0) {
      const searchStr = newValue.slice(mentionStartPos + 1, cursorPos);
      // 如果用户删除了 @ 或移动了光标到 @ 之前，关闭菜单
      if (cursorPos <= mentionStartPos || !newValue.slice(mentionStartPos, mentionStartPos + 1).includes('@')) {
        setShowMentionMenu(false);
        setMentionStartPos(-1);
      } else if (searchStr.includes(' ') || searchStr.includes('\n')) {
        // 空格或换行关闭菜单
        setShowMentionMenu(false);
        setMentionStartPos(-1);
      } else {
        setMentionSearch(searchStr);
      }
    }
  }, [allMedia, showMentionMenu, mentionStartPos, onChange]);

  // ====== 选择媒体素材，插入胶囊 ======
  const handleSelectMedia = useCallback((media: MediaItem, mediaIndex: number) => {
    if (mentionStartPos < 0 || !textareaRef.current) return;

    const textarea = textareaRef.current;
    const cursorPos = textarea.selectionStart;

    // 创建胶囊
    const capsule: MediaCapsule = {
      id: `capsule_${++capsuleIdCounter}_${Date.now()}`,
      mediaIndex,
      label: media.label || (media.type === 'image' ? `图${mediaIndex + 1}` : `视频${mediaIndex + 1}`),
      type: media.type,
    };

    setSelectedCapsules(prev => [...prev, capsule]);

    // 替换 @xxx 为胶囊占位标记
    const beforeAt = value.slice(0, mentionStartPos);
    const afterCursor = value.slice(cursorPos);
    const capsuleMarker = `[🖼️${capsule.label}]`;
    const newValue = beforeAt + capsuleMarker + afterCursor;

    onChange(newValue);

    // 关闭菜单
    setShowMentionMenu(false);
    setMentionStartPos(-1);
    setMentionSearch('');

    // 设置光标位置到插入的胶囊后面
    requestAnimationFrame(() => {
      const newPos = beforeAt.length + capsuleMarker.length;
      // 🛡️ preventScroll: 阻止浏览器 scrollIntoView，防止画布坐标失步
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(newPos, newPos);
    });
  }, [mentionStartPos, value, onChange]);

  // ====== 移除胶囊 ======
  const handleRemoveCapsule = useCallback((capsuleId: string) => {
    const capsule = selectedCapsules.find(c => c.id === capsuleId);
    if (!capsule) return;

    // 从文本中移除胶囊标记
    const marker = `[🖼️${capsule.label}]`;
    const newValue = value.replace(marker, '');
    onChange(newValue);

    setSelectedCapsules(prev => prev.filter(c => c.id !== capsuleId));
  }, [selectedCapsules, value, onChange]);

  // ====== 点击外部关闭 @ 菜单 ======
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mentionMenuRef.current && !mentionMenuRef.current.contains(e.target as Node)) {
        setShowMentionMenu(false);
        setMentionStartPos(-1);
      }
    };
    if (showMentionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showMentionMenu]);

  // ====== ESC 关闭菜单 ======
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showMentionMenu) {
        setShowMentionMenu(false);
        setMentionStartPos(-1);
      }
    };
    if (showMentionMenu) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [showMentionMenu]);

  // ====== 翻译胶囊为纯文本 ======
  const translateCapsulesToText = useCallback((rawText: string): string => {
    let result = rawText;
    for (const capsule of selectedCapsules) {
      const marker = `[🖼️${capsule.label}]`;
      const replacement = capsule.type === 'image'
        ? `第${capsule.mediaIndex + 1}张参考图`
        : `第${capsule.mediaIndex + 1}个参考视频`;
      result = result.replace(marker, replacement);
    }
    return result;
  }, [selectedCapsules]);

  // ====== 暴露翻译方法 ======
  // 通过 ref 让父组件可以获取翻译后的 prompt
  useEffect(() => {
    if (onGetFullPrompt) {
      onGetFullPrompt(value, selectedCapsules);
    }
  }, [value, selectedCapsules, onGetFullPrompt]);

  // ====== 检查是否有可用素材 ======
  const hasMedia = allMedia.length > 0;

  return (
    <div className={`relative ${className}`}>
      {/* ====== 胶囊标签区 ====== */}
      {selectedCapsules.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2 px-1">
          {selectedCapsules.map(capsule => (
            <span
              key={capsule.id}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full
                bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300
                hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors group cursor-default"
            >
              {capsule.type === 'image' ? (
                <ImageIcon className="w-3 h-3" />
              ) : (
                <Video className="w-3 h-3" />
              )}
              {capsule.label}
              <button
                onClick={() => handleRemoveCapsule(capsule.id)}
                className="ml-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center
                  opacity-0 group-hover:opacity-100 transition-opacity
                  hover:bg-blue-200 dark:hover:bg-blue-800"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ====== 文本输入区 ====== */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          maxLength={maxLength}
          className={`w-full px-4 py-3 text-sm border border-gray-200 dark:border-gray-700 rounded-lg
            resize-none focus:outline-none focus:border-blue-400 dark:focus:border-blue-500
            focus:ring-1 focus:ring-blue-200 dark:focus:ring-blue-600
            bg-white dark:bg-gray-800 text-gray-900 dark:text-white
            placeholder-gray-400 dark:placeholder-gray-500
            ${textareaClassName}`}
          rows={6}
        />
      </div>

      {/* ====== 底部工具栏 ====== */}
      <div className="flex items-center justify-between mt-1.5 px-1">
        <div className="flex items-center gap-2">
          {/* #549 视频页面隐藏@引用提示 */}
          {!hideMentionHint && (
          <span className={`text-xs ${hasMedia ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`}>
            <AtSign className="w-3 h-3 inline-block mr-0.5" />
            {hasMedia ? `${allMedia.length}个素材可引用` : '上传素材后可 @ 引用'}
          </span>
          )}
        </div>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {value.length}/{maxLength}
        </span>
      </div>

      {/* ====== @ 提及下拉菜单 ====== */}
      {showMentionMenu && hasMedia && (
        <div
          ref={mentionMenuRef}
          className="fixed z-[9999] w-[220px] max-h-[240px] overflow-y-auto
            bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700
            rounded-lg shadow-lg"
          style={{
            top: mentionMenuPosition.top,
            left: mentionMenuPosition.left,
          }}
        >
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <span className="text-xs text-gray-500 dark:text-gray-400">选择要引用的素材</span>
          </div>
          {filteredMedia.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-gray-400 dark:text-gray-500">
              没有匹配的素材
            </div>
          ) : (
            filteredMedia.map((media, idx) => {
              const globalIndex = allMedia.indexOf(media);
              const isAlreadyAdded = selectedCapsules.some(c => c.mediaIndex === globalIndex);
              return (
                <button
                  key={`${media.type}-${globalIndex}`}
                  onClick={() => handleSelectMedia(media, globalIndex)}
                  disabled={isAlreadyAdded}
                  className={`w-full px-3 py-2 flex items-center gap-2.5 text-sm transition-colors
                    ${isAlreadyAdded
                      ? 'opacity-40 cursor-not-allowed bg-gray-50 dark:bg-gray-800'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'
                    }`}
                >
                  {/* 微缩略图 */}
                  <div className="w-8 h-8 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center">
                    {media.url ? (
                      <img
                        src={media.url}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                    ) : media.type === 'image' ? (
                      <ImageIcon className="w-4 h-4 text-gray-400" />
                    ) : (
                      <Video className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                  {/* 标签 */}
                  <div className="flex flex-col items-start min-w-0">
                    <span className="text-gray-900 dark:text-white truncate">
                      {media.type === 'image' ? '🖼️' : '🎬'} {media.label}
                    </span>
                    {isAlreadyAdded && (
                      <span className="text-[10px] text-gray-400">已引用</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 工具函数：将含胶囊标记的 prompt 翻译为纯文本
 * 在提交生成请求时调用
 */
export function translatePromptWithCapsules(
  rawPrompt: string,
  capsules: { mediaIndex: number; label: string; type: 'image' | 'video' }[]
): string {
  let result = rawPrompt;
  for (const capsule of capsules) {
    const marker = `[🖼️${capsule.label}]`;
    const replacement = capsule.type === 'image'
      ? `第${capsule.mediaIndex + 1}张参考图`
      : `第${capsule.mediaIndex + 1}个参考视频`;
    result = result.replace(marker, replacement);
  }
  return result;
}
