import { fetchJson, cached, setCache } from './utils.js'
import type { NavPoint, Holding, StockQuote, FundDetail } from './types.js'

interface SearchResultItem {
  code: string
  name: string
  type: string
  pinyin?: string
}

// ============ 基金列表搜索 ============
// 天天基金 fund_search API
export async function searchFunds(keyword: string): Promise<SearchResultItem[]> {
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchPageAPI.ashx?m=1&key=${encodeURIComponent(keyword)}&pageIndex=0&pageSize=20&IsNeedBaseInfo=1&IsNeedZTInfo=1`
  const cacheKey = `search:${keyword}`
  const hit = cached<SearchResultItem[]>(cacheKey)
  if (hit) return hit
  try {
    const text = await fetchJson(url)
    const jsonpMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonpMatch) return []
    const data = JSON.parse(jsonpMatch[0])
    const list: SearchResultItem[] = (data.Datas || []).map((d: any) => ({
      code: d.CODE,
      name: String(d.NAME || '').replace(/<[^>]+>/g, ''),
      type: d.FundBaseInfo?.FTYPE || '',
      pinyin: d.PINYIN,
    }))
    setCache(cacheKey, list)
    return list
  } catch (e) {
    console.error('searchFunds error:', (e as Error).message)
    return []
  }
}

// ============ 基金详情（名称、类型、经理、规模、净值、成立日期等） ============
// 从 pingzhongdata 接口一次性提取全部信息（该接口稳定可用）
export async function getFundDetail(code: string): Promise<FundDetail> {
  const cacheKey = `detail:${code}`
  const hit = cached<FundDetail>(cacheKey, 30 * 60 * 1000)
  if (hit) return hit
  try {
    const pzUrl = `https://fund.eastmoney.com/pingzhongdata/${code}.js`
    const pzText = await fetchJson(pzUrl, { headers: { Referer: `https://fund.eastmoney.com/${code}.html` } })

    // 基金名称
    const nameMatch = pzText.match(/var\s+fS_name\s*=\s*"([^"]+)"/)
    const name = nameMatch ? nameMatch[1] : code

    // 基金经理
    let manager = ''
    const mgrMatch = pzText.match(/Data_currentFundManager\s*=\s*\[([\s\S]*?)\]/)
    if (mgrMatch) {
      try {
        const mgrs = JSON.parse('[' + mgrMatch[1] + ']')
        if (mgrs.length > 0) manager = mgrs[0].name || ''
      } catch {}
    }

    // 成立日期：从 Data_netWorthTrend 第一个时间戳推断
    let establishDate = ''
    const ntMatch = pzText.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)
    if (ntMatch) {
      try {
        const arr = JSON.parse(ntMatch[1])
        if (arr.length > 0) establishDate = formatDateFromTs(arr[0].x)
      } catch {}
    }

    // 最新净值（从最后一个时间戳）
    let netValue: number | null = null
    let netValueDate = ''
    let growthRate: number | null = null
    if (ntMatch) {
      try {
        const arr = JSON.parse(ntMatch[1])
        if (arr.length > 0) {
          const last = arr[arr.length - 1]
          netValue = +Number(last.y).toFixed(4)
          netValueDate = formatDateFromTs(last.x)
          growthRate = last.equityReturn != null ? +Number(last.equityReturn).toFixed(2) : null
        }
      } catch {}
    }

    const detail: FundDetail = {
      code,
      name,
      type: guessFundType(name),
      manager,
      company: '',
      scale: '',
      netValue,
      netValueDate,
      growthRate,
      establishDate,
    }
    setCache(cacheKey, detail)
    return detail
  } catch (e) {
    console.error('getFundDetail error:', (e as Error).message)
    return { code, name: code, type: '', manager: '', company: '', scale: '', netValue: null, netValueDate: '', growthRate: null, establishDate: '' }
  }
}

// 根据名称推断基金类型
function guessFundType(name: string): string {
  if (name.includes('指数') || name.includes('ETF')) return '指数型'
  if (name.includes('货币')) return '货币型'
  if (name.includes('债券') || name.includes('债')) return '债券型'
  if (name.includes('混合')) return '混合型'
  if (name.includes('QDII')) return 'QDII'
  return '股票型'
}

// ============ 历史净值序列 ============
// 统一使用 pingzhongdata 接口获取完整历史，再按 days 参数切片
export async function getNavHistory(code: string, days: number | 'all' = 365): Promise<NavPoint[]> {
  const isAll = days === 'all'
  const cacheKey = `nav:${code}:full`
  let fullList = cached<NavPoint[]>(cacheKey, 24 * 60 * 60 * 1000)

  if (!fullList) {
    fullList = await getNavHistoryFromPingzhong(code)
    if (fullList.length > 0) {
      setCache(cacheKey, fullList, 24 * 60 * 60 * 1000)
    } else {
      fullList = await getNavHistoryFromLsjz(code)
    }
  }

  if (isAll || !fullList.length) return fullList

  const daysNum = typeof days === 'number' ? days : 365
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysNum)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  return fullList.filter((p) => p.date >= cutoffStr)
}

// 通过 pingzhongdata 接口获取基金成立以来全部历史净值
async function getNavHistoryFromPingzhong(code: string): Promise<NavPoint[]> {
  try {
    const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`
    const text = await fetchJson(url, {
      headers: { Referer: `https://fund.eastmoney.com/${code}.html` },
    })
    const m = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)
    if (!m) return []
    const arr = JSON.parse(m[1])
    const list: NavPoint[] = arr.map((d: any) => ({
      date: formatDateFromTs(d.x),
      nav: +Number(d.y).toFixed(4),
      growthRate: d.equityReturn != null ? +Number(d.equityReturn).toFixed(2) : 0,
    }))
    list.sort((a, b) => (a.date < b.date ? -1 : 1))
    return list
  } catch (e) {
    console.error('getNavHistoryFromPingzhong error:', (e as Error).message)
    return []
  }
}

// 降级方案：通过 lsjz 接口获取（近期只返回 20 条，仅作备用）
async function getNavHistoryFromLsjz(code: string): Promise<NavPoint[]> {
  try {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - 365)
    const sd = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
    const ed = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=200&startDate=${sd}&endDate=${ed}`
    const text = await fetchJson(url, {
      headers: { Referer: `https://fundf10.eastmoney.com/jjjz_${code}.html` },
    })
    const data = JSON.parse(text)
    const list: NavPoint[] = (data?.Data?.LSJZList || []).map((d: any) => ({
      date: d.FSRQ,
      nav: parseFloat(d.DWJZ),
      growthRate: d.JZZZL ? parseFloat(d.JZZZL) : 0,
    }))
    list.sort((a, b) => (a.date < b.date ? -1 : 1))
    return list
  } catch (e) {
    console.error('getNavHistoryFromLsjz error:', (e as Error).message)
    return []
  }
}

function formatDateFromTs(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ============ 重仓股票 ============
// 天天基金 fundf10 FundArchivesDatas 接口（返回 JSONP 含 HTML 表格）
export async function getHoldings(code: string): Promise<Partial<Holding>[]> {
  const cacheKey = `holdings:${code}`
  const hit = cached<Partial<Holding>[]>(cacheKey, 6 * 60 * 60 * 1000)
  if (hit) return hit
  try {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const candidates: { y: number; m: number }[] = []
    for (let y = year; y >= year - 1 && candidates.length < 6; y--) {
      for (let m = 12; m >= 1; m--) {
        if (y === year && m > month) continue
        candidates.push({ y, m })
        if (candidates.length >= 6) break
      }
    }

    let html = ''
    for (const c of candidates) {
      const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${c.y}&month=${c.m}`
      const text = await fetchJson(url, {
        headers: { Referer: `https://fundf10.eastmoney.com/ccmx_${code}.html` },
      })
      if (text && text.includes('apidata') && text.includes('<tbody>')) {
        html = text
        break
      }
    }

    if (!html) return []

    const contentMatch = html.match(/content:"([\s\S]*?)",arryear/)
    const contentHtml = contentMatch ? contentMatch[1] : html

    const rowRegex = /<tr>[\s\S]*?<\/tr>/g
    const rows = contentHtml.match(rowRegex) || []

    const result: Partial<Holding>[] = []
    for (const row of rows) {
      const cells: string[] = []
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g
      let cm: RegExpExecArray | null
      while ((cm = cellRegex.exec(row)) !== null) {
        const text = cm[1].replace(/<[^>]+>/g, '').trim()
        cells.push(text)
      }
      if (cells.length < 5) continue
      const rank = parseInt(cells[0])
      if (isNaN(rank) || rank < 1 || rank > 20) continue
      const stockCode = cells[1].replace(/[^0-9]/g, '')
      const stockName = cells[2]
      let ratio = 0
      for (let i = 3; i < cells.length; i++) {
        const v = parseFloat(cells[i])
        if (!isNaN(v) && cells[i].includes('%')) {
          ratio = v
          break
        }
      }
      if (stockCode && stockName) {
        result.push({ rank, code: stockCode, name: stockName, ratio, industry: '' })
      }
      if (result.length >= 10) break
    }

    setCache(cacheKey, result)
    return result
  } catch (e) {
    console.error('getHoldings error:', (e as Error).message)
    return []
  }
}

// ============ 个股行情信息（最新价、涨跌、市值、PE） ============
// 使用腾讯财经接口（qt.gtimg.cn），返回 GBK 编码
export async function getStockQuote(stockCode: string): Promise<StockQuote | null> {
  const cacheKey = `stockq:${stockCode}`
  const hit = cached<StockQuote>(cacheKey, 5 * 60 * 1000)
  if (hit) return hit
  try {
    // 判断市场前缀：A股(6/0/3开头) + 港股(5位0开头)
    const prefix = getStockPrefix(stockCode)
    const url = `http://qt.gtimg.cn/q=${prefix}${stockCode}`
    const text = await fetchJson(url)
    const m = text.match(/"([^"]+)"/)
    if (!m) return null
    const parts = m[1].split('~')
    if (parts.length < 50) return null
    // 港股字段布局不同，这里 A 股字段索引：3=当前价，4=昨收，32=涨跌幅，44=总市值(亿)，52=PE(TTM)
    const result: StockQuote = {
      code: stockCode,
      name: '',
      latestPrice: parseFloat(parts[3]) || 0,
      latestChange: parseFloat(parts[32]) || 0,
      prevClose: parseFloat(parts[4]) || 0,
      ytdChange: null,
      marketCap: parts[44] ? parseFloat(parts[44]).toFixed(2) + '亿' : '',
      peRatio: (parts[52] && parseFloat(parts[52])) || (parts[46] && parseFloat(parts[46])) || null,
    }
    setCache(cacheKey, result)
    return result
  } catch (e) {
    console.error('getStockQuote error:', (e as Error).message)
    return null
  }
}

// 判断股票市场前缀（支持 A 股 + 港股）
function getStockPrefix(stockCode: string): string {
  // 港股：5 位数字且以 0 开头（如 00883）
  if (stockCode.length === 5 && stockCode.startsWith('0')) return 'hk'
  // A 股：6/688 开头 → sh，0/3 开头 → sz
  if (stockCode.startsWith('6') || stockCode.startsWith('688')) return 'sh'
  return 'sz'
}

// ============ 个股历史 K 线（用于重仓股走势参照） ============
// 使用腾讯财经历史 K 线接口
export async function getStockHistory(stockCode: string, days = 365): Promise<{ date: string; price: number; change: number }[]> {
  const cacheKey = `stockh:${stockCode}:${days}`
  const hit = cached<{ date: string; price: number; change: number }[]>(cacheKey, 6 * 60 * 60 * 1000)
  if (hit) return hit
  try {
    const prefix = getStockPrefix(stockCode)
    // 港股 K 线接口前缀不同
    const symbol = prefix === 'hk' ? `hk${stockCode}` : `${prefix}${stockCode}`
    const end = new Date()
    const beg = new Date()
    beg.setDate(beg.getDate() - days)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,${fmt(beg)},${fmt(end)},640,qfq`
    const text = await fetchJson(url)
    const data = JSON.parse(text)
    const klines = data?.data?.[symbol]?.qfqday || data?.data?.[symbol]?.day || []
    const list = klines.map((k: string[]) => {
      const date = k[0]
      const close = parseFloat(k[2])
      return { date, price: close, change: 0 }
    })
    for (let i = list.length - 1; i > 0; i--) {
      const prev = list[i - 1].price
      list[i].change = prev ? +(((list[i].price - prev) / prev) * 100).toFixed(2) : 0
    }
    setCache(cacheKey, list)
    return list
  } catch (e) {
    console.error('getStockHistory error:', (e as Error).message)
    return []
  }
}
