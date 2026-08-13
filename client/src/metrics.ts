// 指标计算：区间收益、年初至今、最大回撤、年化波动率、夏普比率
// 所有计算基于净值序列，假设无风险利率 2%
import type { NetWorthPoint, GrowthPoint } from './types'

const RISK_FREE_RATE = 0.02 // 无风险利率（年化）

export interface Metrics {
  totalReturn: number // 区间总收益 %
  ytdReturn: number // 年初至今 %
  maxDrawdown: number // 最大回撤 %
  annualVolatility: number // 年化波动率 %
  sharpe: number // 夏普比率
  startDate: string
  endDate: string
  count: number
}
// 按区间筛选净值
export type RangeKey = '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | 'ytd' | 'all'

export function filterByRange(netWorth: NetWorthPoint[], range: RangeKey): NetWorthPoint[] {
  if (range === 'all') return netWorth
  const now = new Date()
  let start: Date
  if (range === 'ytd') {
    start = new Date(now.getFullYear(), 0, 1)
  } else {
    const days = { '1m': 30, '3m': 90, '6m': 180, '1y': 365, '3y': 365 * 3, '5y': 365 * 5 }[range]
    start = new Date(now.getTime() - days * 24 * 3600 * 1000)
  }
  const startTs = start.getTime()
  return netWorth.filter((p) => p.timestamp >= startTs)
}

export function computeMetrics(netWorth: NetWorthPoint[]): Metrics | null {
  if (netWorth.length < 2) return null
  const sorted = [...netWorth].sort((a, b) => a.timestamp - b.timestamp)
  const startNav = sorted[0].nav
  const endNav = sorted[sorted.length - 1].nav
  const totalReturn = ((endNav - startNav) / startNav) * 100

  // 年初至今
  const yearStart = new Date(new Date(sorted[sorted.length - 1].date).getFullYear(), 0, 1).getTime()
  const ytdPoints = sorted.filter((p) => p.timestamp >= yearStart)
  const ytdReturn =
    ytdPoints.length >= 1
      ? ((endNav - ytdPoints[0].nav) / ytdPoints[0].nav) * 100
      : totalReturn

  // 最大回撤
  let peak = sorted[0].nav
  let maxDD = 0
  for (const p of sorted) {
    if (p.nav > peak) peak = p.nav
    const dd = (p.nav - peak) / peak
    if (dd < maxDD) maxDD = dd
  }
  const maxDrawdown = maxDD * 100

  // 日收益率序列
  const dailyReturns: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    dailyReturns.push((sorted[i].nav - sorted[i - 1].nav) / sorted[i - 1].nav)
  }
  const meanReturn = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
  const variance =
    dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / Math.max(1, dailyReturns.length - 1)
  const dailyVol = Math.sqrt(variance)
  const annualVolatility = dailyVol * Math.sqrt(252) * 100

  // 夏普比率：(年化收益 - 无风险) / 年化波动
  const tradingDays = sorted.length
  const annualReturn = (Math.pow(endNav / startNav, 252 / tradingDays) - 1) * 100
  const sharpe =
    annualVolatility > 0 ? (annualReturn - RISK_FREE_RATE * 100) / annualVolatility : 0

  return {
    totalReturn,
    ytdReturn,
    maxDrawdown,
    annualVolatility,
    sharpe,
    startDate: sorted[0].date,
    endDate: sorted[sorted.length - 1].date,
    count: sorted.length,
  }
}

// 归一化：将净值序列按首点缩放到 100，便于多基金横向对比
export function normalize(points: { date: string; nav: number; timestamp: number }[]) {
  if (points.length === 0) return []
  const base = points[0].nav
  return points.map((p) => ({ ...p, nav: (p.nav / base) * 100 }))
}

// 将多只基金按日期对齐到统一时间轴（用于归一化叠加）
// 取所有基金日期的并集，缺失值用前值填充
export interface AlignedSeries {
  timestamps: number[]
  dates: string[]
  series: { code: string; name: string; color: string; values: (number | null)[] }[]
}

export function alignSeries(
  funds: { code: string; name: string; color: string; netWorth: NetWorthPoint[] }[],
  normalized: boolean
): AlignedSeries {
  if (funds.length === 0) return { timestamps: [], dates: [], series: [] }

  // 收集所有时间戳并去重排序
  const tsSet = new Set<number>()
  for (const f of funds) for (const p of f.netWorth) tsSet.add(p.timestamp)
  const timestamps = Array.from(tsSet).sort((a, b) => a - b)
  const dates = timestamps.map((ts) => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })

  const series = funds.map((f) => {
    // 按时间戳建立查找表
    const map = new Map<number, number>()
    for (const p of f.netWorth) map.set(p.timestamp, p.nav)
    // 前向填充
    const values: (number | null)[] = []
    let lastVal: number | null = null
    for (const ts of timestamps) {
      const v = map.get(ts)
      if (v !== undefined) {
        lastVal = v
        values.push(v)
      } else {
        values.push(lastVal)
      }
    }
    // 归一化：首日 = 0%，后续为相对首日的累计涨跌幅百分比
    if (normalized) {
      const firstNonNull = values.find((v) => v !== null)
      const base = firstNonNull ?? 1
      const arr = values.map((v) => (v === null ? null : (v / base - 1) * 100))
      return { code: f.code, name: f.name, color: f.color, values: arr }
    }
    return { code: f.code, name: f.name, color: f.color, values }
  })

  return { timestamps, dates, series }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// ===== 蛋卷累计收益率（图表"累计收益率"模式）=====
// 蛋卷 growth 接口 day 参数随区间切换：1m/3m/6m/1y/3y/5y/ty(年初至今)/all
export const RANGE_TO_DAY: Record<RangeKey, string> = {
  '1m': '1m',
  '3m': '3m',
  '6m': '6m',
  '1y': '1y',
  '3y': '3y',
  '5y': '5y',
  ytd: 'ty',
  all: 'all',
}

// 从累计净值换算累计收益率（蛋卷数据缺失时的降级）：以区间首点为基准
export function netWorthToReturn(points: NetWorthPoint[]): GrowthPoint[] {
  if (points.length === 0) return []
  const base = points[0].nav
  return points.map((p) => ({
    date: p.date,
    timestamp: p.timestamp,
    value: (p.nav / base - 1) * 100,
    thanValue: 0,
    performanceValue: 0,
  }))
}

export interface GrowthFundInput {
  code: string
  name: string
  color: string
  points: GrowthPoint[] // 对应 day 窗口的蛋卷累计收益率（已以区间起点重定基）
}

// 多基金蛋卷累计收益率按日期对齐（value 已重定基，无需再换算）
// 产出 series(基金收益率) 与 benchSeries(业绩比较基准) 两套序列，用于叠加基准虚线
export interface AlignedReturns {
  timestamps: number[]
  dates: string[]
  series: { code: string; name: string; color: string; values: (number | null)[] }[]
  benchSeries: { code: string; values: (number | null)[] }[]
}

export function alignReturns(funds: GrowthFundInput[]): AlignedReturns {
  if (funds.length === 0) return { timestamps: [], dates: [], series: [], benchSeries: [] }

  // 收集所有时间戳并去重排序
  const tsSet = new Set<number>()
  for (const f of funds) for (const p of f.points) tsSet.add(p.timestamp)
  const timestamps = Array.from(tsSet).sort((a, b) => a - b)
  const dates = timestamps.map((ts) => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })

  const series: AlignedReturns['series'] = []
  const benchSeries: AlignedReturns['benchSeries'] = []
  for (const f of funds) {
    const map = new Map<number, GrowthPoint>()
    for (const p of f.points) map.set(p.timestamp, p)
    // 前向填充
    const values: (number | null)[] = []
    const bench: (number | null)[] = []
    let lastVal: number | null = null
    let lastBench: number | null = null
    for (const ts of timestamps) {
      const p = map.get(ts)
      if (p) {
        lastVal = p.value
        lastBench = p.performanceValue
        values.push(p.value)
        bench.push(p.performanceValue)
      } else {
        values.push(lastVal)
        bench.push(lastBench)
      }
    }
    series.push({ code: f.code, name: f.name, color: f.color, values })
    benchSeries.push({ code: f.code, values: bench })
  }

  return { timestamps, dates, series, benchSeries }
}
