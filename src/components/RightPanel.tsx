'use client';

import { Card } from '@/components/ui/card';
import { Image as ImageIcon } from 'lucide-react';

export default function RightPanel() {
  return (
    <div className="ml-[320px] mt-[76px] min-h-[calc(100vh-100px)]">
      <Card className="h-full border border-gray-200 bg-white p-8 relative">
        {/* 默认状态 */}
        <div className="flex flex-col items-center justify-center h-full min-h-[600px]">
          <div className="w-32 h-32 rounded-full bg-gray-100 flex items-center justify-center mb-6">
            <ImageIcon className="w-16 h-16 text-gray-300" />
          </div>
          <h3 className="text-2xl font-semibold text-gray-700 mb-2">预览区域</h3>
          <p className="text-gray-500 text-center">
            生成的内容将显示在这里
          </p>
        </div>

        {/* 右下角系统提示（占位） */}
        <div className="absolute bottom-4 right-6">
          <p className="text-xs text-gray-400">
            激活 Windows 转到设置以激活 Windows
          </p>
        </div>
      </Card>
    </div>
  );
}
