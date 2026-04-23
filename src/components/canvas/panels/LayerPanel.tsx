'use client';

import React, { useState, useEffect } from 'react';
import { X, Layers } from 'lucide-react';
import { CanvasElement } from '@/types/canvas';

interface LayerPanelProps {
  elements: CanvasElement[];
  selectedIds: string[];
  showPanel: boolean;
  onTogglePanel: () => void;
  onSelectElement: (id: string, additive: boolean) => void;
}

export default function LayerPanel({
  elements,
  selectedIds,
  showPanel,
  onTogglePanel,
  onSelectElement,
}: LayerPanelProps) {
  // #101 修复：SSR Hydration 撕裂 - 图层数量在 SSR 和 CSR 之间不一致
  // 整个组件在 SSR 阶段返回 null，等客户端挂载后再渲染
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  if (!isMounted) return null;
  
  return (
    <>
      {/* 图层按钮 */}
      <div className="fixed bottom-4 left-4 z-40">
        <button
          onClick={onTogglePanel}
          className="bg-white rounded-lg shadow-sm px-3 py-2 flex items-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <Layers className="w-4 h-4 text-gray-600" />
          <span className="text-sm text-gray-600">图层</span>
          <span className="text-xs text-gray-400">({elements.length})</span>
        </button>
      </div>
      
      {/* 图层面板 */}
      {showPanel && (
        <div 
          className="fixed bottom-16 left-20 w-72 bg-white rounded-lg shadow-xl z-50 border border-gray-100 max-h-80 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-3 border-b border-gray-100 flex items-center justify-between">
            <span className="font-medium text-sm">图层记录</span>
            <button onClick={onTogglePanel} className="text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-y-auto max-h-60">
            {elements.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">暂无图层</div>
            ) : (
              elements.slice().reverse().map((el, index) => (
                <div 
                  key={el.id}
                  className={`p-2 flex items-center gap-2 border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${
                    selectedIds.includes(el.id) ? 'bg-blue-50' : ''
                  } ${!el.visible ? 'opacity-50' : ''}`}
                  onClick={() => {
                    onSelectElement(el.id, false);
                  }}
                >
                  {/* 缩略图 */}
                  <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                    {el.type === 'image' && el.imageUrl ? (
                      <img src={el.imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : el.type === 'imageGenerator' ? (
                      <div className="w-6 h-6 bg-blue-100 rounded" />
                    ) : el.type === 'videoGenerator' ? (
                      <div className="w-6 h-6 bg-green-100 rounded" />
                    ) : el.type === 'path' ? (
                      <div className="w-6 h-6 border-2 border-gray-400 rounded" />
                    ) : (
                      <div className="w-6 h-6 bg-gray-200 rounded" />
                    )}
                  </div>
                  
                  {/* 名称和类型 */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{el.name || `${el.type}`}</div>
                    <div className="text-xs text-gray-400">
                      {el.visible ? (el.locked ? '已锁定' : '可见') : '已隐藏'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
