// 主题上下文：管理亮/暗模式切换，持久化到 localStorage
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { palettes, type Palette, type ThemeMode } from './theme'

interface ThemeCtx {
  palette: Palette
  mode: ThemeMode
  toggle: () => void
  setMode: (m: ThemeMode) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

const STORAGE_KEY = 'fund-dashboard:theme'

function getInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  // 默认亮色
  return 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode)

  const setMode = (m: ThemeMode) => {
    setModeState(m)
    try {
      localStorage.setItem(STORAGE_KEY, m)
    } catch {}
  }

  const toggle = () => setMode(mode === 'light' ? 'dark' : 'light')

  // 全局背景色随主题变化（含平滑过渡）
  useEffect(() => {
    document.body.style.background = palettes[mode].bg0
    document.body.style.color = palettes[mode].text0
    document.body.style.transition = 'background-color 0.3s ease, color 0.3s ease'
  }, [mode])

  const value: ThemeCtx = {
    palette: palettes[mode],
    mode,
    toggle,
    setMode,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
