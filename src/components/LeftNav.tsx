'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';

interface LeftNavProps {
  /** 是否显示完整的导航（包含Logo和导航按钮） */
  showFullNav?: boolean;
  /** 是否在页面加载时自动添加左侧padding */
  withPadding?: boolean;
}

/**
 * 左侧Logo和导航组件
 * 用于画布、生图、视频等页面，提供统一的左侧导航体验
 */
export default function LeftNav({ showFullNav = true, withPadding = true }: LeftNavProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  
  // 判断是否显示主题切换按钮（不在主页和画布页面显示）
  const showThemeToggle = pathname !== '/' && pathname !== '/canvas';
  
  // 切换主题
  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  if (!showFullNav) return null;

  return (
    <>
      {/* 左侧Logo和导航 - 固定定位，不随滚动移动 */}
      <div className="fixed left-0 z-30 flex flex-col items-center gap-2" style={{ left: '8px', top: '12px' }}>
        {/* Logo - 单独展示，无框 */}
        <img src="/model-logo.png" alt="Logo" className="w-9 h-9 rounded-lg" />
        
        {/* 导航组件 */}
        <div className="relative transition-transform duration-300 ease-out group/nav hover:translate-x-2">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-1.5 py-2.5 flex flex-col items-center shadow-sm border border-gray-200/50 dark:border-gray-700/50">
            {/* 主页 */}
            <Link href="/" className="relative group/item">
              <button
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer ${
                  pathname === '/' 
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' 
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                  <path d="M2 6L8 2L14 6V14H2V6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                  <path d="M6 14V9H10V14" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                </svg>
              </button>
              {/* 悬停提示 */}
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                主页
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
              </div>
            </Link>
            
            {/* 生图页面 */}
            <Link href="/generate" className="relative group/item">
              <button
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer ${
                  pathname === '/generate' 
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' 
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <circle cx="5.5" cy="5.5" r="1.2" stroke="currentColor" strokeWidth="1"/>
                  <path d="M2.5 11L5.5 8L8 10.5L10.5 7L13.5 10V12.5H2.5V11Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              {/* 悬停提示 */}
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                生图页面
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
              </div>
            </Link>
            
            {/* 视频页面 */}
            <Link href="/video" className="relative group/item">
              <button
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer ${
                  pathname === '/video' 
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' 
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M6.5 6L10 8L6.5 10V6Z" fill="currentColor"/>
                </svg>
              </button>
              {/* 悬停提示 */}
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                视频页面
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
              </div>
            </Link>
            
            {/* 画布页面 - 仅在非画布页面显示 */}
            {pathname !== '/canvas' && (
              <Link href="/canvas" className="relative group/item">
                <button
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer ${
                    pathname === '/canvas' 
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' 
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                    <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                    <line x1="5" y1="1.5" x2="5" y2="14.5" stroke="currentColor" strokeWidth="1"/>
                    <line x1="11" y1="1.5" x2="11" y2="14.5" stroke="currentColor" strokeWidth="1"/>
                    <line x1="1.5" y1="5" x2="14.5" y2="5" stroke="currentColor" strokeWidth="1"/>
                    <line x1="1.5" y1="11" x2="14.5" y2="11" stroke="currentColor" strokeWidth="1"/>
                  </svg>
                </button>
                {/* 悬停提示 */}
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                  画布
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
                </div>
              </Link>
            )}

            {/* 分隔线 */}
            <div className="w-5 h-px bg-gray-300 dark:bg-gray-600 my-1" />

            {/* 模型列表 */}
            <Link href="/models" className="relative group/item">
              <button
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer ${
                  pathname === '/models' 
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' 
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                </svg>
              </button>
              {/* 悬停提示 */}
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                模型列表
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
              </div>
            </Link>

            {/* 个人中心 */}
            <Link href="/records" className="relative group/item">
              <button
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer ${
                  pathname === '/records' 
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' 
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M3 14c0-2.5 2.5-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
              {/* 悬停提示 */}
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                个人中心
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
              </div>
            </Link>

            {/* 生成记录 */}
            <Link href="/history" className="relative group/item">
              <button
                className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer ${
                  pathname === '/history' 
                    ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200' 
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                  <circle cx="5.5" cy="5.5" r="0.75" fill="currentColor"/>
                  <circle cx="5.5" cy="8" r="0.75" fill="currentColor"/>
                  <circle cx="5.5" cy="10.5" r="0.75" fill="currentColor"/>
                  <line x1="7.5" y1="5.5" x2="12" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <line x1="7.5" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <line x1="7.5" y1="10.5" x2="12" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
              {/* 悬停提示 */}
              <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                生成记录
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
              </div>
            </Link>
          </div>
        </div>
      </div>
      
      {/* 主题切换按钮 - 固定定位，不随滚动移动 */}
      {showThemeToggle && (
        <div 
          className="fixed z-30 flex flex-col items-center"
          style={{ left: '8px', top: '405px' }}
        >
          <div className="relative transition-transform duration-300 ease-out group/nav hover:translate-x-2">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-1.5 flex flex-col items-center shadow-sm border border-gray-200/50 dark:border-gray-700/50">
              <div className="relative group/item">
                <button
                  onClick={toggleTheme}
                  className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  {/* 太阳图标 - 深色模式下显示（点击切换到日间） */}
                  {theme === 'dark' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5"/>
                      <line x1="12" y1="1" x2="12" y2="3"/>
                      <line x1="12" y1="21" x2="12" y2="23"/>
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                      <line x1="1" y1="12" x2="3" y2="12"/>
                      <line x1="21" y1="12" x2="23" y2="12"/>
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                    </svg>
                  ) : (
                    /* 月亮图标 - 浅色模式下显示（点击切换到夜间） */
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                    </svg>
                  )}
                </button>
                {/* 悬停提示 */}
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
                  {theme === 'dark' ? '日间模式' : '夜间模式'}
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
