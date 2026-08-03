import type {
  Fund,
  FundSearchResult,
  Holding,
  NewsItem,
  NavPoint,
  FundMetrics,
  ApiResponse,
} from '../types'

const BASE = '/api'

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json: ApiResponse<T> = await res.json()
  if (json.code !== 0) throw new Error(json.message || 'API error')
  return json.data
}

// 颜色池，给每只基金分配稳定颜色
const COLOR_POOL = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
]

export const fundApi = {
  // 搜索基金
  search: (keyword: string) =>
    request<FundSearchResult[]>(`${BASE}/funds/search?keyword=${encodeURIComponent(keyword)}`),

  // 获取基金完整数据（详情 + 历史净值 + 指标）
  getFund: async (code: string, days = 365, colorIndex = 0): Promise<Fund> => {
    const data = await request<{
      code: string
      name: string
      type: string
      manager: string
      company: string
      scale: string
      navSeries: NavPoint[]
      metrics: FundMetrics
    }>(`${BASE}/funds/${code}?days=${days}`)
    return {
      id: code,
      code: data.code,
      name: data.name,
      type: data.type,
      manager: data.manager,
      company: data.company,
      color: COLOR_POOL[colorIndex % COLOR_POOL.length],
      navSeries: data.navSeries,
      holdings: [],
      metrics: { ...data.metrics, scale: data.scale || data.metrics.scale || '--' },
    }
  },

  // 获取重仓股（含个股行情与历史）
  getHoldings: (code: string) =>
    request<Holding[]>(`${BASE}/funds/${code}/holdings`),

  // 搜索全球新闻
  searchNews: (params: { date: string; keyword?: string; fundName?: string; stockName?: string; rangeDays?: number }) => {
    const q = new URLSearchParams({ date: params.date })
    if (params.keyword) q.set('keyword', params.keyword)
    if (params.fundName) q.set('fundName', params.fundName)
    if (params.stockName) q.set('stockName', params.stockName)
    if (params.rangeDays) q.set('rangeDays', String(params.rangeDays))
    return request<NewsItem[]>(`${BASE}/news/search?${q.toString()}`)
  },

  health: () => request<{ status: string; time: string }>(`${BASE}/health`),
}
