// 全球新闻检索：GDELT 优先（走代理）+ 国内源降级
// GDELT 限流极严（连续 2-3 次 429，恢复需 1-5 分钟），必须串行化 + 缓存 + 降级
//
// 数据源优先级：
// 1. GDELT ArtList（全球新闻，含中文媒体）
// 2. Wikipedia "On This Day"（历史事件，国内可达）
// 3. 新浪财经滚动新闻（国内可达，仅近期）
import { httpGet } from '../utils/http'
import { cacheGet, cacheSet, sleep } from '../utils/cache'

export interface NewsArticle {
  title: string
  url: string
  date: string // YYYY-MM-DD
  domain: string
  sourceCountry: string
  language: string
  // 影响判断（基于关键词的简易分类）
  impact: 'positive' | 'negative' | 'neutral'
  // 分类
  category: string
  source: 'gdelt' | 'wikipedia' | 'sina'
}

// ===== 全局串行锁（GDELT 限流刚需）=====
let newsLock: Promise<unknown> = Promise.resolve()
function withNewsLock<T>(task: () => Promise<T>): Promise<T> {
  const run = newsLock.then(task, task)
  // 链式串行：下一个请求必须等前一个完成
  newsLock = run.then(
    () => undefined,
    () => undefined
  )
  return run as Promise<T>
}

// ===== 主入口：检索某日期 ±7 天的全球新闻 =====
// sectors: 基金领域关键词（用于精准检索，可选）
export async function searchNews(centerDate: string, sectors: string[] = []): Promise<NewsArticle[]> {
  const cacheKey = `news:${centerDate}:${sectors.join(',')}`
  const cached = cacheGet<NewsArticle[]>(cacheKey)
  if (cached) return cached

  const result = await withNewsLock(async () => {
    // 1) 尝试 GDELT（走代理，带入领域词）
    try {
      const articles = await searchByGdelt(centerDate, sectors)
      if (articles.length > 0) {
        cacheSet(cacheKey, articles, 30 * 60 * 1000) // 30 分钟
        return articles
      }
    } catch (err) {
      console.warn(`[news] GDELT failed for ${centerDate}:`, (err as Error).message)
    }
    // 2) 降级到 Wikipedia 历史事件
    try {
      const articles = await searchByWikipedia(centerDate)
      if (articles.length > 0) {
        cacheSet(cacheKey, articles, 30 * 60 * 1000)
        return articles
      }
    } catch (err) {
      console.warn(`[news] Wikipedia failed for ${centerDate}:`, (err as Error).message)
    }
    // 3) 最终降级到新浪财经滚动新闻（仅近期有效）
    try {
      const articles = await searchBySina()
      if (articles.length > 0) {
        cacheSet(cacheKey, articles, 15 * 60 * 1000)
        return articles
      }
    } catch (err) {
      console.warn(`[news] Sina failed:`, (err as Error).message)
    }
    return []
  })

  return result
}

// ===== GDELT =====
// sectors: 基金领域关键词，用于聚焦检索
async function searchByGdelt(centerDate: string, sectors: string[] = []): Promise<NewsArticle[]> {
  const c = new Date(centerDate)
  const start = new Date(c.getTime() - 7 * 24 * 3600 * 1000)
  const end = new Date(c.getTime() + 7 * 24 * 3600 * 1000)
  const sd = gdeltDate(start)
  const ed = gdeltDate(end)
  // 构建查询：领域词优先，混合中英文
  // GDELT 查询语法：OR 必须在同一字段内，用括号分组
  let queryStr: string
  if (sectors.length > 0) {
    // 取前 6 个领域词，避免查询过长
    const terms = sectors.slice(0, 6).map((s) => s.replace(/["'()]/g, '')).filter(Boolean)
    // 区分中文和英文词
    const cnTerms = terms.filter((t) => /[\u4e00-\u9fa5]/.test(t))
    const enTerms = terms.filter((t) => !/[\u4e00-\u9fa5]/.test(t))
    const parts: string[] = []
    if (cnTerms.length) parts.push(`(${cnTerms.join(' OR ')})`)
    if (enTerms.length) parts.push(`(${enTerms.join(' OR ')})`)
    queryStr = encodeURIComponent(`${parts.join(' ')} sourcelang:chi|eng`)
  } else {
    queryStr = encodeURIComponent('(China OR economy OR market OR 股市 OR 经济) sourcelang:chi|eng')
  }
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${queryStr}&mode=ArtList&maxrecords=50&sort=DateDesc&format=json&startdatetime=${sd}000000&enddatetime=${ed}000000`
  // GDELT 通过代理较慢，超时给足
  const text = await httpGet(url, {
    useProxy: true,
    timeout: 45000,
    retries: 2,
    retryBase: 3000,
  })
  // GDELT 有时返回错误页面（HTML 或纯文本），先校验 JSON
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`GDELT returned non-JSON response (likely query syntax or rate limit)`)
  }
  const articles: any[] = json?.articles || []
  return articles.slice(0, 30).map((a) => {
    const date = parseGdeltDate(a.seendate)
    return {
      title: a.title || '',
      url: a.url || '',
      date,
      domain: a.domain || '',
      sourceCountry: a.sourcecountry || '',
      language: a.language || '',
      impact: classifyImpact(a.title || '') as NewsArticle['impact'],
      category: classifyCategory(a.title || ''),
      source: 'gdelt' as const,
    }
  })
}

// ===== Wikipedia "On This Day" =====
async function searchByWikipedia(centerDate: string): Promise<NewsArticle[]> {
  const c = new Date(centerDate)
  const targetYear = c.getFullYear()
  const month = c.getMonth() + 1
  const day = c.getDate()
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`
  const text = await httpGet(url, {
    useProxy: true,
    timeout: 20000,
    retries: 1,
  })
  const json = JSON.parse(text)
  const events: any[] = json?.events || []
  // 按与目标年份的接近度排序，优先返回目标年份附近的事件
  const scored = events.map((e) => ({
    e,
    distance: Math.abs((e.year || 0) - targetYear),
  }))
  scored.sort((a, b) => a.distance - b.distance)
  return scored
    .slice(0, 15)
    .map(({ e }) => ({
      title: `${e.year}年：${e.text}`,
      url: (e.pages && e.pages[0] && e.pages[0].content_urls?.desktop?.page) || '',
      date: `${e.year}-${pad(month)}-${pad(day)}`,
      domain: 'wikipedia.org',
      sourceCountry: 'global',
      language: 'en',
      impact: classifyImpact(e.text || '') as NewsArticle['impact'],
      category: classifyCategory(e.text || ''),
      source: 'wikipedia' as const,
    }))
}

// ===== 新浪财经滚动新闻（仅近期，作为最终降级）=====
async function searchBySina(): Promise<NewsArticle[]> {
  const url = 'https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&tag_id=0&dire=f&type=0&dpc=1'
  const text = await httpGet(url, { retries: 1, timeout: 15000 })
  const json = JSON.parse(text)
  const feeds: any[] = json?.feed?.list || []
  return feeds.slice(0, 20).map((f) => {
    const richText = f.rich_text || f.text || ''
    const title = stripHtml(richText).slice(0, 120)
    const ts = parseInt(f.create_time || '0', 10) * 1000
    const d = new Date(ts)
    return {
      title,
      url: f.link || '',
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      domain: 'sina.com.cn',
      sourceCountry: 'china',
      language: 'zh',
      impact: classifyImpact(title) as NewsArticle['impact'],
      category: classifyCategory(title),
      source: 'sina' as const,
    }
  })
}

// ===== 辅助：影响判断 / 分类（基于关键词）=====
const NEGATIVE_WORDS = ['下跌', '暴跌', '崩盘', '亏损', '危机', '风险', '警告', '下跌', '崩', '跌', '跌停', 'panic', 'crash', 'crisis', 'drop', 'fall', 'plunge', 'bear']
const POSITIVE_WORDS = ['上涨', '大涨', '暴涨', '利好', '盈利', '增长', '突破', '新高', '复苏', '反弹', '涨', '涨停', 'surge', 'rally', 'gain', 'rise', 'boom', 'bull', 'soar']
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  '货币政策': ['央行', '利率', '降息', '加息', '流动性', 'Fed', 'ECB', 'PBOC', 'rate', 'interest'],
  '贸易': ['贸易', '关税', '出口', '进口', 'trade', 'tariff', 'export'],
  '地缘政治': ['战争', '冲突', '制裁', '军事', 'war', 'conflict', 'sanction', 'geopolitical'],
  '能源': ['石油', '原油', '天然气', 'OPEC', 'oil', 'energy', 'crude'],
  '科技': ['芯片', '半导体', 'AI', '人工智能', '科技', '互联网', 'chip', 'semiconductor', 'tech'],
  '股市': ['股市', 'A股', '美股', '港股', '恒生', '道琼斯', 'stock', 'equity', 'index'],
  '宏观': ['GDP', 'CPI', 'PMI', '通胀', '就业', '非农', 'inflation', 'employment'],
}

function classifyImpact(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase()
  let pos = 0,
    neg = 0
  for (const w of POSITIVE_WORDS) if (lower.includes(w.toLowerCase())) pos++
  for (const w of NEGATIVE_WORDS) if (lower.includes(w.toLowerCase())) neg++
  if (pos > neg) return 'positive'
  if (neg > pos) return 'negative'
  return 'neutral'
}

function classifyCategory(text: string): string {
  const lower = text.toLowerCase()
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const w of words) {
      if (lower.includes(w.toLowerCase())) return cat
    }
  }
  return '其他'
}

function gdeltDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function parseGdeltDate(s: string): string {
  // YYYYMMDDTHHMMSSZ
  if (!s || s.length < 8) return ''
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
