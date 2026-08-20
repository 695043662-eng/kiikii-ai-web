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
import ReactDOM from 'react-dom';
import Link from 'next/link';

// #515 预加载首屏 Logo 图片
if (typeof window !== 'undefined') {
  ReactDOM.preload('/logo-transparent.png', { as: 'image' });
  ReactDOM.preload('/logo-dark.png', { as: 'image' });
}

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
    <div
      className="absolute z-30 flex flex-col items-start group/logo-nav"
      style={{ left: '8px', top: '12px' }}
    >
      
      {/* 🔧 #432 修复：画布页面Logo替换 + 容器自适应比例 */}
      {/* 🔧 #433 调整：位置往下往右，尺寸大10% */}
      {/* 🔧 #434 优化：悬停时呼吸效果和阴影效果 */}
      {/* 🔧 #437 优化：Logo作为主页按钮+文字提示，阴影加深，菜单灰色 */}
      <Link 
        href="/" 
        className="relative group/item cursor-pointer"
      >
        <div className="relative rounded-lg transition-all duration-300 group-hover/logo-nav:[animation:logo-breathe_2s_ease-in-out_infinite] group-hover/logo-nav:shadow-xl group-hover/logo-nav:shadow-gray-400/40 ml-2 mt-2">
          {/* #515 首屏 Logo 添加 fetchPriority="high" 优化加载 */}
          {/* 白天模式：透明背景 Logo */}
          <img
            src="/logo-transparent.png"
            alt="Logo"
            fetchPriority="high"
            className="h-10 w-auto rounded-md dark:hidden"
            referrerPolicy="no-referrer-when-downgrade"
          />
          {/* 黑夜模式：白色 Logo（尺寸一致） */}
          <img
            src="/logo-dark.png"
            alt="Logo"
            fetchPriority="high"
            className="hidden dark:block h-10 w-auto rounded-md"
            referrerPolicy="no-referrer-when-downgrade"
          />
          {/* Logo文字提示（在Logo正右方，带指向三角形） */}
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover/item:opacity-100 transition-opacity duration-200 pointer-events-none shadow-lg">
            {/* 左侧指向三角形 */}
            <div className="absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 border-[6px] border-transparent border-r-gray-100 dark:border-r-gray-700" />
            回到主页
          </div>
        </div>
      </Link>
      
      {/* 🔧 #434 优化：导航菜单默认隐藏，悬停Logo时向下展开 */}
      {/* 🔧 #437 优化：删除主页按钮，菜单光影改为灰色 */}
      <div 
        className="
          mt-3 overflow-hidden transition-all duration-300 ease-out
          opacity-0 max-h-0 pointer-events-none
          group-hover/logo-nav:opacity-100 group-hover/logo-nav:max-h-60 group-hover/logo-nav:pointer-events-auto
        "
        style={{ animation: 'nav-slide-down 0.3s ease-out' }}
      >
        <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-xl py-2 flex flex-col shadow-xl border border-gray-200 dark:border-gray-600 min-w-[140px]">
          
          {/* 生图页面 */}
          <Link href="/generate" className="flex items-center px-3 py-2 mx-2 rounded-lg transition-all duration-200 cursor-pointer text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 mr-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="5.5" cy="5.5" r="1.2" stroke="currentColor" strokeWidth="1"/>
                <path d="M2.5 11L5.5 8L8 10.5L10.5 7L13.5 10V12.5H2.5V11Z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-medium whitespace-nowrap">生图页面</span>
          </Link>
          
          {/* 视频页面 */}
          <Link href="/video" className="flex items-center px-3 py-2 mx-2 rounded-lg transition-all duration-200 cursor-pointer text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 mr-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M6.5 6L10 8L6.5 10V6Z" fill="currentColor"/>
              </svg>
            </div>
            <span className="text-sm font-medium whitespace-nowrap">视频页面</span>
          </Link>
          
          {/* 个人中心 */}
          <Link href="/records" className="flex items-center px-3 py-2 mx-2 rounded-lg transition-all duration-200 cursor-pointer text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 mr-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M3 14c0-2.5 2.5-4 5-4s5 1.5 5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-sm font-medium whitespace-nowrap">个人中心</span>
          </Link>
          
          {/* 历史记录 */}
          <Link href="/history" className="flex items-center px-3 py-2 mx-2 rounded-lg transition-all duration-200 cursor-pointer text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700">
            <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700 mr-3">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M8 4.5V8L10.5 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-sm font-medium whitespace-nowrap">历史记录</span>
          </Link>
          
        </div>
      </div>
    </div>
  );
};

export default TopBar;
