// 基金数据：搜索、全量历史净值（pingzhongdata）、重仓股（FundArchivesDatas）
// 注意：fundgz / fundmobapi 接口近期失效，名称/经理/净值统一从 pingzhongdata 提取
import { httpGet } from '../utils/http'
import { cacheGet, cacheSet } from '../utils/cache'

export interface FundSearchResult {
  code: string
  name: string
  type: string
  pinyin: string
}

export interface NetWorthPoint {
  date: string // YYYY-MM-DD
  timestamp: number // ms
  nav: number // 累计净值（含分红再投资，用于成立来业绩走势/回测/指标，与官方图表一致）
  unitNav: number // 单位净值（当日成交价，用于显示单日价格）
  returnRate: number // 当日涨跌幅 %（基于单位净值计算，分红日为除权后涨跌）
}

export interface FundDetail {
  code: string
  name: string
  manager: string
  establishmentDate: string // 近似成立日（取净值首日）
  netWorth: NetWorthPoint[]
}

// ===== 搜索 =====
// 注意：FundSearchPageAPI.ashx 已失效（返回空），改用 FundSearchAPI.ashx
// 该接口返回 JSONP，需提取 JSON；字段名与 PageAPI 不同
export async function searchFunds(keyword: string): Promise<FundSearchResult[]> {
  const callback = `cb${Date.now()}`
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?callback=${callback}&m=1&key=${encodeURIComponent(keyword)}`
  const text = await httpGet(url, {
    headers: { Referer: 'https://fund.eastmoney.com/' },
    retries: 1,
  })
  const json = extractJsonp(text, callback)
  const datas: any[] = json?.Datas || []
  return datas.map((d) => ({
    code: d.CODE || d._id || '',
    name: d.NAME || '',
    type: d.FundBaseInfo?.FTYPE || d.FTYPE || '',
    pinyin: d.PINYIN || '',
  }))
}

// ===== 全量历史净值 + 名称 + 经理 =====
export async function getFundDetail(code: string): Promise<FundDetail> {
  const cacheKey = `fund:detail:${code}`
  const cached = cacheGet<FundDetail>(cacheKey)
  if (cached) return cached

  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`
  const text = await httpGet(url, {
    headers: { Referer: `https://fund.eastmoney.com/${code}.html` },
    retries: 2,
  })

  const name = extractStringVar(text, 'fS_name')
  const manager = extractCurrentManager(text)
  const netWorth = extractNetWorthTrend(text)
  const establishmentDate = netWorth.length > 0 ? netWorth[0].date : ''

  const detail: FundDetail = { code, name, manager, establishmentDate, netWorth }
  // 净值当日不变，缓存 2 小时
  cacheSet(cacheKey, detail, 2 * 60 * 60 * 1000)
  return detail
}

// ===== 蛋卷累计收益率曲线 =====
// 数据源：https://danjuanfunds.com/djapi/fund/growth/{code}?day=X （公开无鉴权，需 Referer）
// fund_nav_growth[]: {date, nav(单位净值), percentage(日涨跌幅%), value(累计收益率,小数),
//                     than_value(对比), performance_value(业绩比较基准)}
// value 以区间起点重定基（首点=0），×100 得 %。day 参数：1m/3m/6m/1y/3y/5y/ty(年初至今)/all
// 注意：ytd 参数无效（返回 999001 参数错误），年初至今必须用 ty
export interface GrowthPoint {
  date: string // YYYY-MM-DD
  timestamp: number // ms
  value: number // 累计收益率 %（蛋卷 value×100，以区间起点重定基）
  thanValue: number // 对比基准 %（than_value×100）
  performanceValue: number // 业绩比较基准 %（performance_value×100）
}

export const GROWTH_DAY_WHITELIST = ['1m', '3m', '6m', '1y', '3y', '5y', 'ty', 'all'] as const
export type GrowthDay = (typeof GROWTH_DAY_WHITELIST)[number]

export async function getFundGrowth(code: string, day: GrowthDay = 'all'): Promise<GrowthPoint[]> {
  const cacheKey = `fund:growth:${code}:${day}`
  const cached = cacheGet<GrowthPoint[]>(cacheKey)
  if (cached) return cached

  const url = `https://danjuanfunds.com/djapi/fund/growth/${code}?day=${day}`
  const text = await httpGet(url, {
    headers: {
      Referer: `https://danjuanfunds.com/funding/${code}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    },
    retries: 2,
  })
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`danjuan growth invalid response: ${code} day=${day}`)
  }
  const list: any[] = json?.data?.fund_nav_growth || []
  if (list.length === 0) {
    throw new Error(`danjuan growth empty: ${code} day=${day}`)
  }
  const points: GrowthPoint[] = list.map((p) => ({
    date: p.date,
    timestamp: new Date(`${p.date}T00:00:00+08:00`).getTime(),
    value: toPct(p.value),
    thanValue: toPct(p.than_value),
    performanceValue: toPct(p.performance_value),
  }))
  // 净值当日不变，缓存 2 小时
  cacheSet(cacheKey, points, 2 * 60 * 60 * 1000)
  return points
}

// 蛋卷返回小数（如 "0.024096"），转为 %（*100）；非法值按 0
function toPct(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n * 100 : 0
}

// ===== 单位净值 + 累计净值 合并提取 =====
// pingzhongdata 中两个数组的 timestamp 完全对齐（已验证：同基金同长度、0 错位）
// - Data_netWorthTrend: [{x, y=单位净值, equityReturn=涨跌幅}, ...]
// - Data_ACWorthTrend: [[x, y=累计净值], ...]
// 官方"业绩走势/成立以来"图表使用累计净值（含分红再投资），单位净值仅在显示单日价格时用
// 对有分红/拆分的基金（如 161024），累计净值反映真实总回报，单位净值会因除权骤降
function extractNetWorthTrend(text: string): NetWorthPoint[] {
  // 提取单位净值序列（含涨跌幅）
  const mUnit = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)
  // 提取累计净值序列（纯数值数组）
  const mAccu = text.match(/Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (!mUnit) return []

  let unitArr: any[] = []
  let accuMap = new Map<number, number>()
  try {
    unitArr = JSON.parse(mUnit[1]) as any[]
  } catch {
    return []
  }
  if (mAccu) {
    try {
      const accuArr = JSON.parse(mAccu[1]) as [number, number][]
      for (const [ts, y] of accuArr) accuMap.set(ts, y)
    } catch {
      // 累计净值解析失败时退化为用单位净值
    }
  }

  return unitArr.map((p) => {
    const d = new Date(p.x)
    const accu = accuMap.has(p.x) ? accuMap.get(p.x)! : p.y
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      timestamp: p.x,
      // nav = 累计净值（成立来业绩走势用）；无累计净值时退化为单位净值
      nav: accu,
      unitNav: p.y,
      returnRate: p.equityReturn ?? 0,
    }
  })
}

// ===== 重仓股 =====
export interface HoldingStock {
  stockCode: string // 6位代码
  stockName: string
  marketCode: string // sh / sz
  ratio: number // 持仓占比 %
}

export interface FundHoldings {
  reportDate: string // YYYY-MM
  stocks: HoldingStock[]
}

export async function getFundHoldings(code: string): Promise<FundHoldings> {
  const cacheKey = `fund:holdings:${code}`
  const cached = cacheGet<FundHoldings>(cacheKey)
  if (cached) return cached

  // 从最近的已披露报告期往回找
  const candidates = recentReportQuarters(new Date(), 4)
  let result: FundHoldings = { reportDate: '', stocks: [] }
  for (const q of candidates) {
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${q.year}&month=${q.month}`
    try {
      const text = await httpGet(url, {
        headers: { Referer: `https://fundf10.eastmoney.com/ccmx_${code}.html` },
        retries: 1,
      })
      const stocks = parseHoldings(text)
      if (stocks.length > 0) {
        result = { reportDate: `${q.year}-${pad(q.month)}`, stocks }
        break
      }
    } catch {
      // 继续尝试更早的报告期
    }
  }
  // 持仓按季度变化，缓存 6 小时
  cacheSet(cacheKey, result, 6 * 60 * 60 * 1000)
  return result
}

// ===== 辅助函数 =====
function extractJsonObject(text: string): any {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

// 从 JSONP 响应中提取 JSON：callback({...}) 或 callback([...])
function extractJsonp(text: string, callback: string): any {
  // 优先按 callback 名匹配
  const re = new RegExp(`${callback}\\s*\\(([\\s\\S]*)\\)\\s*;?\\s*$`)
  const m = text.match(re)
  if (m) {
    try {
      return JSON.parse(m[1])
    } catch {}
  }
  // 兜底：提取第一个 {...} 或 [...]
  const m2 = text.match(/[\[{][\s\S]*[}\]]/)
  if (m2) {
    try {
      return JSON.parse(m2[0])
    } catch {}
  }
  return null
}

function extractStringVar(text: string, varName: string): string {
  const re = new RegExp(`var\\s+${varName}\\s*=\\s*["']([^"']*)["']`)
  const m = text.match(re)
  return m ? m[1] : ''
}

function extractCurrentManager(text: string): string {
  const m = text.match(/Data_currentFundManager\s*=\s*(\[[\s\S]*?\])\s*;/)
  if (!m) return ''
  try {
    const arr = JSON.parse(m[1])
    return (arr as any[]).map((x) => x.name).filter(Boolean).join(', ')
  } catch {
    return ''
  }
}

// 旧版 extractNetWorthTrend 已重构为合并单位净值+累计净值，见上方实现

function parseHoldings(text: string): HoldingStock[] {
  // var apidata={ content:"<table>...</table>", arryear:..., ... };
  const m = text.match(/content\s*:\s*"([\s\S]*?)"\s*,/)
  if (!m) return []
  // content 中引号被转义为 \"，需反转义
  const html = m[1].replace(/\\"/g, '"').replace(/\\\//g, '/')
  // 只取第一个 tbody（前十大重仓股），避免误解析后续对比表格
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/)
  const tbodyHtml = tbodyMatch ? tbodyMatch[1] : html
  const rows = tbodyHtml.match(/<tr>[\s\S]*?<\/tr>/g) || []
  const stocks: HoldingStock[] = []
  for (const row of rows) {
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    if (tds.length < 7) continue
    // 实际列序：序号 | 股票代码 | 股票名称 | 最新价 | 涨跌幅 | 相关资讯 | 占净值比 | 持股数 | 持仓市值
    const stockCode = stripTags(tds[1]).trim()
    const stockName = stripTags(tds[2]).trim()
    const ratioText = stripTags(tds[6])
    if (!/^\d{5,6}$/.test(stockCode)) continue
    // 市场判断：6位且以6开头=沪市(sh)，0/3开头=深市(sz)，5位=港股(hk)
    let marketCode: string
    if (stockCode.length === 5) {
      marketCode = 'hk'
    } else if (stockCode.startsWith('6')) {
      marketCode = 'sh'
    } else {
      marketCode = 'sz'
    }
    const ratio = parseFloat(ratioText) || 0
    // 过滤异常占比（>50% 明显不是真实持仓）
    if (ratio <= 0 || ratio > 50) continue
    stocks.push({ stockCode, stockName, marketCode, ratio })
  }
  return stocks.slice(0, 10)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// 从当前日期往前找最近的已披露报告期（季度末月）
function recentReportQuarters(now: Date, count: number): { year: number; month: number }[] {
  const months = [12, 9, 6, 3] // 倒序，便于往回找
  const result: { year: number; month: number }[] = []
  let y = now.getFullYear()
  let curMonth = now.getMonth() + 1
  // 报告披露规则：一季报4月底、半年报8月底、三季报10月底、年报次年3月底
  // 月份对应的"可披露时间"：3月->4月起、6月->8月起、9月->10月起、12月->次年3月起
  const discloseAfter: Record<number, { y: number; m: number }> = {
    3: { y: 0, m: 4 },
    6: { y: 0, m: 8 },
    9: { y: 0, m: 10 },
    12: { y: 1, m: 3 }, // 年报次年3月
  }

  outer: while (result.length < count && y >= 2010) {
    for (const mq of months) {
      const disc = discloseAfter[mq]
      const discYear = y + disc.y
      // 该报告期是否已披露
      if (discYear < now.getFullYear() || (discYear === now.getFullYear() && disc.m <= curMonth)) {
        result.push({ year: y, month: mq })
        if (result.length >= count) break outer
      }
    }
    y--
  }
  return result
}
