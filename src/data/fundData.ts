import type { Fund, NewsItem, NavPoint, Holding } from '../types'

// ============ 工具函数 ============
function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 基于种子的伪随机，保证数据可复现
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

// 生成一年的交易日（跳过周末）
function generateTradingDays(startDate: string, count: number): string[] {
  const days: string[] = []
  const start = new Date(startDate)
  let i = 0
  while (days.length < count) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) days.push(formatDate(d))
    i++
  }
  return days
}

// 生成净值序列：带趋势 + 波动 + 偶发事件冲击
function generateNavSeries(
  dates: string[],
  startNav: number,
  drift: number, // 每日漂移
  volatility: number,
  seed: number,
  shocks: { date: string; impact: number }[] = [],
): NavPoint[] {
  const rand = seededRandom(seed)
  let nav = startNav
  return dates.map((date) => {
    // 检查是否有事件冲击
    const shock = shocks.find((s) => s.date === date)
    const shockImpact = shock ? shock.impact : 0
    // Box-Muller 近似生成正态分布
    const noise = (rand() + rand() + rand() - 1.5) * volatility
    const growthRate = drift + noise + shockImpact
    const prevNav = nav
    nav = Math.max(0.3, prevNav * (1 + growthRate / 100))
    return { date, nav: +nav.toFixed(4), growthRate: +((nav / prevNav - 1) * 100).toFixed(2) }
  })
}

// 生成股票价格序列（独立于基金，但受相同宏观事件影响）
function generatePriceSeries(
  dates: string[],
  startPrice: number,
  drift: number,
  volatility: number,
  seed: number,
  shocks: { date: string; impact: number }[] = [],
): { date: string; price: number; change: number }[] {
  const rand = seededRandom(seed)
  let price = startPrice
  return dates.map((date) => {
    const shock = shocks.find((s) => s.date === date)
    const shockImpact = shock ? shock.impact * 1.5 : 0 // 个股波动放大
    const noise = (rand() + rand() + rand() - 1.5) * volatility
    const change = drift + noise + shockImpact
    const prev = price
    price = Math.max(1, prev * (1 + change / 100))
    return { date, price: +price.toFixed(2), change: +change.toFixed(2) }
  })
}

// ============ 宏观事件冲击点（用于制造净值波动 + 触发新闻） ============
const MACRO_SHOCKS = [
  { date: '2025-09-24', impact: 2.8, label: '美联储超预期降息50bp' },
  { date: '2025-10-08', impact: 3.5, label: '财政部大规模化债计划公布' },
  { date: '2025-11-05', impact: -1.8, label: '美国大选结果引发市场震荡' },
  { date: '2025-12-18', impact: -2.2, label: '年末资金面紧张，债市调整' },
  { date: '2026-01-20', impact: 2.1, label: '春节消费数据超预期' },
  { date: '2026-03-15', impact: -1.5, label: '硅谷银行风波余波，科技股回调' },
  { date: '2026-04-10', impact: 2.6, label: 'AI算力需求爆发，半导体领涨' },
  { date: '2026-05-22', impact: -2.0, label: '地缘冲突升级，避险情绪上升' },
  { date: '2026-06-18', impact: 1.9, label: '央行降准0.5个百分点' },
  { date: '2026-07-28', impact: -1.2, label: '美联储释放鹰派信号' },
]

// ============ 生成基金数据 ============
const TRADING_DAYS = generateTradingDays('2025-08-04', 240)

function computeMetrics(navSeries: NavPoint[]) {
  const latest = navSeries[navSeries.length - 1]
  const first = navSeries[0]
  const totalReturn = +(((latest.nav / first.nav) - 1) * 100).toFixed(2)
  // 年初至今：找到2026-01-01之后的第一个点
  const ytdStart = navSeries.find((p) => p.date >= '2026-01-01') ?? first
  const ytdReturn = +(((latest.nav / ytdStart.nav) - 1) * 100).toFixed(2)
  // 最大回撤
  let peak = navSeries[0].nav
  let maxDD = 0
  for (const p of navSeries) {
    if (p.nav > peak) peak = p.nav
    const dd = ((p.nav - peak) / peak) * 100
    if (dd < maxDD) maxDD = dd
  }
  // 波动率（日收益率标准差 * sqrt(252)）
  const returns = navSeries.slice(1).map((p, i) => p.growthRate)
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
  const vol = +Math.sqrt(variance * 252).toFixed(2)
  // 夏普比率（假设无风险利率2%）
  const sharpe = +(((totalReturn - 2) / vol) || 0).toFixed(2)
  return {
    latestNav: latest.nav,
    latestGrowth: latest.growthRate,
    navUnit: '元',
    totalReturn,
    ytdReturn,
    maxDrawdown: +maxDD.toFixed(2),
    sharpeRatio: sharpe,
    volatility: vol,
    scale: '',
  }
}

function buildHoldings(
  defs: { code: string; name: string; industry: string; ratio: number; basePrice: number; drift: number; vol: number; seed: number }[],
): Holding[] {
  return defs.map((d, idx) => {
    const trend = generatePriceSeries(TRADING_DAYS, d.basePrice, d.drift, d.vol, d.seed, MACRO_SHOCKS)
    const latest = trend[trend.length - 1]
    const ytdStart = trend.find((t) => t.date >= '2026-01-01') ?? trend[0]
    return {
      rank: idx + 1,
      code: d.code,
      name: d.name,
      ratio: d.ratio,
      industry: d.industry,
      trend,
      latestPrice: latest.price,
      latestChange: latest.change,
      ytdChange: +(((latest.price / ytdStart.price) - 1) * 100).toFixed(2),
      marketCap: ['2.8万亿', '1.5万亿', '8200亿', '4500亿', '3200亿', '6800亿', '5100亿', '2900亿', '1800亿', '1500亿'][idx] ?? '1000亿',
      peRatio: +(15 + Math.random() * 35).toFixed(1),
    }
  })
}

export const FUNDS: Fund[] = [
  {
    id: 'f1',
    code: '012345',
    name: '华夏科创先锋A',
    type: '股票型 · 科创板',
    manager: '张明远',
    company: '华夏基金',
    color: '#6366f1',
    navSeries: generateNavSeries(TRADING_DAYS, 1.2, 0.06, 1.6, 42, MACRO_SHOCKS),
    holdings: buildHoldings([
      { code: '688981', name: '中芯国际', industry: '半导体', ratio: 9.8, basePrice: 95, drift: 0.08, vol: 2.4, seed: 101 },
      { code: '688256', name: '寒武纪', industry: '半导体', ratio: 8.5, basePrice: 220, drift: 0.12, vol: 3.5, seed: 102 },
      { code: '688036', name: '传音控股', industry: '消费电子', ratio: 7.2, basePrice: 130, drift: 0.05, vol: 2.0, seed: 103 },
      { code: '688111', name: '金山办公', industry: '软件', ratio: 6.8, basePrice: 280, drift: 0.09, vol: 2.6, seed: 104 },
      { code: '688012', name: '中微公司', industry: '半导体设备', ratio: 6.3, basePrice: 180, drift: 0.10, vol: 2.8, seed: 105 },
      { code: '688005', name: '容百科技', industry: '新能源', ratio: 5.5, basePrice: 45, drift: 0.02, vol: 2.9, seed: 106 },
      { code: '688185', name: '康希诺', industry: '生物医药', ratio: 4.9, basePrice: 65, drift: -0.01, vol: 3.0, seed: 107 },
      { code: '688169', name: '石头科技', industry: '智能家居', ratio: 4.3, basePrice: 280, drift: 0.06, vol: 2.3, seed: 108 },
      { code: '688126', name: '沪硅产业', industry: '半导体材料', ratio: 3.8, basePrice: 18, drift: 0.07, vol: 2.7, seed: 109 },
      { code: '688082', name: '盛美上海', industry: '半导体设备', ratio: 3.4, basePrice: 110, drift: 0.08, vol: 2.5, seed: 110 },
    ]),
    metrics: {} as any,
  },
  {
    id: 'f2',
    code: '005828',
    name: '易方达蓝筹精选',
    type: '混合型 · 大盘价值',
    manager: '张坤',
    company: '易方达基金',
    color: '#10b981',
    navSeries: generateNavSeries(TRADING_DAYS, 1.8, 0.03, 1.1, 88, MACRO_SHOCKS),
    holdings: buildHoldings([
      { code: '600519', name: '贵州茅台', industry: '白酒', ratio: 11.2, basePrice: 1500, drift: 0.02, vol: 1.6, seed: 201 },
      { code: '000858', name: '五粮液', industry: '白酒', ratio: 8.7, basePrice: 140, drift: 0.02, vol: 1.8, seed: 202 },
      { code: '600036', name: '招商银行', industry: '银行', ratio: 8.1, basePrice: 38, drift: 0.01, vol: 1.3, seed: 203 },
      { code: '000333', name: '美的集团', industry: '家电', ratio: 7.5, basePrice: 75, drift: 0.04, vol: 1.5, seed: 204 },
      { code: '601318', name: '中国平安', industry: '保险', ratio: 6.9, basePrice: 50, drift: 0.03, vol: 1.4, seed: 205 },
      { code: '600276', name: '恒瑞医药', industry: '医药', ratio: 6.2, basePrice: 48, drift: 0.03, vol: 1.7, seed: 206 },
      { code: '000651', name: '格力电器', industry: '家电', ratio: 5.8, basePrice: 42, drift: 0.01, vol: 1.5, seed: 207 },
      { code: '002714', name: '牧原股份', industry: '农业', ratio: 5.1, basePrice: 45, drift: 0.00, vol: 2.1, seed: 208 },
      { code: '603259', name: '药明康德', industry: '医药研发', ratio: 4.6, basePrice: 60, drift: -0.02, vol: 2.2, seed: 209 },
      { code: '600309', name: '万华化学', industry: '化工', ratio: 4.0, basePrice: 85, drift: 0.03, vol: 1.8, seed: 210 },
    ]),
    metrics: {} as any,
  },
  {
    id: 'f3',
    code: '161725',
    name: '招商中证白酒指数',
    type: '指数型 · 消费',
    manager: '侯昊',
    company: '招商基金',
    color: '#f59e0b',
    navSeries: generateNavSeries(TRADING_DAYS, 0.95, 0.04, 1.8, 64, MACRO_SHOCKS),
    holdings: buildHoldings([
      { code: '600519', name: '贵州茅台', industry: '白酒', ratio: 15.8, basePrice: 1500, drift: 0.02, vol: 1.6, seed: 301 },
      { code: '000858', name: '五粮液', industry: '白酒', ratio: 12.3, basePrice: 140, drift: 0.02, vol: 1.8, seed: 302 },
      { code: '000568', name: '泸州老窖', industry: '白酒', ratio: 9.6, basePrice: 180, drift: 0.03, vol: 1.9, seed: 303 },
      { code: '002304', name: '洋河股份', industry: '白酒', ratio: 8.2, basePrice: 95, drift: 0.01, vol: 1.7, seed: 304 },
      { code: '000596', name: '古井贡酒', industry: '白酒', ratio: 7.1, basePrice: 220, drift: 0.03, vol: 1.8, seed: 305 },
      { code: '600779', name: '水井坊', industry: '白酒', ratio: 5.9, basePrice: 55, drift: 0.02, vol: 2.0, seed: 306 },
      { code: '000799', name: '酒鬼酒', industry: '白酒', ratio: 5.0, basePrice: 28, drift: 0.00, vol: 2.3, seed: 307 },
      { code: '603369', name: '今世缘', industry: '白酒', ratio: 4.4, basePrice: 48, drift: 0.03, vol: 1.7, seed: 308 },
      { code: '600197', name: '伊力特', industry: '白酒', ratio: 3.6, basePrice: 22, drift: 0.01, vol: 2.0, seed: 309 },
      { code: '000995', name: '皇台酒业', industry: '白酒', ratio: 2.8, basePrice: 15, drift: -0.01, vol: 2.4, seed: 310 },
    ]),
    metrics: {} as any,
  },
  {
    id: 'f4',
    code: '320007',
    name: '诺安成长混合',
    type: '混合型 · 半导体',
    manager: '蔡嵩松',
    company: '诺安基金',
    color: '#ef4444',
    navSeries: generateNavSeries(TRADING_DAYS, 1.35, 0.07, 2.4, 77, MACRO_SHOCKS),
    holdings: buildHoldings([
      { code: '688981', name: '中芯国际', industry: '半导体', ratio: 10.5, basePrice: 95, drift: 0.08, vol: 2.4, seed: 401 },
      { code: '002049', name: '紫光国微', industry: '半导体', ratio: 9.2, basePrice: 75, drift: 0.09, vol: 2.6, seed: 402 },
      { code: '688012', name: '中微公司', industry: '半导体设备', ratio: 8.6, basePrice: 180, drift: 0.10, vol: 2.8, seed: 403 },
      { code: '300142', name: '沃森生物', industry: '生物医药', ratio: 7.4, basePrice: 28, drift: -0.02, vol: 2.5, seed: 404 },
      { code: '603501', name: '韦尔股份', industry: '半导体', ratio: 6.9, basePrice: 95, drift: 0.07, vol: 2.7, seed: 405 },
      { code: '300661', name: '圣邦股份', industry: '半导体', ratio: 6.3, basePrice: 160, drift: 0.08, vol: 2.8, seed: 406 },
      { code: '688082', name: '盛美上海', industry: '半导体设备', ratio: 5.7, basePrice: 110, drift: 0.08, vol: 2.5, seed: 407 },
      { code: '002371', name: '北方华创', industry: '半导体设备', ratio: 5.2, basePrice: 320, drift: 0.09, vol: 2.6, seed: 408 },
      { code: '688256', name: '寒武纪', industry: '半导体', ratio: 4.6, basePrice: 220, drift: 0.12, vol: 3.5, seed: 409 },
      { code: '300223', name: '北京君正', industry: '半导体', ratio: 4.0, basePrice: 65, drift: 0.06, vol: 2.7, seed: 410 },
    ]),
    metrics: {} as any,
  },
]

// 计算每只基金的指标 & 规模
const SCALES = ['78.2亿', '412.6亿', '286.9亿', '156.3亿']
FUNDS.forEach((f, i) => {
  f.metrics = computeMetrics(f.navSeries)
  f.metrics.scale = SCALES[i]
})

// ============ 新闻数据 ============
// 为每个宏观冲击点 + 关键日期生成多条新闻
const NEWS_DB: NewsItem[] = [
  // 2025-09 美联储降息
  { id: 'n1', title: '美联储宣布降息50个基点，超出市场预期', source: '新华社', date: '2025-09-24', region: '美国', category: '宏观', summary: '美联储FOMC会议决定将联邦基金利率目标区间下调50个基点，为2024年以来首次大幅降息，鲍威尔表示通胀压力缓解但劳动力市场需关注。', impact: '利好', impactScore: 72, url: '#' },
  { id: 'n2', title: 'Global markets rally as Fed delivers jumbo rate cut', source: 'Reuters', date: '2025-09-24', region: '全球', category: '宏观', summary: 'Stock markets worldwide surged after the Federal Reserve cut rates by half a percentage point, with risk assets broadly benefiting from the dovish pivot.', impact: '利好', impactScore: 68, url: '#' },
  { id: 'n3', title: 'A股三大指数集体高开，半导体板块领涨', source: '证券时报', date: '2025-09-25', region: '中国', category: '行业', summary: '受海外宽松预期提振，上证指数高开1.2%，科创板半导体个股批量涨停，北向资金净流入超80亿元。', impact: '利好', impactScore: 65, url: '#' },
  { id: 'n4', title: '美元指数跌破100关口，人民币汇率走强', source: '第一财经', date: '2025-09-25', region: '全球', category: '宏观', summary: '美元指数跌至99.8，离岸人民币升破7.10，外资机构上调中国资产评级。', impact: '利好', impactScore: 58, url: '#' },

  // 2025-10 财政部化债
  { id: 'n5', title: '财政部推出6万亿化债计划，地方债风险显著化解', source: '人民日报', date: '2025-10-08', region: '中国', category: '政策', summary: '国务院批准增加地方政府债务限额置换存量隐性债务，规模达6万亿元，市场风险偏好显著提升。', impact: '利好', impactScore: 80, url: '#' },
  { id: 'n6', title: '金融股大涨，银行板块单日涨幅创年内新高', source: '上海证券报', date: '2025-10-08', region: '中国', category: '行业', summary: '化债利好直接提振银行资产质量预期，招商银行、平安银行等领涨，银行ETF涨超6%。', impact: '利好', impactScore: 75, url: '#' },
  { id: 'n7', title: 'China unveils massive debt swap to ease local fiscal strain', source: 'Bloomberg', date: '2025-10-08', region: '全球', category: '宏观', summary: 'China announced a 6 trillion yuan debt swap program to reduce hidden local government debt, boosting confidence in the financial sector.', impact: '利好', impactScore: 70, url: '#' },
  { id: 'n8', title: '外资机构集体看多中国，高盛上调A股目标位', source: '财新网', date: '2025-10-09', region: '中国', category: '宏观', summary: '高盛、瑞银等机构发布研报看好中国资产，MSCI中国指数一周上涨12%。', impact: '利好', impactScore: 62, url: '#' },

  // 2025-11 美国大选
  { id: 'n9', title: '美国大选结果揭晓，全球市场震荡', source: 'CNN', date: '2025-11-05', region: '美国', category: '地缘', summary: '美国大选结果公布后，全球资本市场剧烈波动，美元、美债收益率大幅上行，新兴市场资金外流。', impact: '利空', impactScore: -55, url: '#' },
  { id: 'n10', title: 'A股低开反弹，机构建议关注内需主线', source: '中国证券报', date: '2025-11-06', region: '中国', category: '宏观', summary: '受外部扰动影响上证低开1.5%后回升，消费、医药防御板块表现稳健。', impact: '利空', impactScore: -38, url: '#' },
  { id: 'n11', title: '关税担忧升温，出口相关板块承压', source: '经济观察报', date: '2025-11-07', region: '中国', category: '行业', summary: '市场担忧新一届美国政府对华加征关税，纺织、家电等出口链个股回调。', impact: '利空', impactScore: -48, url: '#' },
  { id: 'n12', title: 'Gold spikes as geopolitical uncertainty rises', source: 'Financial Times', date: '2025-11-05', region: '全球', category: '地缘', summary: 'Gold prices jumped 2.5% as investors sought safe-haven assets amid US election uncertainty.', impact: '中性', impactScore: 20, url: '#' },

  // 2025-12 年末资金面
  { id: 'n13', title: '年末资金面紧张，国债期货大幅下跌', source: '中国基金报', date: '2025-12-18', region: '中国', category: '宏观', summary: '银行间质押式回购利率飙升至3.5%，10年期国债收益率上行至2.6%，债基普遍回调。', impact: '利空', impactScore: -60, url: '#' },
  { id: 'n14', title: '央行开展MLF操作投放流动性，但难解结构性紧张', source: '21世纪经济报道', date: '2025-12-19', region: '中国', category: '政策', summary: '央行开展14500亿元MLF操作，但同业存单利率仍处高位，资金面紧张延续至年末。', impact: '利空', impactScore: -42, url: '#' },
  { id: 'n15', title: '公募基金年末排名战白热化，重仓股波动加大', source: '证券时报', date: '2025-12-20', region: '中国', category: '行业', summary: '基金调仓换股加剧抱团股波动，白酒、新能源板块出现明显资金博弈。', impact: '利空', impactScore: -35, url: '#' },

  // 2026-01 春节消费
  { id: 'n16', title: '春节假期消费数据亮眼，白酒销量同比增长18%', source: '商务部', date: '2026-01-20', region: '中国', category: '宏观', summary: '春节期间全国零售和餐饮企业销售额同比增长12.5%，白酒、免税消费表现突出。', impact: '利好', impactScore: 68, url: '#' },
  { id: 'n17', title: '白酒板块走强，茅台股价突破1700元', source: '上海证券报', date: '2026-01-21', region: '中国', category: '公司', summary: '贵州茅台股价创年内新高，白酒指数基金净值单日上涨2.3%。', impact: '利好', impactScore: 55, url: '#' },
  { id: 'n18', title: 'Spring Festival spending boosts consumer confidence', source: 'CNBC', date: '2026-01-21', region: '亚太', category: '宏观', summary: 'China retail sales during the Lunar New Year holiday surged 12.5%, signaling robust consumer recovery.', impact: '利好', impactScore: 60, url: '#' },

  // 2026-03 硅谷银行余波
  { id: 'n19', title: '区域性银行风险再度引发关注，科技股承压', source: '华尔街见闻', date: '2026-03-15', region: '美国', category: '宏观', summary: '美国一家区域性银行财报不及预期，市场重新审视中小银行资产质量，科技成长股估值回调。', impact: '利空', impactScore: -50, url: '#' },
  { id: 'n20', title: '半导体板块回调，机构认为是布局良机', source: '中国证券报', date: '2026-03-16', region: '中国', category: '行业', summary: '受海外科技股拖累，半导体ETF下跌3.2%，但机构认为AI算力需求支撑长期逻辑不变。', impact: '中性', impactScore: -15, url: '#' },
  { id: 'n21', title: 'Fed signals caution on rate cuts amid banking stress', source: 'Reuters', date: '2026-03-15', region: '美国', category: '宏观', summary: 'The Federal Reserve indicated potential delays in rate cuts due to lingering banking sector vulnerabilities.', impact: '利空', impactScore: -45, url: '#' },

  // 2026-04 AI算力爆发
  { id: 'n22', title: 'AI算力需求爆发，全球半导体景气度超预期', source: '科技日报', date: '2026-04-10', region: '全球', category: '行业', summary: '主要云厂商Capex指引大幅上调，AI芯片订单可见度延伸至2027年，半导体设备龙头订单暴增。', impact: '利好', impactScore: 78, url: '#' },
  { id: 'n23', title: '中微公司单季订单创新高，国产替代加速', source: '财联社', date: '2026-04-11', region: '中国', category: '公司', summary: '中微公司一季度新签订单同比增长85%，刻蚀设备在先进制程验证顺利。', impact: '利好', impactScore: 70, url: '#' },
  { id: 'n24', title: 'Nvidia, AMD hit record highs on AI chip demand', source: 'Bloomberg', date: '2026-04-10', region: '全球', category: '公司', summary: 'Shares of Nvidia and AMD surged to all-time highs as cloud giants ramp up AI infrastructure spending.', impact: '利好', impactScore: 75, url: '#' },
  { id: 'n25', title: '科创50指数大涨3.5%，半导体占据涨幅榜', source: '证券时报', date: '2026-04-11', region: '中国', category: '行业', summary: '科创板半导体个股批量涨停，诺安成长、华夏科创等基金净值单日涨超4%。', impact: '利好', impactScore: 72, url: '#' },

  // 2026-05 地缘冲突
  { id: 'n26', title: '中东地缘冲突升级，原油价格飙升8%', source: '新华社', date: '2026-05-22', region: '地缘', category: '地缘', summary: '地区紧张局势升级推动布伦特原油突破95美元，避险资产黄金、美债走强，全球股市承压。', impact: '利空', impactScore: -58, url: '#' },
  { id: 'n27', title: 'A股风险偏好下降，北向资金净流出120亿', source: '第一财经', date: '2026-05-23', region: '中国', category: '宏观', summary: '受地缘风险影响，北向资金大幅流出，高估值成长股回调，红利低波板块相对抗跌。', impact: '利空', impactScore: -52, url: '#' },
  { id: 'n28', title: 'Oil shock threatens global inflation outlook', source: 'Financial Times', date: '2026-05-22', region: '全球', category: '宏观', summary: 'The oil price surge triggered by geopolitical tensions could reignite inflation, complicating central bank policy paths.', impact: '利空', impactScore: -60, url: '#' },

  // 2026-06 央行降准
  { id: 'n29', title: '央行宣布降准0.5个百分点，释放长期资金约1万亿', source: '中国人民银行', date: '2026-06-18', region: '中国', category: '政策', summary: '中国人民银行决定于6月25日下调金融机构存款准备金率0.5个百分点，预计释放长期资金约1万亿元。', impact: '利好', impactScore: 65, url: '#' },
  { id: 'n30', title: '金融、地产板块领涨，沪深300单日涨2.1%', source: '上海证券报', date: '2026-06-18', region: '中国', category: '行业', summary: '降准直接利好银行负债成本，地产融资环境改善预期升温，蓝筹板块普涨。', impact: '利好', impactScore: 60, url: '#' },
  { id: 'n31', title: 'PBOC easing supports equity valuations, says Goldman', source: 'Goldman Sachs Research', date: '2026-06-19', region: '全球', category: '宏观', summary: "Goldman Sachs noted the PBOC's RRR cut would support equity valuations, particularly financials and property.", impact: '利好', impactScore: 55, url: '#' },

  // 2026-07 美联储鹰派
  { id: 'n32', title: '美联储7月会议释放鹰派信号，9月降息预期降温', source: '华尔街见闻', date: '2026-07-28', region: '美国', category: '宏观', summary: '美联储会议纪要显示通胀粘性仍存，多数官员倾向暂缓降息，美债收益率上行，全球成长股承压。', impact: '利空', impactScore: -48, url: '#' },
  { id: 'n33', title: '北向资金再度流出，科创板高位回调', source: '中国证券报', date: '2026-07-29', region: '中国', category: '行业', summary: '受海外流动性预期变化影响，前期涨幅较大的科创板回调3%，半导体板块资金获利了结。', impact: '利空', impactScore: -42, url: '#' },
  { id: 'n34', title: 'Dollar strengthens as Fed stays hawkish', source: 'Reuters', date: '2026-07-28', region: '全球', category: '宏观', summary: 'The dollar index rose to a one-month high as Fed officials pushed back against market expectations for imminent rate cuts.', impact: '利空', impactScore: -40, url: '#' },
]

export { NEWS_DB, MACRO_SHOCKS, TRADING_DAYS }

// 根据日期检索新闻：返回该日期 ±3 天范围内的新闻
export function searchNewsByDate(date: string, rangeDays = 3): NewsItem[] {
  const target = new Date(date)
  return NEWS_DB.filter((n) => {
    const nd = new Date(n.date)
    const diff = Math.abs(nd.getTime() - target.getTime()) / (1000 * 60 * 60 * 24)
    return diff <= rangeDays
  }).sort((a, b) => {
    // 按与目标日期的距离排序
    const da = Math.abs(new Date(a.date).getTime() - target.getTime())
    const db = Math.abs(new Date(b.date).getTime() - target.getTime())
    return da - db
  })
}

// 获取所有日期（用于判断是否有新闻）
export function getNewsDates(): string[] {
  return [...new Set(NEWS_DB.map((n) => n.date))]
}
