/**
 * ============================================
 * Canvas/Editor TopBar 组件
 * ============================================
 * 
 * 【重构最高宪法 - kiikii-me】
 * 1. 代码幂等性：所有 Props 命名必须完全参照原 page.tsx 的变量名
 * 2. 架构原子化：纯函数组件，禁止 useEffect/useState 控制全局 Canvas 状态
 * 3. 零容错合规：Props 命名与原代码严格一致，防止合并断裂
 * 4. 资源保护：禁止引入闭包内存泄漏、重复渲染逻辑
 * 
 * 【项目全局意识补丁】
 * - 导航链接保持原有 next/link 路径："/", "/generate", "/video", "/records"
 * - 用户信息走全局 UserContext，不引入私有状态
 * 
 * 【来源】page.tsx 顶栏区域 (第4930-5023行)
 * 【修复记录】2025-01-XX 纠偏：Logo还原为model-logo.png，布局还原为纵向flex-col
 * ============================================
 */

import React from 'react';
import Link from 'next/link';

// ============================================
// 【Props 定义】
// ============================================

export interface ToolItem {
  id?: string;
  name?: string;
  icon?: string;
  divider?: boolean;
}

export type ToolIcons = Record<string, React.ReactNode>;

export interface TopBarProps {
  /** 当前激活的工具 ID */
  activeTool: string;
  
  /** 设置激活工具的回调 */
  setActiveTool: React.Dispatch<React.SetStateAction<string>>;
  
  /** 工具点击处理函数 - page.tsx handleToolClick */
  handleToolClick: (toolId: string) => void;
  
  /** 工具列表 - page.tsx tools 数组 */
  tools: ToolItem[];
  
  /** 工具图标 Record - page.tsx icons 对象 */
  icons: ToolIcons;
  
  /** 是否正在裁剪模式 - 裁剪时禁用工具栏交互 */
  isCropping: boolean;
}

// ============================================
// 【组件实现 - 纯函数】
// ============================================

/**
 * TopBar 组件
 * 
 * 【架构原子化约束】
 * - 纯函数组件，无 useEffect/useState
 * - 所有状态通过 props 注入
 * - 所有回调通过 props 传入
 * - 不控制全局 Canvas 状态
 * 
 * 【修复记录】
 * - 2025-01-XX：Logo 还原为 <img src="/model-logo.png">，不适用通用 SVG
 * - 2025-01-XX：布局还原为纵向 flex-col，与原代码一致
 */
const TopBar: React.FC<TopBarProps> = ({
  activeTool,
  setActiveTool,
  handleToolClick,
  tools,
  icons,
  isCropping,
}) => {
  
  // ========================================
  // 【渲染逻辑 - 100% 还原原 page.tsx 样式】
  // ========================================
  
  return (
    <div className="absolute left-0 z-30 flex flex-col items-center gap-2" style={{ left: '8px', top: '12px' }}>
      
      {/* Logo - 单独展示，无框（还原为 model-logo.png 图片） */}
      <Link href="/" className="relative group/item">
        <img 
          src="/model-logo.png" 
          alt="Logo" 
          className="w-9 h-9 rounded-lg" 
        />
        {/* 悬停提示 */}
        <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
          返回首页
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800 dark:border-r-gray-700" />
        </div>
      </Link>
      
      {/* 导航组件 - 纵向排列（还原为原代码结构） */}
      <div className="relative transition-transform duration-300 ease-out group/nav hover:translate-x-2">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-1.5 py-2.5 flex flex-col items-center shadow-sm border border-gray-200/50 dark:border-gray-700/50">
          
          {/* 主页 */}
          <Link href="/" className="relative group/item">
            <button
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                <path d="M2 6L8 2L14 6V14H2V6Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
                <path d="M6 14V9H10V14" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              </svg>
            </button>
            {/* 悬停提示 */}
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
              主页
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800 dark:border-r-gray-700" />
            </div>
          </Link>
          
          {/* 生图页面 */}
          <Link href="/generate" className="relative group/item">
            <button
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="5.5" cy="5.5" r="1.2" stroke="currentColor" strokeWidth="1"/>
                <path d="M2.5 11L5.5 8L8 10.5L10.5 7L13.5 10V12.5H2.5V11Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {/* 悬停提示 */}
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
              生图页面
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800 dark:border-r-gray-700" />
            </div>
          </Link>
          
          {/* 视频页面 */}
          <Link href="/video" className="relative group/item">
            <button
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M6.5 6L10 8L6.5 10V6Z" fill="currentColor"/>
              </svg>
            </button>
            {/* 悬停提示 */}
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
              视频页面
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800 dark:border-r-gray-700" />
            </div>
          </Link>
          
          {/* 个人中心 */}
          <Link href="/records" className="relative group/item">
            <button
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg width="17.6" height="17.6" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M3 14c0-2.5 2.5-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </button>
            {/* 悬停提示 */}
            <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/item:opacity-100 group-hover/item:visible transition-all duration-200 pointer-events-none shadow-lg">
              个人中心
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800 dark:border-r-gray-700" />
            </div>
          </Link>
          
        </div>
      </div>
    </div>
  );
};

export default TopBar;
