import { useState, useEffect, useMemo } from 'react'
import type { LoadedFund } from '../App'
import type { NewsArticle, SectorInfo } from '../types'
import type { AnchorNews } from '../storage'
import { api } from '../api'
import { makeStyles, type Palette } from '../theme'
import { useTheme } from '../ThemeContext'

interface Props {
  query: { date: string; fundCode: string } | null
  articles: NewsArticle[]
  sector: SectorInfo | null
  market_context?: string
  loading: boolean
  status: { stage: string; message: string } | null
  error: string
  anchors: AnchorNews[]
  onAnchor: (article: NewsArticle) => void
  onRemoveAnchor: (id: string) => void
  funds: LoadedFund[]
}

export function NewsPanel({ query, articles, sector, market_context, loading, status, error, anchors, onAnchor, onRemoveAnchor, funds }: Props) {
  const { palette: p } = useTheme()
  const styles = makeStyles(p)
  const [tab, setTab] = useState<'current' | 'anchored'>('current')

  // 有查询时自动切到 current；无查询且有锚点时切到 anchored
  useEffect(() => {
    if (query) setTab('current')
    else if (anchors.length > 0) setTab('anchored')
  }, [query, anchors.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${p.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ ...styles.label }}>全球新闻资讯</span>
          {query && (
            <span style={{ fontSize: '11px', color: p.accent }}>
              {query.date} ±7天
            </span>
          )}
        </div>
        {query && sector && sector.sectors.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: p.text2 }}>基金领域：</span>
            {sector.sectors.map((s) => (
              <span key={s} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: p.accentDim, color: p.accent }}>
                {s}
              </span>
            ))}
          </div>
        )}
        {query && (
          <div style={{ fontSize: '11px', color: p.text2, marginTop: '4px' }}>
            {sector ? '已按基金领域精准检索' : '点击净值曲线点位检索'} · 可锚定到图表对照
          </div>
        )}
      </div>

      {/* Tab */}
      <div style={{ display: 'flex', gap: '2px', padding: '6px 8px', borderBottom: `1px solid ${p.border}` }}>
        <button
          onClick={() => setTab('current')}
          style={tabBtnStyle(p, tab === 'current')}
        >
          当前检索 ({articles.length})
        </button>
        <button
          onClick={() => setTab('anchored')}
          style={tabBtnStyle(p, tab === 'anchored')}
        >
          已锚定 ({anchors.length})
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {tab === 'current' && (
          <CurrentView
            query={query}
            articles={articles}
            market_context={market_context}
            loading={loading}
            status={status}
            error={error}
            anchors={anchors}
            onAnchor={onAnchor}
          />
        )}
        {tab === 'anchored' && (
          <AnchoredView anchors={anchors} onRemove={onRemoveAnchor} funds={funds} />
        )}
      </div>
    </div>
  )
}

function tabBtnStyle(p: Palette, active: boolean): React.CSSProperties {
  return {
    background: active ? p.bg3 : 'transparent',
    color: active ? p.text0 : p.text1,
    border: 'none',
    borderRadius: '4px',
    padding: '5px 10px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: 500,
  }
}

function CurrentView({
  query,
  articles,
  market_context,
  loading,
  status,
  error,
  anchors,
  onAnchor,
}: {
  query: { date: string; fundCode: string } | null
  articles: NewsArticle[]
  market_context?: string
  loading: boolean
  status: { stage: string; message: string } | null
  error: string
  anchors: AnchorNews[]
  onAnchor: (a: NewsArticle) => void
}) {
  const { palette: p } = useTheme()
  if (!query) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center', color: p.text2, fontSize: '12px' }}>
        点击净值曲线任意点位
        <br />
        检索该日期 ±7 天的全球新闻
      </div>
    )
  }
  // 流式加载中且尚无文章：显示进度状态
  if (loading && articles.length === 0) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        {status ? (
          <>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: p.accent,
              marginBottom: '8px',
            }}>
              <span style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                border: `2px solid ${p.accent}`,
                borderTopColor: 'transparent',
                animation: 'news-spin 0.8s linear infinite',
              }} />
              {status.message}
            </div>
            <StageIndicator stage={status.stage} palette={p} />
          </>
        ) : (
          <div style={{ fontSize: '12px', color: p.text2 }}>正在检索全球新闻...</div>
        )}
        <style>{`@keyframes news-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }
  // 加载完成但有错误且无文章
  if (error && articles.length === 0) {
    return <div style={{ padding: '20px', textAlign: 'center', color: p.impactNegative, fontSize: '12px' }}>检索失败：{error}</div>
  }
  // 流式加载中但已有文章：显示已收到的文章 + 底部加载条
  if (articles.length === 0 && !loading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: p.text2, fontSize: '12px' }}>该时期暂无新闻数据</div>
  }

  return (
    <div style={{ padding: '6px' }}>
      {market_context && (
        <div
          style={{
            padding: '8px 10px',
            margin: '4px 0 8px',
            borderRadius: '6px',
            background: p.accentSoft,
            border: `1px solid ${p.accentDim}`,
          }}
        >
          <div style={{ fontSize: '10px', color: p.accent, fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            AI 市场概述
          </div>
          <div style={{ fontSize: '11px', lineHeight: 1.5, color: p.text1 }}>{market_context}</div>
        </div>
      )}
      {articles.map((a, i) => (
        <NewsCard
          key={i}
          article={a}
          isAnchored={anchors.some((x) => x.date === query.date && x.url === a.url)}
          onAnchor={() => onAnchor(a)}
        />
      ))}
      {/* 流式加载中：底部持续显示进度 */}
      {loading && articles.length > 0 && status && (
        <div style={{
          padding: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '11px',
          color: p.accent,
        }}>
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            border: `2px solid ${p.accent}`,
            borderTopColor: 'transparent',
            animation: 'news-spin 0.8s linear infinite',
          }} />
          {status.message} · 已收到 {articles.length} 条
        </div>
      )}
      <style>{`@keyframes news-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// 阶段指示器：搜索中 -> 分析中 -> 完成
function StageIndicator({ stage, palette: p }: { stage: string; palette: Palette }) {
  const stages = [
    { key: 'searching', label: '搜索' },
    { key: 'analyzing', label: '分析' },
    { key: 'done', label: '完成' },
  ]
  const activeIdx = stages.findIndex((s) => s.key === stage)
  if (activeIdx === -1) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginTop: '6px' }}>
      {stages.map((s, i) => (
        <div
          key={s.key}
          style={{
            width: '28px',
            height: '3px',
            borderRadius: '2px',
            background: i <= activeIdx ? p.accent : p.border,
            transition: 'background 0.3s',
          }}
        />
      ))}
    </div>
  )
}

function NewsCard({
  article,
  isAnchored,
  onAnchor,
}: {
  article: NewsArticle
  isAnchored: boolean
  onAnchor: () => void
}) {
  const { palette: p } = useTheme()
  const [translated, setTranslated] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [showOriginal, setShowOriginal] = useState(true)

  const isNonChinese = useMemo(() => {
    // 计算中文字符占比，低于 30% 视为非中文（需翻译）
    const chineseChars = (article.title.match(/[\u4e00-\u9fa5]/g) || []).length
    const totalChars = article.title.length
    return totalChars > 0 && chineseChars / totalChars < 0.3
  }, [article.title])

  const handleTranslate = async () => {
    if (translated) {
      setShowOriginal(!showOriginal)
      return
    }
    setTranslating(true)
    try {
      const t = await api.translate(article.title, 'en', 'zh-CN')
      setTranslated(t)
      setShowOriginal(false)
    } catch {
      setTranslated('翻译失败')
    } finally {
      setTranslating(false)
    }
  }

  const impactColor =
    article.impact === 'positive' ? p.impactPositive : article.impact === 'negative' ? p.impactNegative : p.impactNeutral
  const sourceLabel =
    article.source === 'gdelt' ? 'GDELT' :
    article.source === 'wikipedia' ? 'Wikipedia' :
    article.source === 'llm' ? 'AI 分析' : '新浪'
  const hasLLMFields = article.source === 'llm' || !!(article.summary || article.impact_reason || article.relevance !== undefined || article.affected_sectors)

  return (
    <div
      style={{
        padding: '10px 12px',
        margin: '4px 0',
        borderRadius: '6px',
        background: p.bg2,
        border: `1px solid ${p.border}`,
      }}
    >
      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <span style={{ ...badgeStyle, background: `${impactColor}22`, color: impactColor }}>
          {article.impact === 'positive' ? '利好' : article.impact === 'negative' ? '利空' : '中性'}
        </span>
        <span style={{ ...badgeStyle, background: `${p.accent}22`, color: p.accent }}>{article.category}</span>
        <span style={{ ...badgeStyle, background: p.bg3, color: p.text1 }}>{sourceLabel}</span>
        {article.sourceCountry && (
          <span style={{ ...badgeStyle, background: p.bg3, color: p.text1 }}>{article.sourceCountry}</span>
        )}
        <span style={{ ...badgeStyle, background: p.bg3, color: p.text2 }}>{article.date}</span>
      </div>
      <div style={{ fontSize: '12px', lineHeight: 1.5, color: p.text0, marginBottom: '6px' }}>
        {showOriginal ? article.title : translated || article.title}
      </div>
      {/* LLM 归因字段 */}
      {hasLLMFields && (
        <div style={{ marginBottom: '6px' }}>
          {article.summary && (
            <div style={{ fontSize: '11px', lineHeight: 1.5, color: p.text2, fontStyle: 'italic', marginBottom: '4px' }}>
              {article.summary}
            </div>
          )}
          {article.impact_reason && (
            <div style={{ fontSize: '11px', lineHeight: 1.4, color: p.text2, marginBottom: '4px' }}>
              <span style={{ color: impactColor, fontWeight: 500 }}>影响推理：</span>
              {article.impact_reason}
            </div>
          )}
          {article.relevance !== undefined && article.relevance !== null && (
            <RelevanceBar value={article.relevance} palette={p} />
          )}
          {article.affected_sectors && article.affected_sectors.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '10px', color: p.text2 }}>影响领域：</span>
              {article.affected_sectors.map((s, si) => (
                <span key={si} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: p.accentDim, color: p.accent }}>
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        {article.url ? (
          <a href={article.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: p.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {article.domain || article.url}
          </a>
        ) : (
          <span style={{ fontSize: '11px', color: p.text2, flex: 1 }}>无链接</span>
        )}
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {isNonChinese && (
            <button
              onClick={handleTranslate}
              disabled={translating}
              style={miniBtnStyle(p)}
              title="翻译为中文"
            >
              {translating ? '翻译中...' : translated ? (showOriginal ? '看译文' : '看原文') : '翻译'}
            </button>
          )}
          <button
            onClick={onAnchor}
            disabled={isAnchored}
            style={{
              ...miniBtnStyle(p),
              background: isAnchored ? `${p.accent}22` : 'transparent',
              color: isAnchored ? p.accent : p.text1,
              borderColor: isAnchored ? p.accent : p.border,
              cursor: isAnchored ? 'default' : 'pointer',
            }}
            title="锚定到净值点位"
          >
            {isAnchored ? '✓ 已锚定' : '锚定'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AnchoredView({
  anchors,
  onRemove,
  funds,
}: {
  anchors: AnchorNews[]
  onRemove: (id: string) => void
  funds: LoadedFund[]
}) {
  const { palette: p } = useTheme()
  if (anchors.length === 0) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center', color: p.text2, fontSize: '12px' }}>
        尚无锚定新闻
        <br />
        在检索结果中点击"锚定"将新闻标注到图表
      </div>
    )
  }
  // 按日期排序
  const sorted = [...anchors].sort((a, b) => a.timestamp - b.timestamp)
  return (
    <div style={{ padding: '6px' }}>
      <div style={{ padding: '6px 8px', fontSize: '11px', color: p.text2, marginBottom: '4px' }}>
        跨时期事件对照（按时间排序）
      </div>
      {sorted.map((a) => {
        const fund = funds.find((f) => f.code === a.fundCode)
        const impactColor =
          a.impact === 'positive' ? p.impactPositive : a.impact === 'negative' ? p.impactNegative : p.impactNeutral
        return (
          <div
            key={a.id}
            style={{
              padding: '10px 12px',
              margin: '4px 0',
              borderRadius: '6px',
              background: p.bg2,
              border: `1px solid ${p.border}`,
              borderLeft: `3px solid ${impactColor}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: p.text0, fontFamily: '"JetBrains Mono", monospace' }}>
                  {a.date}
                </span>
                {fund && (
                  <span style={{ fontSize: '10px', color: p.text2, background: p.bg3, padding: '1px 6px', borderRadius: '3px' }}>
                    {fund.detail?.name || fund.name}
                  </span>
                )}
              </div>
              <button
                onClick={() => onRemove(a.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: p.text2,
                  cursor: 'pointer',
                  fontSize: '12px',
                  padding: '0 4px',
                }}
                title="取消锚定"
              >
                ×
              </button>
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.4, color: p.text1, marginBottom: '6px' }}>
              {a.title}
            </div>
            {a.summary && (
              <div style={{ fontSize: '11px', lineHeight: 1.4, color: p.text2, fontStyle: 'italic', marginBottom: '4px' }}>
                {a.summary}
              </div>
            )}
            {a.impact_reason && (
              <div style={{ fontSize: '11px', lineHeight: 1.4, color: p.text2, marginBottom: '6px' }}>
                <span style={{ color: impactColor, fontWeight: 500 }}>影响推理：</span>
                {a.impact_reason}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ ...badgeStyle, background: `${impactColor}22`, color: impactColor }}>
                {a.impact === 'positive' ? '利好' : a.impact === 'negative' ? '利空' : '中性'}
              </span>
              <span style={{ ...badgeStyle, background: `${p.accent}22`, color: p.accent }}>{a.category}</span>
              {a.url && (
                <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: p.text2 }}>
                  原文
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const badgeStyle: React.CSSProperties = {
  fontSize: '10px',
  padding: '2px 6px',
  borderRadius: '3px',
  fontWeight: 500,
  lineHeight: 1.4,
}

function miniBtnStyle(p: Palette): React.CSSProperties {
  return {
    background: 'transparent',
    color: p.text1,
    border: `1px solid ${p.border}`,
    borderRadius: '4px',
    padding: '3px 8px',
    fontSize: '11px',
    cursor: 'pointer',
    fontWeight: 500,
  }
}

// 相关度评分条:0-100%,颜色随分值变化(低=灰,中=蓝,高=绿)
function RelevanceBar({ value, palette: p }: { value: number; palette: Palette }) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const color = pct >= 70 ? p.impactPositive : pct >= 40 ? p.accent : p.text2
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
      <span style={{ fontSize: '10px', color: p.text2, minWidth: '42px' }}>相关度</span>
      <div style={{ flex: 1, maxWidth: '120px', height: '4px', borderRadius: '2px', background: p.bg3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '2px', background: color, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: '10px', color, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, minWidth: '32px' }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}
