import { useState, useRef, useEffect } from 'react'
import { Box } from '@mantine/core'
import type { LoadedFund, MainTab } from '../App'
import { api } from '../api'
import type { FundSearchResult } from '../types'
import { makeStyles, fmtPct } from '../theme'
import { useTheme } from '../ThemeContext'
import type { RangeKey } from '../metrics'

interface Props {
  funds: LoadedFund[]
  onAdd: (fund: { code: string; name: string }) => void
  range: string
  onRangeChange: (r: string) => void
  normalized: boolean
  onNormalizedChange: (n: boolean) => void
  mainTab: MainTab
  onMainTabChange: (t: MainTab) => void
}

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '1m', label: '1月' },
  { key: '3m', label: '3月' },
  { key: '6m', label: '6月' },
  { key: '1y', label: '1年' },
  { key: '3y', label: '3年' },
  { key: '5y', label: '5年' },
  { key: 'ytd', label: '年初至今' },
  { key: 'all', label: '成立来' },
]

export function Header({ funds, onAdd, range, onRangeChange, normalized, onNormalizedChange, mainTab, onMainTabChange }: Props) {
  const { palette: p, mode, toggle } = useTheme()
  const styles = makeStyles(p)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<FundSearchResult[]>([])
  const [showResults, setShowResults] = useState(false)
  const [searching, setSearching] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭搜索结果
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 防抖搜索
  useEffect(() => {
    if (!keyword.trim()) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      api
        .searchFunds(keyword.trim())
        .then((list) => {
          setResults(list.slice(0, 8))
          setShowResults(true)
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 350)
    return () => clearTimeout(timer)
  }, [keyword])

  return (
    <header
      style={{
        background: p.bg1,
        borderBottom: `1px solid ${p.border}`,
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
        flexWrap: 'nowrap',
        transition: 'background-color 0.3s ease, border-color 0.3s ease',
      }}
    >
      {/* 品牌 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '6px',
            background: `linear-gradient(135deg, ${p.accent}, ${p.accentDim})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: '14px',
          }}
        >
          F
        </div>
        <span style={{ fontWeight: 600, fontSize: '15px', color: p.text0 }}>基金多维分析看板</span>
      </div>

      {/* 主 tab 切换：分析看板 / 策略回测 - 与区间切换一致的原生按钮组，确保激活态文字反相 */}
      <Box style={{ display: 'flex', gap: '1px', background: p.bg2, borderRadius: '6px', padding: '2px', border: `1px solid ${p.border}`, flexShrink: 0 }}>
        {([
          { value: 'analysis', label: '📊 分析看板' },
          { value: 'backtest', label: '⚙️ 策略回测' },
        ] as const).map((t) => (
          <button
            key={t.value}
            onClick={() => onMainTabChange(t.value)}
            style={{
              background: mainTab === t.value ? p.accent : 'transparent',
              color: mainTab === t.value ? '#fff' : p.text1,
              border: 'none',
              borderRadius: '4px',
              padding: '5px 12px',
              fontSize: '12px',
              cursor: 'pointer',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              transition: 'background-color 0.15s ease, color 0.15s ease',
              boxShadow: mainTab === t.value ? `0 2px 8px ${p.accent}55` : 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </Box>

      {/* 搜索 */}
      <div ref={searchRef} style={{ position: 'relative', width: '200px', flexShrink: 0 }}>
        <input
          type="text"
          placeholder="搜索基金代码/名称/拼音..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          style={{ ...styles.input, width: '100%' }}
        />
        {searching && (
          <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: p.text2, fontSize: '12px' }}>
            搜索中...
          </span>
        )}
        {showResults && results.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              background: p.bg1,
              border: `1px solid ${p.borderLight}`,
              borderRadius: '8px',
              maxHeight: '320px',
              overflowY: 'auto',
              zIndex: 100,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            }}
          >
            {results.map((r) => {
              const added = funds.some((f) => f.code === r.code)
              return (
                <div
                  key={r.code}
                  onClick={() => {
                    if (!added) {
                      onAdd({ code: r.code, name: r.name })
                    }
                    setKeyword('')
                    setResults([])
                    setShowResults(false)
                  }}
                  style={{
                    padding: '10px 12px',
                    cursor: added ? 'not-allowed' : 'pointer',
                    borderBottom: `1px solid ${p.border}`,
                    opacity: added ? 0.5 : 1,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = p.bg2)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div style={{ fontSize: '13px', color: p.text0 }}>{r.name}</div>
                    <div style={{ fontSize: '11px', color: p.text2 }}>{r.code} · {r.type}</div>
                  </div>
                  <span style={{ fontSize: '11px', color: added ? p.text2 : p.accent }}>
                    {added ? '已添加' : '添加'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 区间切换 - 紧凑按钮组，8个选项单行排列 */}
      <Box style={{ display: 'flex', gap: '1px', background: p.bg2, borderRadius: '6px', padding: '2px', flexShrink: 0 }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => onRangeChange(r.key)}
            style={{
              background: range === r.key ? p.accent : 'transparent',
              color: range === r.key ? '#fff' : p.text1,
              border: 'none',
              borderRadius: '4px',
              padding: '5px 8px',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              transition: 'background-color 0.15s ease, color 0.15s ease',
              boxShadow: range === r.key ? `0 2px 8px ${p.accent}55` : 'none',
            }}
          >
            {r.label}
          </button>
        ))}
      </Box>

      {/* 视图切换 - 紧凑按钮组 */}
      <Box style={{ display: 'flex', gap: '1px', background: p.bg2, borderRadius: '6px', padding: '2px', flexShrink: 0 }}>
        <button
          onClick={() => onNormalizedChange(true)}
          style={{
            background: normalized ? p.accent : 'transparent',
            color: normalized ? '#fff' : p.text1,
            border: 'none',
            borderRadius: '4px',
            padding: '5px 10px',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            transition: 'background-color 0.15s ease, color 0.15s ease',
            boxShadow: normalized ? `0 2px 8px ${p.accent}55` : 'none',
          }}
        >
          归一化
        </button>
        <button
          onClick={() => onNormalizedChange(false)}
          style={{
            background: !normalized ? p.accent : 'transparent',
            color: !normalized ? '#fff' : p.text1,
            border: 'none',
            borderRadius: '4px',
            padding: '5px 10px',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            transition: 'background-color 0.15s ease, color 0.15s ease',
            boxShadow: !normalized ? `0 2px 8px ${p.accent}55` : 'none',
          }}
        >
          绝对净值
        </button>
      </Box>

      <div style={{ flex: 1 }} />

      <span style={{ color: p.text2, fontSize: '12px' }}>
        共 {funds.length} 只基金
      </span>

      {/* 主题切换 */}
      <button
        onClick={toggle}
        title={mode === 'light' ? '切换到暗色模式' : '切换到亮色模式'}
        style={{
          background: p.bg2,
          border: `1px solid ${p.border}`,
          borderRadius: '6px',
          padding: '6px 10px',
          cursor: 'pointer',
          color: p.text1,
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = p.bg3)}
        onMouseLeave={(e) => (e.currentTarget.style.background = p.bg2)}
      >
        {mode === 'light' ? '🌙' : '☀️'}
      </button>
    </header>
  )
}
