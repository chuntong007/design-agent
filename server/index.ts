// 确保代理环境变量可见（用户本地开启了翻墙代理，Node 进程需显式设置）
// socks5h:// 表示让代理服务器做 DNS 解析，避免本地 DNS 污染
if (!process.env.ALL_PROXY && !process.env.all_proxy) {
  process.env.ALL_PROXY = 'socks5h://127.0.0.1:1080'
}

import express from 'express'
import cors from 'cors'
import {
  searchFunds,
  getFundDetail,
  getNavHistory,
  getHoldings,
  getStockQuote,
  getStockHistory,
} from './fundService.js'
import { searchGlobalNews, translateText } from './newsService.js'
import { ok, fail, mapWithConcurrency, sleep } from './utils.js'
import type { NavPoint, FundMetrics, Holding } from './types.js'

const app = express()
app.use(cors())
app.use(express.json())

const PORT = 8787

// ============ 路由 ============

// 基金搜索
app.get('/api/funds/search', async (req, res) => {
  try {
    const keyword = String(req.query.keyword || '').trim()
    if (!keyword) return res.json(ok([]))
    const list = await searchFunds(keyword)
    res.json(ok(list))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail((e as Error).message))
  }
})

// 获取基金完整数据：详情 + 历史净值 + 指标
app.get('/api/funds/:code', async (req, res) => {
  try {
    const { code } = req.params
    const daysParam = String(req.query.days || '365')
    const days = daysParam === 'all' || daysParam === 'ALL' ? 'all' : (parseInt(daysParam) || 365)
    const [detail, navSeries] = await Promise.all([getFundDetail(code), getNavHistory(code, days)])
    const metrics = computeMetrics(navSeries)
    res.json(
      ok({
        ...detail,
        navSeries,
        metrics,
      }),
    )
  } catch (e) {
    console.error(e)
    res.status(500).json(fail((e as Error).message))
  }
})

// 获取基金重仓股（含个股行情与历史走势）
app.get('/api/funds/:code/holdings', async (req, res) => {
  try {
    const { code } = req.params
    const holdings = await getHoldings(code)
    if (holdings.length === 0) {
      return res.json(ok([]))
    }
    // 限制并发为 3，避免行情服务器因并发过高而 socket hang up
    const enriched = await mapWithConcurrency(holdings, 3, async (h) => {
      try {
        await sleep(120)
        const [quote, history] = await Promise.all([
          getStockQuote(h.code as string),
          getStockHistory(h.code as string, 365),
        ])
        const ytdStart = history.find((t) => t.date >= new Date().getFullYear() + '-01-01') || history[0]
        return {
          ...h,
          trend: history,
          latestPrice: quote?.latestPrice ?? 0,
          latestChange: quote?.latestChange ?? 0,
          ytdChange:
            quote && ytdStart
              ? +(((quote.latestPrice - ytdStart.price) / ytdStart.price) * 100).toFixed(2)
              : 0,
          marketCap: quote?.marketCap ?? '',
          peRatio: quote?.peRatio ?? 0,
          name: h.name,
          industry: h.industry || guessIndustry(h.name as string),
        }
      } catch (e) {
        return { ...h, trend: [], latestPrice: 0, latestChange: 0, ytdChange: 0, marketCap: '', peRatio: 0, industry: guessIndustry(h.name as string) }
      }
    })
    res.json(ok(enriched))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail((e as Error).message))
  }
})

// 新闻搜索（默认 ±7 天）
app.get('/api/news/search', async (req, res) => {
  try {
    const { keyword, fundName, stockName, date } = req.query
    const rangeDays = parseInt(String(req.query.rangeDays)) || 7
    if (!date) return res.status(400).json(fail('date is required', 400))
    const news = await searchGlobalNews({
      keyword: String(keyword || ''),
      fundName: String(fundName || ''),
      stockName: String(stockName || ''),
      date: String(date),
      rangeDays,
    })
    res.json(ok(news))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail((e as Error).message))
  }
})

// 翻译接口（用于非中文新闻）
app.post('/api/translate', async (req, res) => {
  try {
    const { text, target } = req.body || {}
    if (!text) return res.status(400).json(fail('text is required', 400))
    const translated = await translateText(String(text), String(target || 'zh'))
    res.json(ok({ translated }))
  } catch (e) {
    console.error(e)
    res.status(500).json(fail((e as Error).message))
  }
})

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json(ok({ status: 'ok', time: new Date().toISOString() }))
})

// ============ 指标计算 ============
function computeMetrics(navSeries: NavPoint[]): FundMetrics {
  if (!navSeries || navSeries.length === 0) {
    return { latestNav: 0, latestGrowth: 0, totalReturn: 0, ytdReturn: 0, maxDrawdown: 0, sharpeRatio: 0, volatility: 0, scale: '' }
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
    scale: '',
  }
}

// ============ 行业推断 ============
function guessIndustry(name: string): string {
  const map: { kw: string[]; ind: string }[] = [
    { kw: ['酒', '茅台', '五粮液'], ind: '白酒' },
    { kw: ['银行'], ind: '银行' },
    { kw: ['保险', '平安'], ind: '保险' },
    { kw: ['药', '生物', '医疗', '康'], ind: '医药' },
    { kw: ['芯', '微', '半导体', '光电', '华创'], ind: '半导体' },
    { kw: ['电池', '锂', '新能源', '光伏'], ind: '新能源' },
    { kw: ['地产', '置业'], ind: '地产' },
    { kw: ['汽', '车'], ind: '汽车' },
    { kw: ['电', '美', '格力', '海尔'], ind: '家电' },
    { kw: ['化工', '化学'], ind: '化工' },
    { kw: ['软件', '信息', '办公', '金山'], ind: '软件' },
  ]
  for (const m of map) {
    if (m.kw.some((k) => name.includes(k))) return m.ind
  }
  return '其他'
}

app.listen(PORT, () => {
  console.log(`\n  🚀 基金洞察后端服务已启动 (TypeScript): http://localhost:${PORT}\n`)
})
