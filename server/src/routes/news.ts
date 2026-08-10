import { Router } from 'express'
import { searchNews } from '../services/news'
import { searchNewsByLLMStream } from '../services/news-llm'
import { translateText } from '../services/translate'
import { inferFundSector } from '../services/sector'
import type { StreamEvent } from '../services/llm'

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
    const { articles, market_context } = await searchNews(date, sectors)
    res.json({ ok: true, data: articles, sector: sectorInfo, market_context })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message })
  }
})

// 流式检索新闻（SSE）：/api/news/search/stream?date=2024-03-15&fundCode=005827
// 响应 Content-Type: text/event-stream
// 事件序列:
//   sector   -> { sectors, description }（领域识别完成）
//   status   -> { stage: 'searching'|'analyzing'|'fallback', message }
//   sources  -> { urls: string[] }（搜索来源 URL）
//   article  -> { article: NewsArticle }（增量文章，多条）
//   market_context -> { text: string }
//   complete -> { articles: NewsArticle[], market_context: string }
//   error    -> { message: string }
//   done     -> 结束标记
newsRoutes.get('/search/stream', async (req, res) => {
  const date = String(req.query.date || '').trim()
  const fundCode = String(req.query.fundCode || '').trim()
  if (!date) {
    res.status(400).json({ ok: false, error: 'date required' })
    return
  }

  // SSE 头
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // nginx 透传
  res.flushHeaders()

  // SSE 发送辅助
  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // 客户端断开时清理
  let clientClosed = false
  req.on('close', () => {
    clientClosed = true
  })

  try {
    // 1) 领域识别
    let sectors: string[] = []
    let sectorInfo = null
    let fundName: string | undefined
    if (fundCode) {
      const sector = await inferFundSector(fundCode)
      sectors = sector.keywords
      sectorInfo = { sectors: sector.sectors, description: sector.description }
      fundName = sector.name
    }
    if (clientClosed) return
    sendEvent('sector', sectorInfo)

    // 2) LLM 流式检索（优先）
    // 若 LLM_API_KEY 未配置或调用失败，降级到非流式 GDELT 链
    const hasLlmKey = !!process.env.LLM_API_KEY
    if (hasLlmKey) {
      sendEvent('status', { stage: 'searching', message: '正在调用 LLM 联网搜索...' })

      let llmFailed = false
      try {
        await searchNewsByLLMStream(date, sectors, fundName, (event: StreamEvent) => {
          if (clientClosed) return
          switch (event.type) {
            case 'status':
              sendEvent('status', { stage: event.stage, message: event.message })
              break
            case 'sources':
              sendEvent('sources', { urls: event.urls })
              break
            case 'article':
              // 将 LLMAnalysisArticle 映射后发送（路由层不做映射，发送原始 article）
              sendEvent('article', { article: event.article })
              break
            case 'market_context':
              sendEvent('market_context', { text: event.text })
              break
            case 'complete':
              sendEvent('complete', {
                articles: event.articles,
                market_context: event.market_context,
              })
              break
            case 'error':
              llmFailed = true
              sendEvent('status', {
                stage: 'fallback',
                message: `LLM 失败: ${event.message}，降级到 GDELT...`,
              })
              break
          }
        })

        if (!llmFailed) {
          if (!clientClosed) sendEvent('done', {})
          return
        }
      } catch (err) {
        llmFailed = true
        if (!clientClosed) {
          sendEvent('status', {
            stage: 'fallback',
            message: `LLM 异常: ${(err as Error).message.slice(0, 100)}，降级到 GDELT...`,
          })
        }
      }
    }

    // 3) 降级：非流式 GDELT 链
    if (clientClosed) return
    if (!hasLlmKey) {
      sendEvent('status', {
        stage: 'fallback',
        message: 'LLM 未配置，使用 GDELT 检索...',
      })
    }

    const { articles, market_context } = await searchNews(date, sectors)
    if (clientClosed) return

    // 逐条发送文章（模拟流式体验）
    for (const article of articles) {
      if (clientClosed) return
      sendEvent('article', { article })
    }
    if (market_context) {
      sendEvent('market_context', { text: market_context })
    }
    sendEvent('complete', { articles, market_context: market_context || '' })
    sendEvent('done', {})
  } catch (err) {
    if (!clientClosed) {
      sendEvent('error', { message: (err as Error).message })
      sendEvent('done', {})
    }
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
