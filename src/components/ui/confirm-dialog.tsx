'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AlertTriangle, Info, AlertCircle, CheckCircle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  variant?: 'danger' | 'warning' | 'info' | 'success';
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  onConfirm,
  variant = 'info',
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const getConfirmButtonClass = () => {
    // 统一使用蓝色，不管是什么类型
    return 'bg-blue-500 text-white hover:bg-blue-600';
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[400px] p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border-0">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex gap-3 mt-6">
          <AlertDialogCancel asChild>
            <button className="flex-1 px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors">
              {cancelText}
            </button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <button
              onClick={handleConfirm}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${getConfirmButtonClass()}`}
            >
              {confirmText}
            </button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
