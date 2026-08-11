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

    // 2) LLM 流式检索（优先，认证由 CC-Switch 完成，无需检查 apiKey）
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
          case 'reasoning_delta':
            sendEvent('reasoning_delta', { text: event.text })
            break
          case 'reasoning_done':
            sendEvent('reasoning_done', { text: event.text })
            break
          case 'output_delta':
            sendEvent('output_delta', { text: event.text })
            break
          case 'output_done':
            sendEvent('output_done', { text: event.text })
            break
          case 'complete':
            sendEvent('complete', {
              text: event.text,
              reasoning: event.reasoning,
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

    // 3) 降级：非流式 GDELT 链 -> 包装为 Markdown 文本一次性推送
    if (clientClosed) return

    const { articles, market_context } = await searchNews(date, sectors)
    if (clientClosed) return

    // 将 GDELT 文章包装为 Markdown，作为 output 一次性推送（降级链路无真流式）
    let md = ''
    if (market_context) {
      md += `## 市场概述\n\n${market_context}\n\n`
    }
    if (articles.length > 0) {
      md += `## 重要新闻\n\n`
      for (const a of articles) {
        const impactLabel = a.impact === 'positive' ? '📈 利好' : a.impact === 'negative' ? '📉 利空' : '➖ 中性'
        const titlePart = a.url ? `[${a.title}](${a.url})` : a.title
        md += `- ${impactLabel} **${a.category}** ${titlePart}  \n  ${a.date} · ${a.source}\n`
      }
    } else {
      md += `*该时期暂无新闻数据*\n`
    }
    sendEvent('output_delta', { text: md })
    sendEvent('output_done', { text: md })
    sendEvent('complete', { text: md, reasoning: '' })
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
