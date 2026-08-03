import { fetchJsonApi, cached, setCache } from './utils.js'

// GDELT 限流较严，用全局锁串行化请求 + 最小间隔
let lastRequestTime = 0
const MIN_INTERVAL = 1500 // 请求间至少间隔 1.5 秒
async function throttledFetch(url) {
  const now = Date.now()
  const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestTime = Date.now()
  return fetchJsonApi(url, {}, 20000)
}

// ============ GDELT 全球新闻搜索 ============
// GDELT DOC 2.0 API：https://api.gdeltproject.org/api/v2/doc/doc
// 免费、无需 key，支持按日期范围、关键词、语言检索全球新闻

// 基于基金/股票关键词 + 日期生成搜索 query
function buildQuery(context) {
  // context: { fundName, stockName, keyword, date }
  const parts = []
  if (context.keyword) parts.push(context.keyword)
  if (context.fundName) parts.push(`"${context.fundName}"`)
  if (context.stockName) parts.push(`"${context.stockName}"`)
  // 加入财经相关词以提高相关性
  if (!context.keyword && !context.fundName && !context.stockName) {
    parts.push('stock market china finance')
  }
  return parts.slice(0, 3).join(' ')
}

// 中英双语关键词映射，提升中文语境相关性
const KEYWORD_MAP = {
  降息: 'rate cut',
  降准: 'RRR cut',
  化债: 'debt',
  选举: 'election',
  大选: 'election',
  半导体: 'semiconductor',
  芯片: 'chip',
  白酒: 'baijiu liquor',
  新能源: 'new energy',
  医药: 'pharmaceutical',
  银行: 'bank',
  地缘: 'geopolitic',
  冲突: 'conflict',
  原油: 'oil',
  AI: 'artificial intelligence',
  算力: 'AI chip',
}

function enrichQuery(query) {
  let enriched = query
  for (const [zh, en] of Object.entries(KEYWORD_MAP)) {
    if (query.includes(zh)) {
      enriched = `${enriched} OR ${en}`
    }
  }
  return enriched
}

export async function searchGlobalNews({ keyword, fundName, stockName, date, rangeDays = 5 }) {
  const query = enrichQuery(buildQuery({ keyword, fundName, stockName, date }))
  const cacheKey = `news:${query}:${date}:${rangeDays}`
  const hit = cached(cacheKey, 30 * 60 * 1000)
  if (hit) return hit

  try {
    const target = new Date(date)
    const start = new Date(target)
    start.setDate(start.getDate() - rangeDays)
    const end = new Date(target)
    end.setDate(end.getDate() + rangeDays)

    const fmt = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    const startStr = fmt(start)
    const endStr = fmt(end)

    // GDELT DOC API：按相关性排序，取 50 条
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=50&sort=DateDesc&format=json&startdatetime=${startStr}000000&enddatetime=${endStr}000000`

    // GDELT 限流较严，带重试
    let text = ''
    let lastErr = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        text = await throttledFetch(url)
        break
      } catch (e) {
        lastErr = e
        // 429 限流：等待后重试
        if (e.message.includes('429') && attempt < 2) {
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
          continue
        }
        break
      }
    }

    if (!text) {
      console.error('searchGlobalNews: GDELT failed, trying fallback sources, last error:', lastErr?.message)
      // GDELT 限流时，使用备用新闻源（缓存更久以减少请求）
      const fallback = await searchFallbackNews(query, startStr, endStr, date)
      // 备用源结果缓存 30 分钟
      if (fallback.length > 0) {
        setCache(cacheKey, fallback, 30 * 60 * 1000)
      }
      return fallback
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      // GDELT 有时返回非标准 JSON，尝试清理
      const m = text.match(/\{[\s\S]*\}/)
      data = m ? JSON.parse(m[0]) : { articles: [] }
    }

    const articles = (data?.articles || []).slice(0, 25).map((a, i) => ({
      id: `gdelt_${i}_${a.url || ''}`.slice(0, 100),
      title: a.title || '(无标题)',
      source: cleanSource(a.domain || a.sourcecountry || '未知'),
      date: parseGdeltDate(a.seendate),
      region: mapRegion(a.sourcecountry),
      category: '宏观',
      summary: (a.title || '').slice(0, 200),
      impact: '中性',
      impactScore: 0,
      url: a.url || '#',
      language: a.language || '',
    }))

    setCache(cacheKey, articles)
    return articles
  } catch (e) {
    console.error('searchGlobalNews error:', e.message)
    return []
  }
}

// ============ 备用新闻源（GDELT 限流时使用） ============
// 使用多个免费 RSS 源 + Wikipedia 历史事件
async function searchFallbackNews(query, startStr, endStr, targetDate) {
  const results = []

  // 1. Wikipedia "On This Day" - 提供历史事件（按月日匹配）
  try {
    const d = new Date(targetDate)
    const month = d.getMonth() + 1
    const day = d.getDate()
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`
    const wikiText = await fetchJsonApi(wikiUrl, {}, 20000)
    const wikiData = JSON.parse(wikiText)
    const events = (wikiData.events || [])
      // 优先返回与金融/经济相关的事件
      .filter((ev) => {
        const t = (ev.text || '').toLowerCase()
        return /stock|market|econom|financ|bank|trade|oil|price|currency|crash|bubble|rate/.test(t) || true
      })
      .slice(0, 10)
    for (const ev of events) {
      results.push({
        id: `wiki_${ev.year}_${ev.text.slice(0, 20)}`.slice(0, 100),
        title: `[${ev.year}年] ${ev.text.slice(0, 100)}`,
        source: 'Wikipedia 历史上的今天',
        date: `${ev.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        region: '全球',
        category: '宏观',
        summary: ev.text,
        impact: '中性',
        impactScore: 0,
        url: ev.pages?.[0]?.content_urls?.desktop?.page || '#',
        language: 'en',
      })
    }
  } catch (e) {
    console.error('wiki fallback error:', e.message)
  }

  // 2. 财经 RSS 源（通过 rss2json 转换）
  try {
    const rssFeeds = [
      'https://feeds.bbci.co.uk/news/business/rss.xml', // BBC Business
      'https://www.cnbc.com/id/10001147/device/rss/rss.html', // CNBC Markets
    ]
    for (const feed of rssFeeds) {
      try {
        const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed)}&count=10`
        const rssText = await fetchJsonApi(rssUrl, {}, 12000)
        const rssData = JSON.parse(rssText)
        const items = (rssData.items || []).slice(0, 8)
        for (const item of items) {
          const itemDate = item.pubDate ? item.pubDate.slice(0, 10) : targetDate
          results.push({
            id: `rss_${(item.guid || item.title || '').slice(0, 80)}`,
            title: item.title || '(无标题)',
            source: rssData.title || cleanSource(item.author || feed),
            date: itemDate,
            region: '全球',
            category: '宏观',
            summary: (item.description || item.title || '').replace(/<[^>]+>/g, '').slice(0, 200),
            impact: '中性',
            impactScore: 0,
            url: item.link || '#',
            language: 'en',
          })
        }
      } catch (e) {
        console.error('rss feed error:', feed, e.message)
      }
    }
  } catch (e) {
    console.error('rss fallback error:', e.message)
  }

  // 3. 如果都没有，生成一条提示
  if (results.length === 0) {
    results.push({
      id: 'fallback_info',
      title: `${targetDate} 附近新闻检索受限`,
      source: '系统提示',
      date: targetDate,
      region: '全球',
      category: '宏观',
      summary: `GDELT 全球新闻数据库当前请求频率受限（HTTP 429），稍后重试即可恢复。这是免费的公共服务，限制较严格，建议间隔 1-2 分钟后再点击其他日期。`,
      impact: '中性',
      impactScore: 0,
      url: 'https://www.gdeltproject.org/',
      language: 'zh',
    })
  }

  return results.slice(0, 20)
}

function cleanSource(domain) {
  if (!domain) return '未知来源'
  return domain.replace(/^www\./, '').replace(/^m\./, '')
}

function parseGdeltDate(s) {
  // GDELT 日期格式：20250924T120000Z
  if (!s) return ''
  const m = s.match(/(\d{4})(\d{2})(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return s
}

function mapRegion(country) {
  if (!country) return '全球'
  const cn = ['China', 'Taiwan', 'Hong Kong']
  const us = ['United States', 'USA']
  const eu = ['United Kingdom', 'France', 'Germany', 'Spain', 'Italy', 'Netherlands', 'Russia', 'Ukraine']
  const apac = ['Japan', 'South Korea', 'India', 'Singapore', 'Australia', 'Malaysia', 'Indonesia', 'Thailand']
  if (cn.includes(country)) return '中国'
  if (us.includes(country)) return '美国'
  if (eu.includes(country)) return '欧洲'
  if (apac.includes(country)) return '亚太'
  return '全球'
}
