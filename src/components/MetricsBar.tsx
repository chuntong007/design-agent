import React from 'react'
import { Activity, BarChart3, ShieldAlert, Gauge, TrendingUp, Calendar } from 'lucide-react'
import type { Fund } from '../types'
import { Card, changeColor, formatSign } from './UI'
import { clsx } from 'clsx'

interface Props {
  funds: Fund[]
  selectedIds: string[]
}

export const MetricsBar: React.FC<Props> = ({ funds, selectedIds }) => {
  const selected = funds.filter((f) => selectedIds.includes(f.id))

  // 多基金时取平均，单基金时显示该基金
  const agg = React.useMemo(() => {
    if (selected.length === 0) return null
    const avg = (key: keyof Fund['metrics']) =>
      selected.reduce((s, f) => s + (f.metrics[key] as number), 0) / selected.length
    return {
      totalReturn: avg('totalReturn'),
      ytdReturn: avg('ytdReturn'),
      maxDrawdown: avg('maxDrawdown'),
      sharpeRatio: avg('sharpeRatio'),
      volatility: avg('volatility'),
      count: selected.length,
    }
  }, [selected])

  if (!agg) {
    return (
      <Card className="p-5 flex items-center justify-center text-slate-400 text-sm">
        请至少选择一只基金查看指标
      </Card>
    )
  }

  const items = [
    {
      label: '区间总收益',
      value: formatSign(agg.totalReturn, '%'),
      icon: <TrendingUp size={16} />,
      color: agg.totalReturn >= 0 ? 'text-rose-600' : 'text-emerald-600',
      sub: `基于 ${agg.count} 只基金均值`,
    },
    {
      label: '年初至今',
      value: formatSign(agg.ytdReturn, '%'),
      icon: <Calendar size={16} />,
      color: agg.ytdReturn >= 0 ? 'text-rose-600' : 'text-emerald-600',
      sub: 'YTD 收益',
    },
    {
      label: '最大回撤',
      value: `${agg.maxDrawdown.toFixed(2)}%`,
      icon: <ShieldAlert size={16} />,
      color: 'text-rose-600',
      sub: '区间最大回撤',
    },
    {
      label: '年化波动率',
      value: `${agg.volatility.toFixed(2)}%`,
      icon: <Activity size={16} />,
      color: 'text-amber-600',
      sub: '日收益年化标准差',
    },
    {
      label: '夏普比率',
      value: agg.sharpeRatio.toFixed(2),
      icon: <Gauge size={16} />,
      color: agg.sharpeRatio >= 1 ? 'text-emerald-600' : 'text-slate-700',
      sub: '风险调整后收益',
    },
    {
      label: '对比基金数',
      value: agg.count,
      icon: <BarChart3 size={16} />,
      color: 'text-brand-600',
      sub: '当前选中',
    },
  ]

  return (
    <Card className="p-5">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
              <span className={it.color}>{it.icon}</span>
              {it.label}
            </div>
            <div className={clsx('text-2xl font-bold tabular-nums tracking-tight', it.color)}>{it.value}</div>
            <div className="text-[11px] mt-0.5 text-slate-400">{it.sub}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}
