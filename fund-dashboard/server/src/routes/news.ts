import { Router } from 'express'
import { searchNews } from '../services/news'
import { translateText } from '../services/translate'
import { inferFundSector } from '../services/sector'

export const newsRoutes = Router()

// 检索新闻：/api/news/search?date=2024-03-15&fundCode=005827
// fundCode 可选，传入则带入基金领域关键词精准检索
newsRoutes.get('/search', async (req, res) => {
  const date = String(req.query.date || '').trim()
  const fundCode = String(req.query.fundCode || '').trim()
  if (!date) {
    res.json({ ok: false, error: 'date required' })
    return
  }
  try {
    let sectors: string[] = []
    let sectorInfo = null
    if (fundCode) {
      const sector = await inferFundSector(fundCode)
      sectors = sector.keywords
      sectorInfo = { sectors: sector.sectors, description: sector.description }
    }
    const articles = await searchNews(date, sectors)
    res.json({ ok: true, data: articles, sector: sectorInfo })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

// 翻译：POST /api/news/translate  { text: "...", from: "en", to: "zh-CN" }
newsRoutes.post('/translate', async (req, res) => {
  const { text, from, to } = req.body || {}
  if (!text) {
    res.json({ ok: false, error: 'text required' })
    return
  }
  try {
    const translated = await translateText(String(text), from || 'en', to || 'zh-CN')
    res.json({ ok: true, data: translated })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})
