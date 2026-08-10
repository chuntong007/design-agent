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
): Promise<{ articles: NewsArticle[]; sector: SectorInfo | null; market_context?: string }> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error || `request failed: ${path}`)
  }
  return {
    articles: json.data || [],
    sector: json.sector || null,
    market_context: json.market_context,
  }
}

// ===== 流式新闻检索（SSE）=====

export type NewsStreamEvent =
  | { event: 'sector'; data: SectorInfo | null }
  | { event: 'status'; data: { stage: 'searching' | 'analyzing' | 'fallback' | 'done'; message: string } }
  | { event: 'sources'; data: { urls: string[] } }
  | { event: 'article'; data: { article: NewsArticle } }
  | { event: 'market_context'; data: { text: string } }
  | { event: 'complete'; data: { articles: NewsArticle[]; market_context: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done' }

// 流式新闻检索：消费 SSE，通过回调实时推送事件
// 返回 AbortController 用于取消请求
export function searchNewsStream(
  date: string,
  fundCode: string | undefined,
  onEvent: (evt: NewsStreamEvent) => void
): AbortController {
  const controller = new AbortController()
  const path = `/news/search/stream?date=${encodeURIComponent(date)}${fundCode ? `&fundCode=${encodeURIComponent(fundCode)}` : ''}`

  ;(async () => {
    try {
      const res = await fetch(`${BASE}${path}`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      })
      if (!res.ok || !res.body) {
        throw new Error(`Stream request failed: HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE 事件以双换行分隔
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          const lines = block.split('\n')
          let event = ''
          let data = ''
          for (const line of lines) {
            if (line.startsWith('event:')) {
              event = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              data += line.slice(5).trim()
            }
          }
          if (!event) continue

          if (event === 'done') {
            onEvent({ event: 'done' })
            return
          }

          try {
            const parsed = JSON.parse(data)
            onEvent({ event, data: parsed } as NewsStreamEvent)
          } catch {
            // 解析失败跳过
          }
          void currentEvent
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        onEvent({ event: 'error', data: { message: (err as Error).message } })
        onEvent({ event: 'done' })
      }
    }
  })()

  return controller
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
