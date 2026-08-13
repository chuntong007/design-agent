import { useEffect, useState, useCallback, useRef } from 'react'
import type { FundDetail, SectorInfo, NewsSession, GrowthPoint } from './types'
import { api, searchNewsStream } from './api'
import { storage, type PinnedFund, type AnchorNews } from './storage'
import { seriesColor, makeStyles } from './theme'
import { useTheme } from './ThemeContext'
import { RANGE_TO_DAY, type RangeKey } from './metrics'
import { Header } from './components/Header'
import { FundList } from './components/FundList'
import { NavChartPanel } from './components/NavChartPanel'
import { MetricsPanel } from './components/MetricsPanel'
import { HoldingsPanel } from './components/HoldingsPanel'
import { NewsDrawer } from './components/NewsDrawer'
import { BacktestPanel } from './components/BacktestPanel'

export interface LoadedFund extends PinnedFund {
  detail?: FundDetail
  color: string
  loading?: boolean
  error?: string
}

export type MainTab = 'analysis' | 'backtest'

export function App() {
  const { palette: p } = useTheme()
  const styles = makeStyles(p)
  const [funds, setFunds] = useState<LoadedFund[]>([])
  const [range, setRange] = useState<string>(storage.getView().range)
  const [chartMode, setChartMode] = useState<'return' | 'nav'>(storage.getView().chartMode)
  const [selectedCode, setSelectedCode] = useState<string>('')
  // 蛋卷累计收益率缓存：key = `${code}:${day}`；growthErrors 记录失败避免重复请求
  const [growthMap, setGrowthMap] = useState<Record<string, GrowthPoint[]>>({})
  const [growthErrors, setGrowthErrors] = useState<Record<string, string>>({})
  const [anchors, setAnchors] = useState<AnchorNews[]>(storage.getAnchors())
  // 主 tab：分析看板 / 策略回测
  const [mainTab, setMainTab] = useState<MainTab>('analysis')
  // 【抽屉对照模式】多检索会话历史 + 当前激活会话 + 抽屉展开/收起
  // drawerCollapsed: 收起态（保留会话，仅隐藏抽屉，便于回看完整图表）
  const [newsSessions, setNewsSessions] = useState<NewsSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [drawerCollapsed, setDrawerCollapsed] = useState(false)
  // 图表↔报告联动高亮日期
  const [highlightDate, setHighlightDate] = useState<string | null>(null)
  // 【NewsTimeline 列表模式】true=列表视图 / false=时间轴视图（持久化）
  const [newsTimelineListMode, setNewsTimelineListMode] = useState<boolean>(() => storage.getNewsTimelineListMode())
  // 【NewsTimeline 清空全部】确认弹窗开关（由 NavChartPanel 内部 Modal 触发）
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false)
  // 【多基金检索】用户从 FundList 顶部 chip 区预设的检索范围；空选时兜底"全基金综合"
  const [newsTargetCodes, setNewsTargetCodes] = useState<string[]>([])
  const newsAbortRef = useRef<AbortController | null>(null)

  // 抽屉是否可见：有激活会话且未收起
  const drawerOpen = activeSessionId !== null && !drawerCollapsed

  // 当前激活的会话
  const activeSession = newsSessions.find((s) => s.id === activeSessionId) || null

  // 初始化：加载基金列表
  useEffect(() => {
    const pinned = storage.getFunds()
    const loaded: LoadedFund[] = pinned.map((f, i) => ({ ...f, color: seriesColor(p, i) }))
    setFunds(loaded)
    if (loaded.length > 0 && !selectedCode) setSelectedCode(loaded[0].code)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 主题切换时重新分配基金曲线颜色
  useEffect(() => {
    setFunds((prev) => prev.map((f, i) => ({ ...f, color: seriesColor(p, i) })))
  }, [p])

  // 持久化视图状态
  useEffect(() => {
    storage.setView({ range, chartMode })
  }, [range, chartMode])
  useEffect(() => {
    storage.setAnchors(anchors)
  }, [anchors])
  // 持久化 NewsTimeline 列表模式
  useEffect(() => {
    storage.setNewsTimelineListMode(newsTimelineListMode)
  }, [newsTimelineListMode])

  // 加载基金详情
  const loadFundDetail = useCallback(async (code: string) => {
    setFunds((prev) =>
      prev.map((f) => (f.code === code ? { ...f, loading: true, error: '' } : f))
    )
    try {
      const detail = await api.getFundDetail(code)
      setFunds((prev) =>
        prev.map((f) => (f.code === code ? { ...f, detail, loading: false } : f))
      )
    } catch (err) {
      setFunds((prev) =>
        prev.map((f) => (f.code === code ? { ...f, loading: false, error: (err as Error).message } : f))
      )
    }
  }, [])

  // 初次挂载：加载所有基金详情
  useEffect(() => {
    funds.forEach((f) => {
      if (!f.detail && !f.loading && !f.error) {
        loadFundDetail(f.code)
      }
    })
  }, [funds.length]) // 仅在数量变化时触发

  // 按需加载蛋卷累计收益率：补齐缺失的 (fund, day) 数据（区间切换随之改变 day 参数）
  const ensureGrowth = useCallback(
    (codes: string[], rangeKey: string) => {
      const day = RANGE_TO_DAY[rangeKey as RangeKey] ?? 'all'
      codes.forEach((code) => {
        const key = `${code}:${day}`
        if (growthMap[key] || growthErrors[key]) return
        api
          .getFundGrowth(code, day)
          .then((points) => setGrowthMap((m) => ({ ...m, [key]: points })))
          .catch((err) => setGrowthErrors((e) => ({ ...e, [key]: (err as Error).message })))
      })
    },
    [growthMap, growthErrors]
  )

  // 区间/基金列表变化时补齐 growth 数据（仅对有 detail 的基金；guard 防重复）
  useEffect(() => {
    if (mainTab !== 'analysis') return
    const codes = funds.filter((f) => f.detail).map((f) => f.code)
    ensureGrowth(codes, range)
  }, [funds, range, mainTab, ensureGrowth])

  // 添加基金
  const addFund = useCallback(
    (fund: { code: string; name: string }) => {
      setFunds((prev) => {
        if (prev.some((f) => f.code === fund.code)) return prev
        const newFund: LoadedFund = {
          ...fund,
          color: seriesColor(p, prev.length),
          addedAt: Date.now(),
        }
        const next = [...prev, newFund]
        storage.setFunds(next.map(({ code, name, addedAt }) => ({ code, name, addedAt })))
        return next
      })
    },
    [p]
  )

  // 删除基金
  const removeFund = useCallback((code: string) => {
    setFunds((prev) => {
      const next = prev.filter((f) => f.code !== code)
      // 重新分配颜色
      const recolored = next.map((f, i) => ({ ...f, color: seriesColor(p, i) }))
      storage.setFunds(recolored.map(({ code, name, addedAt }) => ({ code, name, addedAt })))
      // 清理相关锚点
      setAnchors((a) => {
        const filtered = a.filter((x) => x.fundCode !== code)
        storage.setAnchors(filtered)
        return filtered
      })
      return recolored
    })
    setSelectedCode((cur) => (cur === code ? '' : cur))
  }, [p])

  // 更新指定会话的状态（流式回调用）
  const updateSession = useCallback((sessionId: string, patch: Partial<NewsSession> | ((prev: NewsSession) => Partial<NewsSession>)) => {
    setNewsSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...(typeof patch === 'function' ? patch(s) : patch) } : s)))
  }, [])

  // 取消所有活动检索请求(用于切换下拉选择时清理)
  const abortAllNews = useCallback(() => {
    if (newsAbortRef.current) {
      newsAbortRef.current.abort()
      newsAbortRef.current = null
    }
    // 标记所有 loading 的会话为已取消
    setNewsSessions((prev) =>
      prev.map((s) => (s.loading ? { ...s, loading: false, error: '已取消' } : s))
    )
  }, [])

  // 点击净值曲线 -> 创建新检索会话 + 流式检索（SSE 增量推送）
  // 【多基金综合研判】统一按 newsTargetCodes 决定 targetCodes；空选兜底"全基金综合"
  // e: 保留签名兼容(忽略修饰键),NavChartPanel 不再透传 MouseEvent
  const onPointClick = useCallback(
    (date: string, primaryFundCode: string, _e?: React.MouseEvent | React.KeyboardEvent | 'shift' | 'alt') => {
      // 取消上一次未完成的请求
      if (newsAbortRef.current) {
        newsAbortRef.current.abort()
        newsAbortRef.current = null
      }

      // 1. 确定目标基金列表：newsTargetCodes 优先；空选/未设置时兜底为全部已加载基金
      const loadedFundsList = funds.filter((f) => f.detail)
      const targetCodes: string[] = newsTargetCodes.length > 0 ? newsTargetCodes : loadedFundsList.map((f) => f.code)

      // 3. 单 session(单 SSE 调用, 后端对多 fundCode 做综合研判)
      const isMulti = targetCodes.length > 1
      const sessionId = `${date}-${targetCodes.join('_')}-${Date.now()}`
      const batchId = isMulti ? `batch-${Date.now()}` : undefined
      const primaryFund = funds.find((f) => f.code === targetCodes[0])
      const newSession: NewsSession = {
        id: sessionId,
        date,
        fundCode: targetCodes[0],
        fundName: isMulti
          ? `${targetCodes.length} 支基金组合`
          : primaryFund?.detail?.name || primaryFund?.name,
        sector: null,
        reasoning: '',
        outputText: '',
        sources: [],
        loading: true,
        error: '',
        status: { stage: 'init', message: isMulti ? '正在启动多基金综合研判...' : '正在启动检索...' },
        createdAt: Date.now(),
        isMultiFundSession: isMulti,
        batchId,
        targetFundCodes: targetCodes,
      }
      setNewsSessions((prev) => [newSession, ...prev])
      setActiveSessionId(sessionId)
      setDrawerCollapsed(false)

      // 4. 单次 SSE 调用(传 fundCodes 数组, 后端做综合研判)
      const controller = searchNewsStream(date, targetCodes, (evt) => {
        switch (evt.event) {
          case 'sector':
            updateSession(sessionId, { sector: evt.data })
            break
          case 'status':
            updateSession(sessionId, { status: { stage: evt.data.stage, message: evt.data.message } })
            break
          case 'sources':
            updateSession(sessionId, (s) => ({ sources: [...s.sources, ...evt.data.urls] }))
            break
          case 'reasoning_delta':
            updateSession(sessionId, (s) => ({ reasoning: s.reasoning + evt.data.text }))
            break
          case 'reasoning_done':
            updateSession(sessionId, { reasoning: evt.data.text })
            break
          case 'output_delta':
            updateSession(sessionId, (s) => ({ outputText: s.outputText + evt.data.text }))
            break
          case 'output_done':
            updateSession(sessionId, { outputText: evt.data.text })
            break
          case 'complete':
            updateSession(sessionId, { outputText: evt.data.text, reasoning: evt.data.reasoning })
            break
          case 'error':
            updateSession(sessionId, { error: evt.data.message })
            break
          case 'done':
            updateSession(sessionId, { loading: false, status: null })
            break
        }
      })
      newsAbortRef.current = controller
    },
    [funds, newsTargetCodes, updateSession]
  )

  // 锚定当前激活会话的 AI 分析报告（整篇 Markdown）
  const anchorNews = useCallback(
    () => {
      if (!activeSession || !activeSession.outputText) return
      // 【简述】从 LLM 报告开头提取一句话概括(后端保证 **简述**: <4-8字> 标记)
      // 用多字符匹配同时兼容 ASCII ':' 和全角'：'，截断到 12 字防爆框
      const summaryMatch = activeSession.outputText.match(/^\*\*简述\*\*[:：]\s*(.+)$/m)
      const summary = summaryMatch ? summaryMatch[1].trim().slice(0, 12) : undefined
      const anchor: AnchorNews = {
        id: `${activeSession.date}-${activeSession.fundCode}-${Date.now()}`,
        date: activeSession.date,
        timestamp: new Date(activeSession.date).getTime(),
        fundCode: activeSession.fundCode,
        title: `${activeSession.date} AI 分析报告`,
        url: '',
        source: 'llm',
        category: 'AI 分析',
        impact: '',
        pinnedAt: Date.now(),
        text: activeSession.outputText,
        reasoning: activeSession.reasoning,
        summary,
      }
      setAnchors((prev) => {
        // 同一日期同一基金去重
        const filtered = prev.filter((a) => !(a.date === anchor.date && a.fundCode === anchor.fundCode))
        const next = [...filtered, anchor]
        storage.setAnchors(next)
        return next
      })
    },
    [activeSession]
  )

  // 收起抽屉（保留会话状态，仅隐藏，便于回看完整图表后重新展开）
  // 注：不再联动 setHighlightDate(null)，让用户通过点击/再点圆点自行控制高亮
  const collapseDrawer = useCallback(() => {
    setDrawerCollapsed(true)
  }, [])

  // 展开抽屉（恢复之前收起的会话）
  const expandDrawer = useCallback(() => {
    setDrawerCollapsed(false)
  }, [])

  // 移除历史检索会话
  const removeSession = useCallback((id: string) => {
    setNewsSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      // 如果移除的是当前激活会话，切换到第一个或清空激活态
      if (activeSessionId === id) {
        if (next.length > 0) {
          setActiveSessionId(next[0].id)
        } else {
          setActiveSessionId(null)
          setDrawerCollapsed(false)
        }
      }
      return next
    })
  }, [activeSessionId])

  // 切换激活会话
  const switchSession = useCallback((id: string) => {
    setActiveSessionId(id)
  }, [])

  // 取消锚定
  const removeAnchor = useCallback((id: string) => {
    setAnchors((prev) => {
      const next = prev.filter((a) => a.id !== id)
      storage.setAnchors(next)
      return next
    })
  }, [])

  // 【NewsTimeline】切换列表/时间轴模式（持久化到 localStorage）
  const toggleNewsTimelineListMode = useCallback(() => {
    setNewsTimelineListMode((prev) => {
      const next = !prev
      storage.setNewsTimelineListMode(next)
      return next
    })
  }, [])

  // 【NewsTimeline】清空全部锚点：遍历 anchors 一次性移除，并清掉持续高亮 + 关闭确认弹窗
  const clearAllAnchors = useCallback(() => {
    setAnchors((prev) => {
      const next: AnchorNews[] = []
      storage.setAnchors(next)
      return next
    })
    setHighlightDate(null)
    setClearAllConfirmOpen(false)
  }, [])

  // 【NewsTimeline】单击圆点 -> 切换该日期竖线高亮（再次点击同一日期取消高亮）
  const handleJumpToAnchor = useCallback((date: string) => {
    setHighlightDate((prev) => (prev === date ? null : date))
  }, [])

  // 【NewsTimeline】范围滑块变化 -> 联动到 range
  // 注意：直接 setRange 会让 Header 的 range 选择器同步更新；用户也可以用 Header 改回
  const handleTimelineRangeChange = useCallback((start: string, end: string) => {
    // 把 [start, end] 映射到项目内置的 RangeKey（用 1y/3y/5y/all 都行,这里用 'all' 全量最安全）
    // 实际应用：更合理的做法是依据天数映射到最接近的预设
    const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000)
    let key: string = 'all'
    if (days <= 31) key = '1m'
    else if (days <= 92) key = '3m'
    else if (days <= 186) key = '6m'
    else if (days <= 365) key = '1y'
    else if (days <= 365 * 3) key = '3y'
    else if (days <= 365 * 5) key = '5y'
    setRange(key)
  }, [])

  const loadedFunds = funds.filter((f) => f.detail)
  const selectedFund = funds.find((f) => f.code === selectedCode) || funds[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: p.bg0, transition: 'background-color 0.3s ease' }}>
      <Header
        funds={funds}
        onAdd={addFund}
        range={range}
        onRangeChange={setRange}
        chartMode={chartMode}
        onChartModeChange={setChartMode}
        mainTab={mainTab}
        onMainTabChange={setMainTab}
      />
      {mainTab === 'analysis' ? (
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '260px 1fr 360px', gap: '12px', padding: '12px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* 左侧：基金列表 */}
          <div style={{ ...styles.card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <FundList
              funds={funds}
              selectedCode={selectedCode}
              onSelect={setSelectedCode}
              onRemove={removeFund}
              newsTargetCodes={newsTargetCodes}
              onSetNewsTargets={setNewsTargetCodes}
            />
          </div>
          {/* 中间：图表 + 指标（浮动抽屉遮挡，不挤压） */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ ...styles.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}>
              <NavChartPanel
                funds={loadedFunds}
                range={range}
                chartMode={chartMode}
                growthMap={growthMap}
                growthErrors={growthErrors}
                anchors={anchors}
                onPointClick={onPointClick}
                newsTargetCodes={newsTargetCodes}
                newsQuery={activeSession ? { date: activeSession.date, fundCode: activeSession.fundCode } : null}
                highlightDate={highlightDate}
                onChartBlankClick={drawerOpen ? collapseDrawer : undefined}
                onJumpToAnchor={handleJumpToAnchor}
                onRemoveAnchor={removeAnchor}
                onRangeChange={handleTimelineRangeChange}
                listMode={newsTimelineListMode}
                onToggleListMode={toggleNewsTimelineListMode}
                onClearAllAnchors={clearAllAnchors}
                clearAllConfirmOpen={clearAllConfirmOpen}
                onClearAllConfirmOpenChange={setClearAllConfirmOpen}
              />
            </div>
            <div style={{ ...styles.card, padding: '12px 16px' }}>
              <MetricsPanel funds={loadedFunds} range={range} />
            </div>
          </div>
          {/* 收起态：浮动"展开分析"胶囊按钮（提示有会话可恢复，可移除） */}
          {drawerCollapsed && activeSession && (
            <div
              style={{
                position: 'absolute',
                top: '20px',
                right: '384px',
                zIndex: 50,
                display: 'flex',
                alignItems: 'stretch',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                border: `1px solid ${p.border}`,
                background: p.bg1,
                animation: 'drawer-slide-in 0.25s ease-out',
              }}
            >
              {/* 展开 区域：点击恢复抽屉 */}
              <button
                onClick={expandDrawer}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: p.text0,
                  cursor: 'pointer',
                  padding: '8px 12px',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontFamily: 'inherit',
                }}
                title="展开 AI 分析抽屉"
              >
                <span style={{ color: p.accent, fontSize: '13px' }}>◂</span>
                <span>展开分析</span>
                <span style={{
                  fontSize: '10px',
                  color: p.text2,
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 500,
                  padding: '1px 5px',
                  background: p.bg3,
                  borderRadius: '3px',
                }}>
                  {activeSession.date}
                </span>
                {activeSession.outputText && (
                  <span style={{ fontSize: '9px', color: p.text2 }}>
                    {activeSession.outputText.length} 字
                  </span>
                )}
              </button>
              {/* 移除按钮：清除当前会话 */}
              <button
                onClick={() => removeSession(activeSession.id)}
                style={{
                  background: p.bg2,
                  border: 'none',
                  borderLeft: `1px solid ${p.border}`,
                  color: p.text2,
                  cursor: 'pointer',
                  padding: '0 10px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  lineHeight: 1,
                }}
                title="移除此检索会话"
              >
                ×
              </button>
            </div>
          )}
          {/* 抽屉：AI 分析（浮动遮挡，不参与 grid，绝对定位覆盖中间图表区域右半） */}
          {drawerOpen && (
            <div style={{
              position: 'absolute',
              top: '12px',
              right: '372px',
              bottom: '12px',
              width: 'calc(50% - 200px)',
              minWidth: '420px',
              zIndex: 50,
              animation: 'drawer-slide-in 0.3s ease-out',
            }}>
              <NewsDrawer
                sessions={newsSessions}
                activeSessionId={activeSessionId}
                onSwitchSession={switchSession}
                onRemoveSession={removeSession}
                onClose={collapseDrawer}
                onAnchor={anchorNews}
                anchors={anchors}
                onHighlightDate={setHighlightDate}
                availableFunds={loadedFunds.map((f) => ({ code: f.code, name: f.detail?.name || f.name }))}
              />
            </div>
          )}
          {/* 右侧：重仓股 + 已锚定报告列表 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ ...styles.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <HoldingsPanel fund={selectedFund} range={range} />
            </div>
            <div style={{ ...styles.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <AnchoredList anchors={anchors} onRemove={removeAnchor} funds={funds} />
            </div>
          </div>
        </div>
      ) : (
        /* 策略回测 tab - 传入 range 实现区间联动 */
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <BacktestPanel funds={funds} range={range} onRangeChange={setRange} />
        </div>
      )}
    </div>
  )
}

// 右栏下半区：已锚定报告列表（点击展开查看完整分析）
function AnchoredList({
  anchors,
  onRemove,
  funds,
}: {
  anchors: AnchorNews[]
  onRemove: (id: string) => void
  funds: LoadedFund[]
}) {
  const { palette: p } = useTheme()
  const [expanded, setExpanded] = useState<string | null>(null)
  const styles = makeStyles(p)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${p.border}` }}>
        <span style={{ ...styles.label }}>已锚定报告 ({anchors.length})</span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px' }}>
        {anchors.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: p.text2, fontSize: '11px' }}>
            在抽屉分析完成后点击"锚定"<br />将报告标注到图表
          </div>
        ) : (
          [...anchors].sort((a, b) => a.timestamp - b.timestamp).map((a) => {
            const fund = funds.find((f) => f.code === a.fundCode)
            const isExpanded = expanded === a.id
            return (
              <div
                key={a.id}
                style={{
                  padding: '8px 10px',
                  margin: '3px 0',
                  borderRadius: '6px',
                  background: p.bg2,
                  border: `1px solid ${p.border}`,
                  borderLeft: `3px solid ${p.accent}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : a.id)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', gap: '6px', alignItems: 'center', flex: 1, minWidth: 0 }}
                  >
                    <span style={{ fontSize: '11px', fontWeight: 600, color: p.text0, fontFamily: '"JetBrains Mono", monospace', flexShrink: 0 }}>
                      {a.date}
                    </span>
                    {fund && (
                      <span style={{ fontSize: '10px', color: p.text2, background: p.bg3, padding: '1px 5px', borderRadius: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fund.detail?.name || fund.name}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => onRemove(a.id)}
                    style={{ background: 'transparent', border: 'none', color: p.text2, cursor: 'pointer', fontSize: '12px', padding: '0 4px', flexShrink: 0 }}
                    title="取消锚定"
                  >
                    ×
                  </button>
                </div>
                {isExpanded && a.text && (
                  <div style={{ marginTop: '6px', padding: '8px', borderRadius: '4px', background: p.bg3, fontSize: '11px', color: p.text1, lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>
                    {a.text.slice(0, 500)}{a.text.length > 500 ? '...' : ''}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
