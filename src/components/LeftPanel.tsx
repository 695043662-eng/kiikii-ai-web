'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Upload, X, Image as ImageIcon, Sparkles, LogIn } from 'lucide-react';

interface LeftPanelProps {
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  fullPowerMode: boolean;
  setFullPowerMode: (value: boolean) => void;
  selectedFunction: string;
  setSelectedFunction: (value: string) => void;
  uploadedImages: string[];
  setUploadedImages: (value: string[]) => void;
  handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  removeImage: (index: number) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  aspectRatio: string;
  setAspectRatio: (value: string) => void;
  resolution: string;
  setResolution: (value: string) => void;
  count: number;
  setCount: (value: number) => void;
  isLoggedIn: boolean;
}

export default function LeftPanel({
  selectedModel,
  setSelectedModel,
  fullPowerMode,
  setFullPowerMode,
  selectedFunction,
  setSelectedFunction,
  uploadedImages,
  setUploadedImages,
  handleImageUpload,
  removeImage,
  prompt,
  setPrompt,
  aspectRatio,
  setAspectRatio,
  resolution,
  setResolution,
  count,
  setCount,
  isLoggedIn,
}: LeftPanelProps) {
  const [activeTab, setActiveTab] = useState('editor');

  const functionButtons = [
    { id: 'curve', label: '曲图生成' },
    { id: 'clear', label: '清空' },
  ];

  const resolutionOptions = ['1K', '2K', '4K'];
  const countOptions = [1, 2, 3, 4];
  const aspectRatioOptions = ['1:1', '3:4', '4:3', '16:9', '9:16'];

  const handleFunctionClick = (id: string) => {
    if (id === 'clear') {
      setPrompt('');
      setUploadedImages([]);
      setSelectedFunction('curve');
    } else {
      setSelectedFunction(id);
    }
  };

  return (
    <div className="fixed left-4 top-[76px] bottom-4 w-[300px] overflow-y-auto">
      <Card className="p-4 h-full border border-gray-200 bg-white">
        {/* 模型选择区 */}
        <div className="mb-6">
          <Label className="mb-2 block text-sm font-semibold text-gray-900">模型</Label>

          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="w-full mb-3">
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nano-banana-pro-3">Nano Banana Pro (线路三)</SelectItem>
              <SelectItem value="nano-banana-pro-1">Nano Banana Pro (线路一)</SelectItem>
              <SelectItem value="nano-banana-pro-2">Nano Banana Pro (线路二)</SelectItem>
              <SelectItem value="ultra-banana">Ultra Banana (旗舰)</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm text-gray-700">满血模式</Label>
            <Switch
              checked={fullPowerMode}
              onCheckedChange={setFullPowerMode}
              className="data-[state=checked]:bg-orange-500"
            />
          </div>

          <div className="flex gap-2">
            {functionButtons.map((btn) => (
              <Button
                key={btn.id}
                variant={selectedFunction === btn.id ? 'default' : 'outline'}
                className="flex-1 text-xs"
                style={{
                  ...(selectedFunction === btn.id
                    ? { backgroundColor: '#ffd100', color: '#000', borderColor: '#ffd100' }
                    : {}),
                }}
                onClick={() => handleFunctionClick(btn.id)}
              >
                {btn.label}
              </Button>
            ))}
          </div>
        </div>

        {/* 上传参考图区 */}
        <div className="mb-6">
          <Label className="mb-2 block text-sm font-semibold text-gray-900">
            上传参考图 <span className="text-xs text-gray-500">(MAX5)</span>
          </Label>

          <div className="space-y-2">
            {uploadedImages.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                {uploadedImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={img}
                      alt={`uploaded-${index}`}
                      className="w-full h-24 object-cover rounded-lg border border-gray-200"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => document.getElementById('image-upload')?.click()}
              disabled={uploadedImages.length >= 5}
            >
              <Upload className="w-4 h-4 mr-2" />
              上传图片
            </Button>
            <input
              id="image-upload"
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* 提示词区域 */}
        <div className="mb-6">
          <Label className="mb-2 block text-sm font-semibold text-gray-900">提示</Label>

          <div className="flex gap-1 mb-2 border-b border-gray-200">
            {['提示词编辑框', '提示词', '历史记录'].map((tab) => (
              <button
                key={tab}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? 'text-gray-900 border-b-2 border-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="relative">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想生成的内容..."
              className="min-h-[120px] pr-16 pb-8 resize-none"
              maxLength={1800}
            />
            <div className="absolute bottom-2 right-2 text-xs text-gray-400">
              {prompt.length}/1800
            </div>
          </div>

          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1 text-xs text-gray-500">
              <ImageIcon className="w-4 h-4" />
              <span>支持粘贴图片上传</span>
            </div>
            <Button variant="outline" size="sm" className="ml-auto text-xs px-2 py-1">
              <Sparkles className="w-3 h-3 mr-1" />
              提示词优化
            </Button>
          </div>
        </div>

        {/* 参数设置区 */}
        <div className="mb-6">
          <Label className="mb-2 block text-sm font-semibold text-gray-900">宽高比 / 分辨率</Label>

          <Select value={aspectRatio} onValueChange={setAspectRatio}>
            <SelectTrigger className="w-full mb-3">
              <SelectValue placeholder="选择宽高比" />
            </SelectTrigger>
            <SelectContent>
              {aspectRatioOptions.map((ratio) => (
                <SelectItem key={ratio} value={ratio}>
                  {ratio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex gap-2 mb-3">
            {resolutionOptions.map((res) => (
              <Button
                key={res}
                variant={resolution === res ? 'default' : 'outline'}
                className="flex-1 text-xs"
                style={{
                  ...(resolution === res
                    ? { backgroundColor: '#ffd100', color: '#000', borderColor: '#ffd100' }
                    : {}),
                }}
                onClick={() => setResolution(res)}
              >
                {res}
              </Button>
            ))}
          </div>

          <Label className="mb-2 block text-sm font-semibold text-gray-900">数量</Label>

          <div className="flex gap-2">
            {countOptions.map((num) => (
              <Button
                key={num}
                variant={count === num ? 'default' : 'outline'}
                className="flex-1 text-xs"
                style={{
                  ...(count === num
                    ? { backgroundColor: '#ffd100', color: '#000', borderColor: '#ffd100' }
                    : {}),
                }}
                onClick={() => setCount(num)}
              >
                {num}
              </Button>
            ))}
          </div>
        </div>

        {/* 登录按钮 */}
        <div className="mt-auto">
          <Button
            className="w-full text-sm font-semibold"
            style={{ backgroundColor: '#ffd100', color: '#000', border: 'none' }}
          >
            <LogIn className="w-4 h-4 mr-2" />
            登录
          </Button>
        </div>
      </Card>
    </div>
  );
}
