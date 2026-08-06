// API 客户端：统一封装 fetch，处理错误
import type {
  ApiResult,
  FundSearchResult,
  FundDetail,
  FundHoldings,
  StockQuote,
  StockKlinePoint,
  NewsArticle,
  BacktestParams,
  BacktestResult,
  SectorInfo,
  StrategyInfo,
} from './types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const json: ApiResult<T> = await res.json()
  if (!json.ok) {
    throw new Error(json.error || `request failed: ${path}`)
  }
  return json.data as T
}

// 新闻检索返回带领域信息，特殊处理
async function requestNews(
  path: string,
  init?: RequestInit
): Promise<{ articles: NewsArticle[]; sector: SectorInfo | null }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error || `request failed: ${path}`)
  }
  return { articles: json.data || [], sector: json.sector || null }
}

export const api = {
  searchFunds: (keyword: string) =>
    request<FundSearchResult[]>(`/fund/search?keyword=${encodeURIComponent(keyword)}`),
  getFundDetail: (code: string) => request<FundDetail>(`/fund/detail?code=${code}`),
  getFundHoldings: (code: string) => request<FundHoldings>(`/fund/holdings?code=${code}`),
  getStockQuotes: (codes: string[]) =>
    request<StockQuote[]>(`/stock/quotes?codes=${codes.join(',')}`),
  getStockKlines: (codes: string[], rangeDays: number) =>
    request<Record<string, StockKlinePoint[]>>(
      `/stock/klines?codes=${codes.join(',')}&rangeDays=${rangeDays}`
    ),
  searchNews: (date: string, fundCode?: string) =>
    requestNews(`/news/search?date=${date}${fundCode ? `&fundCode=${fundCode}` : ''}`),
  translate: (text: string, from = 'en', to = 'zh-CN') =>
    request<string>(`/news/translate`, {
      method: 'POST',
      body: JSON.stringify({ text, from, to }),
    }),
  runBacktest: (params: BacktestParams) =>
    request<BacktestResult>(`/backtest/run`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  getStrategies: () => request<StrategyInfo[]>(`/backtest/strategies`),
}
