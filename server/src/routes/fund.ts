import { Router } from 'express'
import {
  searchFunds,
  getFundDetail,
  getFundHoldings,
  getFundGrowth,
  GROWTH_DAY_WHITELIST,
  type GrowthDay,
} from '../services/fund'

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

// 蛋卷累计收益率曲线：/api/fund/growth?code=161024&day=1y
// day 白名单：1m/3m/6m/1y/3y/5y/ty(年初至今)/all，默认 all
fundRoutes.get('/growth', async (req, res) => {
  const code = String(req.query.code || '').trim()
  const day = (String(req.query.day || 'all').trim() || 'all') as GrowthDay
  if (!code) {
    res.json({ ok: false, error: 'code required' })
    return
  }
  if (!GROWTH_DAY_WHITELIST.includes(day as (typeof GROWTH_DAY_WHITELIST)[number])) {
    res.json({
      ok: false,
      error: `invalid day: ${day}, allowed: ${GROWTH_DAY_WHITELIST.join('/')}`,
    })
    return
  }
  try {
    const points = await getFundGrowth(code, day)
    res.json({ ok: true, data: points })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})
