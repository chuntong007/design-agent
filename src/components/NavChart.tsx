import React, { useMemo, useRef, useEffect } from 'react'
import ReactECharts from 'echarts-for-react'
import type { Fund } from '../types'

interface Props {
  funds: Fund[]
  selectedIds: string[]
  normalized: boolean // 是否归一化对比
  anchorDate: string | null
  onPointClick: (fund: Fund, date: string, nav: number) => void
  newsDates: string[]
}

export const NavChart: React.FC<Props> = ({ funds, selectedIds, normalized, anchorDate, onPointClick, newsDates }) => {
  const chartRef = useRef<any>(null)
  const selectedFunds = useMemo(
    () => funds.filter((f) => selectedIds.includes(f.id)),
    [funds, selectedIds],
  )

  const dates = useMemo(() => funds[0]?.navSeries.map((p) => p.date) ?? [], [funds])

  const option = useMemo(() => {
    const series = selectedFunds.map((f) => {
      const base = f.navSeries[0]?.nav ?? 1
      const data = f.navSeries.map((p) => {
        const v = normalized ? +(((p.nav - base) / base) * 100).toFixed(2) : p.nav
        return [p.date, v]
      })
      return {
        name: f.name,
        type: 'line',
        data,
        smooth: 0.3,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 2.2, color: f.color },
        itemStyle: { color: f.color },
        emphasis: { focus: 'series', scale: 1.4 },
        // 高亮新闻日期
        markPoint: {
          symbol: 'pin',
          symbolSize: 0,
          data: [],
        },
      }
    })

    return {
      animationDuration: 800,
      grid: { left: 56, right: 24, top: 24, bottom: 64 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15,23,42,0.92)',
        borderColor: 'transparent',
        borderRadius: 12,
        padding: [10, 14],
        textStyle: { color: '#fff', fontSize: 12 },
        axisPointer: {
          type: 'line',
          lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 },
        },
        formatter: (params: any[]) => {
          const date = params[0]?.axisValue
          const rows = params
            .map((p) => {
              const val = normalized ? `${p.value[1].toFixed(2)}%` : p.value[1].toFixed(4)
              return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
                <span style="color:#cbd5e1">${p.seriesName}</span>
                <span style="margin-left:auto;font-weight:600">${val}</span>
              </div>`
            })
            .join('')
          const newsHint = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.15);color:#fbbf24;font-size:11px">📰 点击此处检索该日期全球新闻</div>`
          return `<div style="font-weight:600;margin-bottom:2px">${date}</div>${rows}${newsHint}`
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisLabel: { color: '#94a3b8', fontSize: 11, formatter: (v: string) => v.slice(5) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: {
          color: '#94a3b8',
          fontSize: 11,
          formatter: (v: number) => (normalized ? `${v.toFixed(0)}%` : v.toFixed(2)),
        },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          height: 22,
          bottom: 14,
          borderColor: 'transparent',
          backgroundColor: '#f1f5f9',
          fillerColor: 'rgba(99,102,241,0.12)',
          handleStyle: { color: '#6366f1', borderColor: '#6366f1' },
          textStyle: { color: '#94a3b8', fontSize: 10 },
          dataBackground: { lineStyle: { color: '#cbd5e1' }, areaStyle: { color: '#e2e8f0' } },
        },
      ],
      series,
      // 锚定竖线
      graphic: anchorDate
        ? [
            {
              type: 'line',
              shape: { x1: 0, y1: 0, x2: 0, y2: 0 },
              z: 100,
              silent: true,
              style: { stroke: '#f59e0b', lineWidth: 2, lineDash: [6, 4] },
            },
          ]
        : [],
    }
  }, [selectedFunds, normalized, dates, anchorDate])

  // 重新构建带锚定线的 option（移除逐日新闻 markLine，避免数据量大时卡死）
  const fullOption = useMemo(() => {
    const opt = { ...option }
    const markLines: any[] = []

    // 仅锚定线（高亮）
    if (anchorDate && dates.includes(anchorDate)) {
      markLines.push({
        xAxis: anchorDate,
        symbol: 'none',
        label: {
          show: true,
          position: 'insideEndTop',
          formatter: '📍 锚定点',
          color: '#f59e0b',
          fontSize: 11,
          fontWeight: 600,
          backgroundColor: 'rgba(245,158,11,0.12)',
          padding: [3, 6],
          borderRadius: 4,
        },
        lineStyle: { color: '#f59e0b', type: 'solid', width: 2 },
      })
    }

    if (markLines.length && opt.series) {
      opt.series = opt.series.map((s: any, i: number) => (i === 0 ? { ...s, markLine: { silent: true, symbol: 'none', data: markLines } } : s))
    }
    return opt
  }, [option, anchorDate, dates])

  const onChartReady = (instance: any) => {
    if (!instance) return
    bindClick(instance)
  }

  // 每次 option 更新后，重新绑定点击事件（实例不变，但 selectedFunds/dates 可能变化，需闭包最新值）
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance?.()
    if (inst) bindClick(inst)
  })

  function bindClick(instance: any) {
    if (!instance) return
    instance.getZr().off('click')
    instance.getZr().on('click', (params: any) => {
      const pointInPixel = [params.offsetX, params.offsetY]
      if (instance.containPixel('grid', pointInPixel)) {
        const pointInGrid = instance.convertFromPixel({ seriesIndex: 0 }, pointInPixel)
        const xIndex = Math.round(pointInGrid[0])
        if (xIndex >= 0 && xIndex < dates.length) {
          const date = dates[xIndex]
          const fund = selectedFunds[0]
          if (fund) {
            const navPoint = fund.navSeries[xIndex]
            if (navPoint) {
              onPointClick(fund, date, navPoint.nav)
            }
          }
        }
      }
    })
  }

  return (
    <div className="w-full h-full">
      <ReactECharts
        ref={chartRef}
        option={fullOption}
        style={{ height: '100%', width: '100%' }}
        onChartReady={onChartReady}
        notMerge
      />
    </div>
  )
}
