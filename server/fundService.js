import { fetchJson, cached, setCache } from './utils.js'

// ============ 基金列表搜索 ============
// 天天基金 fund_search API
export async function searchFunds(keyword) {
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchPageAPI.ashx?m=1&key=${encodeURIComponent(keyword)}&pageIndex=0&pageSize=20&IsNeedBaseInfo=1&IsNeedZTInfo=1`
  const cacheKey = `search:${keyword}`
  const hit = cached(cacheKey)
  if (hit) return hit
  try {
    const text = await fetchJson(url)
    const jsonpMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonpMatch) return []
    const data = JSON.parse(jsonpMatch[0])
    const list = (data.Datas || []).map((d) => ({
      code: d.CODE,
      name: d.NAME.replace(/<[^>]+>/g, ''),
      type: d.FundBaseInfo?.FTYPE || '',
      pinyin: d.PINYIN,
    }))
    setCache(cacheKey, list)
    return list
  } catch (e) {
    console.error('searchFunds error:', e.message)
    return []
  }
}

// ============ 基金详情（名称、类型、经理、规模、净值等） ============
export async function getFundDetail(code) {
  const cacheKey = `detail:${code}`
  const hit = cached(cacheKey, 30 * 60 * 1000)
  if (hit) return hit
  try {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js`
    const text = await fetchJson(url)
    const m = text.match(/\{[\s\S]*\}/)
    let realtime = null
    if (m) {
      try {
        realtime = JSON.parse(m[0])
      } catch {}
    }
    // 详细信息：f10 页面接口
    const detailUrl = `https://fundf10.eastmoney.com/jjjz_${code}.html`
    const html = await fetchJson(detailUrl)
    const name = html.match(/<title>([\s\S]*?)\(/)?.[1]?.trim() || code
    // 从 fundinfo 接口获取更多信息
    const infoUrl = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=0&pageSize=30&plat=Android&appType=ttjj&product=EFund&Version=1&Uid=&deviceid=&CompanyCode=&FCODE=${code}`
    const infoText = await fetchJson(infoUrl)
    let info = {}
    try {
      info = JSON.parse(infoText)
    } catch {}
    const expansion = info?.Expansion || {}
    const detail = {
      code,
      name: expansion?.SHORTNAME || name,
      type: expansion?.FTYPE || '',
      manager: expansion?.JJJL || expansion?.JJL || '',
      company: expansion?.JJGSID || '',
      scale: expansion?.ENDNAV || '',
      netValue: expansion?.DWJZ ? parseFloat(expansion.DWJZ) : realtime?.dwjz ? parseFloat(realtime.dwjz) : null,
      netValueDate: expansion?.FSRQ || realtime?.jzrq || '',
      growthRate: realtime?.gszzl ? parseFloat(realtime.gszzl) : expansion?.RZDF ? parseFloat(expansion.RZDF) : null,
    }
    setCache(cacheKey, detail)
    return detail
  } catch (e) {
    console.error('getFundDetail error:', e.message)
    return { code, name: code, type: '', manager: '', company: '', scale: '', netValue: null, netValueDate: '', growthRate: null }
  }
}

// ============ 历史净值序列 ============
// 统一使用 pingzhongdata 接口获取完整历史，再按 days 参数切片
// pingzhongdata 返回基金成立以来全部净值，lsjz 近期只返回 20 条不可用
export async function getNavHistory(code, days = 365) {
  const isAll = days === 'all' || days === 'ALL'
  const cacheKey = `nav:${code}:full` // 统一缓存完整历史
  let fullList = cached(cacheKey, 24 * 60 * 60 * 1000) // 缓存 24 小时

  if (!fullList) {
    fullList = await getNavHistoryFromPingzhong(code)
    if (fullList.length > 0) {
      setCache(cacheKey, fullList, 24 * 60 * 60 * 1000)
    } else {
      // pingzhongdata 失败时降级到 lsjz
      fullList = await getNavHistoryFromLsjz(code)
    }
  }

  if (isAll || !fullList.length) return fullList

  // 按 days 切片：取最近 days 天的数据
  const daysNum = parseInt(days) || 365
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysNum)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  return fullList.filter((p) => p.date >= cutoffStr)
}

// 通过 pingzhongdata 接口获取基金成立以来全部历史净值
async function getNavHistoryFromPingzhong(code) {
  try {
    const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`
    const text = await fetchJson(url, {
      headers: { Referer: `https://fund.eastmoney.com/${code}.html` },
    })
    const m = text.match(/Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/)
    if (!m) return []
    const arr = JSON.parse(m[1])
    const list = arr.map((d) => ({
      date: formatDateFromTs(d.x),
      nav: +Number(d.y).toFixed(4),
      growthRate: d.equityReturn != null ? +Number(d.equityReturn).toFixed(2) : 0,
    }))
    list.sort((a, b) => (a.date < b.date ? -1 : 1))
    return list
  } catch (e) {
    console.error('getNavHistoryFromPingzhong error:', e.message)
    return []
  }
}

// 降级方案：通过 lsjz 接口获取（近期只返回 20 条，仅作备用）
async function getNavHistoryFromLsjz(code) {
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
    const list = (data?.Data?.LSJZList || []).map((d) => ({
      date: d.FSRQ,
      nav: parseFloat(d.DWJZ),
      growthRate: d.JZZZL ? parseFloat(d.JZZZL) : 0,
    }))
    list.sort((a, b) => (a.date < b.date ? -1 : 1))
    return list
  } catch (e) {
    console.error('getNavHistoryFromLsjz error:', e.message)
    return []
  }
}

function formatDateFromTs(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ============ 重仓股票 ============
// 天天基金 fundf10 FundArchivesDatas 接口（返回 JSONP 含 HTML 表格）
export async function getHoldings(code) {
  const cacheKey = `holdings:${code}`
  const hit = cached(cacheKey, 6 * 60 * 60 * 1000)
  if (hit) return hit
  try {
    // 尝试当前年份的多个季度，取第一个有数据的
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    // 构建候选 year+month 组合：当前季度、上一季度
    const candidates = []
    for (let y = year; y >= year - 1 && candidates.length < 6; y--) {
      for (let m = 12; m >= 1; m--) {
        if (y === year && m > month) continue
        candidates.push({ y, m })
        if (candidates.length >= 6) break
      }
    }

    let html = ''
    let usedYear = year
    let usedMonth = month
    for (const c of candidates) {
      const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${c.y}&month=${c.m}`
      const text = await fetchJson(url, {
        headers: { Referer: `https://fundf10.eastmoney.com/ccmx_${code}.html` },
      })
      if (text && text.includes('apidata') && text.includes('<tbody>')) {
        html = text
        usedYear = c.y
        usedMonth = c.m
        break
      }
    }

    if (!html) return []

    // 提取 content 字段中的 HTML
    const contentMatch = html.match(/content:"([\s\S]*?)",arryear/)
    const contentHtml = contentMatch ? contentMatch[1] : html

    // 解析表格行：<tr><td>1</td><td>...600519...</td><td>...贵州茅台...</td>...比例...</tr>
    const rowRegex = /<tr>[\s\S]*?<\/tr>/g
    const rows = contentHtml.match(rowRegex) || []

    const result = []
    for (const row of rows) {
      // 提取所有单元格文本
      const cells = []
      const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g
      let cm
      while ((cm = cellRegex.exec(row)) !== null) {
        // 去除 HTML 标签，保留文本
        const text = cm[1].replace(/<[^>]+>/g, '').trim()
        cells.push(text)
      }
      if (cells.length < 5) continue
      // 表格列：序号 | 股票代码 | 股票名称 | 最新价 | 涨跌幅 | 相关资讯 | 占净值比例 | 持股数 | 持仓市值
      const rank = parseInt(cells[0])
      if (isNaN(rank) || rank < 1 || rank > 20) continue
      const stockCode = cells[1].replace(/[^0-9]/g, '')
      const stockName = cells[2]
      // 占比可能在第7列（index 6）
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
    console.error('getHoldings error:', e.message)
    return []
  }
}

// ============ 个股行情信息（最新价、涨跌、市值、PE） ============
// 使用腾讯财经接口（qt.gtimg.cn），返回 GBK 编码
export async function getStockQuote(stockCode) {
  const cacheKey = `stockq:${stockCode}`
  const hit = cached(cacheKey, 5 * 60 * 1000)
  if (hit) return hit
  try {
    // 转换为市场前缀：6开头=sh，0/3开头=sz
    const prefix = (stockCode.startsWith('6') || stockCode.startsWith('688')) ? 'sh' : 'sz'
    const url = `http://qt.gtimg.cn/q=${prefix}${stockCode}`
    const text = await fetchJson(url)
    // 腾讯返回 GBK 编码，但数字和 ASCII 部分可直接解析
    // 格式：v_sh600519="1~贵州茅台~600519~1358.98~1350.60~..."
    const m = text.match(/"([^"]+)"/)
    if (!m) return null
    const parts = m[1].split('~')
    if (parts.length < 50) return null
    // 腾讯字段索引：3=当前价，4=昨收，31=涨跌额，32=涨跌幅，44=总市值，46=PE(动态)
    // 名称在 parts[1]（GBK，可能乱码，用基金重仓股名称代替）
    const result = {
      code: stockCode,
      name: '', // 由调用方填充
      latestPrice: parseFloat(parts[3]) || 0,
      latestChange: parseFloat(parts[32]) || 0,
      prevClose: parseFloat(parts[4]) || 0,
      ytdChange: null,
      // parts[44] = 总市值（单位：亿元），parts[52] = PE(TTM)
      marketCap: parts[44] ? parseFloat(parts[44]).toFixed(2) + '亿' : '',
      peRatio: parseFloat(parts[52]) ? parseFloat(parts[52]).toFixed(2) : (parseFloat(parts[46]) ? parseFloat(parts[46]).toFixed(2) : null),
    }
    setCache(cacheKey, result)
    return result
  } catch (e) {
    console.error('getStockQuote error:', e.message)
    return null
  }
}

// ============ 个股历史 K 线（用于重仓股走势参照） ============
// 使用腾讯财经历史 K 线接口
export async function getStockHistory(stockCode, days = 365) {
  const cacheKey = `stockh:${stockCode}:${days}`
  const hit = cached(cacheKey, 6 * 60 * 60 * 1000)
  if (hit) return hit
  try {
    const prefix = (stockCode.startsWith('6') || stockCode.startsWith('688')) ? 'sh' : 'sz'
    const end = new Date()
    const beg = new Date()
    beg.setDate(beg.getDate() - days)
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${prefix}${stockCode},day,${fmt(beg)},${fmt(end)},640,qfq`
    const text = await fetchJson(url)
    const data = JSON.parse(text)
    // 数据在 data.data.<code>.qfqday，每条：[日期, 开, 收, 高, 低, 成交量]
    const klines = data?.data?.[`${prefix}${stockCode}`]?.qfqday || []
    const list = klines.map((k) => {
      const date = k[0]
      const close = parseFloat(k[2])
      return { date, price: close, change: 0 }
    })
    // 计算涨跌幅
    for (let i = list.length - 1; i > 0; i--) {
      const prev = list[i - 1].price
      list[i].change = prev ? +(((list[i].price - prev) / prev) * 100).toFixed(2) : 0
    }
    setCache(cacheKey, list)
    return list
  } catch (e) {
    console.error('getStockHistory error:', e.message)
    return []
  }
}
