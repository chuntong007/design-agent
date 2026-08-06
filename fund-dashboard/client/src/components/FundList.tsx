import type { LoadedFund } from '../App'
import { makeStyles, fmtPct } from '../theme'
import { useTheme } from '../ThemeContext'
import { filterByRange, computeMetrics, type RangeKey } from '../metrics'

interface Props {
  funds: LoadedFund[]
  selectedCode: string
  onSelect: (code: string) => void
  onRemove: (code: string) => void
}

export function FundList({ funds, selectedCode, onSelect, onRemove }: Props) {
  const { palette: p, mode } = useTheme()
  const styles = makeStyles(p)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${p.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ ...styles.label }}>基金组合</span>
        <span style={{ fontSize: '11px', color: p.text2 }}>{funds.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
        {funds.length === 0 && (
          <div style={{ padding: '24px 14px', textAlign: 'center', color: p.text2, fontSize: '12px' }}>
            搜索添加基金以开始分析
          </div>
        )}
        {funds.map((f) => {
          const isSelected = f.code === selectedCode
          // 取近 1 月收益做摘要
          let summary = ''
          if (f.detail) {
            const m = computeMetrics(filterByRange(f.detail.netWorth, '1m' as RangeKey))
            if (m) summary = fmtPct(m.totalReturn)
          }
          return (
            <div
              key={f.code}
              onClick={() => onSelect(f.code)}
              className={mode === 'dark' ? 'glass-card-dark' : 'glass-card'}
              style={{
                padding: '10px 12px',
                borderRadius: '10px',
                marginBottom: '6px',
                cursor: 'pointer',
                background: isSelected ? p.accentSoft : undefined,
                border: `1px solid ${isSelected ? p.accent + '66' : 'transparent'}`,
                borderLeft: isSelected ? `3px solid ${p.accent}` : '3px solid transparent',
                boxShadow: isSelected ? `0 0 16px ${p.accent}22` : 'none',
                position: 'relative',
                transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = mode === 'dark' ? 'rgba(47,53,63,0.6)' : 'rgba(255,255,255,0.7)'
                  e.currentTarget.style.transform = 'translateX(2px)'
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = ''
                  e.currentTarget.style.transform = ''
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: f.color,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: '13px', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p.text0 }}>
                  {f.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(f.code)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: p.text2,
                    cursor: 'pointer',
                    fontSize: '14px',
                    padding: '0 4px',
                    lineHeight: 1,
                  }}
                  title="移除"
                >
                  ×
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: '18px' }}>
                <span style={{ fontSize: '11px', color: p.text2 }}>{f.code}</span>
                {f.loading && <span style={{ fontSize: '11px', color: p.text2 }}>加载中...</span>}
                {f.error && <span style={{ fontSize: '11px', color: p.impactNegative }}>加载失败</span>}
                {summary && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontFamily: '"JetBrains Mono", "SF Mono", Consolas, monospace',
                      fontWeight: 600,
                      color: summary.startsWith('+') ? p.up : summary.startsWith('-') ? p.down : p.text1,
                      background: summary.startsWith('+')
                        ? `${p.up}1a`
                        : summary.startsWith('-')
                        ? `${p.down}1a`
                        : p.bg3,
                      padding: '2px 7px',
                      borderRadius: '10px',
                      border: `1px solid ${
                        summary.startsWith('+') ? `${p.up}33` : summary.startsWith('-') ? `${p.down}33` : p.border
                      }`,
                    }}
                  >
                    {summary}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
