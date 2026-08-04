import { fetchJsonApi, fetchJson, cached, setCache } from './utils.js'
import type { NewsItem } from './types.js'

// ============ GDELT 全球新闻搜索 ============

// GDELT 限流较严，用全局锁串行化请求 + 最小间隔
let lastRequestTime = 0
const MIN_INTERVAL = 1000
// 429 后的全局冷却时间，避免连续触发限流
let cooldownUntil = 0
async function throttledFetch(url: string, timeoutMs = 15000): Promise<string> {
  // 如果处于冷却期，先等待冷却结束（最多等 5 秒）
  const now = Date.now()
  if (cooldownUntil > now) {
    await new Promise((r) => setTimeout(r, Math.min(cooldownUntil - now, 5000)))
  }
  const wait = Math.max(0, lastRequestTime + MIN_INTERVAL - now)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestTime = Date.now()
  return fetchJsonApi(url, {}, timeoutMs)
}

// 基于基金/股票关键词 + 日期生成搜索 query（优化：去除通用词，提取核心主题）
function buildQuery(context: { keyword?: string; fundName?: string; stockName?: string; date: string }): string {
  const parts: string[] = []
  if (context.keyword) parts.push(context.keyword)
  if (context.fundName) {
    const cleanName = context.fundName
      .replace(/基金|指数|混合|联接|ETF|LOF|股票|债券|收益|成长|精选|优势|产业|主题|策略|灵活配置|发起式|定开|增强|量化|A|C|AB|E|H|FOF/g, '')
      .trim()
    if (cleanName.length >= 2) parts.push(`"${cleanName}"`)
  }
  if (context.stockName) parts.push(`"${context.stockName}"`)
  if (parts.length === 0) parts.push('stock market china finance economy')
  return parts.slice(0, 3).join(' ')
}

// 中英双语关键词映射，提升中文语境相关性
const KEYWORD_MAP: Record<string, string> = {
  降息: 'rate cut', 降准: 'RRR cut', 化债: 'debt', 选举: 'election', 大选: 'election',
  半导体: 'semiconductor', 芯片: 'chip', 白酒: 'baijiu liquor', 新能源: 'new energy',
  医药: 'pharmaceutical', 银行: 'bank', 地缘: 'geopolitic', 冲突: 'conflict',
  原油: 'oil', AI: 'artificial intelligence', 算力: 'AI chip', 科技: 'technology',
  消费: 'consumer', 军工: 'defense', 房地产: 'real estate', 券商: 'brokerage',
}

function enrichQuery(query: string): string {
  let enriched = query
  for (const [zh, en] of Object.entries(KEYWORD_MAP)) {
    if (query.includes(zh)) enriched = `${enriched} OR ${en}`
  }
  return enriched
}

// 智能判断新闻影响方向（基于标题关键词）
function guessImpact(title: string): { impact: '利好' | '利空' | '中性'; score: number } {
  const t = (title || '').toLowerCase()
  const positive = ['rally','surge','gain','rise','jump','boom','bull','soar','boost','recover','stimulus','cut rate','easing','bailout','support','profit','beat','exceed','strong','record high','涨','升','利好','突破','增长','超预期','反弹','上涨','大涨','飙升']
  const negative = ['crash','plunge','fall','drop','decline','bear','slump','dive','collapse','crisis','loss','weak','fear','panic','sell','halt','suspend','default','bankrupt','downgrade','warn','risk','threat','跌','降','利空','暴跌','下挫','下滑','违约','风险','警告','崩盘']
  if (positive.some((w) => t.includes(w))) return { impact: '利好', score: 50 + Math.floor(Math.random() * 30) }
  if (negative.some((w) => t.includes(w))) return { impact: '利空', score: -(50 + Math.floor(Math.random() * 30)) }
  return { impact: '中性', score: 0 }
}

// 智能分类
function guessCategory(title: string): string {
  const t = (title || '').toLowerCase()
  if (/rate|fed|central bank|policy|tariff|trade war|gdp|inflation|cpi|pmi/.test(t)) return '宏观'
  if (/chip|semiconductor|oil|steel|tech|ai|battery|solar|pharma/.test(t)) return '行业'
  if (/earnings|revenue|profit|ipo|merger|acquisition|ceo/.test(t)) return '公司'
  if (/geopolit|sanction|war|conflict|nuclear|missile|nato/.test(t)) return '地缘'
  return '宏观'
}

interface SearchParams {
  keyword?: string
  fundName?: string
  stockName?: string
  date: string
  rangeDays?: number
}

// 默认 ±7 天（偏差不超过一周）
export async function searchGlobalNews({ keyword, fundName, stockName, date, rangeDays = 7 }: SearchParams): Promise<NewsItem[]> {
  const query = enrichQuery(buildQuery({ keyword, fundName, stockName, date }))
  const cacheKey = `news:${query}:${date}:${rangeDays}`
  const hit = cached<NewsItem[]>(cacheKey, 30 * 60 * 1000)
  if (hit) return hit

  try {
    const target = new Date(date)
    const start = new Date(target)
    start.setDate(start.getDate() - rangeDays)
    const end = new Date(target)
    end.setDate(end.getDate() + rangeDays)

    const fmt = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
    const startStr = fmt(start)
    const endStr = fmt(end)

    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=50&sort=DateDesc&format=json&startdatetime=${startStr}000000&enddatetime=${endStr}000000`

    // GDELT 阶段硬性截止时间（通过代理时 GDELT 响应较慢，需 30 秒）
    const GDELT_DEADLINE = 30000
    const gdeltStart = Date.now()
    let text = ''
    let lastErr: Error | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - gdeltStart > GDELT_DEADLINE) {
        lastErr = lastErr || new Error('GDELT deadline exceeded')
        break
      }
      try {
        // 单次请求 20 秒超时（GDELT 通过代理响应较慢）
        text = await throttledFetch(url, 20000)
        break
      } catch (e) {
        lastErr = e as Error
        const msg = (e as Error).message
        // 仅 429（快速失败）重试一次；超时不重试
        if (msg.includes('429') && attempt < 1) {
          cooldownUntil = Date.now() + 3000
          await new Promise((r) => setTimeout(r, 3000))
          continue
        }
        break
      }
    }

    if (!text) {
      console.error('searchGlobalNews: GDELT failed, trying fallback, last error:', lastErr?.message)
      const fallback = await searchFallbackNews(query, startStr, endStr, date)
      // 按日期接近度排序，确保最接近目标日期的新闻排在前面
      const sorted = sortByDateProximity(fallback, date)
      if (sorted.length > 0) setCache(cacheKey, sorted, 30 * 60 * 1000)
      return sorted
    }

    let data: any
    try { data = JSON.parse(text) } catch {
      const m = text.match(/\{[\s\S]*\}/)
      data = m ? JSON.parse(m[0]) : { articles: [] }
    }

    const articles: NewsItem[] = (data?.articles || []).slice(0, 25).map((a: any, i: number) => {
      const imp = guessImpact(a.title)
      const lang = a.language || ''
      return {
        id: `gdelt_${i}_${(a.url || '').slice(0, 60)}`,
        title: a.title || '(无标题)',
        source: cleanSource(a.domain || a.sourcecountry || '未知'),
        date: parseGdeltDate(a.seendate),
        region: mapRegion(a.sourcecountry),
        category: guessCategory(a.title),
        summary: (a.title || '').slice(0, 200),
        impact: imp.impact,
        impactScore: imp.score,
        url: a.url || '#',
        language: lang,
        needsTranslation: !!lang && lang !== 'zho' && lang !== 'chi',
      }
    })

    // 按日期接近度排序，让最接近目标日期的新闻排在前面
    const sorted = sortByDateProximity(articles, date)
    setCache(cacheKey, sorted)
    return sorted
  } catch (e) {
    console.error('searchGlobalNews error:', (e as Error).message)
    return []
  }
}

// ============ 翻译 API ============
// 使用免费翻译接口（无需 API key），多源降级
const TRANSLATE_SOURCES = [
  // 1. Google Translate（可能在大陆网络受限）
  async (text: string, target: string): Promise<string | null> => {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text)}`
    const resp = await fetchJson(url, {}, 10000)
    const data = JSON.parse(resp)
    const translated = (data[0] || []).map((seg: any[]) => seg[0] || '').join('')
    return translated || null
  },
  // 2. MyMemory 翻译（免费，无需 key）
  async (text: string, target: string): Promise<string | null> => {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${target === 'zh' ? 'zh-CN' : target}`
    const resp = await fetchJson(url, {}, 10000)
    const data = JSON.parse(resp)
    const translated = data?.responseData?.translatedText
    return translated || null
  },
  // 3. Lingva（Google 翻译开源镜像，多实例）
  async (text: string, target: string): Promise<string | null> => {
    const instances = [
      'https://lingva.ml',
      'https://translate.plausibility.cloud',
    ]
    for (const inst of instances) {
      try {
        const url = `${inst}/api/v1/auto/${target}/${encodeURIComponent(text)}`
        const resp = await fetchJson(url, {}, 6000)
        const data = JSON.parse(resp)
        if (data?.translation) return data.translation
      } catch { continue }
    }
    return null
  },
]

export async function translateText(text: string, targetLang = 'zh'): Promise<string> {
  if (!text || !text.trim()) return text
  const cacheKey = `trans:${text.slice(0, 100)}:${targetLang}`
  const hit = cached<string>(cacheKey, 60 * 60 * 1000)
  if (hit) return hit

  // 串行尝试多个翻译源
  for (const source of TRANSLATE_SOURCES) {
    try {
      const result = await source(text.slice(0, 500), targetLang)
      if (result && result !== text) {
        setCache(cacheKey, result, 60 * 60 * 1000)
        return result
      }
    } catch (e) {
      console.error('translate source error:', (e as Error).message)
    }
  }
  return text
}

// ============ 备用新闻源（GDELT 限流时使用） ============
// Wikipedia「历史上的今天」与近期 RSS 并行抓取，共享截止时间，快速返回
async function searchFallbackNews(query: string, startStr: string, endStr: string, targetDate: string): Promise<NewsItem[]> {
  const results: NewsItem[] = []
  // 整个 fallback 阶段硬性截止时间（约 7 秒），避免拖慢响应
  const FALLBACK_DEADLINE = 7000
  const fallbackStart = Date.now()
  const deadlineHit = () => Date.now() - fallbackStart > FALLBACK_DEADLINE

  const targetTime = new Date(targetDate).getTime()
  const rangeMs = 7 * 24 * 60 * 60 * 1000 // ±7 天
  const nowTime = Date.now()
  const isRecent = Math.abs(nowTime - targetTime) <= 14 * 24 * 60 * 60 * 1000

  // 1. Wikipedia "On This Day"（历史事件，适合久远日期）
  const wikiTask = (async () => {
    try {
      const d = new Date(targetDate)
      const month = d.getMonth() + 1
      const day = d.getDate()
      const wikiUrl = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${month}/${day}`
      const wikiText = await Promise.race([
        fetchJsonApi(wikiUrl, {}, 6000),
        new Promise<string>((_, rej) => setTimeout(() => rej(new Error('wiki timeout')), 6000)),
      ])
      const wikiData = JSON.parse(wikiText)
      const events = (wikiData.events || [])
        .filter((ev: any) => /stock|market|econom|financ|bank|trade|oil|price|currency|crash|bubble|rate|china|asian/.test((ev.text || '').toLowerCase()))
        .slice(0, 6)
      for (const ev of events) {
        if (deadlineHit()) break
        results.push({
          id: `wiki_${ev.year}_${ev.text.slice(0, 20)}`.slice(0, 100),
          title: `[${ev.year}年] ${ev.text.slice(0, 100)}`,
          source: 'Wikipedia 历史上的今天',
          date: `${ev.year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          region: '全球', category: '宏观',
          summary: ev.text, impact: '中性', impactScore: 0,
          url: ev.pages?.[0]?.content_urls?.desktop?.page || '#',
          language: 'en', needsTranslation: true,
        })
      }
    } catch (e) { console.error('wiki fallback error:', (e as Error).message) }
  })()

  // 2. 可达新闻源（仅近期日期才有匹配）：
  //    - 新浪滚动财经 JSON API（大陆网络可直连）
  //    - BBC/CNBC RSS（部分网络被屏蔽，作为补充）
  const rssTask = (async () => {
    if (!isRecent) return
    try {
      // 2a. 新浪滚动财经（可达、快速）
      try {
        const sinaText = await Promise.race([
          fetchJsonApi('https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=20&page=1', { headers: { 'Referer': 'https://finance.sina.com.cn/' } }, 5000),
          new Promise<string>((_, rej) => setTimeout(() => rej(new Error('sina timeout')), 5000)),
        ])
        const sinaData = JSON.parse(sinaText)
        const sinaItems = (sinaData?.result?.data || []).slice(0, 10)
        for (const s of sinaItems) {
          if (deadlineHit()) break
          const ts = Number(s.intime) * 1000
          if (!s.title || isNaN(ts)) continue
          // 仅保留目标日期 ±7 天内的新闻
          if (Math.abs(ts - targetTime) > rangeMs) continue
          const d = new Date(ts)
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          results.push({
            id: `sina_${(s.docid || s.url || '').slice(0, 60)}`,
            title: s.title || '(无标题)',
            source: s.media_name || '新浪财经',
            date: dateStr, region: '中国', category: '宏观',
            summary: (s.summary || s.title || '').slice(0, 200),
            impact: '中性', impactScore: 0,
            url: s.url || s.wapurl || '#', language: 'zh', needsTranslation: false,
          })
        }
      } catch (e) { console.error('sina news error:', (e as Error).message) }

      // 2b. 国际 RSS（BBC/CNBC，部分网络被屏蔽，尽力而为）
      const rssFeeds = [
        { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', name: 'BBC Business' },
        { url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html', name: 'CNBC Markets' },
      ]
      for (const feed of rssFeeds) {
        if (deadlineHit()) break
        try {
          const rssText = await Promise.race([
            fetchJsonApi(feed.url, {}, 5000),
            new Promise<string>((_, rej) => setTimeout(() => rej(new Error('rss timeout')), 5000)),
          ])
          const items = parseRssXml(rssText, feed.name)
          for (const item of items) {
            if (deadlineHit()) break
            const itemTime = new Date(item.date).getTime()
            if (isNaN(itemTime)) continue
            // 仅保留目标日期 ±7 天内的新闻
            if (Math.abs(itemTime - targetTime) > rangeMs) continue
            results.push({
              id: `rss_${(item.guid || item.title || '').slice(0, 80)}`,
              title: item.title || '(无标题)',
              source: feed.name,
              date: item.date, region: '全球', category: '宏观',
              summary: (item.summary || item.title || '').replace(/<[^>]+>/g, '').slice(0, 200),
              impact: '中性', impactScore: 0,
              url: item.link || '#', language: 'en', needsTranslation: true,
            })
          }
        } catch (e) { console.error('rss feed error:', feed.url, (e as Error).message) }
      }
    } catch (e) { console.error('rss fallback error:', (e as Error).message) }
  })()

  // 并行等待两个来源，最多等待截止时间
  await Promise.race([
    Promise.all([wikiTask, rssTask]),
    new Promise((resolve) => setTimeout(resolve, FALLBACK_DEADLINE)),
  ])

  if (results.length === 0) {
    results.push({
      id: 'fallback_info',
      title: `${targetDate} 附近未检索到匹配新闻`,
      source: '系统提示', date: targetDate, region: '全球', category: '宏观',
      summary: 'GDELT 全球新闻数据库当前响应缓慢或请求受限，且该日期距今较久，实时资讯源无法匹配。已按日期接近度排序展示可用的历史事件；点击其他净值点或稍后重试。',
      impact: '中性', impactScore: 0,
      url: 'https://www.gdeltproject.org/', language: 'zh', needsTranslation: false,
    })
  }
  return results.slice(0, 20)
}

function cleanSource(domain: string): string {
  if (!domain) return '未知来源'
  return domain.replace(/^www\./, '').replace(/^m\./, '')
}

// 轻量 RSS XML 解析器（无第三方依赖），提取 title/link/pubDate/guid/description
interface RssItem {
  title: string
  link: string
  date: string // YYYY-MM-DD
  guid: string
  summary: string
}
function parseRssXml(xml: string, fallbackTitle: string): RssItem[] {
  const items: RssItem[] = []
  // 拆分所有 <item>...</item>
  const itemRe = /<item[\s\S]*?<\/item>/gi
  const tagRe = /<([a-zA-Z:]+)([^>]*)>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[0]
    const item: RssItem = { title: '', link: '', date: '', guid: '', summary: '' }
    let t: RegExpExecArray | null
    tagRe.lastIndex = 0
    while ((t = tagRe.exec(block)) !== null) {
      const tag = t[1].toLowerCase()
      const val = (t[3] || '').trim()
      if (tag === 'title' && !item.title) item.title = val
      else if (tag === 'link' && !item.link) item.link = val
      else if (tag === 'pubdate' && !item.date) item.date = parseRssDate(val)
      else if (tag === 'guid' && !item.guid) item.guid = val
      else if (tag === 'description' && !item.summary) item.summary = val
    }
    if (item.title) items.push(item)
  }
  return items
}

function parseRssDate(s: string): string {
  const t = new Date(s)
  if (!isNaN(t.getTime())) {
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
  }
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s.slice(0, 10)
}

// 按日期接近度排序（离目标日期越近越靠前）
function sortByDateProximity(items: NewsItem[], targetDate: string): NewsItem[] {
  const target = new Date(targetDate).getTime()
  if (isNaN(target)) return items
  return items.map((item) => {
    const itemDate = new Date(item.date).getTime()
    const diffDays = isNaN(itemDate) ? 9999 : Math.abs(itemDate - target) / (1000 * 60 * 60 * 24)
    return { ...item, dateDiff: Math.round(diffDays) }
  }).sort((a, b) => (a.dateDiff! - b.dateDiff!))
}

function parseGdeltDate(s: string): string {
  if (!s) return ''
  const m = s.match(/(\d{4})(\d{2})(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s
}

function mapRegion(country: string): string {
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
