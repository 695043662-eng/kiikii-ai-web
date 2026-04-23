'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { Button } from '@/components/ui/button';
import { Sparkles, Video, Image as ImageIcon, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Galaxy from '@/components/ui/Galaxy';
import AuthModal from '@/components/AuthModal';
import { useAIGenerator } from '@/contexts/AIGeneratorContext';

export default function HomePage() {
  const router = useRouter();
  
  // ============================================
  // 【接入 AIGeneratorContext - 统一用户状态】
  // ============================================
  const { isLoggedIn: ctxIsLoggedIn, setIsLoggedIn, refreshUserInfo } = useAIGenerator();
  const isLoggedIn = ctxIsLoggedIn;
  
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

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
    // 【isLoggedIn 已由 AIGeneratorContext 统一管理】
    setAuthModalOpen(false);
    refreshUserInfo();
  };

  return (
    <div className="min-h-screen bg-[#0a0a12]">
      {/* Galaxy 星空背景 - 覆盖整个页面 */}
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

      {/* 导航栏 - 透明背景 */}
      <div className="fixed top-0 left-0 right-0 z-50">
        <Navbar isLoggedIn={isLoggedIn} setIsLoggedIn={setIsLoggedIn} transparent />
      </div>

      {/* Hero Section - 添加 pointer-events-auto 确保可点击 */}
      <section className="relative z-10 pt-[60px] overflow-hidden min-h-screen flex items-center pointer-events-auto">

        {/* Hero Content */}
        <div className="relative z-10 container mx-auto px-4 py-20">
          <div className="max-w-2xl mx-auto text-center">
            <h1 
              className="text-4xl md:text-6xl font-bold text-white mb-6"
            >
              <span className="bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] bg-clip-text text-transparent">
                Kiikii AI
              </span>
            </h1>
            <p 
              className="text-xl md:text-2xl text-white/80 mb-4"
            >
              AI 驱动的创意视觉生成平台
            </p>
            <p 
              className="text-white/60 mb-8 max-w-xl mx-auto"
            >
              使用先进的 AI 技术，将您的创意转化为惊艳的图像和视频。
              支持多种模型、风格迁移、角色一致性等强大功能。
            </p>
            <div 
              className="flex flex-col sm:flex-row gap-4 justify-center"
            >
              <div>
                <Button className="h-12 px-8 text-lg bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white" onClick={() => router.push('/canvas')}>
                  <Sparkles className="w-5 h-5 mr-2" />
                  开始创作
                </Button>
              </div>
              <div>
                <Button variant="outline" className="h-12 px-8 text-lg bg-white/10 border-white/30 text-white hover:bg-white/20" onClick={() => router.push('/models')}>
                  探索模型
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="relative z-10 py-20 pointer-events-auto">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center text-white mb-12">
            强大功能
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            <div 
              className="text-center p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 transition-colors"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[rgb(139,158,232)] to-[rgb(232,180,184)] flex items-center justify-center">
                <ImageIcon className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">AI 图像生成</h3>
              <p className="text-white/60">
                支持多种模型，从快速预览到 4K 高清，满足不同场景需求
              </p>
            </div>
            <div 
              className="text-center p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 transition-colors"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[rgb(139,158,232)] to-[rgb(232,180,184)] flex items-center justify-center">
                <Video className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">AI 视频生成</h3>
              <p className="text-white/60">
                Sora2 引擎，创作高质量视频内容
              </p>
            </div>
            <div 
              className="text-center p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-white/20 transition-colors"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[rgb(139,158,232)] to-[rgb(232,180,184)] flex items-center justify-center">
                <Zap className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">角色一致性</h3>
              <p className="text-white/60">
                创建角色保持视频一致性，让 AI 记住您的角色形象
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-20 pointer-events-auto">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center bg-white/5 backdrop-blur-sm rounded-3xl p-12 border border-white/10">
            <h2 className="text-3xl font-bold text-white mb-4">
              准备好开始创作了吗？
            </h2>
            <p className="text-white/60 mb-8">
              立即体验 AI 图像和视频生成的魔力
            </p>
            <div>
              <Button className="h-12 px-8 text-lg bg-gradient-to-r from-[rgb(139,158,232)] to-[rgb(232,180,184)] hover:from-[rgb(120,140,220)] to-[rgb(212,160,170)] text-white brightness-110 saturate-[1.1]">
                免费开始
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-8 border-t border-white/10 pointer-events-auto">
        <div className="container mx-auto px-4">
          {/* 免责声明 */}
          <div className="max-w-4xl mx-auto text-center text-white/40 text-xs mb-6 p-4 bg-white/5 rounded-xl border border-white/10">
            <p className="mb-2">本平台 AI 生成内容仅用于技术研发及学术测试使用，严禁用于侵权、色情、暴力、政治敏感及违反公序良俗场景。</p>
            <p>用户对生成内容独立承担全部法律责任，平台仅提供技术服务。</p>
          </div>
          
          {/* 版权声明 */}
          <div className="text-center text-white/50 text-sm">
            <p>© 2026 Kiikii AI. All rights reserved.</p>
          </div>
        </div>
      </footer>

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
