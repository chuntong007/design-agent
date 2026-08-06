// 基金模拟回测：基于历史净值，模拟预设买卖策略
// 策略：定投(DCA)、均线交叉(MA)、动量轮动(Momentum)、止损止盈(StopLoss)、
//       网格交易(Grid)、双动量(DualMomentum)、均值回归(MeanReversion)、
//       趋势跟踪(TrendFollowing)、Kelly仓位(Kelly)、RSI超买超卖(RSI)
import { getFundDetail, type NetWorthPoint } from './fund'

// 净值曲线点
type EquityPoint = { date: string; timestamp: number; value: number; benchmark: number }

// ===== 策略元信息 =====
export interface StrategyInfoParam {
  name: string
  label: string
  default: number
  min: number
  max: number
  desc: string
}

export interface StrategyInfo {
  key: string
  name: string
  category: string // 被动/趋势/均值回归/动量/仓位管理/技术指标
  description: string // 一段话介绍策略原理
  details: string[] // 执行步骤细节，每条一个要点
  suitableMarket: string // 适合的市场环境
  riskLevel: '低' | '中' | '高'
  params: StrategyInfoParam[]
}

export const STRATEGY_INFO: StrategyInfo[] = [
  {
    key: 'dca',
    name: '定投(DCA)',
    category: '被动',
    description: '定期定额投入资金，无视短期波动在固定周期买入固定金额，长期摊薄持仓成本，适合无精力盯盘的长期投资者。',
    details: [
      '按固定频率(如每30个交易日)投入固定金额买入',
      '下跌时买入更多份额、上涨时买入较少份额，自动摊薄成本',
      '不主动择时，持续投入直到回测结束',
      '期末清仓统计总收益'
    ],
    suitableMarket: '震荡市或先跌后涨市场可摊薄成本；单边牛市收益不及一次性买入',
    riskLevel: '低',
    params: [
      { name: 'amount', label: '单次定投金额', default: 1000, min: 100, max: 100000, desc: '每次定投投入的金额(元)' },
      { name: 'freqDays', label: '定投频率(天)', default: 30, min: 1, max: 365, desc: '每隔多少个交易日定投一次' }
    ]
  },
  {
    key: 'ma_cross',
    name: '均线交叉(MA Cross)',
    category: '趋势',
    description: '基于短期与长期移动平均线的金叉死叉信号交易，短均线上穿长均线(金叉)买入、下穿(死叉)卖出，捕捉中长期趋势。',
    details: [
      '计算短期均线(默认5日)与长期均线(默认20日)',
      '短均线上穿长均线形成金叉，全仓买入',
      '短均线下穿长均线形成死叉，全仓卖出',
      '趋势行情中获利，震荡市易产生频繁假信号',
      '期末若持仓则清仓结算'
    ],
    suitableMarket: '单边趋势市(牛市或熊市)，震荡市表现较差',
    riskLevel: '中',
    params: [
      { name: 'shortDays', label: '短期均线天数', default: 5, min: 2, max: 60, desc: '短期移动平均窗口' },
      { name: 'longDays', label: '长期均线天数', default: 20, min: 5, max: 250, desc: '长期移动平均窗口' }
    ]
  },
  {
    key: 'momentum',
    name: '动量轮动(Momentum)',
    category: '动量',
    description: '基于动量效应，回看期涨幅为正则持有、为负则空仓，追随已有趋势获取超额收益。',
    details: [
      '计算过去N个交易日(默认20日)的累计涨幅作为动量',
      '动量由负转正时全仓买入，追随上涨趋势',
      '动量由正转负时全仓卖出，规避下跌',
      '本质是趋势跟随，在反转点会滞后',
      '期末若持仓则清仓'
    ],
    suitableMarket: '单边上涨或大级别趋势市，频繁反转市易被反复打脸',
    riskLevel: '中',
    params: [
      { name: 'lookbackDays', label: '回看天数', default: 20, min: 5, max: 120, desc: '计算动量的回看窗口' },
      { name: 'holdingDays', label: '最短持有天数', default: 0, min: 0, max: 60, desc: '买入后最少持有天数(0为不限制)' }
    ]
  },
  {
    key: 'stop_profit_loss',
    name: '止损止盈(Stop Profit/Loss)',
    category: '仓位管理',
    description: '满仓持有并在达到预设止盈或止损线时卖出，控制单笔交易风险与收益，回落企稳后再重新建仓。',
    details: [
      '初始满仓建仓(按buyAmount)',
      '持仓期间监控相对买入价的盈亏比例',
      '盈利达到止盈线(默认20%)则卖出获利了结',
      '亏损达到止损线(默认10%)则卖出止损',
      '空仓后下一交易日重新建仓，期末清仓'
    ],
    suitableMarket: '震荡上行或波动较大的市场，能有效锁定利润与控制回撤',
    riskLevel: '中',
    params: [
      { name: 'stopProfit', label: '止盈比例(%)', default: 20, min: 1, max: 100, desc: '盈利达到该比例卖出' },
      { name: 'stopLoss', label: '止损比例(%)', default: 10, min: 1, max: 50, desc: '亏损达到该比例卖出' },
      { name: 'buyAmount', label: '单次建仓金额', default: 100000, min: 1000, max: 10000000, desc: '每次建仓投入金额' }
    ]
  },
  {
    key: 'grid_trading',
    name: '网格交易(Grid Trading)',
    category: '均值回归',
    description: '在设定价格区间内划分多档网格，价格跌入档位时分批买入、涨出档位时分批卖出，通过反复高抛低吸在震荡市获利。',
    details: [
      '在[下限,上限]价格区间内划分gridCount档网格',
      '将总资金均分为gridCount份，每档对应一份资金',
      '价格跌破某网格线时买入该档，涨破时卖出该档',
      '下跌多买、上涨多卖，自动在震荡中套利',
      '单边趋势市可能踏空或套牢，期末清仓'
    ],
    suitableMarket: '震荡市表现最佳；单边牛市会过早卖飞，单边熊市会持续接刀',
    riskLevel: '中',
    params: [
      { name: 'gridCount', label: '网格数量', default: 10, min: 2, max: 50, desc: '价格区间划分的网格档数' },
      { name: 'lowerPrice', label: '价格下限', default: 0, min: 0, max: 100000, desc: '网格下限净值(0=自动按区间最小值)' },
      { name: 'upperPrice', label: '价格上限', default: 0, min: 0, max: 100000, desc: '网格上限净值(0=自动按区间最大值)' }
    ]
  },
  {
    key: 'dual_momentum',
    name: '双动量(Dual Momentum)',
    category: '动量',
    description: '同时结合绝对动量与相对动量，只有当标的自身涨幅为正(绝对动量)且优于基准(相对动量)时才持有，否则空仓规避下跌。',
    details: [
      '计算标的过去N日涨幅作为绝对动量',
      '若提供基准代码，计算基准同期涨幅作为参照',
      '绝对动量>0且相对动量优于基准时才满仓持有',
      '任一条件不满足则清仓空仓，规避下跌与弱势品种',
      '未提供基准时退化为纯绝对动量，期末清仓'
    ],
    suitableMarket: '牛熊转换频繁的市场，能较好规避熊市与弱势行情',
    riskLevel: '中',
    params: [
      { name: 'lookbackDays', label: '回看天数', default: 20, min: 5, max: 120, desc: '动量计算回看窗口' }
      // benchmarkCode 为字符串代码，不在此数值参数表内；通过 dualMomentum.benchmarkCode 可选指定基准基金
    ]
  },
  {
    key: 'mean_reversion',
    name: '均值回归(Mean Reversion)',
    category: '均值回归',
    description: '基于价格会向均值回归的统计规律，当价格偏离移动均线超过阈值时反向操作：跌破均线过多时买入、涨破过多时卖出。',
    details: [
      '计算maDays日移动均线作为均值基准',
      '计算价格相对均线的偏离度(%)',
      '偏离度低于-阈值(跌破均线过多)时全仓买入',
      '偏离度高于+阈值(涨破均线过多)时全仓卖出',
      '在震荡市反复套利，趋势市可能连续亏损，期末清仓'
    ],
    suitableMarket: '震荡市；强趋势市中价格长期偏离均线会导致持续亏损',
    riskLevel: '中',
    params: [
      { name: 'maDays', label: '均线天数', default: 20, min: 5, max: 120, desc: '均值基准移动平均窗口' },
      { name: 'threshold', label: '偏离阈值(%)', default: 5, min: 1, max: 30, desc: '触发反向操作的偏离幅度' }
    ]
  },
  {
    key: 'trend_following',
    name: '趋势跟踪(Trend Following)',
    category: '趋势',
    description: '结合均线多头排列与ATR波动突破双重确认趋势，仅在多头排列且价格突破ATR上轨时入场，多头排列破坏时离场。',
    details: [
      '计算短期、长期均线判断多头排列(短>长)',
      '计算ATR(真实波幅均值)衡量波动',
      '多头排列且当日价格突破前收+ATR时确认趋势买入',
      '多头排列破坏(短均线下穿长均线)时卖出',
      '用ATR过滤假突破，趋势市获利丰厚，期末清仓'
    ],
    suitableMarket: '强趋势市(大牛市)；本策略仅做多，大熊市中会空仓规避',
    riskLevel: '高',
    params: [
      { name: 'shortDays', label: '短期均线天数', default: 5, min: 2, max: 30, desc: '短期移动平均窗口' },
      { name: 'longDays', label: '长期均线天数', default: 20, min: 5, max: 120, desc: '长期移动平均窗口' },
      { name: 'atrDays', label: 'ATR天数', default: 14, min: 5, max: 60, desc: 'ATR波动率计算窗口' }
    ]
  },
  {
    key: 'kelly',
    name: 'Kelly公式仓位(Kelly)',
    category: '仓位管理',
    description: '基于历史日收益率的胜率与盈亏比，用Kelly公式计算最优仓位比例，并按kellyFraction折扣后动态调仓，长期最大化资金增长。',
    details: [
      '每隔lookbackDays统计窗口内日收益率的胜率p与盈亏比b',
      'Kelly比例 f* = p - (1-p)/b，再乘以kellyFraction(半Kelly降风险)',
      '将 f* 限制在[0,1]作为目标股票仓位',
      '每个调仓周期将股票仓位调整至目标比例(买入或卖出差额)',
      '胜率/盈亏比变化时动态再平衡，期末清仓'
    ],
    suitableMarket: '长期具有正期望(正胜率或正盈亏比)的市场；负期望品种Kelly会给出空仓',
    riskLevel: '高',
    params: [
      { name: 'lookbackDays', label: '回看天数', default: 60, min: 20, max: 250, desc: '统计胜率盈亏比的窗口' },
      { name: 'kellyFraction', label: 'Kelly折扣', default: 0.5, min: 0.1, max: 1, desc: '实际仓位=Kelly比例×折扣(0.5为半Kelly)' }
    ]
  },
  {
    key: 'rsi',
    name: 'RSI超买超卖(RSI)',
    category: '技术指标',
    description: '基于相对强弱指标RSI判断超买超卖，RSI低于超卖线时买入、高于超买线时卖出，捕捉短期的过度反应回归。',
    details: [
      '计算rsiDays日RSI(Wilder平滑法)',
      'RSI<超卖线(默认30)时认为超卖，全仓买入',
      'RSI>超买线(默认70)时认为超买，全仓卖出',
      '在震荡市捕捉高低点反转，趋势市易钝化失效',
      '期末若持仓则清仓'
    ],
    suitableMarket: '震荡市；强趋势中RSI会长期超买/超卖钝化导致踏空或套牢',
    riskLevel: '中',
    params: [
      { name: 'rsiDays', label: 'RSI天数', default: 14, min: 2, max: 60, desc: 'RSI计算窗口' },
      { name: 'oversold', label: '超卖线', default: 30, min: 5, max: 45, desc: 'RSI低于该值买入' },
      { name: 'overbought', label: '超买线', default: 70, min: 55, max: 95, desc: 'RSI高于该值卖出' }
    ]
  }
]

// 回测参数
export interface BacktestParams {
  fundCode: string
  strategy:
    | 'dca'
    | 'ma_cross'
    | 'momentum'
    | 'stop_profit_loss'
    | 'grid_trading'
    | 'dual_momentum'
    | 'mean_reversion'
    | 'trend_following'
    | 'kelly'
    | 'rsi'
  startDate: string // YYYY-MM-DD
  endDate: string
  initialCapital: number // 初始资金
  // 策略特定参数
  dca?: { amount: number; freqDays: number } // 定投金额、频率(天)
  maCross?: { shortDays: number; longDays: number } // 短期/长期均线天数
  momentum?: { lookbackDays: number; holdingDays: number } // 回看天数、持有天数
  stopProfitLoss?: { stopProfit: number; stopLoss: number; buyAmount: number } // 止盈%/止损%/单次买入
  // 新增策略参数
  gridTrading?: { gridCount: number; lowerPrice: number; upperPrice: number } // 网格数/下限/上限(0=自动)
  dualMomentum?: { lookbackDays: number; benchmarkCode?: string } // 回看天数/基准基金代码(可选)
  meanReversion?: { maDays: number; threshold: number } // 均线天数/偏离阈值%
  trendFollowing?: { shortDays: number; longDays: number; atrDays: number } // 短期/长期均线/ATR天数
  kelly?: { lookbackDays: number; kellyFraction: number } // 统计窗口/Kelly折扣
  rsi?: { rsiDays: number; oversold: number; overbought: number } // RSI天数/超卖线/超买线
}

// 单笔交易记录
export interface Trade {
  date: string
  type: 'buy' | 'sell'
  nav: number
  shares: number
  amount: number
  reason: string
}

// 回测结果
export interface BacktestResult {
  ok: boolean
  // 净值曲线
  equityCurve: { date: string; timestamp: number; value: number; benchmark: number }[]
  trades: Trade[]
  // 统计指标
  metrics: {
    totalReturn: number // 总收益率 %
    annualReturn: number // 年化收益率 %
    maxDrawdown: number // 最大回撤 %
    sharpe: number // 夏普比率
    winRate: number // 胜率 %
    tradeCount: number
    finalValue: number
    benchmarkReturn: number // 基准(买入持有)收益率 %
  }
  error?: string
}

export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  try {
    const detail = await getFundDetail(params.fundCode)
    if (!detail.netWorth || detail.netWorth.length === 0) {
      return { ok: false, equityCurve: [], trades: [], metrics: emptyMetrics(), error: '无净值数据' }
    }
    // 筛选区间
    const startTs = new Date(params.startDate).getTime()
    const endTs = new Date(params.endDate).getTime()
    const netWorth = detail.netWorth
      .filter((p) => p.timestamp >= startTs && p.timestamp <= endTs)
      .sort((a, b) => a.timestamp - b.timestamp)

    if (netWorth.length < 10) {
      return { ok: false, equityCurve: [], trades: [], metrics: emptyMetrics(), error: '净值数据不足（至少需10个交易日）' }
    }

    let result: BacktestResult
    switch (params.strategy) {
      case 'dca':
        result = runDCA(netWorth, params)
        break
      case 'ma_cross':
        result = runMACross(netWorth, params)
        break
      case 'momentum':
        result = runMomentum(netWorth, params)
        break
      case 'stop_profit_loss':
        result = runStopProfitLoss(netWorth, params)
        break
      case 'grid_trading':
        result = runGridTrading(netWorth, params)
        break
      case 'dual_momentum': {
        // 双动量需要基准基金净值做相对动量对比；未提供或获取失败则退化为绝对动量
        const benchCode = params.dualMomentum?.benchmarkCode
        let benchNavs: number[] | null = null
        if (benchCode && benchCode !== params.fundCode) {
          try {
            const benchDetail = await getFundDetail(benchCode)
            const bnw = benchDetail.netWorth
              .filter((bw) => bw.timestamp >= startTs && bw.timestamp <= endTs)
              .sort((a, b) => a.timestamp - b.timestamp)
            benchNavs = alignBenchmark(netWorth, bnw)
          } catch {
            benchNavs = null // 基准获取失败则退化为绝对动量
          }
        }
        result = runDualMomentum(netWorth, params, benchNavs)
        break
      }
      case 'mean_reversion':
        result = runMeanReversion(netWorth, params)
        break
      case 'trend_following':
        result = runTrendFollowing(netWorth, params)
        break
      case 'kelly':
        result = runKelly(netWorth, params)
        break
      case 'rsi':
        result = runRSI(netWorth, params)
        break
      default:
        return { ok: false, equityCurve: [], trades: [], metrics: emptyMetrics(), error: '未知策略' }
    }
    return result
  } catch (err) {
    return { ok: false, equityCurve: [], trades: [], metrics: emptyMetrics(), error: (err as Error).message }
  }
}

function emptyMetrics() {
  return {
    totalReturn: 0,
    annualReturn: 0,
    maxDrawdown: 0,
    sharpe: 0,
    winRate: 0,
    tradeCount: 0,
    finalValue: 0,
    benchmarkReturn: 0,
  }
}

// 计算移动平均
function movingAverage(data: NetWorthPoint[], days: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < days - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = i - days + 1; j <= i; j++) sum += data[j].nav
      result.push(sum / days)
    }
  }
  return result
}

// 通用指标计算
function computeMetrics(
  equityCurve: { date: string; value: number; benchmark: number }[],
  trades: Trade[],
  initialCapital: number
) {
  if (equityCurve.length === 0) return emptyMetrics()
  const finalValue = equityCurve[equityCurve.length - 1].value
  const totalReturn = ((finalValue - initialCapital) / initialCapital) * 100
  const days = equityCurve.length
  const annualReturn = (Math.pow(finalValue / initialCapital, 252 / days) - 1) * 100

  // 最大回撤
  let peak = equityCurve[0].value
  let maxDD = 0
  for (const p of equityCurve) {
    if (p.value > peak) peak = p.value
    const dd = (p.value - peak) / peak
    if (dd < maxDD) maxDD = dd
  }
  const maxDrawdown = maxDD * 100

  // 夏普比率（日收益率）
  const returns: number[] = []
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i].value - equityCurve[i - 1].value) / equityCurve[i - 1].value)
  }
  const meanRet = returns.reduce((s, r) => s + r, 0) / Math.max(1, returns.length)
  const variance = returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / Math.max(1, returns.length - 1)
  const dailyVol = Math.sqrt(variance)
  const annualVol = dailyVol * Math.sqrt(252)
  const sharpe = annualVol > 0 ? (annualReturn / 100 - 0.02) / annualVol : 0

  // 胜率（卖出时是否盈利）
  const sellTrades = trades.filter((t) => t.type === 'sell')
  const winTrades = sellTrades.filter((t) => t.amount > 0).length
  const winRate = sellTrades.length > 0 ? (winTrades / sellTrades.length) * 100 : 0

  const benchmarkReturn = ((equityCurve[equityCurve.length - 1].benchmark - initialCapital) / initialCapital) * 100

  return {
    totalReturn,
    annualReturn,
    maxDrawdown,
    sharpe,
    winRate,
    tradeCount: trades.length,
    finalValue,
    benchmarkReturn,
  }
}

// 基准：期初全仓买入持有
function benchmarkCurve(netWorth: NetWorthPoint[], initialCapital: number) {
  if (netWorth.length === 0) return []
  const firstNav = netWorth[0].nav
  const shares = initialCapital / firstNav
  return netWorth.map((p) => ({ date: p.date, timestamp: p.timestamp, value: shares * p.nav, benchmark: shares * p.nav }))
}

// ===== 策略1：定投（DCA）=====
function runDCA(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const amount = params.dca?.amount ?? 1000
  const freqDays = params.dca?.freqDays ?? 30
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: { date: string; timestamp: number; value: number; benchmark: number }[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)

  let lastBuyIdx = -freqDays // 确保第一次就会买入
  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    // 定投买入
    if (i - lastBuyIdx >= freqDays && cash >= amount) {
      const buyShares = amount / p.nav
      shares += buyShares
      cash -= amount
      trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount, reason: '定期定投' })
      lastBuyIdx = i
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  // 期末清仓
  const last = netWorth[netWorth.length - 1]
  if (shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略2：均线交叉（MA Cross）=====
// 短期均线上穿长期均线买入，下穿卖出
function runMACross(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const shortDays = params.maCross?.shortDays ?? 5
  const longDays = params.maCross?.longDays ?? 20
  const maShort = movingAverage(netWorth, shortDays)
  const maLong = movingAverage(netWorth, longDays)
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: { date: string; timestamp: number; value: number; benchmark: number }[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let position = false // 是否持仓

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    const ms = maShort[i]
    const ml = maLong[i]
    if (ms !== null && ml !== null) {
      // 金叉：短均线上穿长均线
      if (ms > ml && !position) {
        const buyShares = cash / p.nav
        shares = buyShares
        cash = 0
        position = true
        trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyShares * p.nav, reason: `MA${shortDays}上穿MA${longDays}金叉` })
      }
      // 死叉：短均线下穿长均线
      else if (ms < ml && position) {
        cash = shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: cash, reason: `MA${shortDays}下穿MA${longDays}死叉` })
        shares = 0
        position = false
      }
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  // 期末清仓
  const last = netWorth[netWorth.length - 1]
  if (position && shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略3：动量轮动（Momentum）=====
// 回看期涨幅为正则持有，为负则空仓
function runMomentum(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const lookback = params.momentum?.lookbackDays ?? 20
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: { date: string; timestamp: number; value: number; benchmark: number }[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let position = false

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    if (i >= lookback) {
      const pastNav = netWorth[i - lookback].nav
      const momentum = (p.nav - pastNav) / pastNav
      // 动量为正且未持仓 -> 买入
      if (momentum > 0 && !position) {
        const buyShares = cash / p.nav
        shares = buyShares
        cash = 0
        position = true
        trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyShares * p.nav, reason: `近${lookback}日动量转正(${(momentum * 100).toFixed(1)}%)` })
      }
      // 动量为负且持仓 -> 卖出
      else if (momentum <= 0 && position) {
        cash = shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: cash, reason: `近${lookback}日动量转负(${(momentum * 100).toFixed(1)}%)` })
        shares = 0
        position = false
      }
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  const last = netWorth[netWorth.length - 1]
  if (position && shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略4：止损止盈（Stop Profit/Loss）=====
// 满仓持有，达到止盈或止损线则卖出，回落后再买入
function runStopProfitLoss(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const stopProfit = (params.stopProfitLoss?.stopProfit ?? 20) / 100
  const stopLoss = (params.stopProfitLoss?.stopLoss ?? 10) / 100
  const buyAmount = params.stopProfitLoss?.buyAmount ?? params.initialCapital
  let cash = params.initialCapital
  let shares = 0
  let entryNav = 0 // 买入时的净值
  const trades: Trade[] = []
  const equityCurve: { date: string; timestamp: number; value: number; benchmark: number }[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let position = false

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    // 未持仓则买入
    if (!position && cash >= buyAmount) {
      const buyShares = buyAmount / p.nav
      shares = buyShares
      cash -= buyAmount
      entryNav = p.nav
      position = true
      trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyAmount, reason: '建仓' })
    }
    // 持仓则检查止盈止损
    else if (position) {
      const gain = (p.nav - entryNav) / entryNav
      if (gain >= stopProfit) {
        cash += shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: shares * p.nav, reason: `止盈(${(gain * 100).toFixed(1)}%)` })
        shares = 0
        position = false
      } else if (gain <= -stopLoss) {
        cash += shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: shares * p.nav, reason: `止损(${(gain * 100).toFixed(1)}%)` })
        shares = 0
        position = false
      }
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  const last = netWorth[netWorth.length - 1]
  if (position && shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 辅助：RSI（Wilder 平滑）=====
function computeRSI(netWorth: NetWorthPoint[], days: number): (number | null)[] {
  const result: (number | null)[] = new Array(netWorth.length).fill(null)
  if (netWorth.length <= days) return result
  // 第一个有效 RSI 位于 days 索引处
  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= days; i++) {
    const diff = netWorth[i].nav - netWorth[i - 1].nav
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }
  let avgGain = gainSum / days
  let avgLoss = lossSum / days
  result[days] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  // Wilder 平滑递推
  for (let i = days + 1; i < netWorth.length; i++) {
    const diff = netWorth[i].nav - netWorth[i - 1].nav
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0
    avgGain = (avgGain * (days - 1) + gain) / days
    avgLoss = (avgLoss * (days - 1) + loss) / days
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return result
}

// ===== 辅助：ATR（真实波幅均值，近似用日净值代替最高/最低）=====
function computeATR(netWorth: NetWorthPoint[], days: number): (number | null)[] {
  // 基金只有单一净值，真实波幅 TR 近似为 |当日净值-昨日净值|
  const result: (number | null)[] = new Array(netWorth.length).fill(null)
  if (netWorth.length <= days) return result
  const trs: number[] = [0]
  for (let i = 1; i < netWorth.length; i++) {
    trs.push(Math.abs(netWorth[i].nav - netWorth[i - 1].nav))
  }
  // 初始 ATR = 前 days 个 TR 的平均
  let sum = 0
  for (let i = 1; i <= days; i++) sum += trs[i]
  let atr = sum / days
  result[days] = atr
  // Wilder 平滑
  for (let i = days + 1; i < netWorth.length; i++) {
    atr = (atr * (days - 1) + trs[i]) / days
    result[i] = atr
  }
  return result
}

// ===== 辅助：将基准基金净值按日期对齐到主基金序列 =====
// 返回与 netWorth 等长的数组，缺失日期用前值填充；首日缺失用第一个可得值回填
function alignBenchmark(netWorth: NetWorthPoint[], benchNetWorth: NetWorthPoint[]): number[] {
  if (benchNetWorth.length === 0) return []
  const map = new Map<number, number>() // timestamp -> nav
  for (const b of benchNetWorth) map.set(b.timestamp, b.nav)
  const aligned: number[] = []
  let last: number | null = null
  // 先做一次正向回填
  for (const p of netWorth) {
    const v = map.get(p.timestamp)
    if (v !== undefined) last = v
    aligned.push(last === null ? NaN : last)
  }
  // 若开头存在 NaN，用后续第一个非 NaN 反向回填
  let firstValid = aligned.findIndex((v) => !Number.isNaN(v))
  if (firstValid > 0) {
    const fill = aligned[firstValid]
    for (let i = 0; i < firstValid; i++) aligned[i] = fill
  }
  // firstValid === -1 表示完全无重叠，策略侧会当作无基准处理
  return aligned
}

// 计算当前净值落在第几档（0 ~ gridCount）
function levelOf(nav: number, lower: number, step: number): number {
  if (step <= 0) return 0
  let lv = Math.floor((nav - lower) / step)
  if (lv < 0) lv = 0
  return lv
}

// ===== 策略5：网格交易（Grid Trading）=====
// 在[lower,upper]区间内划分 gridCount 档，跌破档位买入、涨破档位卖出
function runGridTrading(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const gridCount = Math.max(2, params.gridTrading?.gridCount ?? 10)
  // 价格上下限：为 0 时自动按区间极值
  const navs = netWorth.map((p) => p.nav)
  const autoLow = Math.min(...navs)
  const autoHigh = Math.max(...navs)
  const lowerPrice = params.gridTrading?.lowerPrice && params.gridTrading.lowerPrice > 0
    ? params.gridTrading.lowerPrice
    : autoLow
  const upperPrice = params.gridTrading?.upperPrice && params.gridTrading.upperPrice > 0
    ? params.gridTrading.upperPrice
    : autoHigh
  if (upperPrice <= lowerPrice) {
    return { ok: false, equityCurve: [], trades: [], metrics: emptyMetrics(), error: '网格上限必须大于下限' }
  }
  const step = (upperPrice - lowerPrice) / gridCount
  const gridLines: number[] = []
  for (let k = 0; k <= gridCount; k++) gridLines.push(lowerPrice + k * step)

  // 资金均分：股票预算 = 初始资金的一半，留一半现金应对网格买入；每档资金 = 预算/gridCount
  const stockBudget = params.initialCapital / 2
  const perGridCash = stockBudget / gridCount

  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)

  // 记录每档是否已建仓（避免同一档重复买入）
  const gridHeld: boolean[] = new Array(gridCount + 1).fill(false)
  // 上次价格落在的档位索引
  let prevLevel = levelOf(netWorth[0].nav, lowerPrice, step)

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    const curLevel = levelOf(p.nav, lowerPrice, step)
    // 下跌：从高档位跌入低档位，对经过的每个低档位买入（未持仓档）
    if (curLevel < prevLevel) {
      for (let lv = prevLevel - 1; lv >= curLevel; lv--) {
        if (lv < 0 || lv > gridCount) continue
        if (!gridHeld[lv] && cash >= perGridCash) {
          const buyPrice = gridLines[lv]
          if (buyPrice > 0) {
            const buyShares = perGridCash / buyPrice
            shares += buyShares
            cash -= perGridCash
            gridHeld[lv] = true
            trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: perGridCash, reason: `跌破网格档${lv}(${buyPrice.toFixed(4)})` })
          }
        }
      }
    }
    // 上涨：从低档位涨入高档位，对经过的每个已持仓低档卖出
    else if (curLevel > prevLevel) {
      for (let lv = prevLevel; lv < curLevel; lv++) {
        if (lv < 0 || lv > gridCount) continue
        if (gridHeld[lv] && shares > 0) {
          const buyPrice = gridLines[lv]
          const sellPrice = gridLines[lv + 1]
          if (sellPrice > 0 && buyPrice > 0) {
            // 卖出该档对应的份额（按当初每档资金/买入价估算）
            const sellShares = Math.min(shares, perGridCash / buyPrice)
            if (sellShares > 0) {
              cash += sellShares * sellPrice
              shares -= sellShares
              gridHeld[lv] = false
              trades.push({ date: p.date, type: 'sell', nav: p.nav, shares: sellShares, amount: sellShares * sellPrice, reason: `涨破网格档${lv + 1}(${sellPrice.toFixed(4)})` })
            }
          }
        }
      }
    }
    prevLevel = curLevel
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  // 期末清仓
  const last = netWorth[netWorth.length - 1]
  if (shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略6：双动量（Dual Momentum）=====
// 绝对动量>0 且 优于基准 -> 持有；否则空仓
function runDualMomentum(netWorth: NetWorthPoint[], params: BacktestParams, benchNavs: number[] | null): BacktestResult {
  const lookback = params.dualMomentum?.lookbackDays ?? 20
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let position = false
  const useBench = benchNavs !== null && benchNavs.length === netWorth.length

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    if (i >= lookback) {
      const pastNav = netWorth[i - lookback].nav
      const absMom = (p.nav - pastNav) / pastNav // 绝对动量
      let relOk = true // 相对动量是否满足（默认无基准时视为满足，退化为绝对动量）
      if (useBench) {
        const pastBench = benchNavs![i - lookback]
        const curBench = benchNavs![i]
        if (!Number.isNaN(pastBench) && !Number.isNaN(curBench) && pastBench > 0) {
          const benchMom = (curBench - pastBench) / pastBench
          relOk = absMom >= benchMom
        }
      }
      const shouldHold = absMom > 0 && relOk
      if (shouldHold && !position) {
        const buyShares = cash / p.nav
        shares = buyShares
        cash = 0
        position = true
        trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyShares * p.nav, reason: `双动量满足(绝对${(absMom * 100).toFixed(1)}%)` })
      } else if (!shouldHold && position) {
        cash = shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: cash, reason: `双动量失效(绝对${(absMom * 100).toFixed(1)}%)` })
        shares = 0
        position = false
      }
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  const last = netWorth[netWorth.length - 1]
  if (position && shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略7：均值回归（Mean Reversion）=====
// 价格偏离均线超过阈值时反向操作
function runMeanReversion(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const maDays = params.meanReversion?.maDays ?? 20
  const threshold = (params.meanReversion?.threshold ?? 5) / 100
  const ma = movingAverage(netWorth, maDays)
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let position = false

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    const m = ma[i]
    if (m !== null && m > 0) {
      const dev = (p.nav - m) / m // 偏离度
      // 跌破均线超过阈值 -> 买入（超卖回归）
      if (dev <= -threshold && !position) {
        const buyShares = cash / p.nav
        shares = buyShares
        cash = 0
        position = true
        trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyShares * p.nav, reason: `跌破均线${(dev * 100).toFixed(1)}%超卖` })
      }
      // 涨破均线超过阈值 -> 卖出（超买回归）
      else if (dev >= threshold && position) {
        cash = shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: cash, reason: `涨破均线${(dev * 100).toFixed(1)}%超买` })
        shares = 0
        position = false
      }
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  const last = netWorth[netWorth.length - 1]
  if (position && shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略8：趋势跟踪（Trend Following）=====
// 多头排列(短>长) + ATR突破确认 -> 入场；多头排列破坏 -> 离场
function runTrendFollowing(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const shortDays = params.trendFollowing?.shortDays ?? 5
  const longDays = params.trendFollowing?.longDays ?? 20
  const atrDays = params.trendFollowing?.atrDays ?? 14
  const maShort = movingAverage(netWorth, shortDays)
  const maLong = movingAverage(netWorth, longDays)
  const atrArr = computeATR(netWorth, atrDays)
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let position = false
  let prevBullish: boolean | null = null

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    const ms = maShort[i]
    const ml = maLong[i]
    const atr = atrArr[i]
    if (ms !== null && ml !== null && atr !== null) {
      const bullish = ms > ml
      // 入场：多头排列 + 价格突破前收+ATR
      if (bullish && !position && i > 0) {
        const breakout = p.nav > netWorth[i - 1].nav + atr
        if (breakout) {
          const buyShares = cash / p.nav
          shares = buyShares
          cash = 0
          position = true
          trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyShares * p.nav, reason: `多头排列+ATR突破入场` })
        }
      }
      // 离场：多头排列破坏
      else if (!bullish && position && prevBullish === true) {
        cash = shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: cash, reason: `多头排列破坏离场` })
        shares = 0
        position = false
      }
      prevBullish = bullish
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  const last = netWorth[netWorth.length - 1]
  if (position && shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略9：Kelly公式仓位（Kelly）=====
// 用历史日收益率胜率p与盈亏比b算 Kelly = p - (1-p)/b，乘 kellyFraction 作为目标仓位，定期再平衡
function runKelly(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const lookback = params.kelly?.lookbackDays ?? 60
  const kellyFraction = params.kelly?.kellyFraction ?? 0.5
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let lastRebalance = -1
  let targetRatio = 0 // 目标股票仓位比例

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    // 每隔 lookback 调仓一次（首次在 lookback 处）
    if (i >= lookback && (lastRebalance < 0 || i - lastRebalance >= lookback)) {
      // 统计窗口内日收益率
      const wins: number[] = []
      const losses: number[] = []
      let start = i - lookback
      if (start < 1) start = 1
      for (let j = start + 1; j <= i; j++) {
        const r = (netWorth[j].nav - netWorth[j - 1].nav) / netWorth[j - 1].nav
        if (r > 0) wins.push(r)
        else if (r < 0) losses.push(-r)
      }
      const total = wins.length + losses.length
      if (total > 0) {
        const winP = wins.length / total
        const avgWin = wins.length > 0 ? wins.reduce((s, x) => s + x, 0) / wins.length : 0
        const avgLoss = losses.length > 0 ? losses.reduce((s, x) => s + x, 0) / losses.length : 0
        // 盈亏比 b = 平均盈利 / 平均亏损
        const b = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0)
        // Kelly 比例 f* = p - (1-p)/b
        let f = 0
        if (b === Infinity) {
          f = winP // 只赢不亏，按胜率满仓
        } else if (b > 0) {
          f = winP - (1 - winP) / b
        }
        // 半 Kelly + 限制在 [0,1]
        f = Math.max(0, Math.min(1, f * kellyFraction))
        targetRatio = f
      } else {
        targetRatio = 0
      }
      // 执行再平衡：调整股票仓位至 targetRatio
      const totalValue = cash + shares * p.nav
      const targetStockValue = totalValue * targetRatio
      const currentStockValue = shares * p.nav
      if (targetStockValue > currentStockValue + 1) {
        // 买入差额
        const buyAmount = targetStockValue - currentStockValue
        const buyShares = buyAmount / p.nav
        shares += buyShares
        cash -= buyAmount
        trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyAmount, reason: `Kelly再平衡至${(targetRatio * 100).toFixed(0)}%仓位` })
      } else if (targetStockValue < currentStockValue - 1) {
        // 卖出差额
        const sellAmount = currentStockValue - targetStockValue
        const sellShares = sellAmount / p.nav
        shares -= sellShares
        cash += sellAmount
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares: sellShares, amount: sellAmount, reason: `Kelly再平衡至${(targetRatio * 100).toFixed(0)}%仓位` })
      }
      lastRebalance = i
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  const last = netWorth[netWorth.length - 1]
  if (shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}

// ===== 策略10：RSI超买超卖（RSI）=====
// RSI<超卖线买入，RSI>超买线卖出
function runRSI(netWorth: NetWorthPoint[], params: BacktestParams): BacktestResult {
  const rsiDays = params.rsi?.rsiDays ?? 14
  const oversold = params.rsi?.oversold ?? 30
  const overbought = params.rsi?.overbought ?? 70
  const rsiArr = computeRSI(netWorth, rsiDays)
  let cash = params.initialCapital
  let shares = 0
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  const bench = benchmarkCurve(netWorth, params.initialCapital)
  let position = false

  for (let i = 0; i < netWorth.length; i++) {
    const p = netWorth[i]
    const rsi = rsiArr[i]
    if (rsi !== null) {
      if (rsi < oversold && !position) {
        const buyShares = cash / p.nav
        shares = buyShares
        cash = 0
        position = true
        trades.push({ date: p.date, type: 'buy', nav: p.nav, shares: buyShares, amount: buyShares * p.nav, reason: `RSI=${rsi.toFixed(1)}超卖买入` })
      } else if (rsi > overbought && position) {
        cash = shares * p.nav
        trades.push({ date: p.date, type: 'sell', nav: p.nav, shares, amount: cash, reason: `RSI=${rsi.toFixed(1)}超买卖出` })
        shares = 0
        position = false
      }
    }
    const value = cash + shares * p.nav
    equityCurve.push({ date: p.date, timestamp: p.timestamp, value, benchmark: bench[i]?.value ?? value })
  }
  const last = netWorth[netWorth.length - 1]
  if (position && shares > 0) {
    trades.push({ date: last.date, type: 'sell', nav: last.nav, shares, amount: shares * last.nav, reason: '期末清仓' })
  }
  return { ok: true, equityCurve, trades, metrics: computeMetrics(equityCurve, trades, params.initialCapital) }
}
