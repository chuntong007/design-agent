// LLM 客户端：标准 OpenAI Responses API 协议（内置 web_search 工具）
// 经 CC-Switch 透明转发到 DeepSeek 等兼容端点，不走代理（国内直连或本地转发）
import fetch from 'node-fetch'
import { config } from '../config'

// ===== 请求/响应类型定义 =====

interface JsonSchemaFormat {
  type: 'json_schema'
  name: string
  strict: boolean
  schema: Record<string, unknown>
}

interface ResponsesRequestBody {
  model: string
  input: string
  instructions: string
  tools: Array<{ type: string }>
  tool_choice: { type: string }
  text: { format: JsonSchemaFormat }
  stream: boolean
}

interface WebSearchSource {
  type: string
  url: string
}

interface WebSearchAction {
  type?: string
  query?: string
  sources?: WebSearchSource[]
}

interface MessageContent {
  type: string
  text?: string
}

interface ResponseOutputItem {
  type: string
  id?: string
  action?: WebSearchAction
  content?: MessageContent[]
  role?: string
}

export interface ResponsesAPIBody {
  id?: string
  object?: string
  model?: string
  output?: ResponseOutputItem[]
  error?: {
    message: string
    type?: string
    code?: string
  }
}

// ===== 结构化输出 JSON Schema =====

const fundNewsSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    articles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          date: { type: 'string' },
          summary: { type: 'string' },
          impact: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
          impact_reason: { type: 'string' },
          category: { type: 'string' },
          relevance: { type: 'number' },
          affected_sectors: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'date', 'summary', 'impact', 'category'],
      },
    },
    market_context: { type: 'string' },
  },
  required: ['articles', 'market_context'],
}

// ===== 导出的类型 =====

export interface LLMAnalysisArticle {
  title: string
  url?: string
  date: string
  summary: string
  impact: 'positive' | 'negative' | 'neutral'
  impact_reason?: string
  category: string
  relevance?: number
  affected_sectors?: string[]
}

export interface LLMAnalysis {
  articles: LLMAnalysisArticle[]
  market_context: string
}

export interface ParsedResponse {
  sources: string[]
  analysis: LLMAnalysis
}

export interface ResponsesAPIOptions {
  model?: string
  timeout?: number
}

// ===== 流式事件类型（转发给前端 SSE）=====

export type StreamEvent =
  | { type: 'status'; stage: 'searching' | 'analyzing' | 'done' | 'fallback'; message: string }
  | { type: 'sources'; urls: string[] }
  | { type: 'article'; article: LLMAnalysisArticle }
  | { type: 'market_context'; text: string }
  | { type: 'complete'; articles: LLMAnalysisArticle[]; market_context: string }
  | { type: 'error'; message: string }

// ===== 调用 Responses API（非流式）=====

export async function callResponsesAPI(
  input: string,
  instructions: string,
  options: ResponsesAPIOptions = {}
): Promise<ResponsesAPIBody> {
  const model = options.model || config.llm.model
  const timeout = options.timeout || config.llm.timeout
  const url = `${config.llm.baseUrl}/v1/responses`

  const body: ResponsesRequestBody = {
    model,
    input,
    instructions,
    tools: [{ type: 'web_search' }],
    tool_choice: { type: 'web_search' },
    text: {
      format: {
        type: 'json_schema',
        name: 'fund_news_analysis',
        strict: true,
        schema: fundNewsSchema,
      },
    },
    stream: false,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Responses API HTTP ${res.status}: ${errText.slice(0, 300)}`)
    }

    const json = (await res.json()) as ResponsesAPIBody

    // 检查 API 级别的错误返回（HTTP 200 但 body 含 error）
    if (json.error) {
      throw new Error(`Responses API error: ${json.error.message || JSON.stringify(json.error)}`)
    }

    return json
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Responses API timeout after ${timeout}ms`)
    }
    throw err
  }
}

// ===== 解析 Responses API 输出 =====
// response.output 是数组，包含两种类型的项：
// 1. web_search_call 项 -> action.sources (URL 列表)
// 2. message 项 -> content[].text (LLM 输出的 JSON 文本)

export function parseResponseOutput(response: ResponsesAPIBody): ParsedResponse {
  const output = response.output || []

  const sources: string[] = []
  let analysisText = ''

  for (const item of output) {
    if (item.type === 'web_search_call' && item.action?.sources) {
      for (const src of item.action.sources) {
        if (src.url) {
          sources.push(src.url)
        }
      }
    } else if (item.type === 'message' && item.content && item.content.length > 0) {
      // 取第一个含 text 的 content 项
      const textContent = item.content.find((c) => c.text)
      if (textContent?.text) {
        analysisText = textContent.text
      }
    }
  }

  if (!analysisText) {
    throw new Error('Responses API returned no message content to parse')
  }

  // 某些 LLM 会将 JSON 包裹在 markdown 代码块中，剥离后再解析
  let textToParse = analysisText.trim()
  if (textToParse.startsWith('```')) {
    textToParse = textToParse.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }

  let analysis: LLMAnalysis
  try {
    analysis = JSON.parse(textToParse) as LLMAnalysis
  } catch {
    throw new Error(`Failed to parse LLM analysis JSON: ${textToParse.slice(0, 300)}`)
  }

  // 防御性校验：确保 articles 是数组、market_context 是字符串
  if (!analysis.articles || !Array.isArray(analysis.articles)) {
    throw new Error('LLM analysis missing articles array')
  }
  if (typeof analysis.market_context !== 'string') {
    analysis.market_context = ''
  }

  return { sources, analysis }
}

// ===== 流式调用 Responses API =====
// SSE 事件序列（DeepSeek Responses API）:
//   response.created -> response.in_progress
//   -> response.web_search_call.in_progress/searching/completed (服务端联网搜索)
//   -> response.output_text.delta (LLM 输出增量，多次)
//   -> response.output_text.done
//   -> response.completed (携带完整 response)
//
// 策略：边收 SSE 边解析，向回调 emit StreamEvent
//   - web_search_call 状态 -> emit status(searching)
//   - output_text.delta 累积 -> 尝试增量解析出 article 对象 -> emit article
//   - response.completed -> 解析完整 JSON -> emit complete

export async function callResponsesAPIStream(
  input: string,
  instructions: string,
  onEvent: (event: StreamEvent) => void,
  options: ResponsesAPIOptions = {}
): Promise<void> {
  const model = options.model || config.llm.model
  const timeout = options.timeout || config.llm.timeout
  const url = `${config.llm.baseUrl}/v1/responses`

  const body: ResponsesRequestBody = {
    model,
    input,
    instructions,
    tools: [{ type: 'web_search' }],
    tool_choice: { type: 'web_search' },
    text: {
      format: {
        type: 'json_schema',
        name: 'fund_news_analysis',
        strict: true,
        schema: fundNewsSchema,
      },
    },
    stream: true,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Responses API HTTP ${res.status}: ${errText.slice(0, 300)}`)
    }

    if (!res.body) {
      throw new Error('Responses API returned no stream body')
    }

    // SSE 解析：按行读取，data: 开头的行是 JSON
    let accumulatedText = ''
    let emittedArticleCount = 0
    let allSources: string[] = []
    let webSearchStarted = false

    const decoder = new TextDecoder()
    let buffer = ''

    // node-fetch v2 的 res.body 是 NodeJS.ReadableStream
    const reader = (res.body as unknown as NodeJS.ReadableStream)
    
    await new Promise<void>((resolve, reject) => {
      reader.on('data', (chunk: Buffer) => {
        buffer += decoder.decode(chunk, { stream: true })
        
        // 按双换行分割 SSE 事件块
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // 保留最后不完整的行

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data:')) continue
          
          const dataStr = trimmed.slice(5).trim()
          if (dataStr === '[DONE]') {
            resolve()
            return
          }

          try {
            const evt = JSON.parse(dataStr) as { type: string; [key: string]: unknown }
            handleSSEEvent(evt)
          } catch {
            // 非 JSON 行跳过（如注释或空行）
          }
        }
      })

      reader.on('end', () => {
        // 处理 buffer 中剩余数据
        if (buffer.trim().startsWith('data:')) {
          const dataStr = buffer.trim().slice(5).trim()
          if (dataStr && dataStr !== '[DONE]') {
            try {
              const evt = JSON.parse(dataStr) as { type: string; [key: string]: unknown }
              handleSSEEvent(evt)
            } catch { /* ignore */ }
          }
        }
        resolve()
      })

      reader.on('error', (err: Error) => reject(err))

      function handleSSEEvent(evt: { type: string; [key: string]: unknown }) {
        switch (evt.type) {
          case 'response.web_search_call.in_progress':
          case 'response.web_search_call.searching': {
            if (!webSearchStarted) {
              webSearchStarted = true
              onEvent({ type: 'status', stage: 'searching', message: '正在联网搜索财经新闻...' })
            }
            break
          }
          case 'response.web_search_call.completed': {
            // 提取搜索来源 URL
            const item = evt.item as { action?: { sources?: WebSearchSource[] } } | undefined
            const sources = item?.action?.sources || []
            const urls = sources.map((s) => s.url).filter(Boolean)
            if (urls.length > 0) {
              allSources.push(...urls)
              onEvent({ type: 'sources', urls })
            }
            onEvent({ type: 'status', stage: 'analyzing', message: '搜索完成，正在归因分析...' })
            break
          }
          case 'response.output_text.delta': {
            const delta = (evt as { delta?: string }).delta || ''
            accumulatedText += delta
            // 尝试增量解析：从累积文本中提取已完成的 article 对象
            const newArticles = tryExtractNewArticles(accumulatedText, emittedArticleCount)
            for (const a of newArticles) {
              emittedArticleCount++
              onEvent({ type: 'article', article: a })
            }
            break
          }
          case 'response.output_text.done': {
            // 最终文本完成，尝试提取 market_context
            const ctx = tryExtractMarketContext(accumulatedText)
            if (ctx) {
              onEvent({ type: 'market_context', text: ctx })
            }
            break
          }
          case 'response.completed': {
            // 完整响应，解析最终 JSON
            const response = (evt as { response?: ResponsesAPIBody }).response
            if (response) {
              try {
                const parsed = parseResponseOutput(response)
                onEvent({
                  type: 'complete',
                  articles: parsed.analysis.articles,
                  market_context: parsed.analysis.market_context,
                })
              } catch (e) {
                // 如果完整解析失败，用累积文本兜底
                const analysis = parseAccumulatedText(accumulatedText)
                onEvent({
                  type: 'complete',
                  articles: analysis.articles,
                  market_context: analysis.market_context,
                })
              }
            } else {
              const analysis = parseAccumulatedText(accumulatedText)
              onEvent({
                type: 'complete',
                articles: analysis.articles,
                market_context: analysis.market_context,
              })
            }
            break
          }
          case 'response.failed': {
            const response = (evt as { response?: { error?: { message?: string } } }).response
            const msg = response?.error?.message || 'LLM 响应失败'
            onEvent({ type: 'error', message: msg })
            break
          }
        }
      }
    })

    // 如果没有收到 complete 事件，用累积文本兜底
    if (accumulatedText && emittedArticleCount === 0) {
      const analysis = parseAccumulatedText(accumulatedText)
      onEvent({
        type: 'complete',
        articles: analysis.articles,
        market_context: analysis.market_context,
      })
    }

    void allSources // sources 已在事件中发送
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Responses API stream timeout after ${timeout}ms`)
    }
    throw err
  }
  clearTimeout(timer)
}

// ===== 增量 JSON 解析辅助 =====
// LLM 输出的 JSON 结构: {"articles":[{...},{...}], "market_context":"..."}
// 流式 delta 是文本片段，需要从不完整的 JSON 中提取已完成的对象

function tryExtractNewArticles(accumulatedText: string, alreadyEmitted: number): LLMAnalysisArticle[] {
  const result: LLMAnalysisArticle[] = []
  // 尝试找到 articles 数组中的每个完整对象
  // 策略：用正则匹配 "articles":[ 后的对象，找平衡的大括号
  const articlesStart = accumulatedText.indexOf('"articles"')
  if (articlesStart === -1) return result

  const arrStart = accumulatedText.indexOf('[', articlesStart)
  if (arrStart === -1) return result

  // 从 arrStart 开始，找每个 { ... } 对象（大括号平衡）
  let pos = arrStart + 1
  let objCount = 0
  while (pos < accumulatedText.length) {
    const objStart = accumulatedText.indexOf('{', pos)
    if (objStart === -1) break

    // 找平衡的大括号
    let depth = 1
    let end = objStart + 1
    let inString = false
    let escape = false
    while (end < accumulatedText.length && depth > 0) {
      const ch = accumulatedText[end]
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = !inString
      } else if (!inString) {
        if (ch === '{') depth++
        else if (ch === '}') depth--
      }
      end++
    }

    if (depth !== 0) break // 大括号未闭合，对象不完整

    // 只有计数超过已发射数量时才解析
    if (objCount >= alreadyEmitted) {
      const objStr = accumulatedText.slice(objStart, end)
      try {
        const article = JSON.parse(objStr) as LLMAnalysisArticle
        if (article.title && article.date) {
          result.push(article)
        }
      } catch {
        // 解析失败跳过
      }
    }
    objCount++
    pos = end
  }
  return result
}

function tryExtractMarketContext(accumulatedText: string): string {
  // 尝试提取 "market_context":"..." 的值
  const match = accumulatedText.match(/"market_context"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  return match ? match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : ''
}

function parseAccumulatedText(text: string): LLMAnalysis {
  let textToParse = text.trim()
  if (textToParse.startsWith('```')) {
    textToParse = textToParse.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  try {
    const analysis = JSON.parse(textToParse) as LLMAnalysis
    if (!analysis.articles || !Array.isArray(analysis.articles)) {
      return { articles: [], market_context: '' }
    }
    if (typeof analysis.market_context !== 'string') {
      analysis.market_context = ''
    }
    return analysis
  } catch {
    return { articles: [], market_context: '' }
  }
}
