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
import { useAIGenerator } from '@/contexts/AIGeneratorContext';

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

// 充值记录
interface RechargeHistory {
  id: number;
  user_id: string;
  key_code: string;
  credits: number;
  status: string;
  created_at: string;
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

  const handleLoginSuccess = (userData: any) => {
    setIsLoggedIn(true);
    setAuthModalOpen(false);
    refreshUserInfo();
  };

  // 页面加载时获取充值套餐、兑换记录
  // 【用户信息已由 AIGeneratorContext 统一管理，无需重复获取】
  useEffect(() => {
    const loadAllData = async () => {
      try {
        // 并行执行所有请求
        const [userInfo, packagesData] = await Promise.all([
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
            .catch(() => [])
        ]);

        setPackages(packagesData || []);
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
        await refreshUserInfo();  // 真正调用 API 获取最新积分
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
      // 上传到 S3
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadRes = await fetch('/api/canvas/upload', {
        method: 'POST',
        body: formData,
      });

      const uploadData = await uploadRes.json();

      if (uploadData.success) {
        // 更新用户头像
        const updateRes = await fetch('/api/user/update', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ avatar: uploadData.url }),
        });

        const updateData = await updateRes.json();

        if (updateData.success) {
          // 添加时间戳防止浏览器缓存
          const timestamp = Date.now();
          const newAvatarUrl = `${uploadData.url}${uploadData.url.includes('?') ? '&' : '?'}t=${timestamp}`;
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
      const response = await fetch('/api/user/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname }),
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
                          <img src={user.avatar} alt="头像" className="w-full h-full object-cover" />
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
                        {formatCredits(user?.credits || 0)}
                      </span>
                      <Clock className="w-4 h-4 text-gray-400 mr-2" />
                      <span className="text-sm text-gray-500 dark:text-gray-400 mr-4">积分永不过期，随时可用</span>
                      <Button
                        onClick={async () => {
                          setShowRechargeDialog(true);
                          // 获取充值记录
                          setRechargeHistoryLoading(true);
                          try {
                            const res = await fetch('/api/redeem');
                            const data = await res.json();
                            if (data.success && data.data) {
                              // 直接使用exchange_records表的数据
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
                        充值记录
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
                        <img 
                          src='/wechat-qrcode.png' 
                          alt="客服微信" 
                          className="w-full h-full object-contain"
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
                    disabled={!selectedPackage}
                    onClick={() => setShowPaymentAlert(true)}
                    className={`w-full h-12 text-white font-medium rounded-xl transition-all ${
                      selectedPackage 
                        ? 'bg-gradient-to-r from-[#7B68EE] to-[#9C6CFE] hover:from-[#6B58DE] hover:to-[#8C5CEE]' 
                        : 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed'
                    }`}
                  >
                    {selectedPackage ? `支付 ¥${formatPrice(selectedPackage.price)}` : '请选择套餐'}
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
                    src="https://code.coze.cn/api/sandbox/coze_coding/file/proxy?expire_time=-1&file_path=assets%2F%E5%BE%AE%E4%BF%A1%E5%9B%BE%E7%89%87_20260413203908_185_3.jpg&nonce=f7646c57-9b1b-450d-866c-94127e903a57&project_id=7626250579525861403&sign=e2f939fcb6e5647f3a930a01dc7ba0d566726f4890c98c079109d7ebfaf7af2f"
                    alt="购买入口"
                    width={128}
                    height={128}
                    className="rounded-lg"
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

      {/* 充值记录弹窗 */}
      <Dialog open={showRechargeDialog} onOpenChange={setShowRechargeDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              充值记录
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
                    <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                      <Coins className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white">{record.key_code || '充值'}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {new Date(record.created_at).toLocaleString('zh-CN')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">+{record.credits} 积分</p>
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
