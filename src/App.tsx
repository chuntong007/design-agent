import React, { useState, useCallback, useEffect, useRef } from 'react'
import { LineChart, PieChart, Newspaper, Anchor, Info, X, Sparkles, Wifi } from 'lucide-react'
import type { Fund, Holding } from './types'
import { fundApi } from './api'
import { FundSelector } from './components/FundSelector'
import { MetricsBar } from './components/MetricsBar'
import { NavChart } from './components/NavChart'
import { HoldingsPanel } from './components/HoldingsPanel'
import { NewsPanel } from './components/NewsPanel'
import { Card, Segmented } from './components/UI'
import { FullLoading } from './components/Loading'
import { clsx } from 'clsx'

// 默认加载的示例基金（真实热门基金）
const DEFAULT_CODES = ['161725', '005827', '110011']
const STORAGE_KEY = 'fund-dashboard-selected-codes'
const STORAGE_ACTIVE = 'fund-dashboard-active-code'

// 从 localStorage 读取已保存的基金代码列表
function loadSavedCodes(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const codes = JSON.parse(saved)
      if (Array.isArray(codes) && codes.length > 0) return codes
    }
  } catch {}
  return DEFAULT_CODES
}

function loadSavedActiveCode(): string {
  try {
    return localStorage.getItem(STORAGE_ACTIVE) || ''
  } catch {}
  return ''
}

// 前端指标计算（根据切片后的净值序列重新计算）
function computeMetricsFromNav(navSeries: { date: string; nav: number; growthRate: number }[], scale: string) {
  if (!navSeries || navSeries.length === 0) {
    return { latestNav: 0, latestGrowth: 0, totalReturn: 0, ytdReturn: 0, maxDrawdown: 0, sharpeRatio: 0, volatility: 0, scale: scale || '' }
  }
  const latest = navSeries[navSeries.length - 1]
  const first = navSeries[0]
  const totalReturn = +(((latest.nav / first.nav) - 1) * 100).toFixed(2)
  const yearStart = new Date().getFullYear() + '-01-01'
  const ytdStart = navSeries.find((p) => p.date >= yearStart) || first
  const ytdReturn = +(((latest.nav / ytdStart.nav) - 1) * 100).toFixed(2)
  let peak = navSeries[0].nav
  let maxDD = 0
  for (const p of navSeries) {
    if (p.nav > peak) peak = p.nav
    const dd = ((p.nav - peak) / peak) * 100
    if (dd < maxDD) maxDD = dd
  }
  const returns = navSeries.slice(1).map((p) => p.growthRate || 0)
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length || 1)
  const vol = +Math.sqrt(variance * 252).toFixed(2)
  const sharpe = vol ? +((totalReturn - 2) / vol).toFixed(2) : 0
  return {
    latestNav: latest.nav,
    latestGrowth: latest.growthRate,
    totalReturn,
    ytdReturn,
    maxDrawdown: +maxDD.toFixed(2),
    sharpeRatio: sharpe,
    volatility: vol,
    scale: scale || '',
  }
}

const App: React.FC = () => {
  const [funds, setFunds] = useState<Fund[]>([])
  const [loadingCodes, setLoadingCodes] = useState<string[]>([])
  const [activeFundId, setActiveFundId] = useState<string>('')
  const [normalized, setNormalized] = useState<boolean>(true)
  const [range, setRange] = useState<string>('1y')
  const [initialLoading, setInitialLoading] = useState(true)
  const [serverOnline, setServerOnline] = useState<boolean | null>(null)
  // 保存初始基金代码列表（从 localStorage 或默认值）
  const savedCodesRef = useRef<string[]>(loadSavedCodes())
  const savedActiveRef = useRef<string>(loadSavedActiveCode())

  // 重仓股懒加载
  const [holdingsMap, setHoldingsMap] = useState<Record<string, Holding[]>>({})
  const [holdingsLoading, setHoldingsLoading] = useState<Record<string, boolean>>({})

  // 新闻面板状态
  const [newsOpen, setNewsOpen] = useState(false)
  const [trigger, setTrigger] = useState<{ fund: Fund; date: string; nav: number } | null>(null)
  const [anchor, setAnchor] = useState<{ fund: Fund; date: string; nav: number } | null>(null)

  const [showHelp, setShowHelp] = useState(false)

  // 检查后端健康状态
  useEffect(() => {
    fundApi
      .health()
      .then(() => setServerOnline(true))
      .catch(() => setServerOnline(false))
  }, [])

  // 加载单只基金（始终请求成立来全部历史，前端按区间切片）
  const loadFund = useCallback(async (code: string, colorIndex: number) => {
    setLoadingCodes((prev) => [...prev, code])
    try {
      const fund = await fundApi.getFund(code, 'all', colorIndex)
      setFunds((prev) => {
        const filtered = prev.filter((f) => f.code !== code)
        return [...filtered, fund]
      })
      setActiveFundId((prev) => prev || fund.id)
      return fund
    } catch (e) {
      console.error('加载基金失败:', code, e)
      alert(`基金 ${code} 加载失败，请检查代码是否正确`)
      return null
    } finally {
      setLoadingCodes((prev) => prev.filter((c) => c !== code))
    }
  }, [])

  // 初始加载：从 localStorage 读取已保存的基金列表，若无则用默认值
  useEffect(() => {
    if (serverOnline === false) {
      setInitialLoading(false)
      return
    }
    if (serverOnline !== true) return
    const codes = savedCodesRef.current
    Promise.all(codes.map((c, i) => loadFund(c, i))).finally(() => setInitialLoading(false))
  }, [serverOnline])

  // 持久化：当 funds 变化时保存 code 列表到 localStorage
  useEffect(() => {
    const codes = funds.map((f) => f.code)
    if (codes.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(codes))
    }
  }, [funds])

  // 持久化：当 activeFundId 变化时保存
  useEffect(() => {
    if (activeFundId) {
      const fund = funds.find((f) => f.id === activeFundId)
      if (fund) localStorage.setItem(STORAGE_ACTIVE, fund.code)
    }
  }, [activeFundId, funds])

  // 添加基金（去重）
  const handleAdd = (code: string) => {
    if (funds.some((f) => f.code === code) || loadingCodes.includes(code)) return
    loadFund(code, funds.length + loadingCodes.length)
  }

  // 移除基金
  const handleRemove = (id: string) => {
    setFunds((prev) => {
      const next = prev.filter((f) => f.id !== id)
      if (activeFundId === id) {
        setActiveFundId(next[0]?.id || '')
      }
      // 如果移除后没有基金了，清空 localStorage
      if (next.length === 0) {
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(STORAGE_ACTIVE)
      }
      return next
    })
  }

  const activeFund = funds.find((f) => f.id === activeFundId) ?? funds[0]

  // 懒加载重仓股
  useEffect(() => {
    if (!activeFund) return
    if (holdingsMap[activeFund.id] || holdingsLoading[activeFund.id]) return
    setHoldingsLoading((prev) => ({ ...prev, [activeFund.id]: true }))
    fundApi
      .getHoldings(activeFund.code)
      .then((list) => {
        setHoldingsMap((prev) => ({ ...prev, [activeFund.id]: list }))
      })
      .catch((e) => {
        console.error('重仓股加载失败:', e)
        setHoldingsMap((prev) => ({ ...prev, [activeFund.id]: [] }))
      })
      .finally(() => {
        setHoldingsLoading((prev) => ({ ...prev, [activeFund.id]: false }))
      })
  }, [activeFund])

  const handlePointClick = useCallback((fund: Fund, date: string, nav: number) => {
    setTrigger({ fund, date, nav })
    setNewsOpen(true)
  }, [])

  const handleCloseNews = () => {
    setNewsOpen(false)
  }

  // 区间切换：纯前端切片（后端已返回成立来全部历史）+ 重新计算指标
  const filteredFunds = React.useMemo(() => {
    if (range === 'all') return funds
    const days = range === '1m' ? 30 : range === '3m' ? 90 : range === '6m' ? 180 : 365
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
    return funds.map((f) => {
      const sliced = f.navSeries.filter((p) => p.date >= cutoffStr)
      return { ...f, navSeries: sliced, metrics: computeMetricsFromNav(sliced, f.metrics.scale) }
    })
  }, [funds, range])

  const selectedIds = funds.map((f) => f.id)
  // 给 NavChart 用的 newsDates：净值序列中所有日期都可点击检索
  const newsDates = React.useMemo(() => {
    const s = new Set<string>()
    funds.forEach((f) => f.navSeries.forEach((p) => s.add(p.date)))
    return Array.from(s)
  }, [funds])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50/30">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-white/70 border-b border-slate-200/60">
        <div className="max-w-[1600px] mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 via-brand-600 to-amber-500 flex items-center justify-center text-white shadow-lg shadow-brand-200">
              <LineChart size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 tracking-tight flex items-center gap-2">
                基金洞察
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gradient-to-r from-brand-500 to-amber-500 text-white font-medium">
                  PRO
                </span>
              </h1>
              <p className="text-xs text-slate-400">多维度数据分析看板</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {serverOnline !== null && (
              <div
                className={clsx(
                  'hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium',
                  serverOnline
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-rose-50 text-rose-600',
                )}
              >
                <Wifi size={12} />
                {serverOnline ? '实时数据' : '后端离线'}
              </div>
            )}
            {anchor && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
                <Anchor size={13} />
                <span className="font-medium">已锚定：</span>
                <span className="tabular-nums">{anchor.date}</span>
                <span className="text-amber-500">·</span>
                <span className="font-semibold">{anchor.fund.name}</span>
                <button
                  onClick={() => setAnchor(null)}
                  className="ml-1 hover:text-amber-900"
                >
                  <X size={12} />
                </button>
              </div>
            )}
            <button
              onClick={() => setShowHelp(true)}
              className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
              title="使用说明"
            >
              <Info size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-6 space-y-5">
        {initialLoading && (
          <Card className="p-16">
            <FullLoading text="正在连接实时数据服务并加载示例基金" />
          </Card>
        )}
        {!initialLoading && (
        <>
        {/* 标题区 */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-3xl font-bold text-slate-800 tracking-tight">
              基金多维对比分析
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              历史涨幅 · 重仓参照 · 新闻关联 · 净值锚定对照
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Sparkles size={14} className="text-amber-500" />
            实时数据 · 来源：天天基金 + GDELT 全球新闻
          </div>
        </div>

        {/* 后端离线提示 */}
        {serverOnline === false && (
          <Card className="p-6 border-rose-200 bg-rose-50/50">
            <div className="flex items-center gap-3 text-rose-700">
              <Wifi size={20} />
              <div>
                <div className="font-semibold">后端服务未启动</div>
                <div className="text-xs mt-0.5 text-rose-500">
                  请在终端运行 <code className="px-1.5 py-0.5 bg-rose-100 rounded">npm run dev</code> 启动后端服务（端口 8787），刷新页面后即可使用实时数据。
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* 基金选择卡片 */}
        <FundSelector
          funds={filteredFunds}
          loadingCodes={loadingCodes}
          onAdd={handleAdd}
          onRemove={handleRemove}
          activeFundId={activeFundId}
          onSetActive={setActiveFundId}
        />

        {/* 指标条 */}
        <MetricsBar funds={filteredFunds} selectedIds={selectedIds} />

        {/* 主体：左图表 + 重仓 / 右新闻面板（抽屉式） */}
        <div className={clsx('grid gap-5 transition-all duration-500', newsOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-1')}>
          {/* 左侧：净值图 + 重仓 */}
          <div className={clsx('space-y-5', newsOpen ? 'lg:col-span-2' : 'lg:col-span-1')}>
            {/* 净值对比图 */}
            <Card className="p-5">
              <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-1 h-5 rounded bg-brand-500" />
                  <h3 className="text-base font-semibold text-slate-800">历史净值走势对比</h3>
                  <span className="text-xs text-slate-400 ml-1">点击曲线任意点位可检索当日全球新闻</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Segmented
                    size="sm"
                    value={range}
                    onChange={setRange}
                    options={[
                      { label: '1月', value: '1m' },
                      { label: '3月', value: '3m' },
                      { label: '6月', value: '6m' },
                      { label: '1年', value: '1y' },
                      { label: '成立来', value: 'all' },
                    ]}
                  />
                  <Segmented
                    size="sm"
                    value={normalized ? 'norm' : 'abs'}
                    onChange={(v) => setNormalized(v === 'norm')}
                    options={[
                      { label: '归一化', value: 'norm' },
                      { label: '绝对净值', value: 'abs' },
                    ]}
                  />
                </div>
              </div>
              <div className="h-[400px]">
                {filteredFunds.length === 0 && loadingCodes.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm">
                    <LineChart size={40} className="mb-3 opacity-40" />
                    点击上方「添加基金」开始分析
                  </div>
                ) : filteredFunds.length === 0 ? (
                  <FullLoading text="正在加载基金净值数据" />
                ) : (
                <NavChart
                  funds={filteredFunds}
                  selectedIds={selectedIds}
                  normalized={normalized}
                  anchorDate={anchor?.date ?? null}
                  onPointClick={handlePointClick}
                  newsDates={newsDates}
                />
                )}
              </div>
              {/* 图例说明 */}
              <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="text-amber-500">●</span>
                  点击曲线任意点位 → 自动检索该日期 ±5 天全球新闻
                </span>
                <span className="flex items-center gap-1.5">
                  <Anchor size={11} className="text-amber-500" />
                  橙色实线 = 锚定净值点
                </span>
              </div>
            </Card>

            {/* 重仓股 */}
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="w-1 h-5 rounded bg-brand-500" />
                  <h3 className="text-base font-semibold text-slate-800">
                    重仓股参照分析
                  </h3>
                  {activeFund && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-md font-medium"
                      style={{ color: activeFund.color, backgroundColor: activeFund.color + '14' }}
                    >
                      {activeFund.name}
                    </span>
                  )}
                </div>
                <PieChart size={18} className="text-slate-300" />
              </div>
              {activeFund ? (
                <HoldingsPanel
                  holdings={holdingsMap[activeFund.id] || []}
                  anchorDate={anchor?.date ?? null}
                  loading={holdingsLoading[activeFund.id]}
                />
              ) : (
                <div className="py-16 text-center text-slate-400 text-sm">请先添加基金</div>
              )}
            </Card>
          </div>

          {/* 右侧：新闻面板 */}
          {newsOpen && (
            <div className="lg:col-span-1">
              <Card className="h-full overflow-hidden sticky top-20" >
                <NewsPanel
                  triggerFund={trigger?.fund ?? null}
                  triggerDate={trigger?.date ?? null}
                  triggerNav={trigger?.nav ?? null}
                  anchorInfo={anchor}
                  onAnchor={setAnchor}
                  onClose={handleCloseNews}
                />
              </Card>
            </div>
          )}
        </div>

        {/* 底部信息 */}
        <div className="text-center text-xs text-slate-400 py-4">
          基金洞察看板 · 实时数据来自天天基金与 GDELT 全球新闻数据库
        </div>
        </>
        )}
      </main>

      {/* 帮助弹层 */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in p-4"
          onClick={() => setShowHelp(false)}
        >
          <Card
            className="max-w-lg w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-amber-500 flex items-center justify-center text-white">
                  <Sparkles size={18} />
                </div>
                <h3 className="text-lg font-bold text-slate-800">使用指南</h3>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-3 text-sm text-slate-600">
              {[
                { t: '多基金对比', d: '点击右上角复选框选择多只基金，主图将叠加显示净值走势；可在「归一化 / 绝对净值」间切换以直观对比涨跌幅。' },
                { t: '重仓股参照', d: '点击基金卡片切换「当前查看」的基金，下方展示其重仓股占比、Top5 走势对比及明细指标。' },
                { t: '新闻检索', d: '在主图上点击任意净值点位，右侧自动通过 GDELT 检索该日期 ±5 天内的全球新闻资讯，了解当时发生了什么。' },
                { t: '净值锚定', d: '在新闻面板点击「锚定此净值点」，主图会出现橙色锚定线。之后点击其他日期时，新闻面板底部会同步显示锚定时期事件，便于跨时期对照。' },
              ].map((it, i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <div>
                    <div className="font-semibold text-slate-700">{it.t}</div>
                    <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{it.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

export default App
