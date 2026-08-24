import React from 'react'
import ReactDOM from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { App } from './App'
import { ThemeProvider } from './ThemeContext'
import { palettes } from './theme'

// 全局样式注入（基础重置，主题色由 ThemeProvider 动态控制 body）
const globalCss = `
  * { box-sizing: border-box; }
  html, body, #root {
    margin: 0; padding: 0;
    height: 100%;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body {
    background: ${palettes.light.bg0};
    color: ${palettes.light.text0};
    transition: background-color 0.3s ease, color 0.3s ease;
  }
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${palettes.light.border}; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: ${palettes.light.borderLight}; }
  button { font-family: inherit; }
  input { font-family: inherit; }
  a { color: ${palettes.light.accent}; text-decoration: none; }
  a:hover { text-decoration: underline; }
  /* 科技感：卡片玻璃态 + 微光 */
  .glass-card {
    backdrop-filter: blur(12px);
    background: rgba(255,255,255,0.65);
    border: 1px solid rgba(255,255,255,0.3);
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
  }
  .glass-card-dark {
    backdrop-filter: blur(12px);
    background: rgba(28,32,38,0.65);
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
  }
  /* 科技感：数据网格背景 */
  .tech-grid-bg {
    background-image:
      linear-gradient(rgba(37,99,235,0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(37,99,235,0.03) 1px, transparent 1px);
    background-size: 32px 32px;
  }
  .tech-grid-bg-dark {
    background-image:
      linear-gradient(rgba(96,165,250,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(96,165,250,0.04) 1px, transparent 1px);
    background-size: 32px 32px;
  }
  /* Mantine 日期面板在深色模式适配 */
  .mantine-Popover-dropdown { z-index: 1000 !important; }
`

const styleEl = document.createElement('style')
styleEl.textContent = globalCss
document.head.appendChild(styleEl)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </MantineProvider>
  </React.StrictMode>,
)
