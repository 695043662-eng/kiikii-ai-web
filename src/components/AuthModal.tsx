'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, User, Mail, Lock, Phone, ArrowRight, Sparkles, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'register';
  onLoginSuccess: (user: any) => void;
}

export default function AuthModal({ isOpen, onClose, initialMode = 'login', onLoginSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // 登录表单
  const [loginData, setLoginData] = useState({
    account: '',
    password: '',
  });

  // 注册表单
  const [registerData, setRegisterData] = useState({
    phone: '',
    email: '',
    code: '',
    password: '',
    confirmPassword: '',
  });

  // 忘记密码表单
  const [forgotData, setForgotData] = useState({
    email: '',
    code: '',
    password: '',
    confirmPassword: '',
  });

  // 切换模式
  const toggleMode = (newMode: 'login' | 'register' | 'forgot') => {
    setMode(newMode);
    setError('');
    setSuccess(false);
  };

  // 发送验证码（注册/忘记密码共用）
  const handleSendCode = async (email: string, type: 'register' | 'forgot') => {
    if (!email) {
      setError('请输入邮箱');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('邮箱格式不正确');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, type }),
      });

      const data = await response.json();

      if (data.success) {
        setCountdown(60);
        const timer = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(timer);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(data.error || '发送验证码失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 忘记密码 - 发送验证码
  const handleForgotSendCode = () => {
    handleSendCode(forgotData.email, 'forgot');
  };

  // 忘记密码 - 重置密码
  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!forgotData.email || !forgotData.code || !forgotData.password || !forgotData.confirmPassword) {
      setError('请填写所有必填项');
      return;
    }

    if (forgotData.password !== forgotData.confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    if (forgotData.password.length < 6) {
      setError('密码至少6位');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotData.email,
          code: forgotData.code,
          password: forgotData.password,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          toggleMode('login');
          setForgotData({ email: '', code: '', password: '', confirmPassword: '' });
        }, 1500);
      } else {
        setError(data.error || '重置密码失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 注册 - 发送验证码

  // 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!loginData.account || !loginData.password) {
      setError('请输入账号和密码');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: loginData.account, password: loginData.password }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          onLoginSuccess(data.data);
          onClose();
        }, 1000);
      } else {
        setError(data.error || '登录失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  // 注册
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!registerData.phone || !registerData.email || !registerData.code || !registerData.password) {
      setError('请填写所有必填项');
      return;
    }

    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(registerData.phone)) {
      setError('手机号格式不正确');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(registerData.email)) {
      setError('邮箱格式不正确');
      return;
    }

    if (registerData.password !== registerData.confirmPassword) {
      setError('两次密码输入不一致');
      return;
    }

    if (registerData.password.length < 6) {
      setError('密码至少6位');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: registerData.phone,
          email: registerData.email,
          code: registerData.code,
          password: registerData.password,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          onLoginSuccess(data.data);
          onClose();
        }, 1000);
      } else {
        setError(data.error || '注册失败');
      }
    } catch (err) {
      setError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* 模态框 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="relative w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="absolute -top-2 -right-2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors z-10"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            {/* 玻璃卡片 */}
            <div className="relative overflow-hidden rounded-3xl bg-white/[0.08] backdrop-blur-xl border border-white/[0.12] shadow-2xl">
              {/* 顶部渐变装饰 */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)]" />

              <div className="p-8">
                {/* Logo 和标题 */}
                <div className="text-center mb-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', delay: 0.1 }}
                    className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[rgb(139,158,232)] to-[rgb(232,180,184)] flex items-center justify-center shadow-lg"
                  >
                    <Sparkles className="w-8 h-8 text-white" />
                  </motion.div>
                  <h2 className="text-2xl font-bold text-white">
                    {mode === 'login' ? '欢迎回来' : '创建账号'}
                  </h2>
                  <p className="text-white/60 mt-2">
                    {mode === 'login' ? '登录您的 Kiikii AI 账号' : '开始您的 AI 创作之旅'}
                  </p>
                </div>

                {/* 成功提示 */}
                {success && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-4 rounded-xl bg-green-500/20 border border-green-500/30 text-green-300 text-center"
                  >
                    {mode === 'login' ? '登录成功！' : mode === 'register' ? '注册成功！' : '密码重置成功！'} 正在跳转...
                  </motion.div>
                )}

                {/* 错误提示 */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-center"
                  >
                    {error}
                  </motion.div>
                )}

                {/* 忘记密码表单 */}

                {/* 忘记密码表单 */}
                {mode === 'forgot' && (
                  <div className="space-y-4">
                    <button
                      type="button"
                      onClick={() => toggleMode('login')}
                      className="flex items-center text-white/60 hover:text-white transition-colors mb-2"
                    >
                      <ArrowLeft className="w-4 h-4 mr-1" />
                      返回登录
                    </button>

                    <div className="space-y-2">
                      <label className="text-sm text-white/60">邮箱</label>
                      <Input
                        type="email"
                        placeholder="请输入邮箱"
                        value={forgotData.email}
                        onChange={(e) => setForgotData({ ...forgotData, email: e.target.value })}
                        className="h-12 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)]"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm text-white/60">验证码</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="请输入验证码"
                          value={forgotData.code}
                          onChange={(e) => setForgotData({ ...forgotData, code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                          className="flex-1 h-12 px-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder:text-white/40 focus:outline-none focus:border-[rgb(139,158,232)]"
                          maxLength={6}
                        />
                        <button
                          type="button"
                          onClick={() => handleSendCode(forgotData.email, 'forgot')}
                          disabled={loading || countdown > 0}
                          className="shrink-0 px-4 h-12 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {countdown > 0 ? `${countdown}s` : '获取验证码'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm text-white/60">新密码</label>
                      <Input
                        type="password"
                        placeholder="至少6位"
                        value={forgotData.password}
                        onChange={(e) => setForgotData({ ...forgotData, password: e.target.value })}
                        className="h-12 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)]"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm text-white/60">确认密码</label>
                      <Input
                        type="password"
                        placeholder="再次输入密码"
                        value={forgotData.confirmPassword}
                        onChange={(e) => setForgotData({ ...forgotData, confirmPassword: e.target.value })}
                        className="h-12 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)]"
                      />
                    </div>

                    <Button
                      type="button"
                      onClick={(e) => { e.preventDefault(); handleForgotReset(e as any); }}
                      disabled={loading}
                      className="w-full h-12 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                          重置中...
                        </>
                      ) : (
                        <>
                          重置密码
                          <ArrowRight className="w-5 h-5 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                )}
                <AnimatePresence mode="wait">
                  {mode === 'login' && (
                    <motion.form
                      key="login"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      onSubmit={handleLogin}
                      className="space-y-4"
                    >
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <Input
                          type="text"
                          placeholder="手机号 / 邮箱"
                          value={loginData.account}
                          onChange={(e) => setLoginData({ ...loginData, account: e.target.value })}
                          className="h-14 pl-12 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20"
                        />
                      </div>

                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <Input
                          type="password"
                          placeholder="密码"
                          value={loginData.password}
                          onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                          className="h-14 pl-12 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20"
                        />
                      </div>

                      <Button
                        type="submit"
                        disabled={loading}
                        className="w-full h-14 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            登录中...
                          </>
                        ) : (
                          <>
                            登录
                            <ArrowRight className="w-5 h-5 ml-2" />
                          </>
                        )}
                      </Button>
                    </motion.form>
                  )}
                  {mode === 'register' && (
                    <motion.form
                      key="register"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      onSubmit={handleRegister}
                      className="space-y-4"
                    >
                      <div className="relative">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <Input
                          type="tel"
                          placeholder="手机号"
                          value={registerData.phone}
                          onChange={(e) => setRegisterData({ ...registerData, phone: e.target.value })}
                          className="h-14 pl-12 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20"
                          maxLength={11}
                        />
                      </div>

                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <Input
                          type="email"
                          placeholder="邮箱"
                          value={registerData.email}
                          onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                          className="h-14 pl-12 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20"
                        />
                      </div>

                      <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <Input
                          type="text"
                          placeholder="验证码"
                          value={registerData.code}
                          onChange={(e) => setRegisterData({ ...registerData, code: e.target.value })}
                          className="h-14 pl-12 pr-24 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20"
                          maxLength={6}
                        />
                        <button
                          type="button"
                          onClick={() => handleSendCode(registerData.email, 'register')}
                          disabled={loading || countdown > 0}
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-3 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50"
                        >
                          {countdown > 0 ? `${countdown}秒` : '获取验证码'}
                        </button>
                      </div>

                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <Input
                          type="password"
                          placeholder="密码（至少6位）"
                          value={registerData.password}
                          onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                          className="h-14 pl-12 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20"
                        />
                      </div>

                      <div className="relative">
                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                        <Input
                          type="password"
                          placeholder="确认密码"
                          value={registerData.confirmPassword}
                          onChange={(e) => setRegisterData({ ...registerData, confirmPassword: e.target.value })}
                          className="h-14 pl-12 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-[rgb(139,158,232)] focus:ring-[rgb(139,158,232)]/20"
                        />
                      </div>

                      <Button
                        type="submit"
                        disabled={loading}
                        className="w-full h-14 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                      >
                        {loading ? (
                          <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            注册中...
                          </>
                        ) : (
                          <>
                            注册
                            <ArrowRight className="w-5 h-5 ml-2" />
                          </>
                        )}
                      </Button>
                    </motion.form>
                  )}
                </AnimatePresence>

                {/* 切换登录/注册 */}
                <div className="mt-6 space-y-2 text-center">
                  {mode === 'login' && (
                    <button
                      onClick={() => toggleMode('forgot')}
                      className="block w-full text-white/40 hover:text-white/60 transition-colors text-sm"
                    >
                      忘记密码？
                    </button>
                  )}
                  {mode !== 'forgot' && (
                    <button
                      onClick={() => toggleMode(mode === 'login' ? 'register' : 'login')}
                      className="text-white/60 hover:text-white transition-colors"
                    >
                      {mode === 'login' ? (
                        <>
                          还没有账号？<span className="text-[rgb(139,158,232)] font-semibold">立即注册</span>
                        </>
                      ) : (
                        <>
                          已有账号？<span className="text-[rgb(139,158,232)] font-semibold">立即登录</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
