'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import CanvasViewport from '@/components/canvas/CanvasViewport';

export default function CanvasNewPage() {
  // ====== 基础状态 ======
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);

  return (
    <div className="w-screen h-screen bg-gray-900">
      {/* 顶部工具栏 */}
      <div className="absolute top-4 left-4 z-50 bg-gray-800/90 text-white px-4 py-2 rounded-lg shadow-lg">
        <h1 className="font-bold text-lg mb-2">新架构画布</h1>
        <p className="text-sm text-gray-300">按住空格 + 拖拽移动 | 滚轮缩放</p>
      </div>
      
      {/* 画布 */}
      <div className="w-full h-full">
        <CanvasViewport
          width={8000}
          height={8000}
          onPanChange={setPan}
          onZoomChange={setZoom}
        >
          {/* 测试元素 */}
          <div 
            className="absolute bg-red-500/80 border-2 border-red-700 rounded-lg"
            style={{ left: 2000, top: 2000, width: 400, height: 300 }}
          >
            <div className="p-4 text-white">
              <h2 className="font-bold text-xl mb-2">测试元素 1</h2>
              <p>位置: (2000, 2000)</p>
              <p>尺寸: 400 x 300</p>
              <p className="mt-2 text-sm text-gray-200">这是新架构画布的测试元素</p>
            </div>
          </div>
          
          <div 
            className="absolute bg-blue-500/80 border-2 border-blue-700 rounded-lg"
            style={{ left: 3000, top: 3000, width: 500, height: 400 }}
          >
            <div className="p-4 text-white">
              <h2 className="font-bold text-xl mb-2">测试元素 2</h2>
              <p>位置: (3000, 3000)</p>
              <p>尺寸: 500 x 400</p>
            </div>
          </div>
          
          <div 
            className="absolute bg-green-500/80 border-2 border-green-700 rounded-lg"
            style={{ left: 1500, top: 2500, width: 300, height: 300 }}
          >
            <div className="p-4 text-white">
              <h2 className="font-bold text-xl mb-2">测试元素 3</h2>
              <p>位置: (1500, 2500)</p>
              <p>尺寸: 300 x 300</p>
            </div>
          </div>
          
          {/* 画布中心标记 */}
          <div 
            className="absolute w-4 h-4 bg-yellow-400 rounded-full border-2 border-yellow-600"
            style={{ left: 4000 - 8, top: 4000 - 8 }}
          />
        </CanvasViewport>
      </div>
      
      {/* 右下角信息显示 */}
      <div className="absolute bottom-4 right-4 bg-gray-800/90 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
        <p>Zoom: {Math.round(zoom * 100)}%</p>
        <p>Pan: ({Math.round(pan.x)}, {Math.round(pan.y)})</p>
        <p className="text-gray-400 mt-1">访问 /canvas-new 查看新架构</p>
      </div>
    </div>
  );
}
