import React, { useMemo, useRef } from 'react'
import ReactECharts from 'echarts-for-react'
import type { Holding } from '../types'
import { Loader2, PieChart as PieIcon } from 'lucide-react'

interface Props {
  holdings: Holding[]
  anchorDate: string | null
  loading?: boolean
}

const INDUSTRY_COLORS: Record<string, string> = {
  白酒: '#f59e0b',
  半导体: '#6366f1',
  半导体设备: '#8b5cf6',
  半导体材料: '#a78bfa',
  银行: '#10b981',
  保险: '#14b8a6',
  家电: '#06b6d4',
  医药: '#ec4899',
  生物医药: '#f43f5e',
  医药研发: '#e11d48',
  化工: '#84cc16',
  新能源: '#22c55e',
  消费电子: '#0ea5e9',
  软件: '#3b82f6',
  智能家居: '#64748b',
  农业: '#65a30d',
}

export const HoldingsPanel: React.FC<Props> = ({ holdings, anchorDate, loading }) => {
  if (loading || holdings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        {loading ? (
          <>
            <Loader2 size={32} className="mb-3 animate-spin text-brand-400" />
            <p className="text-sm">正在获取重仓股数据...</p>
          </>
        ) : (
          <>
            <PieIcon size={32} className="mb-3 opacity-40" />
            <p className="text-sm">暂无重仓股数据</p>
          </>
        )}
      </div>
    )
  }
  const chartRef = useRef<any>(null)

  // 占比饼图
  const pieOption = useMemo(() => {
    const top = holdings.slice(0, 10)
    return {
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15,23,42,0.92)',
        borderColor: 'transparent',
        borderRadius: 10,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (p: any) => `${p.name}<br/>占比：<b>${p.value}%</b>`,
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: {
            show: true,
            formatter: '{b|{b}}\n{c|{c}%}',
            rich: {
              b: { fontSize: 11, color: '#475569', lineHeight: 14 },
              c: { fontSize: 12, fontWeight: 600, color: '#0f172a' },
            },
          },
          labelLine: { length: 8, length2: 8 },
          data: top.map((h) => ({
            name: h.name,
            value: h.ratio,
            itemStyle: { color: INDUSTRY_COLORS[h.industry] ?? '#94a3b8' },
          })),
        },
      ],
    }
  }, [holdings])

  // 重仓股走势对比（归一化）
  const lineOption = useMemo(() => {
    const dates = holdings[0]?.trend.map((t) => t.date) ?? []
    const series = holdings.slice(0, 5).map((h) => {
      const base = h.trend[0]?.price ?? 1
      return {
        name: `${h.name}`,
        type: 'line',
        data: h.trend.map((t) => +(((t.price - base) / base) * 100).toFixed(2)),
        smooth: 0.3,
        showSymbol: false,
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
      }
    })
    const markLines: any[] = []
    if (anchorDate && dates.includes(anchorDate)) {
      markLines.push({
        xAxis: anchorDate,
        symbol: 'none',
        label: { show: true, position: 'insideEndTop', formatter: '📍', color: '#f59e0b' },
        lineStyle: { color: '#f59e0b', type: 'dashed', width: 2 },
      })
    }
    return {
      grid: { left: 44, right: 16, top: 30, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,23,42,0.92)',
        borderColor: 'transparent',
        borderRadius: 10,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue
          const rows = params
            .map((p) => `<div style="display:flex;gap:8px"><span style="color:${p.color}">●</span>${p.seriesName} <b>${p.value}%</b></div>`)
            .join('')
          return `<div style="font-weight:600;margin-bottom:4px">${date}</div>${rows}`
        },
      },
      legend: {
        top: 0,
        textStyle: { fontSize: 11, color: '#64748b' },
        itemWidth: 12,
        itemHeight: 12,
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: (v: string) => v.slice(5) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#94a3b8', fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      series:
        markLines.length > 0
          ? series.map((s, i) => (i === 0 ? { ...s, markLine: { silent: true, data: markLines } } : s))
          : series,
    }
  }, [holdings, anchorDate])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 h-full">
      {/* 左：占比饼图 */}
      <div className="lg:col-span-2 flex flex-col">
        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
          <span className="w-1 h-4 rounded bg-brand-500" />
          重仓股占比分布
        </h3>
        <div className="flex-1 min-h-[260px]">
          <ReactECharts option={pieOption} style={{ height: '100%', width: '100%' }} />
        </div>
      </div>

      {/* 右：Top5 走势对比 */}
      <div className="lg:col-span-3 flex flex-col">
        <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
          <span className="w-1 h-4 rounded bg-brand-500" />
          重仓股 Top5 走势对比（归一化 %）
        </h3>
        <div className="flex-1 min-h-[260px]">
          <ReactECharts option={lineOption} style={{ height: '100%', width: '100%' }} />
        </div>
      </div>

      {/* 下方：重仓股明细表 */}
      <div className="lg:col-span-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
              <th className="py-2 px-3 font-medium">排名</th>
              <th className="py-2 px-3 font-medium">股票</th>
              <th className="py-2 px-3 font-medium">行业</th>
              <th className="py-2 px-3 font-medium text-right">占比</th>
              <th className="py-2 px-3 font-medium text-right">最新价</th>
              <th className="py-2 px-3 font-medium text-right">当日涨跌</th>
              <th className="py-2 px-3 font-medium text-right">年初至今</th>
              <th className="py-2 px-3 font-medium text-right">市值</th>
              <th className="py-2 px-3 font-medium text-right">PE</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr
                key={h.code}
                className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors"
              >
                <td className="py-2.5 px-3 text-slate-400 font-medium">{h.rank}</td>
                <td className="py-2.5 px-3">
                  <div className="font-medium text-slate-800">{h.name}</div>
                  <div className="text-xs text-slate-400">{h.code}</div>
                </td>
                <td className="py-2.5 px-3">
                  <span
                    className="inline-block px-2 py-0.5 rounded-md text-xs font-medium"
                    style={{
                      color: INDUSTRY_COLORS[h.industry] ?? '#64748b',
                      backgroundColor: (INDUSTRY_COLORS[h.industry] ?? '#64748b') + '14',
                    }}
                  >
                    {h.industry}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-semibold tabular-nums text-slate-700">
                  {h.ratio}%
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-700">
                  {h.latestPrice.toFixed(2)}
                </td>
                <td
                  className={`py-2.5 px-3 text-right tabular-nums font-medium ${
                    h.latestChange > 0 ? 'text-rose-600' : h.latestChange < 0 ? 'text-emerald-600' : 'text-slate-500'
                  }`}
                >
                  {h.latestChange > 0 ? '+' : ''}
                  {h.latestChange.toFixed(2)}%
                </td>
                <td
                  className={`py-2.5 px-3 text-right tabular-nums font-medium ${
                    h.ytdChange > 0 ? 'text-rose-600' : h.ytdChange < 0 ? 'text-emerald-600' : 'text-slate-500'
                  }`}
                >
                  {h.ytdChange > 0 ? '+' : ''}
                  {h.ytdChange.toFixed(2)}%
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-500">{h.marketCap}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-500">{h.peRatio.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
