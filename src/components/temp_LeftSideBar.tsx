/**
 * ============================================
 * Canvas/Editor LeftSideBar (左侧工具栏) 组件
 * ============================================
 * 
 * 【重构最高宪法 - kiikii-me】
 * 1. 代码幂等性：所有 Props 命名必须完全参照原 page.tsx 的变量名
 * 2. 架构原子化：纯函数组件，禁止 useEffect/useState 控制全局 Canvas 状态
 * 3. 零容错合规：Props 命名与原代码严格一致，防止合并断裂
 * 4. 资源保护：禁止引入闭包内存泄漏、重复渲染逻辑
 * 
 * 【来源】page.tsx 第4957-5067行（完整迁移，含形状工具菜单）
 * ============================================
 */

import React from 'react';

// ============================================
// 【Props 定义】
// ============================================

export interface LeftSideBarProps {
  /** 当前激活的工具 ID */
  activeTool: string;
  
  /** 工具点击处理函数 */
  handleToolClick: (toolId: string) => void;
  
  /** 工具列表 */
  tools: Array<{
    id?: string;
    name?: string;
    icon?: string;
    divider?: boolean;
  }>;
  
  /** 工具图标 Record */
  icons: Record<string, React.ReactNode>;
  
  /** 是否正在裁剪模式 - 裁剪时禁用工具栏交互 */
  isCropping: boolean;
}

// ============================================
// 【组件实现 - 纯函数】
// ============================================

/**
 * LeftSideBar 组件
 * 
 * 【架构原子化约束】
 * - 纯函数组件，无 useEffect/useState
 * - 所有状态通过 props 注入
 * - 所有回调通过 props 传入
 * - 不控制全局 Canvas 状态
 */
const LeftSideBar: React.FC<LeftSideBarProps> = ({
  activeTool,
  handleToolClick,
  tools,
  icons,
  isCropping,
}) => {
  
  // ========================================
  // 【渲染逻辑 - 与 page.tsx 第4957-5067行完全一致】
  // ========================================
  
  return (
    <aside 
      className="absolute left-0 top-1/2 -translate-y-1/2 z-30 group" 
      style={{ left: '8px', pointerEvents: isCropping ? 'none' : 'auto' }}
    >
      {/* 工具栏 */}
      <div 
        data-toolbar="true" 
        className="relative transition-transform duration-300 ease-out group hover:translate-x-2"
      >
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-1.5 py-2.5 flex flex-col items-center shadow-sm border border-gray-200/50 dark:border-gray-700/50">
          {tools.map((tool, index) => {
            if (tool.divider) return <div key={index} className="w-5 h-px bg-gray-300 dark:bg-gray-600 my-1.5" />;
            const isActive = activeTool === tool.id;
            return (
              <div key={tool.id} className="relative group/tool">
                <button
                  onClick={() => handleToolClick(tool.id!)}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 my-0.5 cursor-pointer relative ${
                    isActive ? 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <span style={{ transform: 'scale(1.1)', display: 'flex' }}>
                    {icons[tool.icon as keyof typeof icons]}
                  </span>
                </button>
                
                {/* 悬停提示 - 水平右方显示 */}
                <div className="absolute left-full ml-2 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover/tool:opacity-100 group-hover/tool:visible transition-all duration-200 pointer-events-none shadow-lg">
                  {tool.name}
                  {/* 小三角 */}
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-800 dark:border-r-gray-700" />
                </div>
                
                {/* 形状工具悬停菜单 - 与原代码第4986-5060行完全一致 */}
                {tool.id === 'shape' && (
                  <div className="absolute left-full ml-2 top-0 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-600 p-2 opacity-0 invisible group-hover/tool:opacity-100 group-hover/tool:visible transition-all duration-200 z-50 min-w-[140px]">
                    {/* 形状组 */}
                    <div className="text-xs text-gray-400 dark:text-gray-500 px-2 mb-1">形状</div>
                    <div className="grid grid-cols-4 gap-1 mb-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToolClick('shape-rectangle'); }}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${activeTool === 'shape-rectangle' ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
                        title="方形"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <rect x="2" y="2" width="12" height="12" rx="1"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToolClick('shape-circle'); }}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${activeTool === 'shape-circle' ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
                        title="圆形"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <circle cx="8" cy="8" r="6"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToolClick('shape-triangle'); }}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${activeTool === 'shape-triangle' ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
                        title="三角形"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <polygon points="8,2 14,14 2,14"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToolClick('shape-star'); }}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 ${activeTool === 'shape-star' ? 'bg-blue-100 text-blue-600' : 'text-gray-600'}`}
                        title="五角星"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <polygon points="8,1 10,6 15.5,6.5 11.5,10 12.5,15.5 8,12.5 3.5,15.5 4.5,10 0.5,6.5 6,6"/>
                        </svg>
                      </button>
                    </div>
                    
                    {/* 标注组 */}
                    <div className="text-xs text-gray-400 dark:text-gray-500 px-2 mb-1">标注</div>
                    <div className="grid grid-cols-3 gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToolClick('shape-bubble'); }}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${activeTool === 'shape-bubble' ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
                        title="对话气泡"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2 4a2 2 0 012-2h8a2 2 0 012 2v5a2 2 0 01-2 2H7l-3 3v-3H4a2 2 0 01-2-2V4z"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToolClick('shape-arrow-left'); }}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${activeTool === 'shape-arrow-left' ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
                        title="左向箭头"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 3L3 8L8 13V10H14V6H8V3Z"/>
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToolClick('shape-arrow-right'); }}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${activeTool === 'shape-arrow-right' ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
                        title="右向箭头"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 3L13 8L8 13V10H2V6H8V3Z"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

export default LeftSideBar;
