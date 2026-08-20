'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Loader2, CheckCircle } from 'lucide-react';
import { safeSetItem } from '@/lib/safe-storage';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!account || !password) {
      setError('请输入账号和密码');
      return;
    }

    setLoading(true);

    try {
      // 🔧 #758 修复：添加 credentials: 'include' 确保 cookie 被保存和发送
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, password }),
        credentials: 'include',
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        // 保存用户信息到 localStorage
        safeSetItem('user', JSON.stringify(data.data));
        setTimeout(() => {
          router.push(redirect);
        }, 1500);
      } else {
        setError(data.error || '登录失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f8f9fa' }}>
        <Card className="w-full max-w-md p-8">
          <div className="text-center">
            <CheckCircle className="w-16 h-16 mx-auto mb-4 text-green-500" />
            <h2 className="text-2xl font-bold mb-2">登录成功！</h2>
            <p className="text-gray-600 mb-4">正在跳转到首页...</p>
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-400" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f8f9fa' }}>
      <Card className="w-full max-w-md p-8">
        {/* 返回按钮 */}
        <button
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          返回
        </button>

        <h1 className="text-2xl font-bold mb-6">登录</h1>

        <form onSubmit={handleLogin} className="space-y-4">
          {/* 手机号/邮箱 */}
          <div>
            <Label htmlFor="account">手机号 / 邮箱</Label>
            <Input
              id="account"
              type="text"
              placeholder="请输入手机号或邮箱"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="mt-1"
            />
          </div>

          {/* 密码 */}
          <div>
            <div className="flex justify-between items-center">
              <Label htmlFor="password">密码</Label>
              <Link 
                href="/forgot-password" 
                className="text-sm text-blue-600 hover:underline"
              >
                忘记密码？
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1"
            />
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="text-red-500 text-sm">{error}</div>
          )}

          {/* 登录按钮 */}
          <Button
            type="submit"
            className="w-full"
            style={{ backgroundColor: '#ffd100', color: '#000' }}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                登录中...
              </>
            ) : (
              '登录'
            )}
          </Button>
        </form>

        {/* 注册链接 */}
        <div className="text-center mt-4 text-sm text-gray-600">
          还没有账号？{' '}
          <Link href="/register" className="text-blue-600 hover:underline">
            立即注册
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#f8f9fa' }}>
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
