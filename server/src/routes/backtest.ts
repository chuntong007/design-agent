import { Router } from 'express'
import { runBacktest, STRATEGY_INFO } from '../services/backtest'

export const backtestRoutes = Router()

// 获取策略列表：GET /api/backtest/strategies
backtestRoutes.get('/strategies', (_req, res) => {
  res.json({ ok: true, data: STRATEGY_INFO })
})

// 运行回测：POST /api/backtest/run
backtestRoutes.post('/run', async (req, res) => {
  const params = req.body
  if (!params || !params.fundCode || !params.strategy || !params.startDate || !params.endDate) {
    res.json({ ok: false, error: '缺少必要参数: fundCode, strategy, startDate, endDate' })
    return
  }
  if (!params.initialCapital || params.initialCapital <= 0) {
    params.initialCapital = 100000
  }
  try {
    const result = await runBacktest(params)
    res.json({ ok: result.ok, data: result, error: result.error })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})
