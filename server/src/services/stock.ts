// 个股行情：腾讯财经（eastmoney push2 在 Node 端 socket hang up，不可用）
// 实时行情：http://qt.gtimg.cn/q=sh600519 （GBK 编码，~分隔）
// 历史K线：http://web.ifzq.gtimg.cn/appstock/app/fqkline/get （前复权日线）
import { httpGet } from '../utils/http'
import { cacheGet, cacheSet, sleep } from '../utils/cache'

export interface StockQuote {
  code: string // 市场+代码，如 sh600519
  name: string
  price: number // 现价
  prevClose: number // 昨收
  changePercent: number // 当日涨跌幅 %
  marketCap: number // 总市值（亿元）
  pe: number // PE(TTM)
}

export interface StockKlinePoint {
  date: string // YYYY-MM-DD
  close: number
}

// ===== 实时行情（批量）=====
// 腾讯行情字段以 ~ 分隔，A 股与港股字段位置有差异：
// A 股 (sh/sz): [1]=名称 [3]=现价 [4]=昨收 [32]=涨跌幅 [44]=总市值(亿) [52]=PE(TTM)
// 港股 (hk):   [1]=名称 [3]=现价 [4]=昨收 [33]=涨跌幅 [44]=总市值(万港币) [39]=PE
// 为稳健起见，涨跌幅统一用 (现价-昨收)/昨收 自行计算；市值/PE 仍尝试多个候选位置
export async function getStockQuotes(marketCodes: string[]): Promise<StockQuote[]> {
  if (marketCodes.length === 0) return []
  const url = `http://qt.gtimg.cn/q=${marketCodes.join(',')}`
  const text = await httpGet(url, { gbk: true, retries: 2 })
  const lines = text.split('\n').filter((l) => l.trim())
  const result: StockQuote[] = []
  for (const line of lines) {
    // v_sh600519="1~贵州茅台~600519~1689.00~...~";
    const m = line.match(/v_(\w+)="([^"]*)"/)
    if (!m) continue
    const code = m[1]
    const fields = m[2].split('~')
    if (fields.length < 40) continue
    const num = (i: number) => (i < fields.length ? parseFloat(fields[i]) || 0 : 0)
    const price = num(3)
    const prevClose = num(4)
    // 自行计算涨跌幅，避免 A/港股字段位置差异
    const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0
    // 市值：A 股 [44] 与港股 [44] 单位均为"亿"（本币），无需换算
    const marketCap = num(44)
    // PE：A 股 [52]，港股 [39]
    const pe = code.startsWith('hk') ? num(39) : num(52)
    result.push({
      code,
      name: fields[1] || '',
      price,
      prevClose,
      changePercent,
      marketCap,
      pe,
    })
  }
  return result
}

// ===== 历史 K 线（前复权日线收盘价，用于重仓股走势对比归一化）=====
export async function getStockKline(
  marketCode: string,
  rangeDays: number
): Promise<StockKlinePoint[]> {
  const cacheKey = `stock:kline:${marketCode}:${rangeDays}`
  const cached = cacheGet<StockKlinePoint[]>(cacheKey)
  if (cached) return cached

  const end = new Date()
  const start = new Date(end.getTime() - rangeDays * 24 * 3600 * 1000)
  // 多取 640 根，足够覆盖长区间
  const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${marketCode},day,${fmt(start)},${fmt(end)},640,qfq`
  const text = await httpGet(url, { retries: 2 })
  const json = JSON.parse(text)
  const dataObj = json?.data?.[marketCode] || {}
  const rows: any[] = dataObj.qfqday || dataObj.day || dataObj.kline || []
  const points = rows.map((r: any[]) => ({
    date: r[0],
    close: parseFloat(r[2]) || 0,
  }))
  // 日线缓存 30 分钟
  cacheSet(cacheKey, points, 30 * 60 * 1000)
  return points
}

// 并发受限的批量 K 线获取（腾讯对并发较敏感，串行 + 间隔）
export async function getStockKlinesBatch(
  marketCodes: string[],
  rangeDays: number
): Promise<Record<string, StockKlinePoint[]>> {
  const result: Record<string, StockKlinePoint[]> = {}
  for (const mc of marketCodes) {
    try {
      result[mc] = await getStockKline(mc, rangeDays)
    } catch {
      result[mc] = []
    }
    await sleep(120)
  }
  return result
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function pad(n: number): string {
  return String(n).padStart(2, '0')
}
