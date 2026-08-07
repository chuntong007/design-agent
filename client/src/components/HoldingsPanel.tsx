import { useEffect, useState, useMemo } from 'react'
import type { LoadedFund } from '../App'
import { api } from '../api'
import type { FundHoldings, StockQuote, StockKlinePoint } from '../types'
import { makeStyles, fmtPct, fmtMoney, fmtNum, fmtColor, seriesColor } from '../theme'
import { useTheme } from '../ThemeContext'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts'
import { filterByRange, type RangeKey } from '../metrics'

interface Props {
  fund: LoadedFund | undefined
  range: string
  normalized: boolean
}

export function HoldingsPanel({ fund, range, normalized }: Props) {
  const { palette: p } = useTheme()
  const styles = makeStyles(p)
  const [holdings, setHoldings] = useState<FundHoldings | null>(null)
  const [quotes, setQuotes] = useState<StockQuote[]>([])
  const [klines, setKlines] = useState<Record<string, StockKlinePoint[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'distribution' | 'quotes' | 'compare'>('distribution')

  useEffect(() => {
    if (!fund?.code) return
    setLoading(true)
    setError('')
    setHoldings(null)
    setQuotes([])
    setKlines({})
    api
      .getFundHoldings(fund.code)
      .then(async (h) => {
        setHoldings(h)
        if (h.stocks.length === 0) return
        const marketCodes = h.stocks.map((s) => s.marketCode + s.stockCode)
        // 拉行情
        const q = await api.getStockQuotes(marketCodes)
        setQuotes(q)
        // 拉 K 线（按 range 决定天数）
        const days = rangeDays(range)
        const k = await api.getStockKlines(marketCodes, days)
        setKlines(k)
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [fund?.code, range])

  const pieData = useMemo(() => {
    if (!holdings) return []
    return holdings.stocks.map((s) => ({ name: s.stockName, value: s.ratio, code: s.stockCode }))
  }, [holdings])

  const compareChartData = useMemo(() => {
    // 归一化各重仓股，对齐到统一日期轴
    const validStocks = holdings?.stocks.filter((s) => {
      const mc = s.marketCode + s.stockCode
      return klines[mc] && klines[mc].length > 0
    }) || []
    if (validStocks.length === 0) return { data: [], codes: [] }
    // 收集所有日期
    const dateSet = new Set<string>()
    const maps = new Map<string, Map<string, number>>()
    validStocks.forEach((s) => {
      const mc = s.marketCode + s.stockCode
      const m = new Map<string, number>()
      for (const p of klines[mc]) {
        m.set(p.date, p.close)
        dateSet.add(p.date)
      }
      maps.set(mc, m)
    })
    const dates = Array.from(dateSet).sort()
    const data = dates.map((d) => {
      const row: Record<string, number | string | null> = { date: d }
      validStocks.forEach((s) => {
        const mc = s.marketCode + s.stockCode
        const m = maps.get(mc)!
        row[mc] = m.get(d) ?? null
      })
      return row
    })
    if (normalized) {
      // 归一化：每只股票首日 = 100
      validStocks.forEach((s) => {
        const mc = s.marketCode + s.stockCode
        let first: number | null = null
        for (const row of data) {
          const v = row[mc]
          if (v !== null && typeof v === 'number') {
            if (first === null) first = v
            row[mc] = (v / first) * 100
          }
        }
      })
    }
    return { data, codes: validStocks.map((s) => ({ mc: s.marketCode + s.stockCode, name: s.stockName })) }
  }, [holdings, klines, normalized])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${p.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ ...styles.label }}>重仓股参照</span>
          {fund && <span style={{ fontSize: '11px', color: p.text2 }}>{fund.code}</span>}
        </div>
        <div style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {fund?.detail?.name || fund?.name || '--'}
        </div>
        {holdings?.reportDate && (
          <div style={{ fontSize: '11px', color: p.text2, marginTop: '2px' }}>
            报告期：{holdings.reportDate}
          </div>
        )}
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: '2px', padding: '6px 8px', borderBottom: `1px solid ${p.border}` }}>
        {([
          ['distribution', '持仓分布'],
          ['quotes', '个股行情'],
          ['compare', '走势对比'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              background: tab === k ? p.bg3 : 'transparent',
              color: tab === k ? p.text0 : p.text1,
              border: 'none',
              borderRadius: '4px',
              padding: '5px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {loading && <CenterMsg message="加载重仓股数据..." />}
        {error && <CenterMsg message={`加载失败：${error}`} isError />}
        {!loading && !error && holdings && holdings.stocks.length === 0 && (
          <CenterMsg message="暂无重仓股数据" />
        )}
        {!loading && !error && holdings && holdings.stocks.length > 0 && tab === 'distribution' && (
          <DistributionView pieData={pieData} stocks={holdings.stocks} />
        )}
        {!loading && !error && holdings && holdings.stocks.length > 0 && tab === 'quotes' && (
          <QuotesView stocks={holdings.stocks} quotes={quotes} />
        )}
        {!loading && !error && holdings && holdings.stocks.length > 0 && tab === 'compare' && (
          <CompareView chartData={compareChartData} />
        )}
      </div>
    </div>
  )
}

function DistributionView({ pieData, stocks }: { pieData: { name: string; value: number; code: string }[]; stocks: FundHoldings['stocks'] }) {
  const { palette: p } = useTheme()
  return (
    <div style={{ padding: '12px' }}>
      <div style={{ height: '180px', marginBottom: '12px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={70}
              innerRadius={35}
              paddingAngle={2}
            >
              {pieData.map((_, i) => (
                <Cell key={i} fill={seriesColor(p, i)} stroke={p.bg1} strokeWidth={2} />
              ))}
            </Pie>
            <RTooltip
              contentStyle={{
                background: p.bg2,
                border: `1px solid ${p.borderLight}`,
                borderRadius: '6px',
                fontSize: '12px',
              }}
              formatter={(v: number) => [`${v.toFixed(2)}%`, '占比']}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {stocks.map((s, i) => (
          <div key={s.stockCode} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: seriesColor(p, i) }} />
            <span style={{ fontSize: '12px', flex: 1 }}>{s.stockName}</span>
            <span style={{ fontSize: '12px', color: p.text2, fontFamily: '"JetBrains Mono", monospace' }}>{s.stockCode}</span>
            <span style={{ fontSize: '12px', fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, color: p.text0, minWidth: '48px', textAlign: 'right' }}>
              {s.ratio.toFixed(2)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuotesView({ stocks, quotes }: { stocks: FundHoldings['stocks']; quotes: StockQuote[] }) {
  const { palette: p } = useTheme()
  const quoteMap = new Map(quotes.map((q) => [q.code, q]))
  return (
    <div style={{ padding: '8px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ color: p.text2, fontSize: '11px' }}>
            <th style={thStyle}>名称</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>现价</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>涨跌</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>市值</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>PE</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => {
            const mc = s.marketCode + s.stockCode
            const q = quoteMap.get(mc)
            return (
              <tr key={s.stockCode} style={{ borderBottom: `1px solid ${p.border}` }}>
                <td style={tdStyle}>
                  <div style={{ fontWeight: 500 }}>{s.stockName}</div>
                  <div style={{ fontSize: '10px', color: p.text2 }}>{s.stockCode}</div>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: '"JetBrains Mono", monospace' }}>
                  {q ? fmtNum(q.price, 2) : '--'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: '"JetBrains Mono", monospace', color: q ? fmtColor(p, q.changePercent) : p.text2 }}>
                  {q ? fmtPct(q.changePercent) : '--'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: '"JetBrains Mono", monospace', color: p.text1 }}>
                  {q ? fmtMoney(q.marketCap) : '--'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: '"JetBrains Mono", monospace', color: p.text1 }}>
                  {q && q.pe > 0 ? q.pe.toFixed(1) : '--'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CompareView({ chartData }: { chartData: { data: any[]; codes: { mc: string; name: string }[] } }) {
  const { palette: p } = useTheme()
  if (chartData.data.length === 0) {
    return <CenterMsg message="暂无 K 线数据" />
  }
  return (
    <div style={{ padding: '8px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={p.border} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" stroke={p.text2} tick={{ fontSize: 10 }} minTickGap={40} tickFormatter={(v) => (v as string).slice(5)} />
            <YAxis stroke={p.text2} tick={{ fontSize: 10 }} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(0)} />
            <RTooltip
              contentStyle={{ background: p.bg2, border: `1px solid ${p.borderLight}`, borderRadius: '6px', fontSize: '11px' }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {chartData.codes.map((c, i) => (
              <Line
                key={c.mc}
                type="monotone"
                dataKey={c.mc}
                name={c.name}
                stroke={seriesColor(p, i)}
                strokeWidth={1.8}
                dot={false}
                isAnimationActive
                animationDuration={600}
                animationEasing="ease-out"
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function CenterMsg({ message, isError }: { message: string; isError?: boolean }) {
  const { palette: p } = useTheme()
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: isError ? p.impactNegative : p.text2, fontSize: '12px', padding: '20px' }}>
      {message}
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '6px 4px', textAlign: 'left', fontWeight: 500 }
const tdStyle: React.CSSProperties = { padding: '6px 4px', verticalAlign: 'middle' }

function rangeDays(range: string): number {
  const m: Record<string, number> = { '1m': 30, '3m': 90, '6m': 180, '1y': 365, '3y': 365 * 3, '5y': 365 * 5, ytd: 365, all: 365 * 5 }
  return m[range] || 365
}
