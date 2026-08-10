// localStorage 持久化：基金列表、视图设置、锚定新闻
// 演示基金：明星权益 + 半导体 + 新能源

const PREFIX = 'fund-dashboard:'

export interface PinnedFund {
  code: string
  name: string
  addedAt: number
}

export interface AnchorNews {
  id: string // 锚点唯一 ID
  date: string // 净值日期 YYYY-MM-DD
  timestamp: number
  fundCode: string // 锚定时所选基金
  title: string
  url: string
  source: string
  category: string
  impact: string
  pinnedAt: number
  // LLM 归因字段(可选,锚定时从 NewsArticle 复制)
  summary?: string
  impact_reason?: string
}

export interface ViewState {
  range: string
  normalized: boolean
}

const DEMO_FUNDS: PinnedFund[] = [
  { code: '005827', name: '易方达蓝筹精选混合', addedAt: Date.now() },
  { code: '161725', name: '招商中证白酒指数', addedAt: Date.now() + 1 },
  { code: '159995', name: '华夏国证半导体芯片ETF联接', addedAt: Date.now() + 2 },
  { code: '012543', name: '华夏新能源车ETF联接', addedAt: Date.now() + 3 },
]

export const storage = {
  getFunds(): PinnedFund[] {
    try {
      const raw = localStorage.getItem(`${PREFIX}funds`)
      if (!raw) {
        localStorage.setItem(`${PREFIX}funds`, JSON.stringify(DEMO_FUNDS))
        return DEMO_FUNDS
      }
      const parsed = JSON.parse(raw)
      // 空数组时回退到演示基金（避免调试清空后无法恢复）
      if (!Array.isArray(parsed) || parsed.length === 0) {
        localStorage.setItem(`${PREFIX}funds`, JSON.stringify(DEMO_FUNDS))
        return DEMO_FUNDS
      }
      return parsed
    } catch {
      return DEMO_FUNDS
    }
  },
  setFunds(funds: PinnedFund[]): void {
    localStorage.setItem(`${PREFIX}funds`, JSON.stringify(funds))
  },

  getAnchors(): AnchorNews[] {
    try {
      const raw = localStorage.getItem(`${PREFIX}anchors`)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  },
  setAnchors(anchors: AnchorNews[]): void {
    localStorage.setItem(`${PREFIX}anchors`, JSON.stringify(anchors))
  },

  getView(): ViewState {
    try {
      const raw = localStorage.getItem(`${PREFIX}view`)
      return raw ? JSON.parse(raw) : { range: '1y', normalized: true }
    } catch {
      return { range: '1y', normalized: true }
    }
  },
  setView(view: ViewState): void {
    localStorage.setItem(`${PREFIX}view`, JSON.stringify(view))
  },
}
