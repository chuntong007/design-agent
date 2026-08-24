import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Customized,
} from 'recharts'
import { Modal, Button } from '@mantine/core'
import type { LoadedFund } from '../App'
import type { AnchorNews } from '../storage'
import type { GrowthPoint } from '../types'
import { fmtPct, fmtNum, makeStyles } from '../theme'
import { useTheme } from '../ThemeContext'
import {
  filterByRange,
  alignSeries,
  alignReturns,
  netWorthToReturn,
  RANGE_TO_DAY,
  type RangeKey,
  type AlignedSeries,
  type GrowthFundInput,
} from '../metrics'
import { ErrorBoundary } from './ErrorBoundary'
import { NewsTimeline } from './NewsTimeline'

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

const EMPTY = { timestamps: [], dates: [], series: [], chartData: [], benchSeries: [] }

interface Props {
  funds: LoadedFund[]
  range: string
  chartMode: 'return' | 'nav'
  growthMap: Record<string, GrowthPoint[]>
  growthErrors: Record<string, string>
  anchors: AnchorNews[]
  // e 形参保留兼容(忽略),内部不再透传 modifier
  onPointClick: (date: string, fundCode: string, e?: React.MouseEvent | React.KeyboardEvent | 'shift' | 'alt') => void
  // 【多基金检索】预设的检索基金子集;空选/未传 = 兜底为全部已加载基金
  newsTargetCodes?: string[]
  newsQuery: { date: string; fundCode: string } | null
  // 报告日期联动高亮（点击报告日期标签时，图表对应点位闪烁高亮）
  highlightDate?: string | null
  // 点击图表空白处回调（抽屉打开时用于关闭抽屉）
  onChartBlankClick?: () => void
  // 【NewsTimeline】单击圆点：跳转到该日期的图表高亮
  onJumpToAnchor?: (date: string, anchorId: string) => void
  // 【NewsTimeline】删除锚点
  onRemoveAnchor?: (anchorId: string) => void
  // 【NewsTimeline】范围滑块变化
  onRangeChange?: (start: string, end: string) => void
  // 【NewsTimeline】列表模式（透传）
  listMode?: boolean
  // 【NewsTimeline】切换列表/时间轴模式
  onToggleListMode?: () => void
  // 【NewsTimeline】清空全部锚点
  onClearAllAnchors?: () => void
  // 【NewsTimeline】全部清空确认弹窗开关
  clearAllConfirmOpen?: boolean
  // 【NewsTimeline】全部清空确认弹窗开关变更
  onClearAllConfirmOpenChange?: (open: boolean) => void
}

export function NavChartPanel({
  funds,
  range,
  chartMode,
  growthMap,
  growthErrors,
  anchors,
  onPointClick,
  newsTargetCodes,
  newsQuery,
  highlightDate,
  onChartBlankClick,
  onJumpToAnchor,
  onRemoveAnchor,
  onRangeChange,
  listMode,
  onToggleListMode,
  onClearAllAnchors,
  clearAllConfirmOpen,
  onClearAllConfirmOpenChange,
}: Props) {
  const { palette: p, mode } = useTheme()
  const [hoveredPoint, setHoveredPoint] = useState<{ date: string; fundCode: string } | null>(null)

  // ===== 区间缩放/平移状态 =====
  // viewRange: chartData 的索引区间 [start, end)（end 为开区间）；null = 全量视图
  // 由滚轮缩放 / 拖拽平移 / 时间轴滑块 三条路径共同驱动
  const [viewRange, setViewRange] = useState<[number, number] | null>(null)
  // 【防抖动关键】ref 镜像最新 viewRange + total：
  // wheel/mousemove 事件频率高于 React 渲染频率，若用闭包捕获 state，
  // 快速连续事件会交替命中新旧监听器（effect 重绑间隙），产生来回跳变。
  // 所有高频事件处理器统一从 ref 读取最新值，写入走 setViewRange + 同步 ref
  const viewRangeRef = useRef<[number, number] | null>(null)
  const totalRef = useRef(0)
  const setViewRangeSync = useCallback((next: [number, number] | null) => {
    viewRangeRef.current = next
    setViewRange(next)
  }, [])
  // 拖拽平移状态：记录按下时的鼠标 x 与当时的 viewRange
  const dragStateRef = useRef<{ startX: number; startRange: [number, number] } | null>(null)
  const [draggingChart, setDraggingChart] = useState(false)
  const chartWrapRef = useRef<HTMLDivElement | null>(null)

  // 数据变化（切换 range/模式/基金）时重置缩放，避免残留过期索引
  useEffect(() => {
    setViewRange(null)
  }, [range, chartMode, funds.map((f) => f.code).join(',')])

  // 蛋卷 growth day 参数随区间切换（年初至今 -> ty）
  const day = RANGE_TO_DAY[range as RangeKey] ?? 'all'

  // 对齐多基金序列：'return' 用蛋卷累计收益率(随 day 参数区间重定基)，'nav' 用累计净值
  const aligned = useMemo(() => {
    const withData = funds.filter((f) => f.detail && f.detail.netWorth.length > 0)
    if (withData.length === 0) return EMPTY

    if (chartMode === 'return') {
      const inputs: GrowthFundInput[] = []
      for (const f of withData) {
        const key = `${f.code}:${day}`
        const growth = growthMap[key]
        if (growth && growth.length > 0) {
          inputs.push({ code: f.code, name: f.detail!.name, color: f.color, points: growth })
        } else if (growthErrors[key]) {
          // 蛋卷失败降级：用累计净值换算区间收益率
          const nav = filterByRange(f.detail!.netWorth, range as RangeKey)
          inputs.push({ code: f.code, name: f.detail!.name, color: f.color, points: netWorthToReturn(nav) })
        }
        // 加载中：该基金未进入 inputs → 由下方 growthPending 判定显示 loading
      }
      if (inputs.length === 0) return EMPTY
      const alignedData = alignReturns(inputs)
      // 行格式：{ date, timestamp, [code]: 收益率, [code_bench]: 业绩比较基准 }
      const chartData = alignedData.timestamps.map((ts, i) => {
        const row: Record<string, number | string | null> = {
          date: alignedData.dates[i],
          timestamp: ts,
        }
        for (const s of alignedData.series) row[s.code] = s.values[i]
        for (const b of alignedData.benchSeries) row[`${b.code}_bench`] = b.values[i]
        return row
      })
      return { ...alignedData, chartData }
    }

    // 'nav' 模式：绝对净值（累计净值 元）
    const filtered = withData.map((f) => ({
      code: f.code,
      name: f.detail!.name,
      color: f.color,
      netWorth: filterByRange(f.detail!.netWorth, range as RangeKey),
    }))
    const alignedData = alignSeries(filtered, false)
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
    return { ...alignedData, chartData, benchSeries: [] }
  }, [funds, range, chartMode, growthMap, growthErrors, day])

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

  // 【NewsTimeline】从 Recharts Customized 提取 xScale(date) -> pixel
  // 用 ref 而不是 state：避免每次 Recharts 重渲染时触发 NavChartPanel 重渲染
  const xScaleRef = useRef<((d: string) => number) | null>(null)
  const onXScaleReady = useCallback((scale: (d: string) => number) => {
    xScaleRef.current = scale
  }, [])

  // ===== 区间缩放/平移：视图数据切片 =====
  // fullData 长度变化时收缩越界的 viewRange（防御性，正常由上方 useEffect 重置）
  const total = aligned.chartData.length
  const effectiveRange: [number, number] | null = useMemo(() => {
    if (!viewRange) return null
    const [s, e] = viewRange
    if (e - s < 2 || s >= total) return null
    return [Math.max(0, s), Math.min(total, e)]
  }, [viewRange, total])
  const viewData = useMemo(
    () => (effectiveRange ? aligned.chartData.slice(effectiveRange[0], effectiveRange[1]) : aligned.chartData),
    [aligned.chartData, effectiveRange]
  )
  // 当前可视日期区间（传给 NewsTimeline 联动滑块）
  const viewDates = useMemo(() => {
    const data = viewData.length > 0 ? viewData : aligned.chartData
    return {
      start: (data[0]?.date as string) || '',
      end: (data[data.length - 1]?.date as string) || '',
    }
  }, [viewData, aligned.chartData])

  // ===== 滚轮缩放：以鼠标 x 为锚点 =====
  // 注意：React 的 onWheel 是 passive 事件，preventDefault 无效；
  // 必须用原生 addEventListener({ passive: false }) 才能阻止页面滚动
  // chartVisible：图表是否实际渲染（未走 EmptyState 早退）。
  // 关键：growth 数据分批到达期间 total 可能已 >0 但图表仍显示 EmptyState，
  // 图表真正渲染时 total/effectiveRange 可能都不变，必须靠 chartVisible 触发重绑监听
  const growthPendingNow =
    chartMode === 'return' &&
    funds.some((f) => f.detail && !growthMap[`${f.code}:${day}`] && !growthErrors[`${f.code}:${day}`])
  const chartVisible = funds.length > 0 && total > 0 && !growthPendingNow

  useEffect(() => {
    const wrap = chartWrapRef.current
    if (!wrap) return
    const onWheelNative = (e: WheelEvent) => {
      if (total < 2) return
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      // 鼠标 x 占容器宽度的比例 -> 对应数据索引（锚点）
      const anchorIdx = (mouseX / rect.width) * (total - 1)
      const [s, eIdx] = effectiveRange ?? [0, total]
      const span = eIdx - s
      // deltaY > 0 = 放大（缩小窗口），< 0 = 缩小（扩大窗口）
      const factor = e.deltaY > 0 ? 0.85 : 1 / 0.85
      let newSpan = Math.round(span * factor)
      // 最小窗口 8 个点，最大不超过全量
      newSpan = Math.max(8, Math.min(total, newSpan))
      if (newSpan === span && newSpan !== 8 && newSpan !== total) return
      // 以锚点为中心按原比例分配新窗口，再平移使锚点保持在鼠标位置比例
      const anchorRatio = (anchorIdx - s) / span
      let newStart = Math.round(anchorIdx - anchorRatio * newSpan)
      let newEnd = newStart + newSpan
      // 边界修正
      if (newStart < 0) { newStart = 0; newEnd = newSpan }
      if (newEnd > total) { newEnd = total; newStart = Math.max(0, total - newSpan) }
      if (newEnd - newStart < 8) return
      setViewRange(newStart === 0 && newEnd === total ? null : [newStart, newEnd])
    }
    wrap.addEventListener('wheel', onWheelNative, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheelNative)
  }, [total, effectiveRange, chartVisible])

  // ===== 拖拽平移 =====
  // dragMovedRef: 本次按下是否产生了实际位移（超过阈值），
  // 用于抑制拖拽松手后浏览器派发的 click 误触发新闻检索
  const dragMovedRef = useRef(false)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return // 仅左键
    const wrap = chartWrapRef.current
    if (!wrap || total < 2) return
    dragMovedRef.current = false
    dragStateRef.current = {
      startX: e.clientX,
      startRange: effectiveRange ?? [0, total],
    }
    setDraggingChart(true)
  }, [total, effectiveRange])

  useEffect(() => {
    if (!draggingChart) return
    const onMove = (ev: MouseEvent) => {
      const ds = dragStateRef.current
      const wrap = chartWrapRef.current
      if (!ds || !wrap || total < 2) return
      const rect = wrap.getBoundingClientRect()
      const dx = ev.clientX - ds.startX
      // 位移超过 5px 视为拖拽（抑制后续 click）
      if (Math.abs(dx) > 5) dragMovedRef.current = true
      // dx 像素 -> 索引位移（按当前窗口像素跨度换算）
      const [s, e] = ds.startRange
      const span = e - s
      const idxShift = Math.round((dx / rect.width) * span)
      if (idxShift === 0) return
      let newStart = s - idxShift
      let newEnd = e - idxShift
      // 边界夹紧
      if (newStart < 0) { newStart = 0; newEnd = span }
      if (newEnd > total) { newEnd = total; newStart = total - span }
      if (newEnd - newStart < 8) return
      setViewRange(newStart === 0 && newEnd === total ? null : [newStart, newEnd])
    }
    const onUp = () => {
      dragStateRef.current = null
      setDraggingChart(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [draggingChart, total])

  // 双击重置
  // clickTimerRef: 单击检索的延迟执行定时器；双击时取消，避免双击重置误触发检索
  const clickTimerRef = useRef<number | null>(null)
  const handleDblClick = useCallback(() => {
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }
    setViewRange(null)
  }, [])

  // 组件卸载时清理挂起的单击定时器
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current)
    }
  }, [])

  // 时间轴滑块 -> 精确映射回索引区间（取代 App 层 RangeKey 粗映射）
  const handleTimelineRange = useCallback((start: string, end: string) => {
    if (total < 2) return
    const startTs = new Date(start + 'T00:00:00').getTime()
    const endTs = new Date(end + 'T00:00:00').getTime()
    if (!isFinite(startTs) || !isFinite(endTs) || endTs < startTs) return
    // 在全量数据中找最接近的日期索引
    const dates = aligned.chartData.map((r) => r.date as string)
    let sIdx = 0
    let eIdx = dates.length - 1
    for (let i = 0; i < dates.length; i++) {
      const ts = new Date(dates[i] + 'T00:00:00').getTime()
      if (ts < startTs) sIdx = i
      if (ts <= endTs) eIdx = i
    }
    // 全量时清空缩放
    if (sIdx <= 0 && eIdx >= dates.length - 1) {
      setViewRange(null)
    } else {
      setViewRange([sIdx, Math.max(sIdx + 8, eIdx + 1)])
    }
  }, [total, aligned.chartData])

  // 视觉高亮判定:目标子集不全时,非目标基金淡化(自动,无需手动锁定)
  const isTargetSubSet =
    newsTargetCodes != null && newsTargetCodes.length > 0 && newsTargetCodes.length < funds.length
  // 已选基金集合(无 newsTargetCodes 时视为全部 = 不淡化)
  const targetCodeSet = useMemo(
    () => (isTargetSubSet ? new Set(newsTargetCodes!) : null),
    [isTargetSubSet, newsTargetCodes]
  )

  if (funds.length === 0) {
    return <EmptyState message="添加基金后查看净值走势" />
  }
  const loadingFunds = funds.filter((f) => f.loading)
  // 'return' 模式：蛋卷数据加载中判定（未就绪且未失败）
  const growthPending =
    chartMode === 'return' &&
    funds.some(
      (f) => f.detail && !growthMap[`${f.code}:${day}`] && !growthErrors[`${f.code}:${day}`]
    )
  if ((loadingFunds.length > 0 && aligned.chartData.length === 0) || growthPending) {
    return (
      <EmptyState
        message={chartMode === 'return' ? '正在加载累计收益率数据...' : '正在加载净值数据...'}
      />
    )
  }
  if (aligned.chartData.length === 0) {
    return <EmptyState message="暂无数据" />
  }

  // 点击图表:优先从 activePayload 获取点击的基金 dataKey,否则 fallback 到 funds[0]
  // 点空白（无 activeLabel）时触发 onChartBlankClick（抽屉打开时关闭抽屉）
  // 交互冲突处理:
  //   1. 拖拽平移松手后的 click 不触发检索（dragMovedRef 抑制）
  //   2. 单击检索延迟 280ms 执行，双击重置时取消（避免双击误触发两次检索）
  const handleClick = (state: ClickEventState, e?: React.MouseEvent) => {
    // 拖拽产生的 click：吞掉
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    // 取消上一次待执行的单击（快速连点只执行最后一次）
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current)
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null
      if (!state || !state.activeLabel) {
        // 点空白：若提供了 onChartBlankClick 则触发
        if (onChartBlankClick) onChartBlankClick()
        return
      }
      const date = state.activeLabel as string
      let fundCode = ''
      // 从 activePayload 找到点击的数据系列(dataKey 即基金 code)，跳过基准虚线(_bench)
      if (state.activePayload && state.activePayload.length > 0) {
        const p = state.activePayload.find((x) => !String(x.dataKey).endsWith('_bench'))
        if (p) fundCode = p.dataKey as string
      }
      // fallback:无法确定时用 funds[0]
      if (!fundCode || !funds.some((f) => f.code === fundCode)) {
        fundCode = funds[0]?.code || ''
      }
      if (!fundCode) return
      // 单源决策由 App.tsx 内的 newsTargetCodes 完成;此处仅透传点击事件
      onPointClick(date, fundCode)
    }, 280)
  }

  return (
    <div className={mode === 'dark' ? 'glass-card-dark' : 'glass-card'} style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: '12px' }}>
      <style>{`@keyframes highlight-pulse { 0%, 100% { stroke-opacity: 0.4; } 50% { stroke-opacity: 0.9; } }`}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <span style={{ fontSize: '16px', fontWeight: 700, color: p.text0, letterSpacing: '-0.01em' }}>
            {chartMode === 'return' ? '累计收益率走势' : '净值走势'}
          </span>
          <span style={{ fontSize: '12px', color: p.text2, marginLeft: '10px' }}>
            {chartMode === 'return'
              ? '累计收益率（蛋卷口径·随区间重定基）· 虚线=业绩比较基准'
              : '绝对净值（元）'}{' '}
            · 点击曲线检索新闻 · 滚轮缩放 · 拖拽平移 · 双击重置
          </span>
        </div>
        {/* 缩放状态指示 + 重置按钮 */}
        {effectiveRange && (
          <button
            onClick={handleDblClick}
            style={{
              background: p.accentSoft,
              color: p.accent,
              border: `1px solid ${p.accent}44`,
              borderRadius: '4px',
              padding: '2px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 500,
              lineHeight: 1.4,
              whiteSpace: 'nowrap',
            }}
            title="重置为全量视图"
          >
            🔍 {viewDates.start} ~ {viewDates.end} · 双击图表重置
          </button>
        )}
      </div>
      <div style={{ height: '2px', background: `linear-gradient(90deg, ${p.accent}, transparent)`, marginBottom: '8px', borderRadius: '1px' }} />
      <div
        className={mode === 'dark' ? 'tech-grid-bg-dark' : 'tech-grid-bg'}
        ref={chartWrapRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDblClick}
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: '8px',
          cursor: draggingChart ? 'grabbing' : effectiveRange ? 'grab' : 'default',
          userSelect: draggingChart ? 'none' : undefined,
        }}
      >
        <ErrorBoundary>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={viewData}
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
              tickFormatter={(v) => (chartMode === 'return' ? `${v.toFixed(1)}%` : v.toFixed(2))}
            />
            <Tooltip content={<CustomTooltip funds={funds} chartMode={chartMode} />} />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              formatter={(value) => {
                // 基准虚线不进入图例
                if (String(value).endsWith('_bench')) return null
                const f = funds.find((x) => x.code === value)
                const name = f ? f.detail?.name || value : value
                const isInTarget = targetCodeSet == null || targetCodeSet.has(value as string)
                return (
                  <span
                    style={{
                      color: isInTarget ? p.text0 : p.text2,
                      fontWeight: isInTarget ? 500 : 400,
                      cursor: 'default',
                    }}
                    title={isInTarget ? '在检索组合中' : '不在检索组合中(显示为参考)'}
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
              .map((f) => {
                const isInTarget = targetCodeSet == null || targetCodeSet.has(f.code)
                const isOther = targetCodeSet != null && !targetCodeSet.has(f.code)
                return (
                  <Area
                    key={f.code}
                    type="monotone"
                    dataKey={f.code}
                    stroke={f.color}
                    strokeWidth={isInTarget ? 2 : 1.2}
                    strokeOpacity={isOther ? 0.3 : 1}
                    fill={`url(#grad-${f.code})`}
                    fillOpacity={isOther ? 0.3 : 1}
                    dot={false}
                    activeDot={{
                      r: isInTarget ? 4 : 2,
                      fill: f.color,
                      stroke: p.bg0,
                      strokeWidth: 2,
                    }}
                    isAnimationActive
                    animationDuration={600}
                    animationEasing="ease-out"
                    connectNulls
                  />
                )
              })}
            {/* 'return' 模式：每基金叠加业绩比较基准虚线（不占图例，点击时跳过） */}
            {chartMode === 'return' &&
              funds
                .filter((f) => f.detail)
                .map((f) => {
                  const isOther = targetCodeSet != null && !targetCodeSet.has(f.code)
                  return (
                    <Line
                      key={`${f.code}_bench`}
                      type="monotone"
                      dataKey={`${f.code}_bench`}
                      stroke={f.color}
                      strokeOpacity={isOther ? 0.15 : 0.45}
                      strokeWidth={1.2}
                      strokeDasharray="4 3"
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      isAnimationActive
                      animationDuration={600}
                      connectNulls
                    />
                  )
                })}
            {/* 用 Customized 安全渲染锚点标注：只有 xAxis/yAxis scale 就绪时才渲染 */}
            <Customized component={(props: CustomizedProps) => <AnchorMarks {...props} funds={funds} aligned={aligned} anchors={anchors} queryPoint={queryPoint} palette={p} highlightDate={highlightDate} onXScaleReady={onXScaleReady} />} />
          </ComposedChart>
        </ResponsiveContainer>
        </ErrorBoundary>
      </div>
      {/* 锚定新闻时间线：与图表 x 轴对齐，悬停/单击/拖动滑块均可交互 */}
      <NewsTimeline
        anchors={anchors}
        xStart={aligned.dates[0] || ''}
        xEnd={aligned.dates[aligned.dates.length - 1] || ''}
        xScale={xScaleRef.current ?? undefined}
        viewStart={viewDates.start}
        viewEnd={viewDates.end}
        onJumpTo={onJumpToAnchor}
        onRemove={onRemoveAnchor}
        onRangeChange={handleTimelineRange}
        listMode={listMode}
        onToggleListMode={onToggleListMode}
        onClearAllAnchors={onClearAllAnchors}
        anchorsCount={anchors.length}
      />
      {/* 全部清空确认 Modal：由 NavChartPanel 持有弹窗状态(以正确显示锚点数量) */}
      {onClearAllAnchors && (
        <Modal
          opened={!!clearAllConfirmOpen}
          onClose={() => onClearAllConfirmOpenChange?.(false)}
          title="确认清空所有锚点"
          centered
          size="sm"
        >
          <p style={{ fontSize: 13, color: p.text1, margin: '0 0 16px 0' }}>
            此操作将清除全部已锚定的 AI 分析报告(<b>{anchors.length}</b> 条),且不可撤销。是否继续?
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="subtle" size="sm" onClick={() => onClearAllConfirmOpenChange?.(false)}>
              取消
            </Button>
            <Button color="red" size="sm" onClick={onClearAllAnchors}>
              确认清空
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: TooltipPayload[]
  label?: string
  funds: LoadedFund[]
  chartMode: 'return' | 'nav'
}

function CustomTooltip({ active, payload, label, funds, chartMode }: TooltipProps) {
  const { palette: p } = useTheme()
  if (!active || !payload || payload.length === 0) return null
  // 分离主曲线(基金)与基准虚线(_bench)
  const main = payload
    .filter((pp) => !String(pp.dataKey).endsWith('_bench'))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  const benches = payload.filter((pp) => String(pp.dataKey).endsWith('_bench'))
  return (
    <div
      style={{
        background: p.tooltipBg,
        border: `1px solid ${p.borderLight}`,
        borderRadius: '8px',
        padding: '10px 12px',
        fontSize: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        maxWidth: '360px',
      }}
    >
      <div style={{ color: p.text1, marginBottom: '6px', fontWeight: 600 }}>{label}</div>
      {main.map((pp) => {
        const f = funds.find((x) => x.code === pp.dataKey)
        const bench = benches.find((b) => String(b.dataKey) === `${pp.dataKey}_bench`)
        return (
          <div key={pp.dataKey} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: pp.color }} />
            <span style={{ color: p.text1, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f?.detail?.name || pp.dataKey}
            </span>
            <span style={{ color: p.text0, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600 }}>
              {chartMode === 'return' ? `${pp.value?.toFixed(2)}%` : fmtNum(pp.value, 4)}
            </span>
            {bench && chartMode === 'return' && (
              <span style={{ color: p.text2, fontFamily: '"JetBrains Mono", monospace', fontSize: '11px' }}>
                基准 {bench.value?.toFixed(2)}%
              </span>
            )}
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
  // 把 Recharts 的 xAxis.scale 提升到 NavChartPanel 顶层，供 NewsTimeline 使用
  onXScaleReady?: (scale: (d: string) => number) => void
}

function AnchorMarks(props: AnchorMarksProps) {
  const { xAxisMap, yAxisMap, funds, aligned, anchors, queryPoint, palette: p, highlightDate, onXScaleReady } = props
  // funds 保留在 props 中以便未来扩展(如按基金颜色区分锚点)
  void funds
  if (!xAxisMap || !yAxisMap) return null
  const xAxis = xAxisMap[0]
  const yAxis = yAxisMap[0]
  if (!xAxis || !yAxis || !xAxis.scale || !yAxis.scale) return null

  const yScale = yAxis.scale
  const xScale = xAxis.scale
  // 把 xScale 提升到 NavChartPanel 顶层，使 NewsTimeline 可以像素级对齐图表
  if (onXScaleReady) onXScaleReady(xScale as (d: string) => number)
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
    // 圆点：有有效净值才画，旁边加 title 文字(优先用 summary，截断到 20 字符)
    if (val !== null) {
      const y = yScale!(val)
      if (isFinite(y)) {
        const baseText = a.summary || a.title
        const shortTitle = baseText.length > 20 ? baseText.slice(0, 20) + '…' : baseText
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
