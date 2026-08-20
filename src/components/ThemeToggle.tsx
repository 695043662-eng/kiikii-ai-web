'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center gap-1">
        <div className="h-8 px-2 rounded-lg" />
        <Button variant="ghost" size="sm" className="w-9 h-9 p-0">
          <div className="w-4 h-4" />
        </Button>
      </div>
    );
  }

  const isDark = theme === 'dark';

  return (
    <div className="flex items-center gap-0">
      {/* 状态标签 */}
      <div className="flex items-center gap-1 h-8 px-2 text-sm font-medium text-gray-600 dark:text-gray-300">
        <span>{isDark ? '夜间' : '白天'}</span>
        <ChevronRight className="w-4 h-4" />
      </div>
      
      {/* 切换按钮 */}
      <Button
        variant="ghost"
        size="sm"
        className="w-9 h-9 p-0 hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
      >
        {isDark ? (
          <Sun className="w-4 h-4 text-[rgb(232,180,184)]" />
        ) : (
          <Moon className="w-4 h-4 text-gray-600" />
        )}
      </Button>
    </div>
  );
}
