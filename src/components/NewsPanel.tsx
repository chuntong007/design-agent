import React, { useEffect, useState, useCallback } from 'react'
import { Newspaper, MapPin, Anchor, X, ExternalLink, TrendingUp, TrendingDown, Minus, Globe2, Search, Loader2, AlertCircle, RefreshCw, Languages, Pin } from 'lucide-react'
import type { NewsItem, Fund, PinnedNews } from '../types'
import { fundApi } from '../api'
import { Badge } from './UI'
import { clsx } from 'clsx'

interface Props {
  triggerFund: Fund | null
  triggerDate: string | null
  triggerNav: number | null
  anchorInfo: { fund: Fund; date: string; nav: number } | null
  onAnchor: (info: { fund: Fund; date: string; nav: number } | null) => void
  onClose: () => void
  pinnedNews: PinnedNews | null
  onPinNews: (info: PinnedNews | null) => void
}

const REGION_ICON: Record<string, React.ReactNode> = {
  全球: <Globe2 size={12} />,
  中国: <span className="text-[10px]">🇨🇳</span>,
  美国: <span className="text-[10px]">🇺🇸</span>,
  欧洲: <span className="text-[10px]">🇪🇺</span>,
  亚太: <span className="text-[10px]">🌏</span>,
  地缘: <MapPin size={12} />,
}

const CATEGORY_COLORS: Record<string, string> = {
  宏观: '#6366f1',
  行业: '#10b981',
  公司: '#f59e0b',
  政策: '#ef4444',
  地缘: '#8b5cf6',
}

function impactStyle(item: NewsItem) {
  if (item.impact === '利好') return { color: '#dc2626', icon: <TrendingUp size={13} />, label: '利好' }
  if (item.impact === '利空') return { color: '#059669', icon: <TrendingDown size={13} />, label: '利空' }
  return { color: '#64748b', icon: <Minus size={13} />, label: '中性' }
}

export const NewsPanel: React.FC<Props> = ({ triggerFund, triggerDate, triggerNav, anchorInfo, onAnchor, onClose, pinnedNews, onPinNews }) => {
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [anchorNews, setAnchorNews] = useState<NewsItem[]>([])
  const [anchorLoading, setAnchorLoading] = useState(false)

  // 翻译状态：记录正在翻译的新闻 id 和已翻译的标题
  const [translatingId, setTranslatingId] = useState<string | null>(null)
  const [translatedMap, setTranslatedMap] = useState<Record<string, { title: string; summary: string }>>({})

  // 翻译单条新闻（标题 + 摘要）
  const handleTranslate = useCallback(async (item: NewsItem) => {
    if (translatedMap[item.id]) return // 已翻译
    setTranslatingId(item.id)
    try {
      const [title, summary] = await Promise.all([
        fundApi.translate(item.title),
        item.summary && item.summary !== item.title ? fundApi.translate(item.summary) : Promise.resolve(''),
      ])
      setTranslatedMap((prev) => ({ ...prev, [item.id]: { title, summary } }))
    } catch (e) {
      console.error('翻译失败:', e)
    } finally {
      setTranslatingId(null)
    }
  }, [translatedMap])

  // 当前触发点是否已有锚定新闻
  const isCurrentPinned = pinnedNews && pinnedNews.date === triggerDate && pinnedNews.fundCode === triggerFund?.code

  // 选中/取消选中某条新闻作为锚定新闻
  const handlePinNews = (item: NewsItem) => {
    if (isCurrentPinned && pinnedNews?.news.id === item.id) {
      onPinNews(null)
      return
    }
    if (triggerFund && triggerDate && triggerNav != null) {
      onPinNews({
        news: item,
        fundCode: triggerFund.code,
        fundName: triggerFund.name,
        date: triggerDate,
        nav: triggerNav,
      })
      // 同时锚定该净值点，让图表显示锚定线和 📰 新闻标注
      onAnchor({ fund: triggerFund, date: triggerDate, nav: triggerNav })
    }
  }

  // 检索当前触发日期附近的新闻（±7 天）
  const fetchNews = React.useCallback(async () => {
    if (!triggerDate) {
      setNews([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const list = await fundApi.searchNews({
        date: triggerDate,
        keyword: 'stock market china finance',
        fundName: triggerFund?.name,
        rangeDays: 7,
      })
      setNews(list)
    } catch (e: any) {
      setError(e.message || '新闻检索失败')
      setNews([])
    } finally {
      setLoading(false)
    }
  }, [triggerDate, triggerFund])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  // 检索锚定日期附近的新闻做对照
  useEffect(() => {
    if (!anchorInfo) {
      setAnchorNews([])
      return
    }
    setAnchorLoading(true)
    fundApi
      .searchNews({
        date: anchorInfo.date,
        keyword: 'stock market china finance',
        fundName: anchorInfo.fund.name,
        rangeDays: 7,
      })
      .then(setAnchorNews)
      .catch(() => setAnchorNews([]))
      .finally(() => setAnchorLoading(false))
  }, [anchorInfo])

  const isAnchored = anchorInfo && triggerDate === anchorInfo.date && triggerFund?.id === anchorInfo.fund.id

  const handleAnchor = () => {
    if (isAnchored) {
      onAnchor(null)
    } else if (triggerFund && triggerDate && triggerNav != null) {
      onAnchor({ fund: triggerFund, date: triggerDate, nav: triggerNav })
    }
  }

  return (
    <div className="h-full flex flex-col animate-slide-up">
      {/* 头部 */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-brand-50/60 to-amber-50/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-amber-500 flex items-center justify-center text-white shadow-md">
            <Search size={18} />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              全球新闻关联检索
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-white font-medium">AI</span>
            </h2>
            <p className="text-xs text-slate-500">
              {triggerFund && triggerDate
                ? `已检索「${triggerFund.name}」${triggerDate} 附近 ±7 日全球资讯`
                : '点击左侧净值曲线任意点位以检索新闻'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg hover:bg-white/60 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* 触发上下文 */}
      {triggerFund && triggerDate && (
        <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-400">触发点：</span>
            <span className="font-semibold text-slate-700" style={{ color: triggerFund.color }}>
              {triggerFund.name}
            </span>
            <span className="text-slate-300">|</span>
            <span className="tabular-nums text-slate-600">{triggerDate}</span>
            <span className="text-slate-300">|</span>
            <span className="tabular-nums font-semibold text-slate-800">
              净值 {triggerNav?.toFixed(4) ?? '--'}
            </span>
          </div>
          <button
            onClick={handleAnchor}
            className={clsx(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200',
              isAnchored
                ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30 hover:bg-amber-600'
                : 'bg-white text-amber-600 border border-amber-200 hover:bg-amber-50',
            )}
          >
            <Anchor size={14} />
            {isAnchored ? '已锚定 · 点击取消' : '锚定此净值点'}
          </button>
        </div>
      )}

      {/* 锚定对照条 */}
      {anchorInfo && (
        <div className="px-5 py-2.5 bg-amber-50/70 border-b border-amber-100 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Anchor size={13} className="text-amber-600" />
              <span className="text-amber-700 font-medium">当前锚定：</span>
              <span className="font-semibold text-slate-700" style={{ color: anchorInfo.fund.color }}>
                {anchorInfo.fund.name}
              </span>
              <span className="text-slate-400">{anchorInfo.date}</span>
              <span className="tabular-nums text-slate-600">净值 {anchorInfo.nav.toFixed(4)}</span>
            </div>
            <div className="text-xs text-amber-600">
              切换其他净值时，可对照锚定时期事件
            </div>
          </div>
          {/* 已选锚定新闻 */}
          {pinnedNews && (
            <div className="flex items-center gap-2 bg-white/70 rounded-lg px-2.5 py-1.5 border border-amber-200/60">
              <Pin size={12} className="shrink-0 text-amber-500" />
              <span className="text-[11px] text-amber-800 font-medium truncate flex-1">
                {pinnedNews.news.title}
              </span>
              <button
                onClick={() => onPinNews(null)}
                className="shrink-0 text-slate-400 hover:text-rose-500 transition-colors"
                title="取消锚定新闻"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
            <Loader2 size={36} className="mb-3 animate-spin text-brand-400" />
            <p className="text-sm">正在检索全球新闻...</p>
            <p className="text-xs mt-1 text-slate-400">来源：GDELT 全球新闻数据库</p>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
            <AlertCircle size={36} className="mb-3 text-rose-400" />
            <p className="text-sm text-slate-600">{error}</p>
            <button
              onClick={fetchNews}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-600 text-xs font-medium hover:bg-brand-100 transition-colors"
            >
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        ) : news.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
            <Newspaper size={48} className="mb-3 opacity-40" />
            <p className="text-sm">该日期附近暂无匹配新闻</p>
            <p className="text-xs mt-1">尝试点击其他日期点位</p>
          </div>
        ) : (
          <>
            {/* 当前检索结果 */}
            <div className="space-y-3">
              {news.map((item) => {
                const imp = impactStyle(item)
                const isAnchorMatch = anchorNews.some((a) => a.id === item.id)
                const isPinned = pinnedNews?.news.id === item.id && isCurrentPinned
                const translated = translatedMap[item.id]
                const isTranslating = translatingId === item.id
                return (
                  <div
                    key={item.id}
                    className={clsx(
                      'group relative rounded-xl border p-4 transition-all duration-300 hover:shadow-md cursor-default',
                      isPinned
                        ? 'border-amber-400 bg-amber-50/50 ring-2 ring-amber-300/60'
                        : isAnchorMatch
                          ? 'border-amber-200 bg-amber-50/40 ring-1 ring-amber-200/50'
                          : 'border-slate-200/70 bg-white hover:border-brand-200',
                    )}
                  >
                    {isPinned && (
                      <div className="absolute -top-2 left-3 px-1.5 py-0.5 bg-amber-500 text-white text-[10px] rounded font-medium flex items-center gap-1">
                        <Pin size={9} /> 已锚定新闻
                      </div>
                    )}
                    {isAnchorMatch && !isPinned && (
                      <div className="absolute -top-2 left-3 px-1.5 py-0.5 bg-amber-500 text-white text-[10px] rounded font-medium flex items-center gap-1">
                        <Anchor size={9} /> 锚定同期
                      </div>
                    )}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="text-sm font-semibold text-slate-800 leading-snug group-hover:text-brand-600 transition-colors">
                        {translated ? translated.title : item.title}
                      </h4>
                      <span
                        className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium"
                        style={{ color: imp.color, backgroundColor: imp.color + '14' }}
                      >
                        {imp.icon}
                        {imp.label}
                      </span>
                    </div>
                    {/* 原文小字（翻译后显示） */}
                    {translated && item.language && item.language !== 'zho' && (
                      <p className="text-[11px] text-slate-400 italic leading-relaxed mb-1.5">{item.title}</p>
                    )}
                    <p className="text-xs text-slate-500 leading-relaxed mb-2.5">
                      {translated ? translated.summary || translated.title : item.summary}
                    </p>
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge className="border-slate-200 text-slate-500 bg-slate-50">
                          {REGION_ICON[item.region]}
                          {item.region}
                        </Badge>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{
                            color: CATEGORY_COLORS[item.category],
                            backgroundColor: CATEGORY_COLORS[item.category] + '14',
                          }}
                        >
                          {item.category}
                        </span>
                        <span className="text-xs text-slate-400">{item.source}</span>
                        <span className="text-xs text-slate-400 tabular-nums">{item.date}</span>
                        {item.dateDiff != null && (
                          <span
                            className={clsx(
                              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium',
                              item.dateDiff === 0
                                ? 'bg-emerald-50 text-emerald-600'
                                : item.dateDiff <= 3
                                  ? 'bg-amber-50 text-amber-600'
                                  : 'bg-slate-100 text-slate-500',
                            )}
                            title={`距离点击日期 ${item.dateDiff} 天`}
                          >
                            {item.dateDiff === 0 ? '当日' : `±${item.dateDiff}天`}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 text-[11px] text-slate-400">
                          <span>影响力</span>
                          <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.abs(item.impactScore)}%`,
                                backgroundColor: imp.color,
                              }}
                            />
                          </div>
                          <span className="tabular-nums font-medium" style={{ color: imp.color }}>
                            {item.impactScore > 0 ? '+' : ''}
                            {item.impactScore}
                          </span>
                        </div>
                        {/* 翻译按钮 */}
                        {item.needsTranslation && (
                          <button
                            onClick={() => handleTranslate(item)}
                            disabled={isTranslating}
                            className={clsx(
                              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                              translated
                                ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                                : 'text-slate-400 hover:text-brand-600 hover:bg-brand-50',
                            )}
                            title={translated ? '已翻译' : '翻译为中文'}
                          >
                            {isTranslating ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
                            {translated ? '已翻译' : '翻译'}
                          </button>
                        )}
                        {/* 锚定新闻按钮 */}
                        <button
                          onClick={() => handlePinNews(item)}
                          className={clsx(
                            'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
                            isPinned
                              ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                              : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50',
                          )}
                          title={isPinned ? '取消锚定此新闻' : '锚定此新闻（关联到当前净值点）'}
                        >
                          <Pin size={12} />
                          {isPinned ? '已锚定' : '锚定'}
                        </button>
                        <a href={item.url} target="_blank" rel="noreferrer">
                          <ExternalLink
                            size={13}
                            className="text-slate-300 group-hover:text-brand-500 transition-colors"
                          />
                        </a>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 锚定时期对照（仅当检索日期与锚定日期不同时显示） */}
            {anchorInfo && triggerDate !== anchorInfo.date && (anchorNews.length > 0 || anchorLoading) && (
              <div className="mt-6 pt-5 border-t border-dashed border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <Anchor size={15} className="text-amber-500" />
                  <h3 className="text-sm font-semibold text-slate-700">
                    锚定时期事件对照
                  </h3>
                  <span className="text-xs text-slate-400">
                    {anchorInfo.date} · {anchorInfo.fund.name}
                  </span>
                </div>
                {anchorLoading ? (
                  <div className="flex items-center gap-2 py-4 text-xs text-amber-600">
                    <Loader2 size={14} className="animate-spin" /> 检索锚定时期新闻...
                  </div>
                ) : (
                <div className="space-y-2">
                  {anchorNews.map((item) => {
                    const imp = impactStyle(item)
                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-amber-200/60 bg-amber-50/30 p-3 hover:bg-amber-50/60 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="text-xs font-semibold text-slate-700">{item.title}</h4>
                          <span
                            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                            style={{ color: imp.color, backgroundColor: imp.color + '14' }}
                          >
                            {imp.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">{item.summary}</p>
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-400">
                          <span>{item.region}</span>
                          <span>·</span>
                          <span>{item.source}</span>
                          <span>·</span>
                          <span className="tabular-nums">{item.date}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
