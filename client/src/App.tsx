import { useEffect, useState, useCallback } from 'react'
import type { FundDetail, NewsArticle, SectorInfo } from './types'
import { api } from './api'
import { storage, type PinnedFund, type AnchorNews } from './storage'
import { seriesColor, makeStyles } from './theme'
import { useTheme } from './ThemeContext'
import { Header } from './components/Header'
import { FundList } from './components/FundList'
import { NavChartPanel } from './components/NavChartPanel'
import { MetricsPanel } from './components/MetricsPanel'
import { HoldingsPanel } from './components/HoldingsPanel'
import { NewsPanel } from './components/NewsPanel'
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
  const [normalized, setNormalized] = useState<boolean>(storage.getView().normalized)
  const [selectedCode, setSelectedCode] = useState<string>('')
  const [anchors, setAnchors] = useState<AnchorNews[]>(storage.getAnchors())
  // 主 tab：分析看板 / 策略回测
  const [mainTab, setMainTab] = useState<MainTab>('analysis')
  // 点击曲线触发的新闻检索
  const [newsQuery, setNewsQuery] = useState<{ date: string; fundCode: string } | null>(null)
  const [newsArticles, setNewsArticles] = useState<NewsArticle[]>([])
  const [newsSector, setNewsSector] = useState<SectorInfo | null>(null)
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsError, setNewsError] = useState('')

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
    storage.setView({ range, normalized })
  }, [range, normalized])
  useEffect(() => {
    storage.setAnchors(anchors)
  }, [anchors])

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

  // 点击净值曲线 -> 检索新闻（带入基金领域关键词）
  const onPointClick = useCallback(
    (date: string, fundCode: string) => {
      setNewsQuery({ date, fundCode })
      setNewsError('')
      setNewsArticles([])
      setNewsSector(null)
      setNewsLoading(true)
      api
        .searchNews(date, fundCode)
        .then(({ articles, sector }) => {
          setNewsArticles(articles)
          setNewsSector(sector)
        })
        .catch((err) => setNewsError((err as Error).message))
        .finally(() => setNewsLoading(false))
    },
    []
  )

  // 锚定新闻
  const anchorNews = useCallback(
    (article: NewsArticle) => {
      if (!newsQuery) return
      const anchor: AnchorNews = {
        id: `${newsQuery.date}-${article.url}-${Date.now()}`,
        date: newsQuery.date,
        timestamp: new Date(newsQuery.date).getTime(),
        fundCode: newsQuery.fundCode,
        title: article.title,
        url: article.url,
        source: article.source,
        category: article.category,
        impact: article.impact,
        pinnedAt: Date.now(),
      }
      setAnchors((prev) => {
        // 同一日期同一 URL 去重
        const filtered = prev.filter((a) => !(a.date === anchor.date && a.url === anchor.url))
        const next = [...filtered, anchor]
        storage.setAnchors(next)
        return next
      })
    },
    [newsQuery]
  )

  // 取消锚定
  const removeAnchor = useCallback((id: string) => {
    setAnchors((prev) => {
      const next = prev.filter((a) => a.id !== id)
      storage.setAnchors(next)
      return next
    })
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
        normalized={normalized}
        onNormalizedChange={setNormalized}
        mainTab={mainTab}
        onMainTabChange={setMainTab}
      />
      {mainTab === 'analysis' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 360px', gap: '12px', padding: '12px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* 左侧：基金列表 */}
          <div style={{ ...styles.card, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <FundList
              funds={funds}
              selectedCode={selectedCode}
              onSelect={setSelectedCode}
              onRemove={removeFund}
            />
          </div>
          {/* 中间：图表 + 指标 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ ...styles.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '16px' }}>
              <NavChartPanel
                funds={loadedFunds}
                range={range}
                normalized={normalized}
                anchors={anchors}
                onPointClick={onPointClick}
                newsQuery={newsQuery}
              />
            </div>
            <div style={{ ...styles.card, padding: '12px 16px' }}>
              <MetricsPanel funds={loadedFunds} range={range} />
            </div>
          </div>
          {/* 右侧：重仓股 + 新闻 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ ...styles.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <HoldingsPanel fund={selectedFund} range={range} normalized={normalized} />
            </div>
            <div style={{ ...styles.card, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <NewsPanel
                query={newsQuery}
                articles={newsArticles}
                sector={newsSector}
                loading={newsLoading}
                error={newsError}
                anchors={anchors}
                onAnchor={anchorNews}
                onRemoveAnchor={removeAnchor}
                funds={funds}
              />
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
