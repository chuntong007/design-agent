// 设计系统：支持亮色/暗色双模式，默认亮色
// 亮色：温和米白底 + 柔和强调色，避免高对比刺眼
// 暗色：深蓝灰底 + 降饱和强调色，专业不刺眼
// 涨跌色统一降饱和，避免辣眼
import type { CSSProperties } from 'react'

export type ThemeMode = 'light' | 'dark'

export interface Palette {
  mode: ThemeMode
  // 背景层级（从底到顶）
  bg0: string
  bg1: string
  bg2: string
  bg3: string
  // 边框
  border: string
  borderLight: string
  // 文字
  text0: string
  text1: string
  text2: string
  // 强调：A 股惯例 红涨绿跌（降饱和）
  up: string
  down: string
  neutral: string
  // 品牌强调（柔和蓝）
  accent: string
  accentDim: string
  accentSoft: string
  // 多基金曲线配色（柔和、可区分）
  series: string[]
  // 新闻影响
  impactPositive: string
  impactNegative: string
  impactNeutral: string
  // 图表网格
  grid: string
  // tooltip / 悬浮
  tooltipBg: string
}

// 亮色调色板：温和米白，柔和强调
export const lightPalette: Palette = {
  mode: 'light',
  bg0: '#f7f8fa',
  bg1: '#ffffff',
  bg2: '#f1f3f6',
  bg3: '#e8ebf0',
  border: '#e3e7ec',
  borderLight: '#d0d5dd',
  text0: '#1f2937',
  text1: '#4b5563',
  text2: '#8a94a6',
  up: '#dc2626', // 柔和红
  down: '#16a34a', // 柔和绿
  neutral: '#64748b',
  accent: '#2563eb',
  accentDim: '#dbeafe',
  accentSoft: '#eff6ff',
  series: ['#2563eb', '#d97706', '#7c3aed', '#db2777', '#0d9488', '#65a30d'],
  impactPositive: '#16a34a',
  impactNegative: '#dc2626',
  impactNeutral: '#64748b',
  grid: '#eef0f3',
  tooltipBg: '#ffffff',
}

// 暗色调色板：深蓝灰，降饱和，不刺眼
export const darkPalette: Palette = {
  mode: 'dark',
  bg0: '#14171c',
  bg1: '#1c2026',
  bg2: '#252a32',
  bg3: '#2f353f',
  border: '#323842',
  borderLight: '#404752',
  text0: '#d4d9e0',
  text1: '#9ba3af',
  text2: '#6b7280',
  up: '#f87171', // 柔和红（降饱和）
  down: '#4ade80', // 柔和绿（降饱和）
  neutral: '#94a3b8',
  accent: '#60a5fa',
  accentDim: '#1e3a5f',
  accentSoft: '#172033',
  series: ['#60a5fa', '#fbbf24', '#c084fc', '#f472b6', '#2dd4bf', '#a3e635'],
  impactPositive: '#4ade80',
  impactNegative: '#f87171',
  impactNeutral: '#94a3b8',
  grid: '#2a3038',
  tooltipBg: '#252a32',
}

export const palettes: Record<ThemeMode, Palette> = {
  light: lightPalette,
  dark: darkPalette,
}

// 基金曲线颜色分配（按添加顺序循环）
export function seriesColor(p: Palette, index: number): string {
  return p.series[index % p.series.length]
}

export const typography = {
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontFamilyMono: '"JetBrains Mono", "SF Mono", Consolas, monospace',
}

// 通用样式片段工厂（依赖当前 palette）
export function makeStyles(p: Palette) {
  return {
    card: {
      background: p.bg1,
      border: `1px solid ${p.border}`,
      borderRadius: '10px',
    } as CSSProperties,
    cardHover: {
      background: p.bg1,
      border: `1px solid ${p.borderLight}`,
      borderRadius: '10px',
      transition: 'border-color 0.15s ease',
    } as CSSProperties,
    input: {
      background: p.bg3,
      border: `1px solid ${p.border}`,
      borderRadius: '6px',
      color: p.text0,
      padding: '8px 12px',
      fontSize: '14px',
      outline: 'none',
    } as CSSProperties,
    btn: {
      background: p.accent,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      padding: '8px 14px',
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
    } as CSSProperties,
    btnGhost: {
      background: 'transparent',
      color: p.text1,
      border: `1px solid ${p.border}`,
      borderRadius: '6px',
      padding: '8px 14px',
      fontSize: '13px',
      fontWeight: 500,
      cursor: 'pointer',
    } as CSSProperties,
    label: {
      color: p.text2,
      fontSize: '11px',
      fontWeight: 500,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    } as CSSProperties,
  } as const
}

// 数值格式化（与主题无关）
export function fmtPct(v: number, digits = 2): string {
  if (!isFinite(v)) return '--'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function fmtNum(v: number, digits = 4): string {
  if (!isFinite(v)) return '--'
  return v.toFixed(digits)
}

export function fmtMoney(v: number): string {
  if (!isFinite(v)) return '--'
  if (v >= 10000) return `${(v / 10000).toFixed(2)}万亿`
  return `${v.toFixed(2)}亿`
}

export function fmtColor(p: Palette, v: number): string {
  if (v > 0) return p.up
  if (v < 0) return p.down
  return p.neutral
}
