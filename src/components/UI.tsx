import React from 'react'
import { clsx } from 'clsx'

// ============ 涨跌色 ============
export function changeColor(v: number): string {
  if (v > 0) return 'text-rose-600'
  if (v < 0) return 'text-emerald-600'
  return 'text-slate-500'
}
export function changeBg(v: number): string {
  if (v > 0) return 'bg-rose-50 text-rose-600 border-rose-100'
  if (v < 0) return 'bg-emerald-50 text-emerald-600 border-emerald-100'
  return 'bg-slate-50 text-slate-500 border-slate-100'
}

export function formatSign(v: number, suffix = ''): string {
  const s = v > 0 ? '+' : ''
  return `${s}${v.toFixed(2)}${suffix}`
}

// ============ Card ============
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...rest }) => (
  <div
    className={clsx(
      'rounded-2xl bg-white/80 backdrop-blur-xl border border-slate-200/70 shadow-sm',
      'hover:shadow-md transition-shadow duration-300',
      className,
    )}
    {...rest}
  >
    {children}
  </div>
)

// ============ Badge ============
export const Badge: React.FC<{ children: React.ReactNode; color?: string; className?: string }> = ({
  children,
  color,
  className,
}) => (
  <span
    className={clsx(
      'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border',
      className,
    )}
    style={color ? { color, borderColor: color + '33', backgroundColor: color + '14' } : undefined}
  >
    {children}
  </span>
)

// ============ Metric stat ============
export const Stat: React.FC<{
  label: string
  value: string | number
  sub?: React.ReactNode
  valueClass?: string
  icon?: React.ReactNode
}> = ({ label, value, sub, valueClass, icon }) => (
  <div className="flex flex-col">
    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1">
      {icon}
      {label}
    </div>
    <div className={clsx('text-2xl font-bold tabular-nums tracking-tight', valueClass)}>
      {value}
    </div>
    {sub && <div className="text-xs mt-0.5 text-slate-400">{sub}</div>}
  </div>
)

// ============ Segmented control ============
export const Segmented: React.FC<{
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
  size?: 'sm' | 'md'
}> = ({ options, value, onChange, size = 'md' }) => (
  <div className="inline-flex p-1 bg-slate-100/80 rounded-xl gap-1">
    {options.map((o) => (
      <button
        key={o.value}
        onClick={() => onChange(o.value)}
        className={clsx(
          'rounded-lg font-medium transition-all duration-200',
          size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
          value === o.value
            ? 'bg-white text-brand-600 shadow-sm'
            : 'text-slate-500 hover:text-slate-700',
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
)
