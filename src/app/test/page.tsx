'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function TestPage() {
  const [imageUrl, setImageUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [status, setStatus] = useState('');

  const handleTest = () => {
    if (!imageUrl) {
      toast.error('请输入图片 URL');
      return;
    }

    const url = `/api/proxy-image?url=${encodeURIComponent(imageUrl)}${apiKey ? `&apiKey=${encodeURIComponent(apiKey)}` : ''}`;
    setProxyUrl(url);
    setStatus('代理 URL 已生成，正在尝试加载...');
  };

  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: '#f8f9fa' }}>
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">图片代理测试页面</h1>

        <div className="bg-white rounded-lg p-6 border border-gray-200 mb-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">图片 URL</label>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="输入图片 URL"
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">API Key (可选)</label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入 API Key"
                className="w-full"
              />
            </div>

            <Button onClick={handleTest}>测试</Button>
          </div>
        </div>

        {proxyUrl && (
          <div className="bg-white rounded-lg p-6 border border-gray-200 mb-6">
            <h2 className="text-lg font-semibold mb-4">代理 URL</h2>
            <div className="bg-gray-100 p-4 rounded text-sm font-mono break-all mb-4">
              {proxyUrl}
            </div>
            <p className="text-sm text-gray-600 mb-4">{status}</p>

            <h3 className="text-md font-semibold mb-2">原始图片</h3>
            <div className="border border-gray-200 rounded p-4 mb-4 bg-gray-50">
              <img
                src={imageUrl}
                alt="原始图片"
                className="max-w-full max-h-96 mx-auto"
                onError={() => setStatus('原始图片加载失败')}
                onLoad={() => setStatus('原始图片加载成功')}
              />
            </div>

            <h3 className="text-md font-semibold mb-2">代理图片</h3>
            <div className="border border-gray-200 rounded p-4 bg-gray-50">
              <img
                src={proxyUrl}
                alt="代理图片"
                className="max-w-full max-h-96 mx-auto"
                onError={() => setStatus('代理图片加载失败')}
                onLoad={() => setStatus(prev => prev + ' | 代理图片加载成功')}
              />
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg p-6 border border-gray-200">
          <h2 className="text-lg font-semibold mb-4">测试说明</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
            <li>输入要测试的图片 URL</li>
            <li>如果需要认证，输入 API Key</li>
            <li>点击"测试"按钮生成代理 URL</li>
            <li>查看原始图片和代理图片的加载情况</li>
            <li>如果代理图片加载失败，查看浏览器控制台的错误信息</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
