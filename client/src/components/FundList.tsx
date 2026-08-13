import { useMemo, useState } from 'react'
import { Popover, MultiSelect, Button, Group } from '@mantine/core'
import { Pencil } from 'lucide-react'
import type { LoadedFund } from '../App'
import { makeStyles, fmtPct } from '../theme'
import { useTheme } from '../ThemeContext'
import { filterByRange, computeMetrics, type RangeKey } from '../metrics'

interface Props {
  funds: LoadedFund[]
  selectedCode: string
  onSelect: (code: string) => void
  onRemove: (code: string) => void
  // 【多基金检索】检索组合预设范围；未传时内部兜底为全部已加载基金
  newsTargetCodes?: string[]
  onSetNewsTargets?: (codes: string[]) => void
}

export function FundList({
  funds,
  selectedCode,
  onSelect,
  onRemove,
  newsTargetCodes,
  onSetNewsTargets,
}: Props) {
  const { palette: p, mode } = useTheme()
  const styles = makeStyles(p)
  const [editOpen, setEditOpen] = useState(false)

  // 全部基金 code 列表(用于"全选/反选")
  const allFundCodes = useMemo(() => funds.map((f) => f.code), [funds])

  // 兜底逻辑:未传 / 空选 → 视为"全部"
  const effectiveCodes = useMemo(() => {
    if (newsTargetCodes && newsTargetCodes.length > 0) return newsTargetCodes
    return allFundCodes
  }, [newsTargetCodes, allFundCodes])

  // 是否启用编辑入口(>1 支基金才有意义)
  const showEditButton = funds.length > 1

  // 已选基金详情(用于渲染 chip)
  const selectedFunds = useMemo(
    () => effectiveCodes.map((c) => funds.find((f) => f.code === c)).filter(Boolean) as LoadedFund[],
    [effectiveCodes, funds]
  )

  // Popover MultiSelect 的 data
  const multiselectData = useMemo(
    () => funds.map((f) => ({ value: f.code, label: `${f.name} (${f.code})` })),
    [funds]
  )

  // 真正写入父级:空选 → 自动填入全部(避免真空态)
  const commit = (codes: string[]) => {
    if (!onSetNewsTargets) return
    const next = codes.length === 0 ? allFundCodes : codes
    // 顺序:用 allFundCodes 顺序,确保稳定
    const ordered = allFundCodes.filter((c) => next.includes(c))
    onSetNewsTargets(ordered)
  }

  const handleSelectAll = () => commit(allFundCodes)
  const handleClear = () => commit(allFundCodes) // 清空 = 兜底全选
  const handleInvert = () => {
    const inverted = allFundCodes.filter((c) => !effectiveCodes.includes(c))
    commit(inverted)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部:已添加基金 */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${p.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ ...styles.label }}>📊 已添加基金</span>
        <span style={{ fontSize: '11px', color: p.text2 }}>{funds.length}</span>
      </div>
      {/* 检索组合子区:仅在有基金时显示 */}
      {funds.length > 0 && (
        <div
          style={{
            padding: '10px 12px',
            borderBottom: `1px solid ${p.border}`,
            background: mode === 'dark' ? p.bg0 : p.bg2,
          }}
        >
          {/* 子区标题 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ ...styles.label }}>🔍 检索组合</span>
              <span
                style={{
                  fontSize: '10px',
                  color: p.text2,
                  fontFamily: '"JetBrains Mono", monospace',
                  padding: '1px 5px',
                  background: p.bg3,
                  borderRadius: '3px',
                }}
              >
                {effectiveCodes.length}/{funds.length}
              </span>
            </div>
            {showEditButton && (
              <Popover
                opened={editOpen}
                onChange={setEditOpen}
                position="bottom-end"
                withinPortal
                width={280}
                shadow="md"
              >
                <Popover.Target>
                  <button
                    onClick={() => setEditOpen((o) => !o)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      background: 'transparent',
                      border: `1px solid ${p.border}`,
                      borderRadius: '4px',
                      color: p.text1,
                      fontSize: '11px',
                      fontWeight: 500,
                      padding: '3px 8px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'background-color 0.15s ease, border-color 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = p.bg3
                      e.currentTarget.style.borderColor = p.borderLight
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.borderColor = p.border
                    }}
                    title="编辑检索组合"
                  >
                    <Pencil size={11} />
                    <span>编辑</span>
                  </button>
                </Popover.Target>
                <Popover.Dropdown
                  style={{
                    background: p.bg1,
                    border: `1px solid ${p.border}`,
                    padding: '10px',
                  }}
                >
                  {/* 快捷按钮 */}
                  <Group gap={6} mb={8}>
                    <Button size="compact-xs" variant="light" color="blue" onClick={handleSelectAll}>
                      全选
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={handleClear}>
                      清空
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="gray" onClick={handleInvert}>
                      反选
                    </Button>
                  </Group>
                  {/* MultiSelect */}
                  <MultiSelect
                    data={multiselectData}
                    value={effectiveCodes}
                    onChange={commit}
                    searchable
                    clearable={false}
                    placeholder="勾选基金..."
                    size="xs"
                    maxDropdownHeight={200}
                    styles={{
                      input: { background: p.bg2, borderColor: p.border, color: p.text0 },
                    }}
                  />
                  {/* 底部状态文字 */}
                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '10px',
                      color: p.text2,
                      fontFamily: '"JetBrains Mono", monospace',
                      textAlign: 'right',
                    }}
                  >
                    已选 {effectiveCodes.length} 支 / 共 {funds.length} 支
                  </div>
                </Popover.Dropdown>
              </Popover>
            )}
          </div>
          {/* chip 横排区 */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
              maxHeight: '80px',
              overflowY: 'auto',
            }}
          >
            {selectedFunds.map((f) => (
              <span
                key={f.code}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '3px 4px 3px 7px',
                  borderRadius: '11px',
                  background: p.bg1,
                  border: `1px solid ${p.border}`,
                  fontSize: '12px',
                  color: p.text0,
                  maxWidth: '100%',
                  lineHeight: 1.4,
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: f.color,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '120px',
                  }}
                  title={f.name}
                >
                  {f.name}
                </span>
                <button
                  onClick={() => {
                    if (!onSetNewsTargets) return
                    // 至少保留 1 个:若当前只剩 1 个 chip,清空 = 自动填全部(兜底)
                    const next = effectiveCodes.filter((c) => c !== f.code)
                    commit(next)
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: p.text2,
                    cursor: 'pointer',
                    fontSize: '13px',
                    padding: '0 4px',
                    lineHeight: 1,
                    flexShrink: 0,
                    borderRadius: '50%',
                    transition: 'color 0.15s ease, background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = p.impactNegative
                    e.currentTarget.style.background = `${p.impactNegative}1a`
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = p.text2
                    e.currentTarget.style.background = 'transparent'
                  }}
                  title="从检索组合移除"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {/* 原基金列表区 */}
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
