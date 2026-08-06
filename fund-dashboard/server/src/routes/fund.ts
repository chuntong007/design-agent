import { Router } from 'express'
import { searchFunds, getFundDetail, getFundHoldings } from '../services/fund'

export const fundRoutes = Router()

// 搜索基金：/api/fund/search?keyword=蓝筹
fundRoutes.get('/search', async (req, res) => {
  const keyword = String(req.query.keyword || '').trim()
  if (!keyword) {
    res.json({ ok: false, error: 'keyword required' })
    return
  }
  try {
    const list = await searchFunds(keyword)
    res.json({ ok: true, data: list })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

// 基金详情（含全量净值）：/api/fund/detail?code=005827
fundRoutes.get('/detail', async (req, res) => {
  const code = String(req.query.code || '').trim()
  if (!code) {
    res.json({ ok: false, error: 'code required' })
    return
  }
  try {
    const detail = await getFundDetail(code)
    res.json({ ok: true, data: detail })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

// 基金重仓股：/api/fund/holdings?code=005827
fundRoutes.get('/holdings', async (req, res) => {
  const code = String(req.query.code || '').trim()
  if (!code) {
    res.json({ ok: false, error: 'code required' })
    return
  }
  try {
    const holdings = await getFundHoldings(code)
    res.json({ ok: true, data: holdings })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})
