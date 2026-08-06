import { useMemo } from 'react'
import { Paper } from '@mantine/core'
import type { LoadedFund } from '../App'
import { makeStyles, fmtPct } from '../theme'
import { useTheme } from '../ThemeContext'
import { filterByRange, computeMetrics, type RangeKey, type Metrics } from '../metrics'

interface Props {
  funds: LoadedFund[]
  range: string
}

type MetricKey = keyof Metrics

const METRIC_DEFS: { key: MetricKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'totalReturn', label: '区间总收益', fmt: (v) => fmtPct(v) },
  { key: 'ytdReturn', label: '年初至今', fmt: (v) => fmtPct(v) },
  { key: 'maxDrawdown', label: '最大回撤', fmt: (v) => fmtPct(v) },
  { key: 'annualVolatility', label: '年化波动率', fmt: (v) => `${v.toFixed(2)}%` },
  { key: 'sharpe', label: '夏普比率', fmt: (v) => v.toFixed(3) },
]

type Metric = Metrics

export function MetricsPanel({ funds, range }: Props) {
  const { palette: p, mode } = useTheme()
  const styles = makeStyles(p)
  const metricsByFund = useMemo(() => {
    return funds
      .filter((f) => f.detail)
      .map((f) => {
        const m = computeMetrics(filterByRange(f.detail!.netWorth, range as RangeKey))
        return { fund: f, metrics: m }
      })
  }, [funds, range])

  if (metricsByFund.length === 0) {
    return <div style={{ color: p.text2, fontSize: '12px', padding: '4px 0' }}>加载指标中...</div>
  }

  return (
    <div className={mode === 'dark' ? 'glass-card-dark' : 'glass-card'} style={{ borderRadius: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <span style={{ ...styles.label, fontSize: '12px' }}>核心指标横向对比</span>
        <span style={{ fontSize: '11px', color: p.text2 }}>
          区间：{metricsByFund[0]?.metrics?.startDate} ~ {metricsByFund[0]?.metrics?.endDate}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${METRIC_DEFS.length}, 1fr)`, gap: '10px' }}>
        {METRIC_DEFS.map((def) => {
          // 找出该指标的最佳值用于高亮
          const values = metricsByFund
            .map((x) => x.metrics?.[def.key])
            .filter((v): v is number => typeof v === 'number' && isFinite(v))
          let bestIdx = -1
          if (values.length > 0) {
            // 收益、夏普越大越好；回撤、波动率越小越好
            const isLowerBetter = def.key === 'maxDrawdown' || def.key === 'annualVolatility'
            bestIdx = values.reduce((best, v, i) => {
              if (best === -1) return i
              const bv = values[best]
              return isLowerBetter ? (v < bv ? i : best) : (v > bv ? i : best)
            }, -1)
          }
          return (
            <Paper
              key={def.key}
              radius="md"
              p="xs"
              withBorder
              style={{
                background: p.bg2,
                borderColor: p.border,
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <span style={{ fontSize: '11px', color: p.text2, fontWeight: 500 }}>{def.label}</span>
              {metricsByFund.map((x, i) => {
                const val = x.metrics?.[def.key]
                const isBest = i === bestIdx && values.length > 1
                const color =
                  def.key === 'maxDrawdown'
                    ? p.impactNegative
                    : typeof val === 'number' && val > 0
                    ? p.up
                    : typeof val === 'number' && val < 0
                    ? p.down
                    : p.text0
                return (
                  <div
                    key={x.fund.code}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '5px 7px',
                      borderRadius: '6px',
                      background: isBest ? p.accentSoft : 'transparent',
                      border: isBest ? `1px solid ${p.accent}66` : `1px solid transparent`,
                      boxShadow: isBest ? `0 0 12px ${p.accent}33` : 'none',
                      transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                    }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: x.fund.color, flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: '15px',
                        fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
                        fontWeight: 700,
                        color: typeof val === 'number' ? color : p.text2,
                        flex: 1,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {typeof val === 'number' && isFinite(val) ? def.fmt(val) : '--'}
                    </span>
                    {isBest && <span style={{ fontSize: '11px', color: p.accent }}>★</span>}
                  </div>
                )
              })}
            </Paper>
          )
        })}
      </div>
    </div>
  )
}
