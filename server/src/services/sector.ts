// 基金领域推断：根据基金名称、重仓股推断所属行业领域，生成精准新闻检索关键词
// 用于新闻检索时聚焦到基金相关领域，提升相关性
import { getFundDetail } from './fund'
import { getFundHoldings } from './fund'

export interface FundSector {
  code: string
  name: string
  // 推断出的领域标签（如：白酒、半导体、新能源）
  sectors: string[]
  // 生成的新闻检索关键词（中英文混合）
  keywords: string[]
  // 一句话描述
  description: string
}

// 领域关键词映射表：关键词 -> (中文名, 英文检索词, 新闻分类)
const SECTOR_MAP: { match: string[]; name: string; enTerms: string[] }[] = [
  { match: ['白酒', '酒', '茅台', '五粮液', '泸州老窖'], name: '白酒', enTerms: ['liquor', 'baijiu', 'spirits'] },
  { match: ['半导体', '芯片', '中芯国际', '集成电路'], name: '半导体', enTerms: ['semiconductor', 'chip'] },
  { match: ['新能源', '光伏', '锂电', '电动车', '新能源车', '宁德时代'], name: '新能源', enTerms: ['new energy', 'solar', 'EV', 'lithium'] },
  { match: ['医药', '医疗', '生物', '创新药', '医疗器械'], name: '医药', enTerms: ['pharma', 'biotech', 'medical', 'healthcare'] },
  { match: ['消费', '食品', '零售', '白酒'], name: '消费', enTerms: ['consumer', 'retail'] },
  { match: ['银行', '金融', '证券', '保险'], name: '金融', enTerms: ['bank', 'finance', 'insurance'] },
  { match: ['地产', '房地产', '建材'], name: '地产', enTerms: ['real estate', 'property'] },
  { match: ['科技', '互联网', '软件', '人工智能', 'AI', '腾讯', '阿里'], name: '科技', enTerms: ['tech', 'internet', 'AI'] },
  { match: ['军工', '国防', '航天'], name: '军工', enTerms: ['defense', 'military', 'aerospace'] },
  { match: ['有色', '铜', '铝', '黄金', '矿业'], name: '有色', enTerms: ['mining', 'metals', 'gold'] },
  { match: ['煤炭', '钢铁', '能源'], name: '能源', enTerms: ['coal', 'steel', 'energy'] },
  { match: ['环保', '碳'], name: '环保', enTerms: ['carbon', 'green', 'environment'] },
  { match: ['农业', '食品'], name: '农业', enTerms: ['agriculture', 'food'] },
  { match: ['基建', '建筑', '工程'], name: '基建', enTerms: ['infrastructure', 'construction'] },
  { match: ['汽车', '整车'], name: '汽车', enTerms: ['auto', 'vehicle'] },
  { match: ['港股', '恒生', '中概'], name: '港股', enTerms: ['Hong Kong', 'Hang Seng'] },
  { match: ['美股', '标普', '纳斯达克', '道琼斯'], name: '美股', enTerms: ['US stock', 'S&P', 'Nasdaq'] },
]

// 基金名称中的宽基/主题关键词（无需重仓股即可识别）
const BROAD_KEYWORDS: { match: string[]; name: string; enTerms: string[] }[] = [
  { match: ['沪深300', '300'], name: '沪深300大盘', enTerms: ['CSI 300', 'China large cap'] },
  { match: ['中证500', '500'], name: '中证500中盘', enTerms: ['CSI 500', 'China mid cap'] },
  { match: ['中证1000', '1000'], name: '中证1000小盘', enTerms: ['CSI 1000', 'China small cap'] },
  { match: ['创业板', '成长'], name: '创业板成长', enTerms: ['ChiNext', 'growth stock'] },
  { match: ['蓝筹', '价值'], name: '蓝筹价值', enTerms: ['blue chip', 'value stock'] },
  { match: ['港股', '恒生', '中概'], name: '港股', enTerms: ['Hong Kong', 'Hang Seng'] },
  { match: ['美股', '标普', '纳斯达克'], name: '美股', enTerms: ['US stock', 'S&P'] },
]

export async function inferFundSector(code: string): Promise<FundSector> {
  const cacheKey = `sector:${code}`
  // 先尝试从详情推断（缓存命中则直接返回）
  const detail = await getFundDetail(code).catch(() => null)

  if (!detail || !detail.name) {
    return { code, name: '', sectors: [], keywords: [], description: '无法获取基金信息' }
  }

  const sectors = new Set<string>()
  const enTerms = new Set<string>()
  const matchText = (detail.name || '').toLowerCase()

  // 1) 从基金名称匹配宽基/主题
  for (const b of BROAD_KEYWORDS) {
    if (b.match.some((m) => matchText.includes(m.toLowerCase()))) {
      sectors.add(b.name)
      b.enTerms.forEach((t) => enTerms.add(t))
    }
  }
  // 2) 从基金名称匹配行业
  for (const s of SECTOR_MAP) {
    if (s.match.some((m) => matchText.includes(m.toLowerCase()))) {
      sectors.add(s.name)
      s.enTerms.forEach((t) => enTerms.add(t))
    }
  }

  // 3) 若名称未匹配到行业，从重仓股名称推断
  if (sectors.size === 0) {
    try {
      const holdings = await getFundHoldings(code)
      const stockText = holdings.stocks.map((s) => s.stockName).join(' ').toLowerCase()
      for (const s of SECTOR_MAP) {
        if (s.match.some((m) => stockText.includes(m.toLowerCase()))) {
          sectors.add(s.name)
          s.enTerms.forEach((t) => enTerms.add(t))
        }
      }
    } catch {}
  }

  // 4) 若仍未匹配，标记为宽基/混合
  if (sectors.size === 0) {
    sectors.add('混合/宽基')
    enTerms.add('China market')
  }

  const sectorArr = Array.from(sectors)
  const enArr = Array.from(enTerms)
  // 生成检索关键词：领域名 + 英文词，用于 GDELT
  const keywords = [...sectorArr, ...enArr]

  return {
    code,
    name: detail.name,
    sectors: sectorArr,
    keywords,
    description: `领域：${sectorArr.join('、')}`,
  }
}
