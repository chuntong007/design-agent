import { useMemo, useState, useRef, useEffect } from 'react'
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Customized,
} from 'recharts'
import type { LoadedFund } from '../App'
import type { AnchorNews } from '../storage'
import { fmtPct, fmtNum, makeStyles } from '../theme'
import { useTheme } from '../ThemeContext'
import { filterByRange, alignSeries, type RangeKey, type AlignedSeries } from '../metrics'
import { ErrorBoundary } from './ErrorBoundary'

interface QueryPoint {
  ts: number
  val: number
  idx: number
}

// Recharts 点击事件状态
interface ClickEventState {
  activeLabel?: string | number
  activePayload?: TooltipPayload[]
  activeCoordinate?: { x: number; y: number }
}

// Recharts Tooltip/Payload 数据项
interface TooltipPayload {
  dataKey: string | number
  value: number
  color: string
  name?: string
  payload?: Record<string, unknown>
}

interface Props {
  funds: LoadedFund[]
  range: string
  normalized: boolean
  anchors: AnchorNews[]
  onPointClick: (date: string, fundCode: string) => void
  newsQuery: { date: string; fundCode: string } | null
  // 报告日期联动高亮（点击报告日期标签时，图表对应点位闪烁高亮）
  highlightDate?: string | null
  // 点击图表空白处回调（抽屉打开时用于关闭抽屉）
  onChartBlankClick?: () => void
}

export function NavChartPanel({
  funds,
  range,
  normalized,
  anchors,
  onPointClick,
  newsQuery,
  highlightDate,
  onChartBlankClick,
}: Props) {
  const { palette: p, mode } = useTheme()
  const [hoveredPoint, setHoveredPoint] = useState<{ date: string; fundCode: string } | null>(null)

  // 对齐多基金净值序列
  const aligned = useMemo(() => {
    const withData = funds.filter((f) => f.detail && f.detail.netWorth.length > 0)
    if (withData.length === 0) return { timestamps: [], dates: [], series: [], chartData: [] }
    const filtered = withData.map((f) => ({
      code: f.code,
      name: f.detail!.name,
      color: f.color,
      netWorth: filterByRange(f.detail!.netWorth, range as RangeKey),
    }))
    const alignedData = alignSeries(filtered, normalized)
    // 转为 recharts 需要的行格式：[{ date, timestamp, [code1]: val1, [code2]: val2 }]
    const chartData = alignedData.timestamps.map((ts, i) => {
      const row: Record<string, number | string | null> = {
        date: alignedData.dates[i],
        timestamp: ts,
      }
      for (const s of alignedData.series) {
        row[s.code] = s.values[i]
      }
      return row
    })
    return { ...alignedData, chartData }
  }, [funds, range, normalized])

  // 当前查询点的标记
  const queryPoint = useMemo<QueryPoint | null>(() => {
    if (!newsQuery) return null
    const { date, fundCode } = newsQuery
    const fund = funds.find((f) => f.code === fundCode)
    if (!fund?.detail) return null
    // 在 chartData 中找最接近的日期
    const targetTs = new Date(date).getTime()
    let closest: QueryPoint | null = null
    aligned.series.find((s) => s.code === fundCode)?.values.forEach((v, i) => {
      if (v === null) return
      const ts = aligned.timestamps[i]
      if (!closest || Math.abs(ts - targetTs) < Math.abs(closest.ts - targetTs)) {
        closest = { ts, val: v, idx: i }
      }
    })
    return closest
  }, [newsQuery, funds, aligned])

  if (funds.length === 0) {
    return <EmptyState message="添加基金后查看净值走势" />
  }
  const loadingFunds = funds.filter((f) => f.loading)
  if (loadingFunds.length > 0 && aligned.chartData.length === 0) {
    return <EmptyState message="正在加载净值数据..." />
  }
  if (aligned.chartData.length === 0) {
    return <EmptyState message="暂无净值数据" />
  }

  // 点击图表:优先从 activePayload 获取点击的基金 dataKey,否则 fallback 到 funds[0]
  // 点空白（无 activeLabel）时触发 onChartBlankClick（抽屉打开时关闭抽屉）
  const handleClick = (state: ClickEventState) => {
    if (!state || !state.activeLabel) {
      // 点空白：若提供了 onChartBlankClick 则触发
      if (onChartBlankClick) onChartBlankClick()
      return
    }
    const date = state.activeLabel as string
    let fundCode = ''
    // 从 activePayload 找到点击的数据系列(dataKey 即基金 code)
    if (state.activePayload && state.activePayload.length > 0) {
      fundCode = state.activePayload[0].dataKey as string
    }
    // fallback:无法确定时用 funds[0]
    if (!fundCode || !funds.some((f) => f.code === fundCode)) {
      fundCode = funds[0]?.code || ''
    }
    if (fundCode) onPointClick(date, fundCode)
  }

  return (
    <div className={mode === 'dark' ? 'glass-card-dark' : 'glass-card'} style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: '12px' }}>
      <style>{`@keyframes highlight-pulse { 0%, 100% { stroke-opacity: 0.4; } 50% { stroke-opacity: 0.9; } }`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <span style={{ fontSize: '16px', fontWeight: 700, color: p.text0, letterSpacing: '-0.01em' }}>净值走势</span>
          <span style={{ fontSize: '12px', color: p.text2, marginLeft: '10px' }}>
            {normalized ? '归一化（首日=0%）' : '绝对净值（元）'} · 点击曲线任意点位检索新闻
          </span>
        </div>
      </div>
      <div style={{ height: '2px', background: `linear-gradient(90deg, ${p.accent}, transparent)`, marginBottom: '8px', borderRadius: '1px' }} />
      <div className={mode === 'dark' ? 'tech-grid-bg-dark' : 'tech-grid-bg'} style={{ flex: 1, minHeight: 0, borderRadius: '8px' }}>
        <ErrorBoundary>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={aligned.chartData}
            margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            onClick={handleClick}
          >
            <CartesianGrid stroke={p.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              stroke={p.text2}
              tick={{ fontSize: 11, fill: p.text2 }}
              minTickGap={50}
              tickFormatter={(v) => fmtShortDate(v as string)}
            />
            <YAxis
              stroke={p.text2}
              tick={{ fontSize: 11, fill: p.text2 }}
              domain={['auto', 'auto']}
              tickFormatter={(v) => (normalized ? `${v.toFixed(1)}%` : v.toFixed(2))}
            />
            <Tooltip content={<CustomTooltip funds={funds} normalized={normalized} />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              formatter={(value) => {
                const f = funds.find((x) => x.code === value)
                const name = f ? f.detail?.name || value : value
                return (
                  <span
                    style={{
                      color: p.text1,
                      textShadow: mode === 'dark' ? `0 0 8px ${p.accent}66` : 'none',
                    }}
                  >
                    {name}
                  </span>
                )
              }}
            />
            <defs>
              {funds
                .filter((f) => f.detail)
                .map((f) => (
                  <linearGradient key={f.code} id={`grad-${f.code}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={f.color} stopOpacity={0.32} />
                    <stop offset="60%" stopColor={f.color} stopOpacity={0.08} />
                    <stop offset="100%" stopColor={f.color} stopOpacity={0} />
                  </linearGradient>
                ))}
            </defs>
            {funds
              .filter((f) => f.detail)
              .map((f) => (
                <Area
                  key={f.code}
                  type="monotone"
                  dataKey={f.code}
                  stroke={f.color}
                  strokeWidth={2}
                  fill={`url(#grad-${f.code})`}
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 4, fill: f.color, stroke: p.bg0, strokeWidth: 2 }}
                  isAnimationActive
                  animationDuration={600}
                  animationEasing="ease-out"
                  connectNulls
                />
              ))}
            {/* 用 Customized 安全渲染锚点标注：只有 xAxis/yAxis scale 就绪时才渲染 */}
            <Customized component={(props: CustomizedProps) => <AnchorMarks {...props} funds={funds} aligned={aligned} anchors={anchors} queryPoint={queryPoint} palette={p} highlightDate={highlightDate} />} />
          </ComposedChart>
        </ResponsiveContainer>
        </ErrorBoundary>
      </div>
      {/* 锚定新闻标签条：直接显示在图表下方，所见即所得 */}
      {anchors.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          {anchors.map((a) => {
            const color = a.impact === 'positive' ? p.up : a.impact === 'negative' ? p.down : p.neutral
            return (
              <div
                key={a.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  background: p.bg2,
                  border: `1px solid ${color}66`,
                  borderLeft: `3px solid ${color}`,
                  fontSize: '11px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <span style={{ color: p.text2, fontFamily: 'monospace' }}>{a.date}</span>
                <span style={{ color: p.text1, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.title.length > 24 ? a.title.slice(0, 24) + '…' : a.title}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
  funds: LoadedFund[]
  normalized: boolean
}

function CustomTooltip({ active, payload, label, funds, normalized }: TooltipProps) {
  const { palette: p } = useTheme()
  if (!active || !payload || payload.length === 0) return null
  const sorted = [...payload].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  return (
    <div
      style={{
        background: p.tooltipBg,
        border: `1px solid ${p.borderLight}`,
        borderRadius: '8px',
        padding: '10px 12px',
        fontSize: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        maxWidth: '320px',
      }}
    >
      <div style={{ color: p.text1, marginBottom: '6px', fontWeight: 600 }}>{label}</div>
      {sorted.map((pp) => {
        const f = funds.find((x) => x.code === pp.dataKey)
        return (
          <div key={pp.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: pp.color }} />
            <span style={{ color: p.text1, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f?.detail?.name || pp.dataKey}
            </span>
            <span style={{ color: p.text0, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
              {normalized ? `${pp.value?.toFixed(2)}%` : fmtNum(pp.value, 4)}
            </span>
          </div>
        )
      })}
      <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: `1px solid ${p.border}`, color: p.text2, fontSize: '11px' }}>
        点击检索该日期新闻
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  const { palette: p } = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: p.text2, fontSize: '13px' }}>
      {message}
    </div>
  )
}

function fmtShortDate(d: string): string {
  // YYYY-MM-DD -> MM-DD
  if (!d || d.length < 10) return d
  return d.slice(5)
}

function fmtFullDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// 锚点标注组件：用 Customized 的 component prop 渲染，安全访问 xAxis/yAxis scale
// 只有 scale 就绪时才渲染 SVG 标注，避免 ReferenceDot 的 scale undefined 崩溃
// CustomizedProps:Recharts Customized 组件注入的坐标轴映射,这里用 Record + 具体轴类型
interface AxisConfig {
  scale?: { (value: string | number): number; range?: () => [number, number] }
}
interface CustomizedProps {
  xAxisMap?: Record<number, AxisConfig>
  yAxisMap?: Record<number, AxisConfig>
}
interface AnchorMarksProps extends CustomizedProps {
  funds: LoadedFund[]
  aligned: AlignedSeries
  anchors: AnchorNews[]
  queryPoint: QueryPoint | null
  palette: ReturnType<typeof useTheme>['palette']
  highlightDate?: string | null
}

function AnchorMarks(props: AnchorMarksProps) {
  const { xAxisMap, yAxisMap, funds, aligned, anchors, queryPoint, palette: p, highlightDate } = props
  // funds 保留在 props 中以便未来扩展(如按基金颜色区分锚点)
  void funds
  if (!xAxisMap || !yAxisMap) return null
  const xAxis = xAxisMap[0]
  const yAxis = yAxisMap[0]
  if (!xAxis || !yAxis || !xAxis.scale || !yAxis.scale) return null

  const yScale = yAxis.scale
  const xScale = xAxis.scale
  const yRange: [number, number] = (yScale && typeof yScale.range === 'function') ? yScale.range() : [0, 0]
  const elements: React.ReactNode[] = []

  // 报告日期联动高亮：粗竖线 + 闪烁动画
  if (highlightDate) {
    const idx = aligned.dates.indexOf(highlightDate)
    if (idx >= 0) {
      const x = xScale!(highlightDate)
      if (isFinite(x)) {
        elements.push(
          <line
            key="highlight-line"
            x1={x}
            y1={yRange[0]}
            x2={x}
            y2={yRange[1]}
            stroke={p.accent}
            strokeWidth={2}
            strokeOpacity={0.8}
            style={{ animation: 'highlight-pulse 1.5s ease-in-out infinite' }}
          />
        )
      }
    }
  }

  // 当前检索点标记
  if (queryPoint && queryPoint.idx >= 0 && queryPoint.idx < aligned.dates.length && isFinite(queryPoint.val)) {
    const x = xScale!(aligned.dates[queryPoint.idx])
    const y = yScale!(queryPoint.val)
    if (isFinite(x) && isFinite(y)) {
      elements.push(
        <line key="qp-line" x1={x} y1={yRange[0]} x2={x} y2={yRange[1]} stroke={p.accent} strokeOpacity={0.3} strokeDasharray="3 3" />,
        <circle key="qp-dot" cx={x} cy={y} r={6} fill={p.accent} stroke={p.bg0} strokeWidth={2} />
      )
    }
  }

  // 锚定新闻标记：竖线只依赖日期，圆点用任意有该日期净值的基金定位
  anchors.forEach((a) => {
    const idx = aligned.dates.indexOf(a.date)
    if (idx < 0) return
    // 找任意基金在该日期的有效净值
    let val: number | null = null
    for (const s of aligned.series) {
      const v = s.values[idx]
      if (v !== null && v !== undefined && isFinite(v)) {
        val = v
        break
      }
    }
    const x = xScale!(a.date)
    if (!isFinite(x)) return
    const color = a.impact === 'positive' ? p.up : a.impact === 'negative' ? p.down : p.neutral
    // 竖线：只要有日期就画
    elements.push(
      <line key={`${a.id}-line`} x1={x} y1={yRange[0]} x2={x} y2={yRange[1]} stroke={color} strokeOpacity={0.5} strokeDasharray="3 3" />
    )
    // 圆点：有有效净值才画，旁边加 title 文字(前20字符)
    if (val !== null) {
      const y = yScale!(val)
      if (isFinite(y)) {
        const shortTitle = a.title.length > 20 ? a.title.slice(0, 20) + '…' : a.title
        elements.push(
          <circle key={`${a.id}-dot`} cx={x} cy={y} r={5} fill={color} stroke={p.bg0} strokeWidth={2} />,
          <text key={`${a.id}-label`} x={x + 8} y={y - 8} fontSize={10} fill={p.text1} fontFamily="JetBrains Mono, monospace">
            {shortTitle}
          </text>
        )
      }
    }
  })

  return elements.length > 0 ? <g>{elements}</g> : null
}
