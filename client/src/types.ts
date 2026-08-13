// 共享类型：与后端 API 响应对齐
export interface FundSearchResult {
  code: string
  name: string
  type: string
  pinyin: string
}

export interface NetWorthPoint {
  date: string
  timestamp: number
  nav: number // 累计净值（含分红再投资，用于成立来业绩走势/回测/指标）
  unitNav: number // 单位净值（当日成交价，用于显示单日价格）
  returnRate: number
}
// 蛋卷累计收益率曲线数据点（value 为区间起点重定基的累计收益率 %）
export interface GrowthPoint {
  date: string
  timestamp: number
  value: number // 累计收益率 %
  thanValue: number // 对比基准 %
  performanceValue: number // 业绩比较基准 %
}
export interface FundDetail {
  code: string
  name: string
  manager: string
  establishmentDate: string
  netWorth: NetWorthPoint[]
}

export interface HoldingStock {
  stockCode: string
  stockName: string
  marketCode: string
  ratio: number
}

export interface FundHoldings {
  reportDate: string
  stocks: HoldingStock[]
}

export interface StockQuote {
  code: string
  name: string
  price: number
  prevClose: number
  changePercent: number
  marketCap: number
  pe: number
}

export interface StockKlinePoint {
  date: string
  close: number
}

export interface NewsArticle {
  title: string
  url: string
  date: string
  domain: string
  sourceCountry: string
  language: string
  impact: 'positive' | 'negative' | 'neutral'
  category: string
  source: 'gdelt' | 'wikipedia' | 'sina' | 'llm'
  // LLM 归因字段(可选,LLM 分析时填充)
  summary?: string
  impact_reason?: string
  relevance?: number
  affected_sectors?: string[]
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}

// ===== AI 新闻分析会话（多检索历史，运行时状态，不持久化）=====
export interface PerFundImpact {
  code: string
  name: string
  impact: 'positive' | 'negative' | 'neutral'
  reason: string
}

export interface NewsSession {
  id: string // 会话唯一 ID（date-fundCode-timestamp）
  date: string // 检索日期 YYYY-MM-DD
  fundCode: string
  fundName?: string
  sector: SectorInfo | null
  // 真 token 流式状态
  reasoning: string
  outputText: string
  sources: string[]
  loading: boolean
  error: string
  status: { stage: string; message: string } | null
  createdAt: number
  // 多基金同步检索标识(同时为多支基金创建会话时为 true), 头部徽章据此显示
  isMultiFundSession?: boolean
  // 多基金批次 ID: 同批次创建的会话共享此 ID, 便于整批取消/重建
  batchId?: string
  // 【多基金综合研判】目标基金代码列表(单基金检索时为 [fundCode])
  targetFundCodes?: string[]
  // 逐基金影响判断(从 LLM 输出解析, 可选)
  perFundImpact?: PerFundImpact[]
}

// ===== 回测相关类型 =====
export interface Trade {
  date: string
  type: 'buy' | 'sell'
  nav: number
  shares: number
  amount: number
  reason: string
}

export interface BacktestMetrics {
  totalReturn: number
  annualReturn: number
  maxDrawdown: number
  sharpe: number
  winRate: number
  tradeCount: number
  finalValue: number
  benchmarkReturn: number
}

export interface EquityPoint {
  date: string
  timestamp: number
  value: number
  benchmark: number
}

export interface BacktestResult {
  ok: boolean
  equityCurve: EquityPoint[]
  trades: Trade[]
  metrics: BacktestMetrics
  error?: string
}

export type BacktestStrategy = 'dca' | 'ma_cross' | 'momentum' | 'stop_profit_loss' | 'grid_trading' | 'dual_momentum' | 'mean_reversion' | 'trend_following' | 'kelly' | 'rsi'

export interface StrategyParam {
  name: string
  label: string
  default: number
  min: number
  max: number
  desc: string
}

export interface StrategyInfo {
  key: string
  name: string
  category: string
  description: string
  details: string[]
  suitableMarket: string
  riskLevel: '低' | '中' | '高'
  params: StrategyParam[]
}

export interface BacktestParams {
  fundCode: string
  strategy: BacktestStrategy
  startDate: string
  endDate: string
  initialCapital: number
  dca?: { amount: number; freqDays: number }
  maCross?: { shortDays: number; longDays: number }
  momentum?: { lookbackDays: number; holdingDays: number }
  stopProfitLoss?: { stopProfit: number; stopLoss: number; buyAmount: number }
  gridTrading?: { gridCount: number; lowerPrice: number; upperPrice: number }
  dualMomentum?: { lookbackDays: number; benchmarkCode?: string }
  meanReversion?: { maDays: number; threshold: number }
  trendFollowing?: { shortDays: number; longDays: number; atrDays: number }
  kelly?: { lookbackDays: number; kellyFraction: number }
  rsi?: { rsiDays: number; oversold: number; overbought: number }
}

// 新闻检索返回的领域信息
export interface SectorInfo {
  sectors: string[]
  description: string
}
