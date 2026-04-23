'use client';

import { useState, useEffect, useCallback } from 'react';
import { User } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { motion } from 'framer-motion';

interface UserInfo {
  id: string;
  phone: string;
  nickname: string;
  avatar?: string;
  credits: number;
}

interface NavbarProps {
  isLoggedIn: boolean;
  setIsLoggedIn: (value: boolean) => void;
  historyPromptsOpen?: boolean;
  setHistoryPromptsOpen?: (value: boolean) => void;
  historyRecordsOpen?: boolean;
  setHistoryRecordsOpen?: (value: boolean) => void;
  transparent?: boolean;
  noBorder?: boolean;
}

// 全局用户状态 - 使用简单的闭包存储
const createUserStore = () => {
  let credits = 0;
  let listeners: Set<() => void> = new Set();

  return {
    getCredits: () => credits,
    setCredits: (value: number) => {
      credits = value;
      listeners.forEach(listener => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

const userStore = createUserStore();

// 触发积分更新的全局函数
if (typeof window !== 'undefined') {
  (window as any).refreshUserCredits = () => {
    // 触发自定义事件
    window.dispatchEvent(new CustomEvent('creditsChanged'));
  };
}

export default function Navbar({
  isLoggedIn,
  setIsLoggedIn,
  historyPromptsOpen,
  setHistoryPromptsOpen,
  historyRecordsOpen,
  setHistoryRecordsOpen,
  transparent = false,
  noBorder = false,
}: NavbarProps) {
  const pathname = usePathname();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true); // 加载状态，防止布局偏移

  // 获取用户信息
  const fetchUserInfo = useCallback(async () => {
    try {
      const response = await fetch('/api/user/info');
      const data = await response.json();
      
      if (data.success && data.user) {
        setUser(data.user);
        userStore.setCredits(data.user.credits);
        setIsLoggedIn(true);
      } else {
        setUser(null);
        setIsLoggedIn(false);
      }
    } catch (error) {
      console.error('获取用户信息失败:', error);
      setUser(null);
      setIsLoggedIn(false);
    } finally {
      setIsLoading(false);
    }
  }, [setIsLoggedIn]);

  // 初始化获取用户信息（只在首次渲染时执行，不依赖 pathname）
  useEffect(() => {
    if (pathname !== '/login' && pathname !== '/register') {
      fetchUserInfo();
    } else {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // 空依赖，只在组件挂载时执行一次

  // 监听积分变化事件
  useEffect(() => {
    const handleCreditsChange = () => {
      console.log('收到积分变化事件，重新获取用户信息');
      fetchUserInfo();
    };

    window.addEventListener('creditsChanged', handleCreditsChange);
    return () => window.removeEventListener('creditsChanged', handleCreditsChange);
  }, [fetchUserInfo]);

  const navItems = [
    { name: '首页', href: '/', active: pathname === '/' },
    { name: '画布', href: '/canvas', active: pathname === '/canvas' },
    { name: '图片生成', href: '/generate', active: pathname === '/generate' },
    { name: '视频生成', href: '/video', active: pathname === '/video' },
    { name: '模型列表', href: '/models', active: pathname === '/models' },
  ];

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      setUser(null);
      setIsLoggedIn(false);
      window.location.href = '/';
    } catch (error) {
      console.error('注销失败:', error);
    }
  };

  // 打开登录模态框
  const handleOpenLogin = () => {
    window.dispatchEvent(new CustomEvent('openLogin'));
  };

  // 打开注册模态框
  const handleOpenRegister = () => {
    window.dispatchEvent(new CustomEvent('openRegister'));
  };

  return (
    <nav 
      className={`transition-colors ${
        noBorder 
          ? transparent 
            ? 'bg-transparent' 
            : 'bg-white dark:bg-gray-900'
          : transparent
            ? 'bg-transparent shadow-sm border-b border-white/10'
            : 'bg-white dark:bg-gray-900 shadow-sm border-b border-gray-200 dark:border-gray-800'
      }`}
      style={noBorder ? { borderBottom: 'none' } : undefined}
    >
      <div className="container mx-auto px-4" style={{ height: '60px' }}>
        <div className="flex items-center justify-between h-full">
          {/* 左侧品牌区 */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center gap-3 group" style={{ height: '100px', transform: 'translateX(-24px)' }}>
              <img 
                src="/model-logo.png" 
                alt="Kiikii AI" 
                className="transition-all duration-300 group-hover:brightness-110 group-hover:saturate-110"
                style={{ 
                  height: '60px', 
                  width: 'auto',
                  opacity: transparent ? 0.85 : 1,
                  filter: transparent ? 'brightness(1.05) saturate(1.05)' : 'none'
                }} 
              />
              <div className="flex flex-col">
                <span className={`text-xl font-bold ${transparent ? 'text-white' : 'text-gray-900 dark:text-white'}`}>Kiikii AI</span>
                <span className={`text-xs tracking-wider ${transparent ? 'text-white/60' : 'text-gray-500 dark:text-gray-400'}`}>DreamVision AI</span>
              </div>
            </Link>
          </div>

          {/* 中间导航区 */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <motion.div
                key={item.name}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 17 }}
              >
                <Link
                  href={item.href}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    item.active
                      ? transparent
                        ? 'text-white bg-white/20'
                        : 'text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800'
                      : transparent
                        ? 'text-white/70 hover:text-white hover:bg-white/10'
                        : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                >
                  {item.name}
                </Link>
              </motion.div>
            ))}
          </div>

          {/* 右侧用户区 */}
          <div className="flex items-center gap-3">
            {/* 主题切换 */}
            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
              <ThemeToggle />
            </motion.div>

            {isLoading ? (
              /* 加载中占位，防止布局偏移 */
              <div className="flex items-center gap-2 w-[120px] -mr-12">
                <div className={`w-8 h-8 rounded-full ${transparent ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'} animate-pulse`} />
                <div className={`w-16 h-4 rounded ${transparent ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'} animate-pulse`} />
              </div>
            ) : user ? (
              <div className="flex items-center gap-2 -mr-12">
                {/* 用户信息 - 点击进入个人主页 */}
                <Link href="/records" className="flex items-center gap-2 cursor-pointer">
                  <motion.div 
                    whileHover={{ scale: 1.05 }} 
                    whileTap={{ scale: 0.95 }}
                    className="flex items-center gap-2"
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      transparent ? 'bg-white/20' : 'bg-gray-200 dark:bg-gray-700'
                    }`}>
                      {user.avatar ? (
                        <img src={user.avatar} alt="avatar" className="w-full h-full rounded-full object-cover" />
                      ) : (
                        <User className={`w-5 h-5 ${transparent ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`} />
                      )}
                    </div>
                    <span className={`text-sm font-medium ${transparent ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                      {user.nickname}
                    </span>
                  </motion.div>
                </Link>

                {/* 注销按钮 */}
                <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`text-xs ${transparent ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'}`}
                    onClick={handleLogout}
                  >
                    注销
                  </Button>
                </motion.div>
              </div>
            ) : (
              <div className="flex items-center gap-2 -mr-12">
                <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className={`text-sm ${transparent ? 'text-white/70 hover:text-white hover:bg-white/10' : 'text-gray-600 dark:text-gray-300'}`}
                    onClick={handleOpenLogin}
                  >
                    登录
                  </Button>
                </motion.div>
                <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                  <Button
                    size="sm"
                    className="text-sm bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white brightness-110 saturate-[1.1]"
                    onClick={handleOpenRegister}
                  >
                    注册
                  </Button>
                </motion.div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
