// 基金数据类型定义

export interface Fund {
  id: string
  code: string
  name: string
  type: string
  manager: string
  company: string
  color: string // 图表线色
  // 历史净值序列（按日期升序）
  navSeries: NavPoint[]
  // 重仓股票
  holdings: Holding[]
  // 概要指标
  metrics: FundMetrics
}

export interface NavPoint {
  date: string // YYYY-MM-DD
  nav: number // 单位净值
  growthRate: number // 当日涨幅 %
}

export interface Holding {
  rank: number
  code: string
  name: string
  ratio: number // 占比 %
  industry: string
  // 重仓股自身走势（与基金同期，用于参照对比）
  trend: { date: string; price: number; change: number }[]
  // 重仓股最新指标
  latestPrice: number
  latestChange: number
  ytdChange: number
  marketCap: string
  peRatio: number
}

export interface FundMetrics {
  latestNav: number
  latestGrowth: number
  totalReturn: number // 区间总收益 %
  ytdReturn: number // 年初至今 %
  maxDrawdown: number // 最大回撤 %
  sharpeRatio: number
  volatility: number // 年化波动率 %
  scale: string // 规模
}

export interface NewsItem {
  id: string
  title: string
  source: string
  date: string
  region: '全球' | '中国' | '美国' | '欧洲' | '亚太' | '地缘' | string
  category: '宏观' | '行业' | '公司' | '政策' | '地缘' | string
  summary: string
  impact: '利好' | '利空' | '中性' | string
  impactScore: number // -100 ~ 100
  url: string
  language?: string
}

// 基金搜索结果（轻量）
export interface FundSearchResult {
  code: string
  name: string
  type: string
  pinyin?: string
}

// API 统一响应
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}
