import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/ui/sonner';
import { AIGeneratorProvider } from '@/contexts/AIGeneratorContext';

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
            {children}
          </AIGeneratorProvider>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
