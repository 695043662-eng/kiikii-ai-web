'use client';

import React from 'react';
import CanvasViewport from '@/components/canvas/CanvasViewport';

export default function TestCanvasPage() {
  return (
    <div className="w-screen h-screen bg-gray-900">
      <div className="p-4 text-white">
        <h1 className="text-2xl font-bold mb-4">测试新 Canvas 视口组件</h1>
        <p className="mb-2">按住空格键 + 拖拽移动画布 | 滚轮缩放</p>
      </div>
      <div className="w-full h-[calc(100vh-80px)]">
        <CanvasViewport
          width={8000}
          height={8000}
        >
          {/* 测试元素 */}
          <div 
            className="absolute bg-red-500"
            style={{ left: 2000, top: 2000, width: 400, height: 300 }}
          >
            <div className="p-4 text-white">
              <h2 className="font-bold">测试元素 1</h2>
              <p>位置: (2000, 2000)</p>
              <p>尺寸: 400 x 300</p>
            </div>
          </div>
          
          <div 
            className="absolute bg-blue-500"
            style={{ left: 3000, top: 3000, width: 500, height: 400 }}
          >
            <div className="p-4 text-white">
              <h2 className="font-bold">测试元素 2</h2>
              <p>位置: (3000, 3000)</p>
              <p>尺寸: 500 x 400</p>
            </div>
          </div>
          
          <div 
            className="absolute bg-green-500"
            style={{ left: 1500, top: 2500, width: 300, height: 300 }}
          >
            <div className="p-4 text-white">
              <h2 className="font-bold">测试元素 3</h2>
              <p>位置: (1500, 2500)</p>
              <p>尺寸: 300 x 300</p>
            </div>
          </div>
        </CanvasViewport>
      </div>
    </div>
  );
}
