// 净值图下方的时间轴组件
// 用于在 NavChartPanel 底部展示已锚定的 AI 分析报告，支持：
//   - 多基金色彩区分（按 series 索引）
//   - impact 着色（正/负/中性）
//   - 气泡避让（贪心扫描 + 最小水平间距 60px）
//   - 密集合并（>10 个锚点时合并相邻 <3 天的为"N 条"胶囊）
//   - 圆点缩小（>5 个锚点）
//   - 悬停 Tooltip（自实现，避免引入额外依赖）
//   - 单击触发 onJumpTo / 右键或 Tooltip 删除按钮触发 onRemove
//   - 双滑块范围缩放（双击空白处重置）
//   - 暗/亮色主题自动适配
//   - 无障碍（role/tabIndex/aria-label/Enter 键触发）
//
// Props:
//   - xScale 可选；不传时按 [xStart, xEnd] 均分映射到 canvas 宽度
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { AnchorNews } from '../storage'
import { useTheme } from '../ThemeContext'
import { Modal, Button } from '@mantine/core'

export interface NewsTimelineProps {
  anchors: AnchorNews[]
  xStart: string // YYYY-MM-DD
  xEnd: string // YYYY-MM-DD
  xScale?: (date: string) => number // 可选：父图表传入的 Recharts xScale(date) -> pixel
  // 【缩放联动】父图表当前可视日期区间（受控）；未传时滑块自治（兼容旧用法）
  viewStart?: string
  viewEnd?: string
  onJumpTo?: (date: string, anchorId: string) => void
  onRemove?: (anchorId: string) => void
  onRangeChange?: (start: string, end: string) => void
  // 【列表模式】true=列表视图 / false=时间轴视图
  listMode?: boolean
  // 【列表模式】切换回调
  onToggleListMode?: () => void
  // 【全部清空】清空回调
  onClearAllAnchors?: () => void
  // 【全部清空】锚点数量(由父组件透传,用于决定工具栏按钮可见性)
  anchorsCount?: number
}

// 内部数据结构：合并/避让后的一组锚点 + 渲染位置 + 方向
interface AnchorGroup {
  items: AnchorNews[]
  date: string
}

interface Placement {
  group: AnchorGroup
  x: number
  dir: 'up' | 'down'
  text: string
  width: number
  layer: number  // 0=最靠近 baseline, 1=上一级, 以此类推
}

// 气泡每层占用 28px(22px 气泡 + 6px 间距)
const BUBBLE_LAYER_HEIGHT = 28
const BUBBLE_HEIGHT = 22
// 基础高度(0 层气泡时的 canvas 高度)
const CANVAS_BASE_HEIGHT = 140
// 每层增加的高度
const LAYER_HEIGHT_STEP = 28
// 最多 4 层(超过自动转列表模式)
const MAX_LAYERS = 4
const MIN_SPACING = 60
// 动态计算的 canvas 高度(N 层布局)
const getCanvasHeight = (layers: number) =>
  CANVAS_BASE_HEIGHT + Math.min(layers, MAX_LAYERS) * LAYER_HEIGHT_STEP
const DENSE_THRESHOLD = 5
const MERGE_THRESHOLD = 10
const MERGE_GAP_DAYS = 3
// 【Phase 3/4 增强】列表模式建议阈值 / 极小宽度 / 悬停透明度
const SUGGEST_LIST_MODE_THRESHOLD = 50
const NARROW_WIDTH_THRESHOLD = 400
const HOVER_HIGHLIGHT_OPACITY = 0.35
// 【Phase 2 增强】悬停离开延迟(给用户移到 Tooltip 的缓冲)
const HOVER_LEAVE_DELAY_MS = 200

const dateToTs = (s: string): number => new Date(s + 'T00:00:00').getTime()
const dayDiff = (a: string, b: string): number =>
  Math.round((dateToTs(b) - dateToTs(a)) / 86400000)
const pad = (n: number): string => String(n).padStart(2, '0')

function impactLabel(imp?: string): string {
  if (imp === 'positive') return '正面'
  if (imp === 'negative') return '负面'
  return '中性'
}

// 按基金 code 分配 series 索引（与 NavChartPanel 保持一致：使用 seriesColor 循环）
// 缓存以保证同一基金在多次渲染中颜色稳定
function buildFundIndexMap(anchors: AnchorNews[]): Map<string, number> {
  const map = new Map<string, number>()
  let idx = 0
  for (const a of anchors) {
    if (!map.has(a.fundCode)) {
      map.set(a.fundCode, idx++)
    }
  }
  return map
}

// 合并相邻 < MERGE_GAP_DAYS 天的锚点（仅在锚点 > MERGE_THRESHOLD 时触发）
function mergeCloseAnchors(anchors: AnchorNews[]): { groups: AnchorGroup[]; merged: boolean } {
  if (anchors.length <= MERGE_THRESHOLD) {
    return { groups: anchors.map((a) => ({ items: [a], date: a.date })), merged: false }
  }
  const sorted = [...anchors].sort((a, b) => dateToTs(a.date) - dateToTs(b.date))
  const groups: AnchorGroup[] = []
  let cur: AnchorGroup | null = null
  for (const a of sorted) {
    if (cur && dayDiff(cur.date, a.date) < MERGE_GAP_DAYS && cur.items[0].fundCode === a.fundCode) {
      cur.items.push(a)
      cur.date = a.date
    } else {
      cur = { items: [a], date: a.date }
      groups.push(cur)
    }
  }
  return { groups, merged: true }
}

// 气泡避让:N 层贪心扫描,维护每层右边缘;超密时自动启用极简文本
// 极简模式: 气泡只显示 [影响符号][基金代码],Tooltip 显示完整内容
function placeBubbles(
  groups: AnchorGroup[],
  xScaleFn: (d: string) => number,
  totalAnchors: number
): Placement[] {
  const placements: Placement[] = []
  // 极简模式:锚点数 >= 8 启用(避免气泡太宽)
  const compactMode = totalAnchors >= 8
  // 每层最后一个气泡的右边缘(x + width/2)
  const layerLastRight: number[] = []

  for (const g of groups) {
    const x = xScaleFn(g.date)
    const sample = g.items[0]
    const isMerged = g.items.length > 1
    // 真实估算宽度:含影响符号(2ch) + 圆点(10px) + 文本 + 基金代码(6ch) + padding
    let text: string
    let width: number
    if (isMerged) {
      text = `${g.items.length} 条`
      width = Math.max(40, text.length * 12 + 36)
    } else if (compactMode) {
      // 极简: 文本截断到 4 字 + 基金代码 6 字 ≈ 10 字
      const rawText = sample.summary || sample.title.slice(0, 4) || '锚点'
      text = rawText.slice(0, 4)
      // 圆点(6) + 间距(4) + 符号(10) + 间距(4) + 文本(48) + 间距(2) + code(36) + padding(16) = 126
      width = 126
    } else {
      text = sample.summary || sample.title.slice(0, 8) || '锚点'
      // 完整模式: 圆点(6) + 间距(4) + 符号(10) + 间距(4) + 文本(text.length*12) + 间距(2) + code(36) + padding(16)
      width = Math.max(60, 78 + text.length * 12)
    }

    // 贪心找放得下的层(layer 0 = 离 baseline 最近)
    let chosenLayer = 0
    while (chosenLayer < layerLastRight.length) {
      if (x - layerLastRight[chosenLayer] >= MIN_SPACING) break
      chosenLayer++
    }
    if (chosenLayer >= layerLastRight.length) {
      layerLastRight.push(-Infinity)
    }
    layerLastRight[chosenLayer] = x + width / 2

    // dir: layer 偶数=up(在 baseline 上方),奇数=down(在 baseline 下方)
    // 视觉上,每个 layer 增加 28px 高度(气泡 22px + 间距 6px)
    const dir: 'up' | 'down' = chosenLayer % 2 === 0 ? 'up' : 'down'
    placements.push({ group: g, x, dir, text, width, layer: chosenLayer })
  }
  return placements
}

export function NewsTimeline({
  anchors,
  xStart,
  xEnd,
  xScale,
  viewStart,
  viewEnd,
  onJumpTo,
  onRemove,
  onRangeChange,
  listMode,
  onToggleListMode,
  onClearAllAnchors,
  anchorsCount,
}: NewsTimelineProps) {
  const { palette: p } = useTheme()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  // 拖拽状态（'left'/'right' 手柄），滑块联动逻辑依赖，需先声明
  const [dragging, setDragging] = useState<null | 'left' | 'right'>(null)
  // 【缩放联动】滑块百分比：viewStart/viewEnd 受控优先；拖拽中用本地值即时反馈
  const isControlled = viewStart !== undefined && viewEnd !== undefined
  const controlledLeftPct = useMemo(() => {
    if (!isControlled || !viewStart) return 0
    const total = dateToTs(xEnd) - dateToTs(xStart)
    if (total <= 0) return 0
    return Math.max(0, Math.min(100, ((dateToTs(viewStart) - dateToTs(xStart)) / total) * 100))
  }, [isControlled, viewStart, xStart, xEnd])
  const controlledRightPct = useMemo(() => {
    if (!isControlled || !viewEnd) return 100
    const total = dateToTs(xEnd) - dateToTs(xStart)
    if (total <= 0) return 100
    return Math.max(0, Math.min(100, ((dateToTs(viewEnd) - dateToTs(xStart)) / total) * 100))
  }, [isControlled, viewEnd, xStart, xEnd])
  // 本地拖拽值（非受控模式或拖拽中生效）
  const [localLeftPct, setLocalLeftPct] = useState(0)
  const [localRightPct, setLocalRightPct] = useState(100)
  // 拖拽结束时的最终值（松手后读取上报 onRangeChange）
  const dragFinalRef = useRef<{ left: number; right: number } | null>(null)
  // 受控模式下：外部 view 变化时同步本地值（注意：此时绝不触发 onRangeChange，
  // 否则父组件 handleTimelineRange 回写区间 -> 索引舍入 -> viewDates 微漂移 ->
  // controlledPct 又变 -> 再上报 -> 无限循环（Maximum update depth exceeded）
  useEffect(() => {
    if (!isControlled || dragging !== null) return
    setLocalLeftPct(controlledLeftPct)
    setLocalRightPct(controlledRightPct)
  }, [isControlled, controlledLeftPct, controlledRightPct, dragging])
  const leftPct = dragging !== null ? localLeftPct : isControlled ? controlledLeftPct : localLeftPct
  const rightPct = dragging !== null ? localRightPct : isControlled ? controlledRightPct : localRightPct
  const setLeftPct = setLocalLeftPct
  const setRightPct = setLocalRightPct
  const [hovered, setHovered] = useState<{ placement: Placement; clientX: number; clientY: number } | null>(null)
  // 【Phase 2 增强】悬停基金:用于同基金关联高亮 + 其他基金淡化
  const [hoveredFundCode, setHoveredFundCode] = useState<string | null>(null)
  // 【精准高亮】唯一标识当前 hover 的气泡(placements 索引),只有这一个气泡会高亮
  // 同基金联动仅通过虚线表达,不再让其他气泡一起高亮(避免"误高亮"误解)
  const [hoveredPlacementIdx, setHoveredPlacementIdx] = useState<number | null>(null)
  // 【Phase 3 增强】本地"全部清空"确认弹窗(避免与父级 state 冲突)
  const [clearConfirmOpenLocal, setClearConfirmOpenLocal] = useState(false)
  // 【Phase 2 增强】悬停离开延迟定时器
  const hoverLeaveTimerRef = useRef<number | null>(null)
  const lastRangeEmittedRef = useRef<{ start: string; end: string } | null>(null)

  // 观察 canvas 宽度变化（窗口缩放、tab 切换等）
  useLayoutEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setWidth(w)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 基金索引映射（用于分配 series 颜色）
  const fundIdxMap = useMemo(() => buildFundIndexMap(anchors), [anchors])

  // xScale：优先用 prop；否则按 canvas 宽度均分
  const xScaleFn = useCallback(
    (d: string): number => {
      if (xScale) {
        try {
          return xScale(d)
        } catch {
          // 父级 xScale 可能在某些生命周期点抛错，回退到均分
        }
      }
      if (width <= 0) return 0
      const total = dateToTs(xEnd) - dateToTs(xStart)
      if (total <= 0) return 0
      return Math.max(0, Math.min(width, ((dateToTs(d) - dateToTs(xStart)) / total) * width))
    },
    [xScale, width, xStart, xEnd]
  )

  // 合并 + 避让
  const { groups } = useMemo(
    () => mergeCloseAnchors(anchors),
    [anchors]
  )
  const placements = useMemo(
    () => placeBubbles(groups, xScaleFn, anchors.length),
    [groups, xScaleFn, anchors.length]
  )

  // 【N 层布局】最大层数 + 动态 canvas 高度
  const maxLayer = useMemo(
    () => placements.reduce((m, p) => Math.max(m, p.layer), 0),
    [placements]
  )
  const canvasHeight = getCanvasHeight(maxLayer)
  // 关键位置基于动态高度(原常量被替代,渲染处需用这些变量)
  const baselineTop = canvasHeight - 60  // baseline 距顶部 = 总高 - 60
  const dotTop = baselineTop - 6
  const rangeTrackTop = canvasHeight - 6
  const rangeHintTop = canvasHeight + 8
  const tickLabelTop = baselineTop + 8
  // ticks 自身动态计算:tick 短线从 baselineTop + 8 开始往下
  const tickTop = baselineTop + 8

  const dense = groups.length > DENSE_THRESHOLD

  // 刻度：按 canvas 宽度自适应步长, 避免过密；季度起点 major, 今天高亮
  const ticks = useMemo(() => {
    if (width <= 0) return []
    const result: { x: number; label: string; isMajor: boolean; isToday: boolean }[] = []
    const totalDays = Math.max(1, dayDiff(xStart, xEnd))
    // 最小水平间距:画布越宽,容许的密度越高;但下限 70px 避免密集
    const minSpacing = width < 500 ? 90 : width < 900 ? 75 : 60
    // 候选步长:1月/2月/季/半年/1年/2年/5年(覆盖 30 天 ~ 50 年)
    const stepCandidates = [1, 2, 3, 6, 12, 24, 60]
    let stepMonths = stepCandidates[stepCandidates.length - 1] // 默认 5 年,避免极端区间溢出
    for (const s of stepCandidates) {
      const tickCount = (totalDays / 30) / s
      const needWidth = tickCount * minSpacing
      if (needWidth <= width) { stepMonths = s; break }
    }
    const sY = parseInt(xStart.slice(0, 4), 10)
    const eY = parseInt(xEnd.slice(0, 4), 10)
    const today = new Date().toISOString().slice(0, 10)
    const todayY = parseInt(today.slice(0, 4), 10)
    const todayM = parseInt(today.slice(5, 7), 10)
    for (let y = sY; y <= eY; y++) {
      for (let m = 1; m <= 12; m += stepMonths) {
        const d = `${y}-${pad(m)}-15`
        if (d < xStart || d > xEnd) continue
        const x = xScaleFn(d)
        if (!isFinite(x)) continue
        const isMajor = stepMonths === 1 ? (m === 1 || m === 4 || m === 7 || m === 10) : true
        const isToday = today >= xStart && today <= xEnd && y === todayY && m === todayM
        const label = stepMonths >= 3 ? `${y}` : isMajor ? `${y}.${pad(m)}` : `${pad(m)}`
        result.push({ x, label, isMajor, isToday })
      }
    }
    return result
  }, [width, xStart, xEnd, xScaleFn])

  // 每个基金在当前 anchors 中累计的条数(用于 Tooltip 同基金统计)
  const fundCountMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of anchors) m.set(a.fundCode, (m.get(a.fundCode) ?? 0) + 1)
    return m
  }, [anchors])

  // 滑块拖拽：onMove 更新本地值并记录最终值；onUp 结束拖拽
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent | TouchEvent) => {
      const track = rootRef.current?.querySelector('.nt-range-track') as HTMLElement | null
      if (!track) return
      const rect = track.getBoundingClientRect()
      const clientX = 'touches' in e ? e.touches[0]?.clientX : (e as MouseEvent).clientX
      if (clientX == null) return
      let pct = ((clientX - rect.left) / rect.width) * 100
      pct = Math.max(0, Math.min(100, pct))
      if (dragging === 'left') {
        const nextLeft = Math.min(pct, rightPct - 2)
        setLocalLeftPct(nextLeft)
        dragFinalRef.current = { left: nextLeft, right: rightPct }
      } else {
        const nextRight = Math.max(pct, leftPct + 2)
        setLocalRightPct(nextRight)
        dragFinalRef.current = { left: leftPct, right: nextRight }
      }
    }
    const onUp = () => {
      setDragging(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('mouseup', onUp)
    document.addEventListener('touchend', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.removeEventListener('touchend', onUp)
    }
  }, [dragging, leftPct, rightPct])

  // 拖拽结束（dragging -> null）时上报一次用户调整的范围
  // 受控模式下也只在此时上报；受控值被动变化绝不触发（避免反馈循环）
  useEffect(() => {
    if (dragging !== null) return
    const final = dragFinalRef.current
    dragFinalRef.current = null
    if (!final) return
    const { left, right } = final
    if (left === 0 && right === 100) {
      onRangeChange?.(xStart, xEnd)
      return
    }
    const startTs = dateToTs(xStart)
    const endTs = dateToTs(xEnd)
    const start = new Date(startTs + (endTs - startTs) * (left / 100)).toISOString().slice(0, 10)
    const end = new Date(startTs + (endTs - startTs) * (right / 100)).toISOString().slice(0, 10)
    onRangeChange?.(start, end)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  // 双击空白处重置（受控模式下同时通知父组件）
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (
      target.closest('.nt-dot') ||
      target.closest('.nt-range-handle') ||
      target.closest('.nt-tooltip')
    ) {
      return
    }
    setLocalLeftPct(0)
    setLocalRightPct(100)
    if (isControlled && (localLeftPct !== 0 || localRightPct !== 100)) {
      lastRangeEmittedRef.current = { start: xStart, end: xEnd }
      onRangeChange?.(xStart, xEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, localLeftPct, localRightPct, xStart, xEnd, onRangeChange])

  // 圆点单击
  const handleDotClick = useCallback(
    (placement: Placement, e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation()
      const a = placement.group.items[0]
      onJumpTo?.(placement.group.date, a.id)
    },
    [onJumpTo]
  )

  // 圆点右键删除
  const handleDotContextMenu = useCallback(
    (placement: Placement, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!onRemove) return
      // 移除该组所有锚点
      for (const it of placement.group.items) {
        onRemove(it.id)
      }
    },
    [onRemove]
  )

  // 圆点/气泡悬停
  // 【精准高亮】只对当前 placement 索引高亮(避免"同基金联动"被误解为 bug)
  // 【同基金虚线】仍保留联动(让用户能识别"这 2 个气泡同属一个基金")
  const handleDotEnter = useCallback(
    (placement: Placement, e: React.MouseEvent, idx: number) => {
      // 取消离开延迟(用户从 tooltip 移回)
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current)
        hoverLeaveTimerRef.current = null
      }
      const target = e.currentTarget as HTMLElement
      const rect = target.getBoundingClientRect()
      setHovered({
        placement,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top,
      })
      // 精准高亮:仅这个气泡高亮(用 hoveredPlacementIdx 标记 placement 索引)
      setHoveredPlacementIdx(idx)
      // 同基金关联:仅用于虚线连接(不影响其他气泡高亮)
      const sample = placement.group.items[0]
      setHoveredFundCode(sample.fundCode)
    },
    []
  )
  // 【Phase 2 增强】延迟 200ms 清除,给用户移入 Tooltip 的缓冲
  const handleDotLeave = useCallback((e: React.MouseEvent) => {
    const next = e.relatedTarget as Element | null
    // 防御:relatedTarget 可能为 null 或非 Element(浏览器外、SVG 等)
    if (next && typeof next.closest === 'function') {
      try {
        if (next.closest('.nt-tooltip') || next.closest('.nt-dot') || next.closest('.nt-bubble')) {
          return
        }
      } catch {
        // closest 抛错时按离开处理
      }
    }
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
    }
    hoverLeaveTimerRef.current = window.setTimeout(() => {
      setHovered(null)
      // 清理精准高亮 hoveredPlacementIdx
      setHoveredPlacementIdx(null)
      hoverLeaveTimerRef.current = null
    }, HOVER_LEAVE_DELAY_MS)
  }, [])

  // Tooltip 内部删除按钮
  const handleTooltipRemove = useCallback(() => {
    if (!hovered || !onRemove) return
    for (const it of hovered.placement.group.items) {
      onRemove(it.id)
    }
    setHovered(null)
  }, [hovered, onRemove])

  // Tooltip 内部跳转按钮
  const handleTooltipJump = useCallback(() => {
    if (!hovered || !onJumpTo) return
    const a = hovered.placement.group.items[0]
    onJumpTo(hovered.placement.group.date, a.id)
    setHovered(null)
  }, [hovered, onJumpTo])

  // 渲染 Tooltip 位置（避免溢出视口）
  const tooltipPos = useMemo(() => {
    if (!hovered) return null
    const tw = 260
    const th = 130
    let left = hovered.clientX + 12
    let top = hovered.clientY - th - 8
    if (typeof window !== 'undefined') {
      if (left + tw > window.innerWidth - 8) left = hovered.clientX - tw - 12
      if (top < 8) top = hovered.clientY + 16
    }
    return { left, top }
  }, [hovered])

  // 【Phase 4 边界 E.2】极小宽度自动启用列表模式
  // 实际锚点数量或宽度满足任一即开启:避免气泡在极窄屏完全无法显示
  // 【N 层布局】超过 MAX_LAYERS 时强制列表模式(否则层数太多视觉不可读)
  const effectiveListMode =
    !!listMode ||
    (width > 0 && width < NARROW_WIDTH_THRESHOLD) ||
    maxLayer >= MAX_LAYERS

  // 【Phase 2 同基金关联】计算悬停基金的所有 placement 配对虚线
  const sameFundLines = useMemo(() => {
    if (!hoveredFundCode) return [] as { x1: number; x2: number; y1: number; y2: number }[]
    const sameFundPlacements = placements
      .filter((pl) => pl.group.items[0].fundCode === hoveredFundCode)
      .sort((a, b) => a.x - b.x)
    const lines: { x1: number; x2: number; y1: number; y2: number }[] = []
    for (let i = 0; i < sameFundPlacements.length - 1; i++) {
      const a = sameFundPlacements[i]
      const b = sameFundPlacements[i + 1]
      lines.push({ x1: a.x, x2: b.x, y1: dotTop + 4, y2: dotTop + 4 })
    }
    return lines
  }, [hoveredFundCode, placements])

  if (anchors.length === 0) return null

  // 【Phase 3 列表模式】分支: 列表 / 时间轴
  if (effectiveListMode) {
    return (
      <div
        ref={rootRef}
        className="nt-root nt-list-mode"
        style={{
          position: 'relative',
          marginTop: -1,
          padding: '0',
          background: p.bg1,
          border: `1px solid ${p.border}`,
          borderRadius: '0 0 8px 8px',
        }}
      >
        {/* 列表模式顶部工具栏: 列表标题 + 切换按钮 + 全部清空 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 12px',
            borderBottom: `1px solid ${p.border}`,
            background: p.bg2,
          }}
        >
          <span style={{ fontSize: 11, color: p.text2 }}>
            📋 列表视图 · 共 <b style={{ color: p.text0 }}>{anchorsCount ?? anchors.length}</b> 条锚定报告
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {onToggleListMode && (
              <button
                onClick={onToggleListMode}
                style={{
                  background: p.bg1, border: `1px solid ${p.border}`, borderRadius: 4,
                  padding: '2px 8px', fontSize: 10, color: p.text1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
                title="切回时间轴视图"
              >
                📊 时间轴
              </button>
            )}
            {onClearAllAnchors && (anchorsCount ?? anchors.length) > 0 && (
              <button
                onClick={() => setClearConfirmOpenLocal(true)}
                style={{
                  background: 'transparent', border: `1px solid ${p.impactNegative}33`,
                  borderRadius: 4, padding: '2px 8px', fontSize: 10, color: p.impactNegative,
                  cursor: 'pointer',
                }}
                title="清空所有锚点"
              >
                🗑 全部清空
              </button>
            )}
          </div>
        </div>
        {/* 紧凑表格 */}
        <div style={{ padding: '8px 12px', maxHeight: 240, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${p.border}` }}>
                <th style={{ textAlign: 'left', padding: '4px 6px', color: p.text2, fontWeight: 500 }}>日期</th>
                <th style={{ textAlign: 'left', padding: '4px 6px', color: p.text2, fontWeight: 500 }}>简述</th>
                <th style={{ textAlign: 'left', padding: '4px 6px', color: p.text2, fontWeight: 500 }}>基金</th>
                <th style={{ textAlign: 'left', padding: '4px 6px', color: p.text2, fontWeight: 500 }}>影响</th>
                <th style={{ textAlign: 'right', padding: '4px 6px', color: p.text2, fontWeight: 500 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {[...anchors]
                .sort((a, b) => dateToTs(b.date) - dateToTs(a.date))
                .map((a) => {
                  const seriesIdx = fundIdxMap.get(a.fundCode) ?? 0
                  const seriesColorVal = p.series[seriesIdx % p.series.length]
                  const impactColor =
                    a.impact === 'positive'
                      ? p.impactPositive
                      : a.impact === 'negative'
                        ? p.impactNegative
                        : p.impactNeutral
                  return (
                    <tr
                      key={a.id}
                      style={{ borderBottom: `1px solid ${p.border}22` }}
                    >
                      <td style={{ padding: '6px', color: p.text1, fontVariantNumeric: 'tabular-nums' }}>
                        {a.date}
                      </td>
                      <td
                        style={{
                          padding: '6px',
                          color: p.text0,
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={a.summary || a.title}
                      >
                        {a.summary || a.title}
                      </td>
                      <td style={{ padding: '6px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span
                            style={{
                              width: 6, height: 6, borderRadius: '50%',
                              background: seriesColorVal,
                            }}
                          />
                          <span style={{ color: p.text1, fontSize: 10 }}>{a.fundCode}</span>
                        </span>
                      </td>
                      <td style={{ padding: '6px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '1px 6px',
                            borderRadius: 8,
                            background: `${impactColor}22`,
                            color: impactColor,
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          {a.impact === 'positive'
                            ? '↑ 正面'
                            : a.impact === 'negative'
                              ? '↓ 负面'
                              : '− 中性'}
                        </span>
                      </td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>
                        {onJumpTo && (
                          <button
                            onClick={() => onJumpTo(a.date, a.id)}
                            style={{
                              background: 'transparent', border: 'none',
                              color: p.accent, cursor: 'pointer',
                              fontSize: 11, marginRight: 8,
                            }}
                          >
                            跳转
                          </button>
                        )}
                        {onRemove && (
                          <button
                            onClick={() => onRemove(a.id)}
                            style={{
                              background: 'transparent', border: 'none',
                              color: p.impactNegative, cursor: 'pointer',
                              fontSize: 11,
                            }}
                          >
                            删除
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        {/* 列表模式本地 Modal: 全部清空二次确认 */}
        {onClearAllAnchors && (
          <Modal
            opened={clearConfirmOpenLocal}
            onClose={() => setClearConfirmOpenLocal(false)}
            title="确认清空所有锚点"
            centered
            size="sm"
          >
            <p style={{ fontSize: 13, color: p.text1, margin: '0 0 16px 0' }}>
              此操作将清除全部已锚定的 AI 分析报告(<b>{anchorsCount ?? anchors.length}</b> 条),且不可撤销。是否继续?
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button variant="subtle" size="sm" onClick={() => setClearConfirmOpenLocal(false)}>
                取消
              </Button>
              <Button
                color="red"
                size="sm"
                onClick={() => {
                  onClearAllAnchors()
                  setClearConfirmOpenLocal(false)
                }}
              >
                确认清空
              </Button>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="nt-root"
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'relative',
        marginTop: -1,
        padding: '10px',
        overflowX: 'auto',
        overflowY: 'hidden',
        background: p.bg1,
        border: `1px solid ${p.border}`,
        borderRadius: '0 0 8px 8px',
      }}
    >
      <div
        ref={canvasRef}
        className="nt-canvas"
        style={{
          position: 'relative',
          minWidth: '100%',
          height: canvasHeight,
        }}
      >
        {/* 【Phase 3 工具栏】列表模式切换 + 全部清空 (双模式可触达) */}
        <div
          style={{
            position: 'absolute', top: 4, right: 8, zIndex: 5,
            display: 'flex', gap: 6,
          }}
        >
          {onToggleListMode && (anchorsCount ?? anchors.length) > 0 && (
            <button
              onClick={onToggleListMode}
              style={{
                background: p.bg2, border: `1px solid ${p.border}`, borderRadius: 4,
                padding: '2px 8px', fontSize: 10, color: p.text1, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
              title="切到列表视图(便于密集锚点浏览)"
            >
              📋 列表
            </button>
          )}
          {onClearAllAnchors && (anchorsCount ?? anchors.length) > 0 && (
            <button
              onClick={() => setClearConfirmOpenLocal(true)}
              style={{
                background: 'transparent', border: `1px solid ${p.impactNegative}33`,
                borderRadius: 4, padding: '2px 8px', fontSize: 10, color: p.impactNegative,
                cursor: 'pointer',
              }}
              title="清空所有锚点"
            >
              🗑 全部清空
            </button>
          )}
        </div>
        {/* 【Phase 3 建议开启列表模式】banner (50+ 锚点时显示) */}
        {(anchorsCount ?? anchors.length) >= SUGGEST_LIST_MODE_THRESHOLD && !listMode && onToggleListMode && (
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              background: `${p.accent}11`, borderBottom: `1px solid ${p.accent}33`,
              padding: '4px 12px', fontSize: 11, color: p.text1, zIndex: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span>
              检测到 <b style={{ color: p.text0 }}>{anchorsCount ?? anchors.length}</b> 个锚点,标签可能重叠,推荐使用列表模式
            </span>
            <button
              onClick={onToggleListMode}
              style={{
                background: p.accent, color: '#fff', border: 'none', borderRadius: 3,
                padding: '2px 10px', fontSize: 11, cursor: 'pointer',
              }}
            >
              开启列表模式
            </button>
          </div>
        )}
        {/* 主横线 */}
        <div
          className="nt-baseline"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: baselineTop,
            height: 1,
            background: p.borderLight,
          }}
        />
        {/* 【Phase 2 同基金关联虚线】SVG overlay 层(在 ticks 之上, 圆点/气泡之下) */}
        {hoveredFundCode && sameFundLines.length > 0 && (
          <svg
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 1,
            }}
          >
            {sameFundLines.map((ln, i) => (
              <line
                key={`link-${i}`}
                x1={ln.x1} y1={ln.y1} x2={ln.x2} y2={ln.y2}
                stroke={p.text2}
                strokeWidth={1}
                strokeDasharray="1 4"
                opacity={0.35}
              />
            ))}
          </svg>
        )}
        {/* 刻度: 主要刻度(major) 显示文字, 次要只画短竖线；今天日期加粗主色 + 圆点 */}
        {ticks.map((t, i) => (
          <div key={`tick-${i}`}>
            <div
              style={{
                position: 'absolute',
                top: tickTop,
                left: t.x,
                width: 1,
                height: t.isMajor ? 8 : 4,
                background: t.isToday ? p.accent : p.borderLight,
                opacity: t.isToday ? 1 : (t.isMajor ? 0.9 : 0.4),
              }}
            />
            {t.isMajor && (
              <div
                style={{
                  position: 'absolute',
                  top: tickLabelTop,
                  left: t.x,
                  transform: 'translateX(-50%)',
                  fontSize: 10,
                  color: t.isToday ? p.accent : p.text2,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                  fontWeight: t.isToday ? 700 : 500,
                }}
              >
                {t.label}
              </div>
            )}
            {t.isToday && (
              <div
                title="今天"
                style={{
                  position: 'absolute',
                  top: tickLabelTop + 12,
                  left: t.x,
                  transform: 'translateX(-50%)',
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: p.accent,
                }}
              />
            )}
          </div>
        ))}
        {/* 圆点 + 气泡 */}
        {placements.map((pl, i) => {
          const sample = pl.group.items[0]
          const seriesIdx = fundIdxMap.get(sample.fundCode) ?? 0
          const seriesColorVal = p.series[seriesIdx % p.series.length]
          const isMerged = pl.group.items.length > 1
          const impactColor =
            sample.impact === 'positive'
              ? p.impactPositive
              : sample.impact === 'negative'
                ? p.impactNegative
                : p.impactNeutral
          const dotSize = dense && !isMerged ? 8 : 12
          const dotMarginLeft = -(dotSize / 2)
          // 【精准高亮】仅当前 placement 索引对应气泡高亮(避免"同基金联动"被误认为 bug)
          // 其他气泡的视觉反馈由"同基金虚线"表达,不通过淡化背景干扰用户
          const isHovered = hoveredPlacementIdx === i
          const isOther = false  // 关闭"其他基金淡化"以避免误高亮感
          const ariaLabel = `${pl.group.date} ${
            sample.summary || sample.title.slice(0, 20)
          } 影响${impactLabel(sample.impact)}${
            isMerged ? ` 共 ${pl.group.items.length} 条` : ''
          }`

          return (
            <div key={`pl-${i}`}>
              {/* 气泡：影响符号 + 简述 + 基金代码(3 维数据, 紧凑单行) */}
              <div
                className={`nt-bubble ${pl.dir}`}
                role="button"
                tabIndex={0}
                aria-label={ariaLabel}
                onClick={(e) => handleDotClick(pl, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleDotClick(pl, e)
                  }
                }}
                onContextMenu={(e) => handleDotContextMenu(pl, e)}
                onMouseEnter={(e) => handleDotEnter(pl, e, i)}
                onMouseLeave={handleDotLeave}
                onFocus={(e) => handleDotEnter(pl, e as unknown as React.MouseEvent, i)}
                onBlur={() => {
                  setHovered(null)
                  // 气泡失焦:清理 hoveredPlacementIdx
                  setHoveredPlacementIdx(null)
                }}
                style={{
                  position: 'absolute',
                  top: pl.dir === 'up'
                    ? Math.max(8, baselineTop - 8 - (pl.layer + 1) * BUBBLE_LAYER_HEIGHT)
                    : baselineTop + 8 + pl.layer * BUBBLE_LAYER_HEIGHT,
                  left: pl.x,
                  transform: isHovered ? 'translateX(-50%) scale(1.05)' : 'translateX(-50%)',
                  background: p.bg1,
                  border: isHovered ? `1.5px solid ${p.accent}` : `1px solid ${p.border}`,
                  borderRadius: 6,
                  padding: '3px 8px',
                  fontSize: 11,
                  fontWeight: 500,
                  color: p.text0,
                  whiteSpace: 'nowrap',
                  boxShadow: isHovered
                    ? `0 0 0 2px ${p.accent}22, 0 2px 6px rgba(0,0,0,0.10)`
                    : '0 1px 2px rgba(0,0,0,0.06)',
                  zIndex: isHovered ? 4 : 1,
                  pointerEvents: 'auto',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  opacity: isOther ? HOVER_HIGHLIGHT_OPACITY : 1,
                  transition: 'opacity 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: seriesColorVal,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    color: impactColor,
                    fontWeight: 700,
                    fontSize: 10,
                    marginRight: 1,
                  }}
                >
                  {sample.impact === 'positive' ? '↑' : sample.impact === 'negative' ? '↓' : '−'}
                </span>
                <span>{pl.text}</span>
                <span
                  style={{
                    color: p.text2,
                    fontSize: 10,
                    marginLeft: 2,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {sample.fundCode}
                </span>
              </div>
              {/* 圆点 */}
              <div
                className={`nt-dot impact-${sample.impact || 'neutral'} ${
                  dense && !isMerged ? 'dense' : ''
                } ${isMerged ? 'merged' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={ariaLabel}
                onClick={(e) => handleDotClick(pl, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleDotClick(pl, e)
                  }
                }}
                onContextMenu={(e) => handleDotContextMenu(pl, e)}
                onMouseEnter={(e) => handleDotEnter(pl, e, i)}
                onMouseLeave={handleDotLeave}
                onFocus={(e) => handleDotEnter(pl, e as unknown as React.MouseEvent, i)}
                onBlur={() => {
                  setHovered(null)
                  // 圆点失焦:清理 hoveredPlacementIdx
                  setHoveredPlacementIdx(null)
                }}
                style={{
                  position: 'absolute',
                  top: dotTop,
                  left: pl.x,
                  width: isMerged ? 22 : dotSize,
                  height: isMerged ? 12 : dotSize,
                  marginLeft: isMerged ? -11 : dotMarginLeft,
                  borderRadius: isMerged ? 6 : '50%',
                  background: impactColor,
                  border: `2px solid ${p.bg1}`,
                  boxShadow: `0 0 0 1px ${seriesColorVal}, 0 1px 2px rgba(0,0,0,0.10)`,
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
                  zIndex: 2,
                  opacity: isOther ? HOVER_HIGHLIGHT_OPACITY : 1,
                }}
                onMouseOver={(e) => {
                  const el = e.currentTarget
                  el.style.transform = 'scale(1.35)'
                  el.style.boxShadow = `0 0 0 2px ${p.accent}, 0 0 0 5px ${p.accentDim}`
                }}
                onMouseOut={(e) => {
                  const el = e.currentTarget
                  el.style.transform = 'scale(1)'
                  el.style.boxShadow = `0 0 0 1px ${seriesColorVal}, 0 1px 2px rgba(0,0,0,0.10)`
                }}
              >
                {isMerged && (
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#fff',
                      fontSize: 9,
                      fontWeight: 700,
                    }}
                  >
                    {pl.group.items.length}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {/* 范围滑块 */}
        <div
          className="nt-range-track"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: rangeTrackTop,
            height: 6,
            background: p.bg2,
            borderRadius: 3,
          }}
        >
          <div
            className="nt-range-selected"
            style={{
              position: 'absolute',
              top: 0,
              left: `${leftPct}%`,
              width: `${rightPct - leftPct}%`,
              height: '100%',
              background: p.accentDim,
              borderRadius: 3,
            }}
          />
          <div
            className={`nt-range-handle${dragging === 'left' ? ' active' : ''}`}
            role="slider"
            tabIndex={0}
            aria-label="范围左端"
            aria-valuenow={Math.round(leftPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragging('left')
            }}
            onTouchStart={(e) => {
              e.stopPropagation()
              setDragging('left')
            }}
            style={{
              position: 'absolute',
              top: -3,
              left: `${leftPct}%`,
              width: 12,
              height: 12,
              background: p.accent,
              border: `2px solid ${p.bg1}`,
              borderRadius: '50%',
              transform: 'translateX(-50%)',
              cursor: 'ew-resize',
              boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
              transition: dragging === 'left' ? 'none' : 'transform 0.12s ease',
              zIndex: 3,
            }}
          />
          <div
            className={`nt-range-handle${dragging === 'right' ? ' active' : ''}`}
            role="slider"
            tabIndex={0}
            aria-label="范围右端"
            aria-valuenow={Math.round(rightPct)}
            aria-valuemin={0}
            aria-valuemax={100}
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragging('right')
            }}
            onTouchStart={(e) => {
              e.stopPropagation()
              setDragging('right')
            }}
            style={{
              position: 'absolute',
              top: -3,
              left: `${rightPct}%`,
              width: 12,
              height: 12,
              background: p.accent,
              border: `2px solid ${p.bg1}`,
              borderRadius: '50%',
              transform: 'translateX(-50%)',
              cursor: 'ew-resize',
              boxShadow: '0 1px 2px rgba(0,0,0,0.12)',
              transition: dragging === 'right' ? 'none' : 'transform 0.12s ease',
              zIndex: 3,
            }}
          />
        </div>
        {/* 重置提示 */}
        <div
          style={{
            position: 'absolute',
            top: rangeHintTop,
            right: 8,
            fontSize: 10,
            color: p.text2,
            fontStyle: 'italic',
            pointerEvents: 'none',
          }}
        >
          双击空白处重置 · 拖动 <span style={{ fontFamily: 'monospace' }}>●</span> 调整范围
        </div>
      </div>
      {/* Tooltip 单例 */}
      {hovered && tooltipPos && (
        <div
          className="nt-tooltip visible"
          role="tooltip"
          onMouseEnter={() => {
            // 【Phase 2 增强】移入 Tooltip 时取消离开延迟(用户从圆点移过来)
            if (hoverLeaveTimerRef.current) {
              clearTimeout(hoverLeaveTimerRef.current)
              hoverLeaveTimerRef.current = null
            }
          }}
          onMouseLeave={() => {
            setHovered(null)
            setHoveredFundCode(null)
          }}
          style={{
            position: 'fixed',
            zIndex: 1000,
            left: tooltipPos.left,
            top: tooltipPos.top,
            background: p.tooltipBg,
            border: `1px solid ${p.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            minWidth: 220,
            maxWidth: 320,
            boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
            fontSize: 12,
            color: p.text0,
          }}
        >
          {(() => {
            const sample = hovered.placement.group.items[0]
            const seriesIdx = fundIdxMap.get(sample.fundCode) ?? 0
            const seriesColorVal = p.series[seriesIdx % p.series.length]
            return (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 11, color: p.text2, fontVariantNumeric: 'tabular-nums' }}>
                    {hovered.placement.group.date}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontWeight: 600,
                      background:
                        sample.impact === 'positive'
                          ? `${p.impactPositive}1f`
                          : sample.impact === 'negative'
                            ? `${p.impactNegative}1f`
                            : p.bg3,
                      color:
                        sample.impact === 'positive'
                          ? p.impactPositive
                          : sample.impact === 'negative'
                            ? p.impactNegative
                            : p.impactNeutral,
                    }}
                  >
                    {impactLabel(sample.impact)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: p.text0,
                    margin: '0 0 4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: seriesColorVal,
                      flexShrink: 0,
                    }}
                  />
                  {hovered.placement.group.items.length > 1
                    ? `${hovered.placement.group.items.length} 条聚合`
                    : sample.summary || sample.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: p.text1,
                    lineHeight: 1.5,
                    margin: '0 0 6px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {sample.title}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: p.text2,
                    margin: '0 0 8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: seriesColorVal,
                    }}
                  />
                  {sample.fundCode}
                </div>
                {/* 3 个数据维度：字数 / 距今 / 同基金累计 */}
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    fontSize: 10,
                    color: p.text2,
                    padding: '4px 0 6px',
                    borderTop: `1px dashed ${p.border}`,
                    borderBottom: `1px solid ${p.border}`,
                    margin: '0 0 6px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span title="完整报告字数">📄 {sample.text?.length ?? 0} 字</span>
                  <span title="距离今天的天数">
                    距今 {Math.max(0, dayDiff(sample.date, new Date().toISOString().slice(0, 10)))} 天
                  </span>
                  <span title="该基金累计锚点条数">
                    同基金 {fundCountMap.get(sample.fundCode) ?? 0} 条
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    borderTop: `1px solid ${p.border}`,
                    paddingTop: 8,
                    marginTop: 4,
                  }}
                >
                  <button
                    onClick={handleTooltipJump}
                    style={{
                      flex: 1,
                      background: p.accent,
                      color: p.bg0,
                      border: `1px solid ${p.accent}`,
                      borderRadius: 4,
                      padding: '4px 8px',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 600,
                    }}
                  >
                    ↪ 跳转图表
                  </button>
                  <button
                    onClick={handleTooltipRemove}
                    disabled={!onRemove}
                    style={{
                      flex: 1,
                      background: p.bg2,
                      color: p.impactNegative,
                      border: `1px solid ${p.border}`,
                      borderRadius: 4,
                      padding: '4px 8px',
                      fontSize: 11,
                      cursor: onRemove ? 'pointer' : 'default',
                      fontFamily: 'inherit',
                      opacity: onRemove ? 1 : 0.5,
                    }}
                  >
                    解除锚定
                  </button>
                </div>
              </>
            )
          })()}
        </div>
      )}
      {/* 【Phase 3 本地 Modal】轴模式"全部清空"二次确认(用本地 state,避免与父级 NavChartPanel 弹窗冲突) */}
      {onClearAllAnchors && (
        <Modal
          opened={clearConfirmOpenLocal}
          onClose={() => setClearConfirmOpenLocal(false)}
          title="确认清空所有锚点"
          centered
          size="sm"
        >
          <p style={{ fontSize: 13, color: p.text1, margin: '0 0 16px 0' }}>
            此操作将清除全部已锚定的 AI 分析报告(<b>{anchorsCount ?? anchors.length}</b> 条),且不可撤销。是否继续?
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="subtle" size="sm" onClick={() => setClearConfirmOpenLocal(false)}>
              取消
            </Button>
            <Button
              color="red"
              size="sm"
              onClick={() => {
                onClearAllAnchors()
                setClearConfirmOpenLocal(false)
              }}
            >
              确认清空
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
