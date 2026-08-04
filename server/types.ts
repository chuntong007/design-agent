// ============ 后端共享类型定义 ============

// 统一 API 响应
export interface ApiResponse<T = unknown> {
  code: number
  message: string
  data: T
}

// 净值点
export interface NavPoint {
  date: string // YYYY-MM-DD
  nav: number
  growthRate: number
}

// 基金详情
export interface FundDetail {
  code: string
  name: string
  type: string
  manager: string
  company: string
  scale: string
  netValue: number | null
  netValueDate: string
  growthRate: number | null
  establishDate: string
}

// 基金指标
export interface FundMetrics {
  latestNav: number
  latestGrowth: number
  totalReturn: number
  ytdReturn: number
  maxDrawdown: number
  sharpeRatio: number
  volatility: number
  scale: string
}

// 重仓股
export interface Holding {
  rank: number
  code: string
  name: string
  ratio: number
  industry: string
  trend: { date: string; price: number; change: number }[]
  latestPrice: number
  latestChange: number
  ytdChange: number
  marketCap: string
  peRatio: number
}

// 个股行情
export interface StockQuote {
  code: string
  name: string
  latestPrice: number
  latestChange: number
  prevClose: number
  ytdChange: number | null
  marketCap: string
  peRatio: number | null
}

// 新闻
export interface NewsItem {
  id: string
  title: string
  source: string
  date: string
  region: string
  category: string
  summary: string
  impact: '利好' | '利空' | '中性'
  impactScore: number
  url: string
  language: string
  needsTranslation?: boolean
  dateDiff?: number // 与目标日期的天数差距（0 = 完全匹配）
}
