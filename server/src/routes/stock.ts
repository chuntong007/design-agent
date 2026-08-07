import { Router } from 'express'
import { getStockQuotes, getStockKlinesBatch } from '../services/stock'

export const stockRoutes = Router()

// 实时行情（批量）：/api/stock/quotes?codes=sh600519,sz000858
stockRoutes.get('/quotes', async (req, res) => {
  const codes = String(req.query.codes || '').trim()
  if (!codes) {
    res.json({ ok: false, error: 'codes required' })
    return
  }
  try {
    const list = codes.split(',').map((s) => s.trim()).filter(Boolean)
    const quotes = await getStockQuotes(list)
    res.json({ ok: true, data: quotes })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

// 历史 K 线（批量）：/api/stock/klines?codes=sh600519,sz000858&rangeDays=180
stockRoutes.get('/klines', async (req, res) => {
  const codes = String(req.query.codes || '').trim()
  if (!codes) {
    res.json({ ok: false, error: 'codes required' })
    return
  }
  const rangeDays = Math.max(30, Math.min(365 * 5, parseInt(String(req.query.rangeDays || '180'), 10)))
  try {
    const list = codes.split(',').map((s) => s.trim()).filter(Boolean)
    const map = await getStockKlinesBatch(list, rangeDays)
    res.json({ ok: true, data: map })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})
