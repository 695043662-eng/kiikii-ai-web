'use client';

/**
 * 🛡️ #900 全局错误边界（Error Boundary）
 *
 * 背景：React 16+ 任何一个未捕获的渲染异常都会卸载整棵组件树（白屏死），
 * 用户的画布心血瞬间"消失"。本组件作为最后一道防线：
 *
 * 1. 优雅 UI：崩溃时显示品牌化错误卡片（非白屏），提供"刷新恢复"一键出口
 * 2. 崩溃快照：componentDidCatch 同步写入 localStorage 崩溃上下文（kiikii_crash_log），
 *    刷新后可由开发/客服定位崩溃原因
 * 3. 数据抢救分工：画布数据本身的持久化由既有三链保障——
 *    useAutoSave 防抖落盘（≤5s 窗口）+ pagehide sendBeacon/fetch keepalive 强推云端（#887）
 *    + CanvasImageDB IndexedDB 图片库。崩溃刷新后 loadWorkspace 自动恢复最近草稿。
 *
 * 使用方式：
 *   <ErrorBoundary level="root">{children}</ErrorBoundary>   — layout.tsx 全站兜底
 *   <ErrorBoundary level="canvas">...</ErrorBoundary>        — 画布页局部兜底
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check } from 'lucide-react';

export const CRASH_LOG_KEY = 'kiikii_crash_log';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 边界层级：root=全站兜底 / canvas=画布页局部 */
  level?: 'root' | 'canvas';
  /** 自定义标题（可选） */
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
  componentStack: string;
  copied: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      componentStack: '',
      copied: false,
    };
  }

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error ?? 'Unknown render error'),
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    const level = this.props.level || 'root';
    // 🛡️ #900 崩溃快照抢救：同步写入 localStorage（含时间戳/层级/消息/组件栈，截断防爆）
    try {
      localStorage.setItem(
        CRASH_LOG_KEY,
        JSON.stringify({
          ts: Date.now(),
          level,
          message: String(error instanceof Error ? error.message : error ?? '').slice(0, 500),
          stack: String(errorInfo?.componentStack || '').slice(0, 1500),
        })
      );
    } catch {
      // localStorage 不可用时静默（不能用 useState，此处是 class 方法）
    }
    // 日志先行（架构军规 5）
    console.error(`[ErrorBoundary:${level}] 捕获渲染异常`, error, errorInfo?.componentStack);
  }

  private handleReload = (): void => {
    // 刷新后 useAutoSave.loadWorkspace 会自动恢复 localStorage/云端最近草稿
    window.location.reload();
  };

  private handleCopyError = (): void => {
    const text = `[Kiikii Crash ${new Date().toISOString()}] ${this.state.errorMessage}\n${this.state.componentStack}`;
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => this.setState({ copied: true }))
          .catch(() => {});
      }
    } catch {
      // 剪贴板不可用静默
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const level = this.props.level || 'root';
    const title = this.props.fallbackTitle || (level === 'canvas' ? '画布出现了一点问题' : '页面出现了一点问题');

    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center bg-background p-6">
        <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            您的画布内容已自动保存，
            <br />
            点击下方按钮即可恢复到最近的工作状态。
          </p>
          {this.state.errorMessage ? (
            <p className="mt-3 max-h-20 overflow-y-auto rounded bg-muted/50 px-3 py-2 text-left font-mono text-xs text-muted-foreground">
              {this.state.errorMessage.slice(0, 200)}
            </p>
          ) : null}
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              onClick={this.handleReload}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" />
              刷新恢复
            </button>
            <button
              onClick={this.handleCopyError}
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
              title="复制错误详情用于反馈"
            >
              {this.state.copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {this.state.copied ? '已复制' : '复制详情'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
