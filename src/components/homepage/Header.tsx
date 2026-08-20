'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, ChevronDown, SlidersHorizontal } from 'lucide-react';

/* ============================================================
   军师 PRD - 顶部吸顶操作区 (Sticky Header)
   - 一级大类目 + 搜索栏（上层）
   - 二级风格标签 + 排序/筛选（下层）
   - sticky 吸顶 + 毛玻璃效果
   - 搜索防抖 300ms
   - #813 新增：大类目与卡片 category 字段关联
   - #815 日夜模式按钮移至左侧导航栏底部
   ============================================================ */

interface HeaderProps {
  onSearch?: (query: string) => void;
  onCategoryChange?: (category: string) => void;
  onTagChange?: (tag: string) => void;
  onSortChange?: (sort: string) => void;
  canAdjustMode?: boolean;
  isAdjustMode?: boolean;
  onToggleAdjustMode?: () => void;
}

// #813 一级大类目（与 AddCardModal 的 CATEGORY_OPTIONS 保持一致）
// value 是存入数据库的 category 值，label 是展示文案
export const MAIN_CATEGORIES = [
  { value: '', label: '精选' },           // '' 表示全部
  { value: 'marketing', label: '营销专辑' },
  { value: 'poster', label: '商业海报' },
  { value: 'video', label: '视频特效' },
  { value: 'contest', label: '大赛活动' },
  { value: 'creative', label: '创意设计' },
] as const;

// 二级风格标签
const styleTags = [
  '全部', '万物生花', '手绘插画', '像素风格', '赛博科技',
  'IP&3D立体', '非遗剪纸', '油画风格', '微缩场景', '线稿风格',
  '积木元素', '国风水墨', '卡通动漫', '毛绒风格',
];

// 排序选项
const sortOptions = ['最新', '最热', '推荐'];

export default function Header({
  onSearch,
  onCategoryChange,
  onTagChange,
  onSortChange,
  canAdjustMode,
  isAdjustMode,
  onToggleAdjustMode,
}: HeaderProps) {
  const [activeCategory, setActiveCategory] = useState('');
  const [activeTag, setActiveTag] = useState('全部');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSort, setActiveSort] = useState('最新');
  const [sortOpen, setSortOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sortRef = useRef<HTMLDivElement>(null);

  // 滚动检测
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 搜索防抖
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onSearch?.(value), 300);
    },
    [onSearch],
  );

  // 点击外部关闭排序
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCategoryClick = (value: string) => {
    setActiveCategory(value);
    onCategoryChange?.(value);
  };

  const handleTagClick = (tag: string) => {
    setActiveTag(tag);
    onTagChange?.(tag);
  };

  const handleSortSelect = (sort: string) => {
    setActiveSort(sort);
    setSortOpen(false);
    onSortChange?.(sort);
  };

  return (
    <header className={`sticky top-0 z-20 transition-all duration-200 ${
      scrolled
        ? 'bg-[#F8F9FA]/90 dark:bg-gray-950/90 backdrop-blur-xl shadow-sm'
        : 'bg-[#F8F9FA] dark:bg-gray-950'
    }`}>
      {/* 内容居中对齐，与页面 w-[90%] 容器一致 */}
      <div className="w-[90%] mx-auto px-4 pl-5">
      {/* 上层：大类目 + 搜索 + 日夜模式 */}
      <div className="flex items-center gap-4 pt-4 pb-2">
        {/* 一级大类目 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {MAIN_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => handleCategoryClick(cat.value)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === cat.value
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* 搜索栏 */}
        <div className="flex items-center gap-2 ml-auto">
          <div className="relative max-w-xs">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="搜索灵感..."
              className="w-40 h-8 pl-3 pr-9 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-gray-300 dark:focus:border-gray-600 focus:bg-white dark:focus:bg-gray-700 transition-colors"
            />
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          </div>
        </div>
      </div>

      {/* 下层：风格标签 + 排序筛选 */}
      <div className="flex items-center gap-3 pb-2">
        {/* 二级风格标签 */}
        <div className="flex-1 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-1">
            {styleTags.map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
                  activeTag === tag
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* 排序 + 筛选 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div ref={sortRef} className="relative">
            <button
              onClick={() => setSortOpen(!sortOpen)}
              className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
            >
              {activeSort}
              <ChevronDown className="w-3 h-3" />
            </button>
            {sortOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-100 dark:border-gray-700 py-1 min-w-[80px] z-50">
                {sortOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => handleSortSelect(opt)}
                    className={`w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-700 ${
                      activeSort === opt ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-xs text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
            <SlidersHorizontal className="w-3 h-3" />
            筛选
          </button>

          {/* #820 调节模式开关（仅 NEXT_PUBLIC_ENABLE_ADJUST_MODE=true 时显示） */}
          {canAdjustMode && onToggleAdjustMode && (
            <button
              onClick={onToggleAdjustMode}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs transition-colors ${
                isAdjustMode
                  ? 'bg-amber-500 text-white border border-amber-500'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
              title={isAdjustMode ? '关闭调节模式' : '开启调节模式'}
            >
              <SlidersHorizontal className="w-3 h-3" />
              {isAdjustMode ? '调节中' : '调节'}
            </button>
          )}
        </div>
      </div>
      </div>
    </header>
  );
}
