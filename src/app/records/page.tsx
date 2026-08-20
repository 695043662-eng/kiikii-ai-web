'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import LeftNav from '@/components/LeftNav';
import AuthModal from '@/components/AuthModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Camera, Edit2, Check, X as XIcon, Coins, Phone, Calendar, Ticket, Gift, Check as CheckIcon, Loader2, History, Mail, Clock, CheckCircle } from 'lucide-react';
import { CachedUserInfo, fetchUserWithCache, setCachedUser, clearCachedUser } from '@/lib/user-cache';
import { safeJsonResponse } from '@/lib/safe-json';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';
import { QRCodeSVG } from 'qrcode.react';

interface RedeemRecord {
  id: number;
  key_code: string;
  credits: number;
  used_at: string;
}

interface RechargePackage {
  id: number;
  name: string;
  price: number; // 分
  credits: number;
  tag: string | null;
  savings: number | null; // 分
  sort_order: number;
}

// 充值记录（🔥 #886 修复：改用 payment_orders 表结构，不再用 exchange_records 的兑换码结构）
interface RechargeHistory {
  id: number;
  out_trade_no: string;
  user_id: string;
  price: number;
  credits: number;
  status: string;
  trade_no: string | null;
  package_name: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export default function PersonalPage() {
  const router = useRouter();
  
  // ============================================
  // 【接入 AIGeneratorContext - 统一用户状态】
  // ============================================
  const { credits, userId, isLoggedIn, setIsLoggedIn, refreshUserInfo } = useAIGenerator();
  
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<CachedUserInfo | null>(null);
  
  // 编辑状态
  const [isUpdating, setIsUpdating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 昵称编辑
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [tempNickname, setTempNickname] = useState('');
  
  // 充值相关
  const [keyCode, setKeyCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successCredits, setSuccessCredits] = useState(0);
  const [records, setRecords] = useState<RedeemRecord[]>([]);
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<RechargePackage | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [showPaymentAlert, setShowPaymentAlert] = useState(false);
  const [paymentMaintenance, setPaymentMaintenance] = useState(false);

  // 支付二维码弹窗
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentData, setPaymentData] = useState<{ qrcode: string; money: string; out_trade_no: string }>({ qrcode: '', money: '', out_trade_no: '' });
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const paymentPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isQrExpired, setIsQrExpired] = useState(false);

  // 🔥 #880 核心修复：支付轮询机制
  // 🔥 #881 优化：5分钟超时熔断 + 二维码过期UI
  // 用户扫码付款后，前端必须主动轮询 /api/payment/status 检测支付结果
  // 第三方二维码有效期通常5分钟，超过150次(2s×150=5min)自动熔断停止轮询
  useEffect(() => {
    // 清除上一次的轮询
    if (paymentPollingRef.current) {
      clearInterval(paymentPollingRef.current);
      paymentPollingRef.current = null;
    }

    // 只有弹窗打开 且 有订单号 且 未过期时才启动轮询
    if (!showPaymentModal || !paymentData.out_trade_no || isQrExpired) {
      return;
    }

    const outTradeNo = paymentData.out_trade_no;
    let pollCount = 0;
    const MAX_POLL_COUNT = 150; // 150次 × 2秒 = 5分钟
    console.log('[支付轮询] 启动轮询, 订单号:', outTradeNo, ', 最大轮询次数:', MAX_POLL_COUNT);

    const pollPaymentStatus = async () => {
      pollCount += 1;

      // 🔥 #881 超时熔断：5分钟未支付，自动停止轮询
      // 🔥 #887 定时器彻底销毁：超时时也必须第一时间 clearInterval，防止内存泄漏
      if (pollCount > MAX_POLL_COUNT) {
        console.log('[支付轮询] 超时5分钟未支付，轮询已自动熔断');
        if (paymentPollingRef.current) {
          clearInterval(paymentPollingRef.current);
          paymentPollingRef.current = null;
        }
        setIsQrExpired(true);
        return;
      }

      try {
        console.log('[支付轮询] 正在查询订单:', outTradeNo, `(${pollCount}/${MAX_POLL_COUNT})`);
        // 🔥 #883 防缓存击穿：每次轮询携带时间戳，彻底杜绝浏览器/CF缓存404死锁
        const res = await fetch(`/api/payment/status?out_trade_no=${encodeURIComponent(outTradeNo)}&_t=${Date.now()}`);
        const data = await res.json();

        if (!data.success) {
          console.warn('[支付轮询] 查询失败:', data.error);
          return;
        }

        const orderStatus = data.data?.status;
        console.log('[支付轮询] 订单状态:', orderStatus);

        // 支付成功：按严格顺序执行收尾逻辑
        if (orderStatus === 'paid') {
          console.log('[支付轮询] ✅ 检测到支付成功!');

          // 1. 🔥 #887 定时器彻底销毁：第一时间清除轮询，防止内存泄漏和后续无效请求
          if (paymentPollingRef.current) {
            clearInterval(paymentPollingRef.current);
            paymentPollingRef.current = null;
          }

          // 2. 🔥 #887 竞态修复：延迟 1500ms 再刷新积分，给后端 Webhook 落库留出时间
          // 易支付 Webhook 更新订单状态和增加积分之间可能存在毫秒级微差
          // 如果立即拉取，可能拿到旧积分（积分还没加上）
          setTimeout(async () => {
            // 2a. 清除缓存 + 强制拉取最新用户信息（穿透缓存）
            clearCachedUser();
            const freshUserInfo = await refreshUserInfo(true);

            // 🔥 #888 修复：同步更新本地 user state，确保界面重绘（refreshUserInfo 只更新 AIGeneratorContext 的 credits，不更新本页面的 user）
            if (freshUserInfo) {
              setUser(freshUserInfo);
            }

            // 2b. 触发全局积分变更事件（🔥 #886 修复：必须携带 newCredits，否则 Navbar/AIGeneratorContext 的 creditsChanged 监听器无法本地热更新，导致积分不跳涨）
            window.dispatchEvent(new CustomEvent('creditsChanged', {
              detail: {
                userId: userId,
                newCredits: freshUserInfo?.credits,
              }
            }));

            // 2c. toast 提示
            toast.success('充值成功，积分已到账！');
          }, 1500);

          // 3. 关闭弹窗 + 重置状态（立即执行，不让用户干等）
          setShowPaymentModal(false);
          setPaymentData({ qrcode: '', money: '', out_trade_no: '' });
          setIsQrExpired(false);
        }
      } catch (err) {
        console.error('[支付轮询] 请求异常:', err);
      }
    };

    // 立即查一次，然后每 2 秒轮询
    pollPaymentStatus();
    paymentPollingRef.current = setInterval(pollPaymentStatus, 2000);

    // 组件卸载或弹窗关闭时清除轮询
    return () => {
      if (paymentPollingRef.current) {
        clearInterval(paymentPollingRef.current);
        paymentPollingRef.current = null;
        console.log('[支付轮询] 已清除轮询定时器');
      }
    };
  }, [showPaymentModal, paymentData.out_trade_no, userId, refreshUserInfo, isQrExpired]);

  // 充值记录弹窗
  const [showRechargeDialog, setShowRechargeDialog] = useState(false);
  const [rechargeHistory, setRechargeHistory] = useState<RechargeHistory[]>([]);
  const [rechargeHistoryLoading, setRechargeHistoryLoading] = useState(false);

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

  // 🔥 #888 修复：监听 creditsChanged 事件，同步更新本地 user.credits
  // 场景：画布生图扣费、管理后台调积分、其他标签页积分变化 → 本页面 user state 需同步
  useEffect(() => {
    const handleCreditsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ userId?: string; newCredits?: number }>;
      const { userId: eventUserId, newCredits } = customEvent.detail || {};
      // 只处理当前用户的积分变化
      if (eventUserId && newCredits !== undefined && eventUserId === userId) {
        setUser(prev => prev ? { ...prev, credits: newCredits } : prev);
      }
    };
    window.addEventListener('creditsChanged', handleCreditsChanged as EventListener);
    return () => window.removeEventListener('creditsChanged', handleCreditsChanged as EventListener);
  }, [userId]);

  const handleLoginSuccess = (userData: any) => {
    setIsLoggedIn(true);
    setAuthModalOpen(false);
    refreshUserInfo();
  };

  // 页面加载时获取充值套餐、兑换记录、支付维护状态
  // 【用户信息已由 AIGeneratorContext 统一管理，无需重复获取】
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // 并行执行所有请求
        const [userInfo, packagesData, maintenanceData] = await Promise.all([
          // 【使用 Context 的 refreshUserInfo 获取用户信息】
          refreshUserInfo().then(user => {
            if (user) setUser(user);
            return user;
          }),
          fetch('/api/packages')
            .then(res => res.json())
            .then(data => {
              if (data.success) return data.data || [];
              return [];
            })
            .catch(() => []),
          // 获取支付维护状态
          fetch('/api/payment/maintenance')
            .then(res => res.json())
            .then(data => {
              if (data.success) return data.maintenance;
              return false;
            })
            .catch(() => false)
        ]);

        setPackages(packagesData || []);
        setPaymentMaintenance(maintenanceData);
      } catch (err) {
        console.error('加载数据失败:', err);
      } finally {
        setPackagesLoading(false);
      }
    };

    loadAllData();
  }, [refreshUserInfo]);

  // 格式化积分数
  const formatCredits = (credits: number) => {
    if (credits >= 10000) {
      return (credits / 10000).toFixed(1) + '万';
    }
    return credits.toLocaleString();
  };

  // 格式化价格（分转元）
  const formatPrice = (price: number) => {
    return (price / 100).toFixed(2);
  };

  // 处理在线支付
  const handlePayment = async () => {
    if (!selectedPackage) return;
    
    setLoading(true);
    setIsPaymentLoading(true);
    setIsQrExpired(false); // 🔥 #881 每次新支付重置过期状态
    try {
      const res = await fetch('/api/payment/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: formatPrice(selectedPackage.price),
          userId: userId,
        }),
      });

      const data = await res.json();

      if (data.success && data.data) {
        // 跳转到支付页面或显示二维码
        if (data.data.payurl) {
          window.open(data.data.payurl, '_blank');
        } else if (data.data.qrcode) {
          // 显示支付二维码弹窗
          // 🔥 #880 修复：必须保存 out_trade_no，轮询需要它！
          setPaymentData({
            qrcode: data.data.qrcode,
            money: data.data.money || formatPrice(selectedPackage.price),
            out_trade_no: data.data.out_trade_no || '',
          });
          setShowPaymentModal(true);
        }
      } else {
        setError(data.error || '支付请求失败');
      }
    } catch (err) {
      console.error('支付请求失败:', err);
      setError('支付请求失败，请稍后重试');
    } finally {
      setLoading(false);
      setIsPaymentLoading(false);
    }
  };

  // 处理兑换码充值
  const handleRedeem = async () => {
    if (!redeemCode.trim()) return;
    
    setIsRedeeming(true);
    setError('');
    setSuccess(false);

    try {
      const res = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_code: redeemCode.trim() }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        setSuccessCredits(data.credits);
        setRedeemCode('');
        // 🔒 军规：充值/兑换必须穿透缓存，先清除再刷新
        clearCachedUser();  // 清除旧缓存，重置刷新标记
        const freshUser = await refreshUserInfo();  // 真正调用 API 获取最新积分
        // 🔥 #888 修复：同步更新本地 user state，确保界面重绘
        if (freshUser) setUser(freshUser);
        // #270 触发全局事件，携带 userId 实现本地热更新
        if (data.credits !== undefined) {
          window.dispatchEvent(new CustomEvent('creditsChanged', {
            detail: {
              userId: userId,
              newCredits: data.credits,
            }
          }));
        }
      } else {
        setError(data.error || '兑换码无效');
      }
    } catch (err) {
      setError('兑换失败，请稍后重试');
    } finally {
      setIsRedeeming(false);
    }
  };

  // 打开文件选择器
  const openFileSelector = () => {
    fileInputRef.current?.click();
  };

  // 处理头像上传
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型和大小
    if (!file.type.startsWith('image/')) {
      setError('请上传图片文件');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('图片大小不能超过 5MB');
      return;
    }

    setIsUpdating(true);
    setError('');

    try {
      // 服务端中转上传 COS
      const formData = new FormData();
      formData.append('file', file);
      const uploadResponse = await fetch('/api/canvas/upload', { method: 'POST', body: formData });
      const uploadData = await safeJsonResponse<{ key?: string; url?: string }>(uploadResponse);

      if (uploadData.success) {
        const signedUrl = `/api/canvas/image?key=${encodeURIComponent(uploadData.key ?? '')}`;
        // 更新用户头像
        // 🔧 #758 修复：添加 credentials: 'include' 确保 cookie 被发送
        const updateRes = await fetch('/api/user/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: signedUrl }),
          credentials: 'include',
        });

        const updateData = await updateRes.json();

        if (updateData.success) {
          // 添加时间戳防止浏览器缓存
          const timestamp = Date.now();
          const newAvatarUrl = `${signedUrl}${signedUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
          const updatedUser = { ...user!, avatar: newAvatarUrl };
          setUser(updatedUser);
          setCachedUser(updatedUser);
        } else {
          setError(updateData.error || '更新头像失败');
        }
      } else {
        setError(uploadData.error || '上传头像失败');
      }
    } catch (err) {
      setError('上传失败，请稍后重试');
    } finally {
      setIsUpdating(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 保存昵称
  const handleSaveNickname = async () => {
    const nickname = tempNickname.trim();
    if (!nickname) {
      setIsEditingNickname(false);
      return;
    }

    setIsUpdating(true);
    try {
      // 🔧 #758 修复：添加 credentials: 'include' 确保 cookie 被发送
      const response = await fetch('/api/user/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname }),
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        const updatedUser = { ...user!, nickname };
        setUser(updatedUser);
        setCachedUser(updatedUser);
        setIsEditingNickname(false);
      } else {
        toast.error(data.error || '修改昵称失败');
      }
    } catch (err) {
      console.error('修改昵称失败:', err);
      toast.error('修改昵称失败');
    } finally {
      setIsUpdating(false);
    }
  };

  // 退出登录
  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
      setCachedUser(null);
      setUser(null);
      setIsLoggedIn(false);
    } catch (err) {
      console.error('退出登录失败:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#1E1F2F]">
      {/* 左侧导航 */}
      <LeftNav />
      
      {/* 主内容区 */}
      <main className="container mx-auto px-4 pl-20 pb-8 pt-8">
        {/* 页面标题 */}
        <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-6">个人中心</h1>
        
        <div className="space-y-6">
          {/* 用户信息 + 客服卡片 并排布局 */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* 用户信息区域 - 左侧 */}
            <div className="w-full lg:w-1/2">
              <div className="bg-white dark:bg-[#2A2C3F] rounded-xl border border-gray-200 dark:border-transparent h-auto">
                <div className="p-6 space-y-4">
                  {/* 第一行：头像 + 昵称 + 联系方式 */}
                  <div className="flex items-start gap-4">
                    {/* 头像 */}
                    <div className="flex flex-col items-center gap-2 shrink-0 relative">
                      <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-[#3A3C4F] flex items-center justify-center overflow-hidden border-2 border-white dark:border-[#2A2C3F] shadow-lg">
                        {user?.avatar ? (
                          <img src={user.avatar} alt="头像" className="w-full h-full object-cover" referrerPolicy="no-referrer-when-downgrade" />
                        ) : (
                          <span className="text-2xl font-bold text-gray-400 dark:text-[#B0B3C1]">
                            {user?.nickname?.charAt(0) || '?'}
                          </span>
                        )}
                      </div>
                      {/* 隐藏的文件输入框 */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleAvatarUpload}
                      />
                      {isLoggedIn && (
                        <Button
                          onClick={openFileSelector}
                          className="h-6 text-xs bg-gray-800 hover:bg-gray-700 text-white"
                        >
                          编辑
                        </Button>
                      )}
                      {isUpdating && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-[#2A2C3F]/50 rounded-full flex items-center justify-center">
                          <Loader2 className="w-5 h-5 animate-spin text-[rgb(139,158,232)]" />
                        </div>
                      )}
                    </div>

                    {/* 昵称 + 联系方式 */}
                    <div className="flex-1 min-w-0">
                      {isEditingNickname ? (
                        <div className="flex items-center gap-2">
                          <Input
                            value={tempNickname}
                            onChange={(e) => setTempNickname(e.target.value)}
                            className="h-8 text-lg font-semibold bg-white dark:bg-gray-700"
                            placeholder="输入昵称"
                            maxLength={20}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={handleSaveNickname}
                            className="h-8 bg-gray-800 hover:bg-gray-700 text-white"
                            disabled={isUpdating}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setIsEditingNickname(false);
                              setTempNickname('');
                            }}
                            className="h-8"
                          >
                            <XIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-800 dark:text-white">
                            {isLoggedIn ? (user?.nickname || '用户') : '未登录'}
                          </h3>
                          {isLoggedIn ? (
                            <button
                              onClick={() => {
                                setTempNickname(user?.nickname || '');
                                setIsEditingNickname(true);
                              }}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          ) : (
                            <Button
                              onClick={() => {
                                setAuthMode('login');
                                setAuthModalOpen(true);
                              }}
                              className="h-7 px-4 text-sm bg-gray-800 hover:bg-gray-700 text-white"
                            >
                              登录
                            </Button>
                          )}
                        </div>
                      )}
                      <div className="w-full h-px bg-gray-200 dark:bg-gray-700 my-2"></div>
                      {isLoggedIn && (
                        <div className="space-y-1.5">
                          {user?.phone && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-[#B0B3C1]">
                              <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>{user.phone.slice(0, 3)}****{user.phone.slice(-4)}</span>
                            </div>
                          )}
                          {user?.email && (
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-[#B0B3C1]">
                              <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span className="truncate">{user.email}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 第二行：积分余额卡片（占满宽度） */}
                  {isLoggedIn && (
                    <div className="flex items-center justify-center bg-gray-100 dark:bg-gray-800/50 rounded-xl py-4 px-4">
                      <Coins className="w-5 h-5 text-gray-500 dark:text-gray-400 mr-2" />
                      <span className="text-sm text-gray-600 dark:text-gray-400 mr-3">积分余额</span>
                      <span className="text-2xl font-bold text-gray-800 dark:text-white mr-4">
                        {formatCredits(credits)}
                      </span>
                      <Clock className="w-4 h-4 text-gray-400 mr-2" />
                      <span className="text-sm text-gray-500 dark:text-gray-400 mr-4">积分永不过期，随时可用</span>
                      <Button
                        onClick={async () => {
                          setShowRechargeDialog(true);
                          // 🔥 #886 修复：改用 /api/payment/history 查询 payment_orders 表（原来是 /api/redeem 查 exchange_records 表，查错表了）
                          setRechargeHistoryLoading(true);
                          try {
                            const res = await fetch('/api/payment/history?_t=' + Date.now(), {
                              cache: 'no-store',
                            });
                            const data = await res.json();
                            if (data.success && data.data) {
                              setRechargeHistory(data.data);
                            }
                          } catch (error) {
                            console.error('获取充值记录失败:', error);
                          } finally {
                            setRechargeHistoryLoading(false);
                          }
                        }}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        <History className="w-3 h-3 mr-1" />
                        在线充值记录
                      </Button>
                    </div>
                  )}

                  {/* 第三行：生成记录 + 退出登录按钮 */}
                  {isLoggedIn && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => router.push('/history')}
                        className="flex-1 h-10 text-sm bg-gray-800 hover:bg-gray-700 text-white dark:bg-gray-600 dark:hover:bg-gray-500"
                      >
                        <History className="w-4 h-4 mr-2" />
                        生成记录
                      </Button>
                      <Button
                        onClick={handleLogout}
                        className="h-10 px-6 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200"
                      >
                        退出登录
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 客服卡片 - 右侧 */}
            <div className="w-full lg:w-1/2">
              <div className="bg-white dark:bg-[#2A2C3F] rounded-xl p-6 border border-gray-200 dark:border-[#3A3C4F] h-[18rem]">
                <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10 h-full">
                  <div className="flex-1 text-center md:text-left">
                    <h2 className="text-2xl md:text-3xl font-semibold text-gray-900 dark:text-white mb-2">
                      在线客服
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 tracking-wide mb-6">
                      Live Support
                    </p>
                    
                    <div className="space-y-2">
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        support@kiikii.ai
                      </p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        备注 KIICK 优先通过
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex-shrink-0">
                    <div className="bg-white rounded-lg p-1 border border-gray-100 dark:border-zinc-600">
                      <div className="w-[180px] h-[180px]">
                        <Image 
                          src='/wechat-qrcode.png' 
                          alt="客服微信" 
                          width={180}
                          height={180}
                          className="w-full h-full object-contain"
                          loading="lazy"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 充值套餐 + 兑换码 并排布局 (1.8:1.2比例) */}
          <div className="flex flex-col lg:flex-row gap-6">
            {/* 充值套餐 - 左侧 1.8 */}
            <div className="w-[60%]">
              <div className="bg-gray-100 dark:bg-[#1E1F2F] rounded-xl p-6 border border-gray-200 dark:border-transparent h-full">
                <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-6">选择充值套餐</h2>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {packagesLoading ? (
                    [...Array(6)].map((_, i) => (
                      <div key={i} className="bg-white dark:bg-[#2A2C3F] rounded-xl p-4 animate-pulse">
                        <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded mb-2"></div>
                        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3 mb-1"></div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
                      </div>
                    ))
                  ) : packages.length > 0 ? (
                    packages.map((pkg) => (
                      <div 
                        key={pkg.id}
                        onClick={() => isLoggedIn ? setSelectedPackage(pkg) : (setAuthMode('login'), setAuthModalOpen(true))}
                        className={`bg-white dark:bg-[#2A2C3F] rounded-xl p-4 cursor-pointer hover:shadow-md transition-all relative border ${
                          selectedPackage?.id === pkg.id 
                            ? 'border-[#7B68EE] shadow-lg ring-2 ring-[#7B68EE]/20' 
                            : 'border-gray-200 dark:border-[#3A3C4F] hover:border-[#7B68EE]/50'
                        }`}
                      >
                        {pkg.tag && (
                          <span className="absolute -top-2 -right-2 px-2 py-0.5 rounded text-xs font-medium bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-sm">
                            {pkg.tag}
                          </span>
                        )}
                        <div className="mb-1.5">
                          <span className="text-xl font-bold text-gray-800 dark:text-white">¥{formatPrice(pkg.price)}</span>
                        </div>
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-base font-semibold text-gray-700 dark:text-white">{pkg.credits.toLocaleString()}</span>
                          <span className="text-xs text-gray-600 dark:text-[#B0B3C1]">积分</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-gray-600 dark:text-gray-400">¥{((pkg.price / 100) / pkg.credits).toFixed(5)}/积分</span>
                          {pkg.savings && (
                            <span className="text-[10px] text-green-500">省¥{formatPrice(pkg.savings)}</span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-3 py-8 text-center">
                      <p className="text-gray-600 dark:text-[#B0B3C1]">暂无可用套餐</p>
                    </div>
                  )}
                </div>
                {isLoggedIn ? (
                  <button 
                    disabled={!selectedPackage || isPaymentLoading}
                    onClick={() => {
                      if (paymentMaintenance) {
                        setShowPaymentAlert(true);
                      } else {
                        handlePayment();
                      }
                    }}
                    className={`w-full h-12 text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2 ${
                      isPaymentLoading 
                        ? 'bg-[#7B68EE]/70 cursor-wait' 
                        : selectedPackage 
                          ? 'bg-gradient-to-r from-[#7B68EE] to-[#9C6CFE] hover:from-[#6B58DE] hover:to-[#8C5CEE]' 
                          : 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed'
                    }`}
                  >
                    {isPaymentLoading ? (
                      <>
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        正在生成安全支付码...
                      </>
                    ) : selectedPackage ? `支付 ¥${formatPrice(selectedPackage.price)}` : '请选择套餐'}
                  </button>
                ) : (
                  <button 
                    onClick={() => setAuthModalOpen(true)}
                    className="w-full h-12 text-white font-medium rounded-xl transition-all bg-gradient-to-r from-[#7B68EE] to-[#9C6CFE] hover:from-[#6B58DE] hover:to-[#8C5CEE]"
                  >
                    登录后充值
                  </button>
                )}
              </div>
            </div>

            {/* 兑换码 - 右侧 1.2 */}
            <div className="w-[40%]">
              <div className="bg-white dark:bg-[#2A2C3F] rounded-xl p-6 border border-gray-200 dark:border-transparent h-full flex flex-col">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-300 to-pink-300 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-800 dark:text-white">兑换码充值</p>
                    <p className="text-xs text-gray-600 dark:text-[#B0B3C1]">输入兑换码获取积分</p>
                  </div>
                </div>
                
                {/* 兑换码输入 */}
                <div className="flex-1 flex flex-col mt-8">
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="输入兑换码"
                      value={redeemCode}
                      onChange={(e) => {
                        setRedeemCode(e.target.value.toUpperCase());
                        setError('');
                      }}
                      disabled={!isLoggedIn}
                      className={`w-full bg-gray-50 border pl-10 ${
                        error ? 'border-red-500 focus:border-red-500' : 'border-gray-200 focus:border-gray-300'
                      }`}
                    />
                    <Ticket className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  </div>
                  {/* 错误提示 */}
                  {error && (
                    <p className="text-red-500 text-xs mt-2 text-center">{error}</p>
                  )}
                  <p className="text-[10px] text-gray-600 dark:text-gray-400 mt-2 text-center">兑换码格式：XXXX-XXXX-XXXX-XXXX</p>
                  <Button
                    onClick={() => isLoggedIn ? handleRedeem() : (setAuthMode('login'), setAuthModalOpen(true))}
                    disabled={isLoggedIn && (!redeemCode || isRedeeming)}
                    className="w-full !bg-gradient-to-r from-blue-300 to-pink-300 hover:opacity-90 disabled:opacity-70 text-white font-medium mt-3"
                  >
                    {isLoggedIn ? (isRedeeming ? '兑换中...' : '立即兑换') : '立即兑换'}
                  </Button>
                  <p className="text-[10px] text-gray-600 dark:text-gray-400 mt-4 text-center">兑换码由管理员发放，如有问题请联系客服</p>
                </div>

                {/* 扫码获取兑换码提示 */}
                <div className="mt-4 flex items-center justify-between bg-gray-100 dark:bg-gray-800/50 rounded-xl px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">在线自助购买兑换码入口</span>
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </div>
                  <Image
                    src='/redeem-qrcode.png'
                    alt="购买入口"
                    width={128}
                    height={128}
                    className="rounded-lg"
                    loading="lazy"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 登录/注册模态框 */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authMode}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* 支付提示弹窗 */}
      {showPaymentAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#2A2C3F] rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                <span className="text-3xl">⚠️</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-2">
                在线支付通道维护
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                如需充值，请联系客服或使用兑换码充值
              </p>
              <button
                onClick={() => setShowPaymentAlert(false)}
                className="w-full h-12 bg-gradient-to-r from-[#7B68EE] to-[#9C6CFE] text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 支付二维码弹窗 */}
      {showPaymentModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => {
            setShowPaymentModal(false);
            setPaymentData({ qrcode: '', money: '', out_trade_no: '' });
            setIsQrExpired(false);
          }}
        >
          <div
            className="bg-white dark:bg-[#2A2C3F] rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 关闭按钮 */}
            <button
              onClick={() => {
                setShowPaymentModal(false);
                setPaymentData({ qrcode: '', money: '', out_trade_no: '' });
                setIsQrExpired(false);
              }}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            >
              <XIcon className="w-5 h-5" />
            </button>

            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-1">
                微信扫码支付
              </h3>
              <p className="text-2xl font-bold text-[#7B68EE] dark:text-[#9C6CFE] mb-4">
                ¥{paymentData.money}
              </p>

              {/* 二维码 */}
              <div className="flex justify-center mb-4">
                <div className="bg-white p-4 rounded-xl shadow-sm relative">
                  <div className={isQrExpired ? 'opacity-30 grayscale' : ''}>
                    <QRCodeSVG
                      value={paymentData.qrcode}
                      size={200}
                      level="H"
                      includeMargin={false}
                    />
                  </div>
                  {/* 🔥 #881 二维码过期覆盖层 */}
                  {isQrExpired && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                      <div className="bg-black/70 rounded-xl px-5 py-4 text-center">
                        <p className="text-white font-bold text-sm">二维码已过期</p>
                        <p className="text-gray-300 text-xs mt-1">请关闭重试</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                {isQrExpired ? '二维码已过期，请关闭后重新发起支付' : '请使用微信扫码完成支付'}
              </p>

              <button
                onClick={() => {
                  setShowPaymentModal(false);
                  setPaymentData({ qrcode: '', money: '', out_trade_no: '' });
                  setIsQrExpired(false);
                }}
                className="w-full h-11 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 兑换成功弹窗 */}
      {success && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-[#2A2C3F] rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-green-500" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              兑换成功！
            </h3>
            <p className="text-3xl font-bold text-green-500 mb-2">
              +{(successCredits || 0).toLocaleString()}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              积分已到账
            </p>
            <button
              onClick={() => setSuccess(false)}
              className="w-full h-12 bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] text-white font-medium rounded-xl hover:opacity-90 transition-opacity"
            >
              确定
            </button>
          </div>
        </div>
      )}

      {/* 在线充值记录弹窗（🔥 #887 文案修正：明确区分"在线充值记录"与"兑换码记录"） */}
      <Dialog open={showRechargeDialog} onOpenChange={setShowRechargeDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              在线充值记录
            </DialogTitle>
          </DialogHeader>
          {rechargeHistoryLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : rechargeHistory.length > 0 ? (
            <div className="space-y-3">
              {rechargeHistory.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700"
                >
                  <div className="flex items-center gap-3">
                    {/* 🔥 #887 状态图标：paid 绿色 / unpaid 灰色 */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${record.status === 'paid' ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700/50'}`}>
                      <Coins className={`w-5 h-5 ${record.status === 'paid' ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`font-medium ${record.status === 'paid' ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                          {record.package_name || `${record.credits} 积分套餐`}
                        </p>
                        {/* 🔥 #887 状态标签：paid=绿色已完成 / unpaid=灰色未支付 */}
                        {record.status === 'paid' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                            已完成
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-700/50 dark:text-gray-400">
                            未支付
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(record.created_at).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    {/* 🔥 #887 paid 显示积分增量，unpaid 灰色 */}
                    {record.status === 'paid' ? (
                      <p className="font-bold text-green-600">+{record.credits} 积分</p>
                    ) : (
                      <p className="font-medium text-gray-400">{record.credits} 积分</p>
                    )}
                    <p className="text-xs text-gray-400">
                      ¥{(record.price / 100).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>暂无充值记录</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
