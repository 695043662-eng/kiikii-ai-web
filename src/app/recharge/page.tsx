'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import AuthModal from '@/components/AuthModal';
import Galaxy from '@/components/ui/Galaxy';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Gift, Ticket, Check, Loader2, ArrowLeft, History } from 'lucide-react';
import Link from 'next/link';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { clearCachedUser } from '@/lib/user-cache';

interface RedeemRecord {
  id: number;
  key_code: string;
  credits: number;
  used_at: string;
}

export default function RechargePage() {
  const router = useRouter();
  
  // ============================================
  // 【接入 AIGeneratorContext - 统一用户状态】
  // ============================================
  const { credits, userId, isLoggedIn, setIsLoggedIn, refreshUserInfo } = useAIGenerator();
  
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [keyCode, setKeyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successCredits, setSuccessCredits] = useState(0);
  const [records, setRecords] = useState<RedeemRecord[]>([]);

  // 监听登录/注册事件
  useEffect(() => {
    const handleOpenLogin = () => {
      setAuthMode('login');
      setAuthModalOpen(true);
    };

    const handleOpenRegister = () => {
      setAuthMode('register');
      setAuthModalOpen(true);
    };

    window.addEventListener('openLogin', handleOpenLogin);
    window.addEventListener('openRegister', handleOpenRegister);

    return () => {
      window.removeEventListener('openLogin', handleOpenLogin);
      window.removeEventListener('openRegister', handleOpenRegister);
    };
  }, []);

  const handleLoginSuccess = (user: any) => {
    setIsLoggedIn(true);
    setAuthModalOpen(false);
  };

  // 检查登录状态
  // 【使用 AIGeneratorContext 的 isLoggedIn，无需单独调用 API】
  useEffect(() => {
    if (!isLoggedIn) {
      // 未登录，触发登录模态框
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('openLogin'));
      }, 500);
    } else {
      // 已登录，获取兑换记录
      fetchRecords();
    }
  }, [isLoggedIn]);

  // 【积分变化已由 AIGeneratorContext 统一监听，无需单独处理】
  // 页面使用 Context 的 credits 即可自动同步

  // 获取兑换记录
  const fetchRecords = async () => {
    try {
      const res = await fetch('/api/redeem');
      const data = await res.json();
      setRecords(data.data || []);
    } catch (error) {
      console.error('获取兑换记录失败:', error);
    }
  };

  // 格式化兑换码输入
  const handleKeyCodeChange = (value: string) => {
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let formatted = '';
    for (let i = 0; i < cleaned.length && i < 16; i++) {
      if (i > 0 && i % 4 === 0) {
        formatted += '-';
      }
      formatted += cleaned[i];
    }
    setKeyCode(formatted);
  };

  // 兑换
  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!keyCode.trim()) {
      setError('请输入兑换码');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyCode: keyCode.trim() }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess(true);
        setSuccessCredits(data.data.credits);
        // 🔒 军规：充值/兑换必须穿透缓存，先清除再刷新
        clearCachedUser();  // 清除旧缓存，重置刷新标记
        await refreshUserInfo();  // 真正调用 API 获取最新积分
        // #270 触发全局事件，携带 userId 实现本地热更新
        if (data.data.credits !== undefined) {
          window.dispatchEvent(new CustomEvent('creditsChanged', {
            detail: {
              userId: userId,
              newCredits: data.data.credits,
            }
          }));
        }
        setKeyCode('');
        fetchRecords();
        
        // 2秒后重置
        setTimeout(() => {
          setSuccess(false);
          setSuccessCredits(0);
        }, 3000);
      } else {
        setError(data.error || '兑换失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('zh-CN');
  };

  if (!isLoggedIn) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {/* Galaxy 星空背景 */}
      <div className="fixed inset-0 z-0">
        <Galaxy 
          mouseRepulsion
          mouseInteraction
          density={1.5}
          glowIntensity={0.35}
          saturation={0.15}
          hueShift={260}
          twinkleIntensity={0.25}
          rotationSpeed={0.05}
          repulsionStrength={1.5}
          autoCenterRepulsion={0}
          starSpeed={0.8}
          speed={0.8}
        />
      </div>

      {/* 导航栏 */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <Navbar isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn} />
      </div>

      {/* 主内容 */}
      <div className="relative z-10 pt-[100px] pb-20 px-4">
        <div className="max-w-2xl mx-auto">
          {/* 返回按钮 */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="mb-6"
          >
            <Link href="/">
              <Button variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10">
                <ArrowLeft className="w-4 h-4 mr-2" />
                返回首页
              </Button>
            </Link>
          </motion.div>

          {/* 充值卡片 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="relative overflow-hidden rounded-3xl bg-white/[0.08] backdrop-blur-xl border border-white/[0.12] shadow-2xl"
          >
            {/* 顶部渐变装饰 */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)]" />
            
            <div className="p-8">
              {/* 标题区域 */}
              <div className="text-center mb-8">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.1 }}
                  className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[rgb(139,158,232)] to-[rgb(232,180,184)] flex items-center justify-center shadow-lg"
                >
                  <Gift className="w-10 h-10 text-white" />
                </motion.div>
                <h1 className="text-3xl font-bold text-white mb-2">充值积分</h1>
                <p className="text-white/60">输入兑换码获取积分</p>
              </div>

              {/* 当前积分 */}
              <div className="text-center mb-8">
                <p className="text-white/50 text-sm mb-1">当前积分</p>
                <p className="text-4xl font-bold bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] bg-clip-text text-transparent">
                  {credits.toLocaleString()}
                </p>
              </div>

              {/* 成功提示 */}
              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 rounded-xl bg-green-500/20 border border-green-500/30 text-center"
                >
                  <Check className="w-12 h-12 mx-auto mb-2 text-green-400" />
                  <p className="text-green-300 text-lg font-semibold">
                    兑换成功！
                  </p>
                  <p className="text-green-300/80">
                    获得 {successCredits} 积分
                  </p>
                </motion.div>
              )}

              {/* 错误提示 */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-6 p-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-center"
                >
                  {error}
                </motion.div>
              )}

              {/* 兑换表单 */}
              <form onSubmit={handleRedeem} className="space-y-4">
                <div className="relative">
                  <Ticket className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                  <Input
                    type="text"
                    placeholder="输入兑换码"
                    value={keyCode}
                    onChange={(e) => handleKeyCodeChange(e.target.value)}
                    className="h-16 pl-12 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20 text-center font-mono text-xl tracking-wider"
                    maxLength={19}
                    disabled={loading}
                  />
                </div>

                <p className="text-white/50 text-sm text-center">
                  兑换码格式：XXXX-XXXX-XXXX-XXXX
                </p>

                <Button
                  type="submit"
                  disabled={loading || keyCode.length < 16}
                  className="w-full h-14 text-lg bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      兑换中...
                    </>
                  ) : (
                    '立即兑换'
                  )}
                </Button>
              </form>

              {/* 提示信息 */}
              <div className="mt-8 text-center text-white/40 text-sm">
                <p>兑换码由管理员发放</p>
                <p className="mt-1">如有问题请联系客服</p>
              </div>
            </div>
          </motion.div>

          {/* 兑换记录 */}
          {records.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mt-8 relative overflow-hidden rounded-2xl bg-white/[0.05] backdrop-blur-xl border border-white/[0.1]"
            >
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <History className="w-5 h-5 text-white/70" />
                  <h2 className="text-lg font-semibold text-white">兑换记录</h2>
                </div>

                <div className="space-y-3">
                  {records.map((record) => (
                    <div
                      key={record.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                    >
                      <div>
                        <code className="font-mono text-sm text-white/80">
                          {record.key_code}
                        </code>
                        <p className="text-xs text-white/50 mt-1">
                          {formatDate(record.used_at)}
                        </p>
                      </div>
                      <div className="text-green-400 font-semibold">
                        +{record.credits} 积分
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* 登录/注册模态框 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onLoginSuccess={handleLoginSuccess}
      />
    </div>
  );
}
