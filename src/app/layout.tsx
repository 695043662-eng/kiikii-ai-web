import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';
import { AIGeneratorProvider } from '@/contexts/AIGeneratorContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const inter = Inter({ subsets: ['latin'] });

// 🛡️ #856 打破 Next.js 生产环境死缓存：每次请求都重新渲染，确保首页数据实时
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kiikii AI - AI Image Generator',
  description: 'Kiikii AI image generation platform',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <AIGeneratorProvider>
            {/* 🛡️ #900 全站错误边界：任何渲染异常不再白屏，品牌化错误卡片 + 崩溃快照 + 一键恢复 */}
            <ErrorBoundary level="root">{children}</ErrorBoundary>
          </AIGeneratorProvider>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
