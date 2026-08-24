// Express 入口：注册 CORS、基金/股票/新闻/翻译路由
import express from 'express'
import cors from 'cors'
import { config } from './config'
import { fundRoutes } from './routes/fund'
import { stockRoutes } from './routes/stock'
import { newsRoutes } from './routes/news'
import { backtestRoutes } from './routes/backtest'

const app = express()
// CORS：显式允许 POST（chat SSE 路由）及 JSON 头，避免预检失败导致 fetch 永久 pending
app.use(cors({
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept'],
}))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

app.use('/api/fund', fundRoutes)
app.use('/api/stock', stockRoutes)
app.use('/api/news', newsRoutes)
app.use('/api/backtest', backtestRoutes)

app.listen(config.port, () => {
  console.log(`[fund-dashboard] server listening on http://localhost:${config.port}`)
  console.log(`[fund-dashboard] proxy: ${config.proxyUrl}`)
  console.log(`[fund-dashboard] LLM baseUrl: ${config.llm.baseUrl}`)
  console.log(`[fund-dashboard] LLM model: ${config.llm.model || '(默认，由 CC-Switch 决定)'}`)
  console.log(`[fund-dashboard] LLM apiKey: ${config.llm.apiKey ? 'configured' : 'none (CC-Switch mode)'}`)
})
