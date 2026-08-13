/// <reference types="vite/client" />
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
  GrowthPoint,
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
  | { event: 'reasoning_delta'; data: { text: string } } // 思考过程增量
  | { event: 'reasoning_done'; data: { text: string } } // 思考完成
  | { event: 'output_delta'; data: { text: string } } // 最终分析增量（Markdown）
  | { event: 'output_done'; data: { text: string } } // 最终分析完成
  | { event: 'complete'; data: { text: string; reasoning: string } }
  | { event: 'error'; data: { message: string } }
  | { event: 'done' }

// 流式新闻检索：消费 SSE，通过回调实时推送事件
// 返回 AbortController 用于取消请求
// 注意：SSE 请求直连后端 8787 端口，绕过 Vite 代理（代理会缓冲 SSE）
// 【多基金综合研判】fundCodes 数组: 1 支 = 单基金检索, N 支 = 多基金综合研判
export function searchNewsStream(
  date: string,
  fundCodes: string[],
  onEvent: (evt: NewsStreamEvent) => void
): AbortController {
  const controller = new AbortController()
  const codes = fundCodes.join(',')
  const path = `/news/search/stream?date=${encodeURIComponent(date)}&fundCodes=${encodeURIComponent(codes)}`
  // 直连后端：开发环境用 8787，生产环境用同源（由反向代理处理）
  const streamBase = import.meta.env.DEV ? 'http://localhost:8787/api' : BASE

  ;(async () => {
    try {
      const res = await fetch(`${streamBase}${path}`, {
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

// 旧签名重载(临时,后端部署后移除): 内部转换为新签名, 调用方无需修改
export function searchNewsStreamLegacy(
  date: string,
  fundCode: string | undefined,
  onEvent: (evt: NewsStreamEvent) => void
): AbortController {
  return searchNewsStream(date, fundCode ? [fundCode] : [], onEvent)
}

export const api = {
  searchFunds: (keyword: string) =>
    request<FundSearchResult[]>(`/fund/search?keyword=${encodeURIComponent(keyword)}`),
  getFundDetail: (code: string) => request<FundDetail>(`/fund/detail?code=${code}`),
  getFundHoldings: (code: string) => request<FundHoldings>(`/fund/holdings?code=${code}`),
  // 蛋卷累计收益率曲线：day 取值 1m/3m/6m/1y/3y/5y/ty(年初至今)/all
  getFundGrowth: (code: string, day: string) =>
    request<GrowthPoint[]>(
      `/fund/growth?code=${encodeURIComponent(code)}&day=${encodeURIComponent(day)}`
    ),
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
