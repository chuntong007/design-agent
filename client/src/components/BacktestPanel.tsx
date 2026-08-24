import { useEffect, useMemo, useState } from 'react'
import {
  Accordion,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  NumberInput,
  Paper,
  Progress,
  RingProgress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'
import { Play, Info, TrendingUp, TrendingDown, Activity, Target, RotateCcw } from 'lucide-react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import dayjs from 'dayjs'
import type { LoadedFund } from '../App'
import type {
  BacktestParams,
  BacktestResult,
  BacktestStrategy,
  StrategyInfo,
  StrategyParam,
} from '../types'
import { api } from '../api'
import { fmtNum, fmtPct } from '../theme'
import { useTheme } from '../ThemeContext'
import type { RangeKey } from '../metrics'

type DateMode = 'follow' | 'custom'

interface Props {
  funds: LoadedFund[]
  range: string
  onRangeChange: (r: string) => void
}

// 风险等级 -> 颜色映射（Mantine 颜色名）
const RISK_COLOR: Record<StrategyInfo['riskLevel'], string> = {
  低: 'green',
  中: 'yellow',
  高: 'red',
}

// 分类 -> 颜色映射（Mantine 颜色名）
const CATEGORY_COLOR: Record<string, string> = {
  被动: 'gray',
  趋势: 'blue',
  动量: 'indigo',
  均值回归: 'teal',
  仓位管理: 'grape',
  技术指标: 'cyan',
}

// 按 range 计算默认日期区间（与 Header RANGES 对齐）
function rangeToDates(range: RangeKey, fund: LoadedFund | undefined): [Date, Date] {
  const end = new Date()
  if (range === 'all') {
    const nw = fund?.detail?.netWorth
    if (nw && nw.length > 0) {
      const start = new Date(nw[0].timestamp)
      return [start, end]
    }
    // 兜底：3年
    return [dayjs(end).subtract(3, 'year').toDate(), end]
  }
  if (range === 'ytd') {
    return [new Date(end.getFullYear(), 0, 1), end]
  }
  const days = { '1m': 30, '3m': 90, '6m': 180, '1y': 365, '3y': 365 * 3, '5y': 365 * 5 }[range] ?? 365
  return [dayjs(end).subtract(days, 'day').toDate(), end]
}

// 根据选中策略构建策略特定参数对象
function buildStrategyParams(
  strategy: BacktestStrategy,
  paramValues: Record<string, number>,
  initialCapital: number
): Partial<BacktestParams> {
  const v = paramValues
  switch (strategy) {
    case 'dca':
      return { dca: { amount: v.amount ?? 1000, freqDays: v.freqDays ?? 30 } }
    case 'ma_cross':
      return { maCross: { shortDays: v.shortDays ?? 5, longDays: v.longDays ?? 20 } }
    case 'momentum':
      return { momentum: { lookbackDays: v.lookbackDays ?? 20, holdingDays: v.holdingDays ?? 0 } }
    case 'stop_profit_loss':
      return {
        stopProfitLoss: {
          stopProfit: v.stopProfit ?? 20,
          stopLoss: v.stopLoss ?? 10,
          buyAmount: v.buyAmount ?? initialCapital,
        },
      }
    case 'grid_trading':
      return {
        gridTrading: {
          gridCount: v.gridCount ?? 10,
          lowerPrice: v.lowerPrice ?? 0,
          upperPrice: v.upperPrice ?? 0,
        },
      }
    case 'dual_momentum':
      return { dualMomentum: { lookbackDays: v.lookbackDays ?? 20 } }
    case 'mean_reversion':
      return { meanReversion: { maDays: v.maDays ?? 20, threshold: v.threshold ?? 5 } }
    case 'trend_following':
      return {
        trendFollowing: {
          shortDays: v.shortDays ?? 5,
          longDays: v.longDays ?? 20,
          atrDays: v.atrDays ?? 14,
        },
      }
    case 'kelly':
      return {
        kelly: {
          lookbackDays: v.lookbackDays ?? 60,
          kellyFraction: v.kellyFraction ?? 0.5,
        },
      }
    case 'rsi':
      return {
        rsi: {
          rsiDays: v.rsiDays ?? 14,
          oversold: v.oversold ?? 30,
          overbought: v.overbought ?? 70,
        },
      }
    default:
      return {}
  }
}

export function BacktestPanel({ funds, range, onRangeChange }: Props) {
  const { palette: p, mode } = useTheme()
  const glassClass = mode === 'dark' ? 'glass-card-dark' : 'glass-card'

  const [strategies, setStrategies] = useState<StrategyInfo[]>([])
  const [strategyKey, setStrategyKey] = useState<BacktestStrategy>('dca')
  const [fundCode, setFundCode] = useState(funds[0]?.code || '')
  const [initialCapital, setInitialCapital] = useState(100000)

  // 日期联动模式
  const [dateMode, setDateMode] = useState<DateMode>('follow')
  const [dateRange, setDateRange] = useState<[Date | null, Date | null]>([null, null])

  // 策略动态参数值（键名 -> 数值；与 StrategyParam.name 对应）
  const [paramValues, setParamValues] = useState<Record<string, number>>({})

  const [result, setResult] = useState<BacktestResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  // ===== 加载策略列表 =====
  useEffect(() => {
    let mounted = true
    api
      .getStrategies()
      .then((list) => {
        if (!mounted) return
        setStrategies(list)
        // 初始化每个参数的默认值
        const defaults: Record<string, number> = {}
        for (const s of list) {
          for (const param of s.params) {
            // 各策略参数名不冲突，可直接合并
            defaults[param.name] = param.default
          }
        }
        setParamValues((prev) => ({ ...defaults, ...prev }))
      })
      .catch((err) => {
        if (mounted) setError(`策略加载失败: ${(err as Error).message}`)
      })
    return () => {
      mounted = false
    }
  }, [])

  // ===== 区间联动：follow 模式下根据 range / 基金成立日计算日期 =====
  const selectedFund = useMemo(() => funds.find((f) => f.code === fundCode), [funds, fundCode])
  const followDates = useMemo<[Date, Date]>(() => {
    return rangeToDates(range as RangeKey, selectedFund)
  }, [range, selectedFund])

  useEffect(() => {
    if (dateMode === 'follow') {
      setDateRange([followDates[0], followDates[1]])
    }
  }, [dateMode, followDates])

  // ===== 派生状态 =====
  const selectedStrategy = useMemo(
    () => strategies.find((s) => s.key === strategyKey) || null,
    [strategies, strategyKey]
  )

  // ===== 防御性补齐：切换策略时，仅填充缺失参数，绝不覆盖已有值 =====
  useEffect(() => {
    if (!selectedStrategy) return
    setParamValues((prev) => {
      let changed = false
      const merged = { ...prev }
      for (const p of selectedStrategy.params) {
        if (merged[p.name] === undefined) {
          merged[p.name] = p.default
          changed = true
        }
      }
      return changed ? merged : prev
    })
  }, [selectedStrategy?.key])

  // ===== 恢复默认：仅重置当前策略的 params 字段，不影响 initialCapital =====
  const resetStrategyParams = () => {
    if (!selectedStrategy) return
    const defaults: Record<string, number> = {}
    for (const p of selectedStrategy.params) {
      defaults[p.name] = p.default
    }
    setParamValues((prev) => ({ ...prev, ...defaults }))
  }

  const startDate = dateRange[0] ? dayjs(dateRange[0]).format('YYYY-MM-DD') : ''
  const endDate = dateRange[1] ? dayjs(dateRange[1]).format('YYYY-MM-DD') : ''

  // ===== 运行回测 =====
  const runBacktest = async () => {
    if (!fundCode) {
      setError('请选择基金')
      return
    }
    if (!startDate || !endDate) {
      setError('请选择回测日期区间')
      return
    }
    setRunning(true)
    setError('')
    setResult(null)
    const params: BacktestParams = {
      fundCode,
      strategy: strategyKey,
      startDate,
      endDate,
      initialCapital,
      ...buildStrategyParams(strategyKey, paramValues, initialCapital),
    }
    try {
      const res = await api.runBacktest(params)
      if (!res.ok) {
        setError(res.error || '回测失败')
      } else {
        setResult(res)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRunning(false)
    }
  }

  // 区间选项（与分析看板一致）
  const rangeOptions: { value: string; label: string }[] = [
    { value: '1m', label: '1月' },
    { value: '3m', label: '3月' },
    { value: '6m', label: '6月' },
    { value: '1y', label: '1年' },
    { value: '3y', label: '3年' },
    { value: '5y', label: '5年' },
    { value: 'ytd', label: '年初至今' },
    { value: 'all', label: '成立来' },
  ]

  const cardRadius = 12

  return (
    <div style={{
      flex: '1 1 0%',
      minHeight: 0,
      padding: '12px',
      overflow: 'hidden',
      display: 'grid',
      gridTemplateColumns: '340px 1fr',
      gap: '12px',
    } as React.CSSProperties}>
        {/* ============== 左侧：配置面板 ============== */}
        <div
          className={glassClass}
          style={{
            borderRadius: 12,
            padding: '12px',
            border: `1px solid ${p.border}`,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <Stack gap="md" style={{ paddingBottom: '12px' }}>
              <Group justify="space-between" align="baseline">
                <Text fw={700} size="lg" c={mode === 'dark' ? 'gray.1' : 'dark.8'}>
                  策略配置
                </Text>
                <Badge variant="light" color="blue" size="sm">
                  {strategies.length || 0} 种策略
                </Badge>
              </Group>
              <Divider />

              {/* 基金选择 */}
              <Stack gap={6}>
                <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'} fw={500}>
                  选择基金
                </Text>
                <Select
                  value={fundCode}
                  onChange={(v) => setFundCode(v ?? '')}
                  data={funds.map((f) => ({ value: f.code, label: `${f.name} (${f.code})` }))}
                  radius="md"
                  searchable
                />
              </Stack>

              {/* 日期范围联动 */}
              <Stack gap={6}>
                <Group justify="space-between">
                  <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'} fw={500}>
                    回测区间
                  </Text>
                  <SegmentedControl
                    size="xs"
                    value={dateMode}
                    onChange={(v) => setDateMode(v as DateMode)}
                    data={[
                      { value: 'follow', label: '跟随分析区间' },
                      { value: 'custom', label: '自定义' },
                    ]}
                  />
                </Group>

                {dateMode === 'follow' ? (
                  <Stack gap={6}>
                    <Box style={{ display: 'flex', gap: '1px', flexWrap: 'nowrap', background: mode === 'dark' ? '#252a32' : '#f1f3f6', borderRadius: '6px', padding: '2px', width: '100%' }}>
                      {rangeOptions.map((r) => (
                        <button
                          key={r.value}
                          onClick={() => onRangeChange(r.value)}
                          style={{
                            flex: 1,
                            background: range === r.value ? p.accent : 'transparent',
                            color: range === r.value ? '#fff' : p.text1,
                            border: 'none',
                            borderRadius: '4px',
                            padding: '4px 2px',
                            fontSize: '10px',
                            cursor: 'pointer',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {r.label}
                        </button>
                      ))}
                    </Box>
                    <Text size="xs" c={mode === 'dark' ? 'gray.5' : 'gray.5'}>
                      自动区间：{startDate || '--'} ~ {endDate || '--'}
                    </Text>
                  </Stack>
                ) : (
                  <DatePickerInput
                    type="range"
                    value={dateRange}
                    onChange={setDateRange}
                    radius="md"
                    clearable={false}
                    valueFormat="YYYY-MM-DD"
                    placeholder="选择日期区间"
                  />
                )}
              </Stack>

              {/* 初始资金 */}
              <Stack gap={6}>
                <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'} fw={500}>
                  初始资金（元）
                </Text>
                <NumberInput
                  value={initialCapital}
                  onChange={(v) => {
                    if (typeof v === 'number') setInitialCapital(v)
                  }}
                  onBlur={() => {
                    if (typeof initialCapital !== 'number' || Number.isNaN(initialCapital) || initialCapital < 1000) {
                      setInitialCapital(100000)
                    }
                  }}
                  min={1}
                  step={10000}
                  radius="md"
                  thousandSeparator=","
                />
              </Stack>

              <Divider label="选择策略" labelPosition="center" />

              {/* 策略选择：可搜索下拉（解决策略过多需长滚动的问题） */}
              <Stack gap={6}>
                <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'} fw={500}>
                  策略（输入名称/分类/风险搜索）
                </Text>
                <Select
                  value={strategyKey}
                  onChange={(v) => v && setStrategyKey(v as BacktestStrategy)}
                  data={strategies.map((s) => ({
                    value: s.key,
                    label: `${s.name} · ${s.category} · 风险${s.riskLevel}`,
                  }))}
                  radius="md"
                  searchable
                  nothingFoundMessage="未找到匹配策略"
                  maxDropdownHeight={280}
                />
              </Stack>

              {/* 选中策略的详情卡片（单卡片，含执行步骤/适合市场） */}
              {selectedStrategy && (
                <Card
                  withBorder
                  radius="md"
                  p="sm"
                  style={{
                    borderColor: p.accent,
                    background: p.accentSoft,
                  }}
                >
                  <Group justify="space-between" wrap="nowrap" mb={4}>
                    <Text fw={700} size="sm" c={mode === 'dark' ? 'gray.1' : 'dark.8'}>
                      {selectedStrategy.name}
                    </Text>
                    <Group gap={4}>
                      <Badge color={RISK_COLOR[selectedStrategy.riskLevel]} variant="light" size="xs">
                        风险{selectedStrategy.riskLevel}
                      </Badge>
                      <Badge
                        color={CATEGORY_COLOR[selectedStrategy.category] || 'gray'}
                        variant="dot"
                        size="xs"
                      >
                        {selectedStrategy.category}
                      </Badge>
                    </Group>
                  </Group>
                  <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'}>
                    {selectedStrategy.description}
                  </Text>
                  <Box mt="xs" style={{ borderTop: `1px solid ${p.border}`, paddingTop: 8 }}>
                    <Stack gap={6}>
                      <Box>
                        <Text size="xs" fw={600} mb={2}>
                          执行步骤
                        </Text>
                        <Stack gap={2}>
                          {selectedStrategy.details.map((d, i) => (
                            <Group key={i} gap={6} align="flex-start">
                              <ThemeIcon size={16} radius="xl" variant="light" color="blue">
                                <Text size="9px" fw={700}>
                                  {i + 1}
                                </Text>
                              </ThemeIcon>
                              <Text size="xs" c={mode === 'dark' ? 'gray.3' : 'gray.7'}>
                                {d}
                              </Text>
                            </Group>
                          ))}
                        </Stack>
                      </Box>
                      <Divider my={4} />
                      <Group gap={6} align="flex-start">
                        <Target size={14} color={p.text2} />
                        <Box>
                          <Text size="xs" fw={600}>
                            适合市场
                          </Text>
                          <Text size="xs" c={mode === 'dark' ? 'gray.3' : 'gray.7'}>
                            {selectedStrategy.suitableMarket}
                          </Text>
                        </Box>
                      </Group>
                    </Stack>
                  </Box>
                </Card>
              )}

              {/* 动态策略参数 */}
              {selectedStrategy && selectedStrategy.params.length > 0 && (
                <>
                  <Divider label="策略参数" labelPosition="center" />
                  <Group justify="flex-end">
                    <Button
                      variant="light"
                      color="gray"
                      size="xs"
                      leftSection={<RotateCcw size={14} />}
                      onClick={resetStrategyParams}
                    >
                      恢复默认
                    </Button>
                  </Group>
                  <Stack gap="sm">
                    {selectedStrategy.params.map((param) => (
                      <StrategyParamInput
                        key={param.name}
                        param={param}
                        value={paramValues[param.name] ?? param.default}
                        onChange={(v) =>
                          setParamValues((prev) => ({ ...prev, [param.name]: v }))
                        }
                      />
                    ))}
                  </Stack>
                </>
              )}

              {/* 运行按钮 */}
              <Button
                size="md"
                radius="md"
                loading={running}
                leftSection={<Play size={16} />}
                onClick={runBacktest}
                fullWidth
              >
                {running ? '回测运行中...' : '运行回测'}
              </Button>
              {error && (
                <Text size="xs" c="red" ta="center">
                  {error}
                </Text>
              )}
            </Stack>
          </div>
        </div>

        {/* ============== 右侧：结果面板 ============== */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, height: '100%', overflow: 'hidden' }}>
          {result && result.metrics ? (
            <>
              {/* Card 1: RingProgress 单独 Card，固定最小高度 220px，防止被压截断 */}
              <Card
                className={glassClass}
                radius={cardRadius}
                p="md"
                withBorder
                style={{ minHeight: 220, flexShrink: 0 }}
              >
                <Group justify="space-between" align="center" mb="sm">
                  <Box>
                    <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'}>
                      回测结果 · {selectedStrategy?.name} · {selectedFund?.name}
                    </Text>
                    <Text size="sm" fw={700} c={mode === 'dark' ? 'gray.1' : 'dark.8'}>
                      风险调整后收益
                    </Text>
                  </Box>
                  <ExcessReturnBadge
                    value={result.metrics.totalReturn - result.metrics.benchmarkReturn}
                    palette={p}
                    hint={METRIC_HINTS.excessReturn}
                  />
                </Group>
                <Group gap="lg" align="center" wrap="nowrap">
                  <RingProgress
                    size={150}
                    thickness={11}
                    roundCaps
                    sections={[
                      {
                        value: Math.min(Math.max((result.metrics.sharpe + 1) * 33.3, 0), 100),
                        color: result.metrics.sharpe >= 1 ? 'green' : result.metrics.sharpe >= 0 ? 'blue' : 'red',
                      },
                    ]}
                    label={
                      <Tooltip label={METRIC_HINTS.sharpe} withArrow multiline w={280} position="right" styles={{ tooltip: { whiteSpace: 'pre-line', fontSize: '11px', lineHeight: 1.6 } }}>
                        <Stack align="center" gap={0}>
                          <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'}>
                            夏普比率 ⓘ
                          </Text>
                          <Text size="md" fw={800} c={mode === 'dark' ? 'gray.0' : 'dark.9'}>
                            {result.metrics.sharpe.toFixed(2)}
                          </Text>
                        </Stack>
                      </Tooltip>
                    }
                  />
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs">
                      <Text size="xs" c={p.text2}>评级:</Text>
                      <Badge
                        size="sm"
                        color={
                          result.metrics.sharpe >= 2
                            ? 'green'
                            : result.metrics.sharpe >= 1
                              ? 'blue'
                              : result.metrics.sharpe >= 0
                                ? 'yellow'
                                : 'red'
                        }
                      >
                        {result.metrics.sharpe >= 2
                          ? '优秀'
                          : result.metrics.sharpe >= 1
                            ? '良好'
                            : result.metrics.sharpe >= 0
                              ? '一般'
                              : '差'}
                      </Badge>
                    </Group>
                    <Text size="xs" c={p.text2}>
                      夏普比率 = (策略收益 - 无风险利率) / 策略波动率
                    </Text>
                    <Text size="xs" c={p.text2}>
                      参考: &lt;0 差 · 0~1 一般 · 1~2 良好 · &gt;2 优秀
                    </Text>
                  </Stack>
                </Group>
              </Card>

              {/* Card 2: 8 个关键指标 grid */}
              <Card
                className={glassClass}
                radius={cardRadius}
                p="md"
                withBorder
                style={{ flexShrink: 0 }}
              >
                <Text size="sm" fw={700} mb="sm" c={mode === 'dark' ? 'gray.1' : 'dark.8'}>
                  关键指标
                </Text>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  <MetricCell
                    label="总收益率"
                    value={fmtPct(result.metrics.totalReturn)}
                    color={result.metrics.totalReturn >= 0 ? p.up : p.down}
                    hint={METRIC_HINTS.totalReturn}
                    icon={
                      result.metrics.totalReturn >= 0 ? (
                        <TrendingUp size={14} />
                      ) : (
                        <TrendingDown size={14} />
                      )
                    }
                  />
                  <MetricCell
                    label="年化收益"
                    value={fmtPct(result.metrics.annualReturn)}
                    color={result.metrics.annualReturn >= 0 ? p.up : p.down}
                    hint={METRIC_HINTS.annualReturn}
                  />
                  <MetricCell
                    label="基准收益"
                    value={fmtPct(result.metrics.benchmarkReturn)}
                    color={result.metrics.benchmarkReturn >= 0 ? p.up : p.down}
                    hint={METRIC_HINTS.benchmarkReturn}
                  />
                  <MetricCell
                    label="期末资产"
                    value={fmtNum(result.metrics.finalValue, 0)}
                    color={p.text0}
                    hint={METRIC_HINTS.finalValue}
                  />
                  <MetricCell
                    label="交易次数"
                    value={String(result.metrics.tradeCount)}
                    color={p.text0}
                    hint={METRIC_HINTS.tradeCount}
                  />
                  <MetricCell
                    label="胜率"
                    value={`${result.metrics.winRate.toFixed(0)}%`}
                    color={p.text0}
                    hint={METRIC_HINTS.winRate}
                  />
                  <MetricCell
                    label="最大回撤"
                    value={fmtPct(result.metrics.maxDrawdown)}
                    color={p.impactNegative}
                    hint={METRIC_HINTS.maxDrawdown}
                  />
                  <MetricCell
                    label="超额收益"
                    value={fmtPct(result.metrics.totalReturn - result.metrics.benchmarkReturn)}
                    color={
                      result.metrics.totalReturn - result.metrics.benchmarkReturn >= 0
                        ? p.up
                        : p.down
                    }
                    hint={METRIC_HINTS.excessReturn}
                  />
                </div>

                {/* 回撤条移到 Card 2 末尾 */}
                <Group mt="md" gap="sm" align="center">
                  <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'} style={{ minWidth: 80 }}>
                    最大回撤
                  </Text>
                  <Box style={{ flex: 1 }}>
                    <Progress
                      value={Math.min(Math.abs(result.metrics.maxDrawdown), 100)}
                      color="red"
                      radius="md"
                      size="md"
                    />
                  </Box>
                  <Text size="xs" fw={600} c={p.impactNegative} style={{ minWidth: 60, textAlign: 'right' }}>
                    {fmtPct(result.metrics.maxDrawdown)}
                  </Text>
                </Group>
              </Card>

              {/* 资产曲线 */}
              <Paper
                className={glassClass}
                radius={cardRadius}
                p="lg"
                withBorder
                style={{
                  flex: 1,
                  minHeight: 320,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <Group justify="space-between" mb="sm">
                  <Box>
                    <Text size="sm" fw={700} c={mode === 'dark' ? 'gray.1' : 'dark.8'}>
                      资产曲线 vs 基准（买入持有）
                    </Text>
                    <Text size="xs" c={mode === 'dark' ? 'gray.5' : 'gray.5'}>
                      策略资产净值变化与同期满仓持有的对比
                    </Text>
                  </Box>
                  <Group gap="xs">
                    <Badge variant="dot" color="blue" size="sm">
                      策略资产
                    </Badge>
                    <Badge variant="dot" color="gray" size="sm">
                      买入持有基准
                    </Badge>
                  </Group>
                </Group>
                <Box style={{ flex: 1, minHeight: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={result.equityCurve} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={p.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke={p.text2}
                        tick={{ fontSize: 10, fill: p.text2 }}
                        minTickGap={50}
                        tickFormatter={(v) => (v as string).slice(5)}
                      />
                      <YAxis
                        stroke={p.text2}
                        tick={{ fontSize: 10, fill: p.text2 }}
                        tickFormatter={(v) => (v / 10000).toFixed(0) + '万'}
                      />
                      <RTooltip
                        contentStyle={{
                          background: p.tooltipBg,
                          border: `1px solid ${p.borderLight}`,
                          borderRadius: '6px',
                          fontSize: '11px',
                        }}
                        formatter={(v: number) => fmtNum(v, 0)}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name="策略资产"
                        stroke={p.accent}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive
                        animationDuration={600}
                      />
                      <Line
                        type="monotone"
                        dataKey="benchmark"
                        name="买入持有基准"
                        stroke={p.text2}
                        strokeWidth={1.5}
                        strokeDasharray="5 3"
                        dot={false}
                        isAnimationActive
                        animationDuration={600}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
              </Paper>

              {/* 交易记录 */}
              <Card
                className={glassClass}
                radius={cardRadius}
                p="md"
                withBorder
                style={{ maxHeight: 260, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              >
                <Group justify="space-between" mb="xs">
                  <Text size="sm" fw={700} c={mode === 'dark' ? 'gray.1' : 'dark.8'}>
                    交易记录
                  </Text>
                  <Badge variant="light" color="gray" size="sm">
                    共 {result.trades.length} 笔
                  </Badge>
                </Group>
                <ScrollArea h={200} offsetScrollbars>
                  <Table striped highlightOnHover horizontalSpacing="sm" verticalSpacing="xs" style={{ fontSize: '0.6875rem' }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>日期</Table.Th>
                        <Table.Th>操作</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>净值</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>份额</Table.Th>
                        <Table.Th style={{ textAlign: 'right' }}>金额</Table.Th>
                        <Table.Th>原因</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.trades.map((t, i) => (
                        <Table.Tr key={i}>
                          <Table.Td style={{ fontFamily: 'monospace' }}>{t.date}</Table.Td>
                          <Table.Td>
                            <Badge
                              color={t.type === 'buy' ? 'red' : 'green'}
                              variant="light"
                              size="xs"
                              leftSection={t.type === 'buy' ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            >
                              {t.type === 'buy' ? '买入' : '卖出'}
                            </Badge>
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {fmtNum(t.nav, 4)}
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right', fontFamily: 'monospace' }}>
                            {t.shares.toFixed(2)}
                          </Table.Td>
                          <Table.Td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                            {fmtNum(t.amount, 0)}
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c={mode === 'dark' ? 'gray.4' : 'gray.6'}>
                              {t.reason}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea>
              </Card>
            </>
          ) : (
            <Card
              className={glassClass}
              radius={cardRadius}
              withBorder
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Stack align="center" gap="md">
                <ThemeIcon size={64} radius="xl" variant="light" color="blue">
                  <Activity size={32} />
                </ThemeIcon>
                <Text size="md" c={mode === 'dark' ? 'gray.4' : 'gray.6'} ta="center">
                  {running
                    ? '正在运行回测，请稍候...'
                    : '配置策略参数后点击"运行回测"查看结果'}
                </Text>
              </Stack>
            </Card>
          )}
        </div>
    </div>
  )
}

// ===== 策略参数输入 =====
function StrategyParamInput({
  param,
  value,
  onChange,
}: {
  param: StrategyParam
  value: number
  onChange: (v: number) => void
}) {
  const { mode } = useTheme()
  return (
    <Group justify="space-between" align="flex-end" wrap="nowrap">
      <Box style={{ flex: 1 }}>
        <Group gap={4}>
          <Text size="xs" fw={500} c={mode === 'dark' ? 'gray.3' : 'gray.7'}>
            {param.label}
          </Text>
          <Tooltip label={param.desc} withArrow multiline w={220}>
            <Info size={12} style={{ opacity: 0.5, cursor: 'help' }} />
          </Tooltip>
        </Group>
        <Text size="xs" c={mode === 'dark' ? 'gray.5' : 'gray.5'}>
          {param.desc}
        </Text>
      </Box>
      <NumberInput
        value={value}
        onChange={(v) => {
          // 输入过程中（如清空、键入中间状态）v 不是 number，
          // 此时不写入 state，让 NumberInput 内部保留原始字符串，
          // 避免把用户改了一半的值静默回退到 param.default。
          if (typeof v === 'number') {
            onChange(v)
          }
        }}
        onBlur={() => {
          // 焦点离开时若值为 NaN/缺失，补回默认值
          if (typeof value !== 'number' || Number.isNaN(value)) {
            onChange(param.default)
          }
        }}
        min={param.min}
        max={param.max}
        step={param.max > 100 ? 10 : 1}
        radius="sm"
        w={120}
      />
    </Group>
  )
}

// ===== 指标含义说明（悬停提示文案）=====
const METRIC_HINTS = {
  totalReturn: '策略在回测区间内的总涨跌幅。\n\n计算：(期末资产 - 投入总资金) / 投入总资金 × 100%。\n\n直观理解：期初投入的钱到期末赚/亏了多少比例。注意它不体现过程中的波动，需结合最大回撤一起看。',
  annualReturn: '把总收益折算成"一年能赚多少"的年化收益率。\n\n计算：(1 + 总收益率)^(365/天数) - 1。\n\n直观理解：不同时间长度的回测放在一起比较时的统一标尺。例如 3 年赚 33%，年化约 10%。参考：长期年化 >8% 已属优秀，>15% 极少。',
  benchmarkReturn: '同期"期初全仓买入并一直持有"的收益（买入持有基准）。\n\n作用：判断策略是否"跑赢躺平"。若策略收益低于基准，说明主动操作反而拖了后腿（但可能降低了波动，需结合夏普看）。',
  finalValue: '回测结束时的账户总资产（元）。\n\n计算：投入总资金 + 累计盈亏。对比初始资金即可直观看到赚/亏金额。',
  tradeCount: '策略在区间内执行的买卖总次数（买入+卖出各计一次）。\n\n注意：交易越频繁，实际手续费/冲击成本越高（本回测未计佣金）。次数极少说明策略基本没动，次数过多则要警惕过度交易。',
  winRate: '盈利离场的交易占已完结交易的比例。\n\n计算：盈利笔数 / 总交易笔数 × 100%。\n\n误区提醒：高胜率 ≠ 赚钱。若每次赚 1% 就跑、亏 20% 才割，胜率 90% 仍可能巨亏。需结合单笔盈亏比一起判断。',
  maxDrawdown: '从历史最高点跌到最低点的最大跌幅，衡量"最惨时刻"的亏损深度。\n\n计算：区间内 (峰值 - 之后最低值) / 峰值 的最大值。\n\n直观理解：你在最高点买入的话最多会浮亏多少。注意：回撤 20% 需要再涨 25% 才能回本，回撤 50% 需要涨 100%。风险承受力弱的投资者应重点关注此项。',
  excessReturn: '策略收益超出买入持有基准的部分。\n\n计算：策略总收益 - 基准收益。\n\n为正说明主动管理创造了超额收益（alpha）；为负说明不如直接持有。这是衡量策略价值的最核心指标。',
  sharpe: '每承担 1 单位风险（波动）换取了多少超额收益，"性价比"指标。\n\n计算：(策略收益 - 无风险利率) / 策略收益率的标准差。\n\n参考：>2 优秀，1~2 良好，0~1 一般，<0 亏损且波动大。夏普相同的情况下，回撤更小的策略持有体验更好。',
} as const

// ===== 单格指标 =====
function MetricCell({
  label,
  value,
  color,
  icon,
  hint,
}: {
  label: string
  value: string
  color: string
  icon?: React.ReactNode
  hint?: string
}) {
  const { mode } = useTheme()
  return (
    <Tooltip label={hint} withArrow multiline w={280} position="top" styles={{ tooltip: { whiteSpace: 'pre-line', fontSize: '11px', lineHeight: 1.6 } }} disabled={!hint}>
      <Paper
        radius="md"
        p="xs"
        withBorder
        style={{
          background: mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
          borderColor: mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          cursor: hint ? 'help' : 'default',
        }}
      >
        <Stack gap={2}>
          <Group gap={4} align="center">
            {icon}
            <Text size="xs" c={mode === 'dark' ? 'gray.5' : 'gray.5'}>
              {label}
              {hint && <span style={{ opacity: 0.55, marginLeft: 3, fontSize: 10 }}>ⓘ</span>}
            </Text>
          </Group>
          <Text size="md" fw={800} style={{ color, fontFamily: '"JetBrains Mono", monospace' }}>
            {value}
          </Text>
        </Stack>
      </Paper>
    </Tooltip>
  )
}

// ===== 超额收益徽章 =====
function ExcessReturnBadge({
  value,
  palette,
  hint,
}: {
  value: number
  palette: ReturnType<typeof useTheme>['palette']
  hint?: string
}) {
  const positive = value >= 0
  return (
    <Tooltip label={hint} withArrow multiline w={280} position="bottom" styles={{ tooltip: { whiteSpace: 'pre-line', fontSize: '11px', lineHeight: 1.6 } }} disabled={!hint}>
      <Paper
        radius="md"
        p="sm"
        withBorder
        style={{
          background: positive ? `${palette.up}15` : `${palette.down}15`,
          borderColor: positive ? `${palette.up}50` : `${palette.down}50`,
          cursor: 'help',
        }}
      >
      <Stack gap={0} align="center">
        <Text size="xs" c={positive ? palette.up : palette.down} fw={500}>
          超额收益
        </Text>
        <Text
          size="xl"
          fw={900}
          style={{
            color: positive ? palette.up : palette.down,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {fmtPct(value)}
        </Text>
      </Stack>
      </Paper>
    </Tooltip>
  )
}
