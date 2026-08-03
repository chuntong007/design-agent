import React from 'react'
import { Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

// 加载骨架屏
export const Loading: React.FC<{ text?: string; className?: string }> = ({ text = '加载中', className }) => (
  <div className={clsx('flex items-center justify-center gap-2 text-slate-400 text-sm py-8', className)}>
    <Loader2 size={16} className="animate-spin" />
    {text}...
  </div>
)

// 全屏加载
export const FullLoading: React.FC<{ text?: string }> = ({ text = '加载中' }) => (
  <div className="flex flex-col items-center justify-center py-16 text-slate-400">
    <Loader2 size={32} className="animate-spin mb-3 text-brand-500" />
    <p className="text-sm">{text}...</p>
  </div>
)

// 错误提示
export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center text-rose-500 mb-3 text-xl">
      !
    </div>
    <p className="text-sm text-slate-600 mb-3">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="px-4 py-1.5 rounded-lg bg-brand-50 text-brand-600 text-sm font-medium hover:bg-brand-100 transition-colors"
      >
        重试
      </button>
    )}
  </div>
)

// 空状态
export const EmptyState: React.FC<{ text: string; sub?: string; icon?: React.ReactNode }> = ({
  text,
  sub,
  icon,
}) => (
  <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
    {icon && <div className="mb-3 opacity-50">{icon}</div>}
    <p className="text-sm">{text}</p>
    {sub && <p className="text-xs mt-1">{sub}</p>}
  </div>
)
