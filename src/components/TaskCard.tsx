'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Image as ImageIcon, Download, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { ImagePreviewTrigger } from '@/components/ImagePreview';

interface Task {
  id: number;
  prompt: string;
  model: string;
  aspectRatio: string;
  count: number;
  status: '未同步' | '已同步' | '生成中' | '生成成功' | '生成失败';
  fullPowerMode: boolean;
  referenceImages: string[];
  generatedImages: string[];
}

interface TaskCardProps {
  task: Task;
}

export default function TaskCard({ task }: TaskCardProps) {
  // 状态显示配置
  const statusConfig = {
    '未同步': {
      text: '未同步',
      bgColor: 'bg-gray-100',
      textColor: 'text-gray-600',
      icon: <Clock className="w-3 h-3" />,
    },
    '已同步': {
      text: '已同步',
      bgColor: 'bg-green-100',
      textColor: 'text-green-600',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    '生成中': {
      text: '生成中',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-600',
      icon: <Loader2 className="w-3 h-3 animate-spin" />,
    },
    '生成成功': {
      text: '生成成功',
      bgColor: 'bg-green-100',
      textColor: 'text-green-600',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    '生成失败': {
      text: '生成失败',
      bgColor: 'bg-red-100',
      textColor: 'text-red-600',
      icon: <XCircle className="w-3 h-3" />,
    },
  };

  const currentStatus = statusConfig[task.status] || statusConfig['未同步'];

  return (
    <Card className="border border-gray-200 bg-white min-h-[620px] flex flex-col overflow-hidden">
      {/* 顶部状态栏 */}
      <div className="flex justify-between items-center p-3 border-b border-gray-200 flex-shrink-0">
        <span className="text-sm font-bold text-gray-700">任务 #{task.id}</span>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${currentStatus.bgColor} ${currentStatus.textColor}`}>
          {currentStatus.icon}
          {currentStatus.text}
        </div>
      </div>

      {/* 预览区域 */}
      <div className="flex-1 p-3 min-h-0">
        {task.generatedImages.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 h-full min-h-0">
            {task.generatedImages.map((img, idx) => (
              <div key={idx} className="bg-white border border-gray-300 p-2 flex flex-col">
                {/* 标题栏 */}
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-bold text-gray-700">
                    #{idx + 1}
                  </span>
                  <Button
                    size="sm"
                    className="text-xs"
                    style={{ backgroundColor: '#ffd100', color: '#000' }}
                    onClick={async () => {
                      try {
                        const response = await fetch(img);
                        const blob = await response.blob();
                        const blobUrl = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = blobUrl;
                        link.download = `任务${task.id}_图${idx + 1}.png`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        window.URL.revokeObjectURL(blobUrl);
                      } catch (error) {
                        console.error('下载失败:', error);
                        toast.error('下载失败，请重试');
                      }
                    }}
                  >
                    <Download className="w-3 h-3 mr-1" />
                    下载
                  </Button>
                </div>

                {/* 图片容器 */}
                <div className="bg-gray-50 border border-gray-200 flex-1 min-h-0">
                  <ImagePreviewTrigger
                    images={task.generatedImages}
                    currentIndex={idx}
                  >
                    <img
                      src={img}
                      alt={`生成图${idx + 1}`}
                      className="w-full h-full object-cover min-h-0"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </ImagePreviewTrigger>
                </div>
              </div>
            ))}
          </div>
        ) : task.status === '生成中' ? (
          <div className="flex flex-col items-center justify-center h-full bg-gray-50 rounded-lg border border-gray-200">
            <Loader2 className="w-16 h-16 animate-spin text-blue-600 mb-4" />
            <span className="text-lg text-gray-600">正在生成图片...</span>
            <span className="text-sm text-gray-400 mt-2">预计需要几秒钟</span>
          </div>
        ) : task.status === '生成失败' ? (
          <div className="flex flex-col items-center justify-center h-full bg-red-50 rounded-lg border border-red-200">
            <XCircle className="w-16 h-16 text-red-400 mb-4" />
            <span className="text-lg text-red-600">生成失败</span>
            <span className="text-sm text-red-400 mt-2">请查看控制台了解详情</span>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full bg-gray-50 rounded-lg border border-gray-200">
            <ImageIcon className="w-16 h-16 text-gray-300 mb-4" />
            <span className="text-lg text-gray-600">预览区域</span>
            <span className="text-sm text-gray-400 mt-2">
              {task.status === '未同步' ? '等待同步参数...' : '生成的内容将显示在这里'}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
