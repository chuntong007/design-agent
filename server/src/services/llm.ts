// LLM 客户端：标准 OpenAI Responses API 协议（内置 web_search 工具）
// 经 CC-Switch 透明转发到 DeepSeek 等兼容端点，不走代理（国内直连或本地转发）
//
// 【设计决策】采用自由 Markdown 文本输出 + 真 token 流式透传：
// - 移除 json_schema 强制结构化输出，让 reasoning.delta / output_text.delta
//   可以原样逐 token 透传给前端，实现 ChatGPT 式打字机效果
// - 启用 reasoning（如模型支持），透传思考过程
// - 结构化数据降级为前端从 Markdown 解析，或作为附属提取
import fetch from 'node-fetch'
import { config } from '../config'

// ===== 请求/响应类型定义 =====

interface ResponsesRequestBody {
  model?: string // 可选：为空时省略，由 CC-Switch 默认模型决定
  input: string
  instructions: string
  tools: Array<{ type: string }>
  tool_choice?: { type: string }
  // 自由文本输出：不指定 text.format，让 LLM 输出自然 Markdown
  reasoning?: {
    effort?: 'minimal' | 'low' | 'medium' | 'high'
    summary?: 'auto' | 'concise' | 'detailed'
  }
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
  // reasoning 内容（部分 API 把思考放在 output item 的 summary 里）
  summary?: Array<{ type: string; text?: string }>
}

export interface ResponsesAPIBody {
  id?: string
  object?: string
  model?: string
  output?: ResponseOutputItem[]
  // 部分 API 在顶层暴露 reasoning
  reasoning?: {
    content?: Array<{ type: string; text?: string }>
    summary?: Array<{ type: string; text?: string }>
  }
  error?: {
    message: string
    type?: string
    code?: string
  }
}

// ===== 导出的类型 =====
//
// 历史类型保留（兼容 news-llm.ts 旧引用），新流程以自由文本为主
// articles 由前端从 Markdown 提取，此处仅作兜底

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
  text: string // 自由 Markdown 文本（取代旧 analysis 为主输出）
  reasoning: string // 思考过程文本
  analysis: LLMAnalysis // 兜底：尝试从文本提取的结构化数据（可能为空）
}

export interface ResponsesAPIOptions {
  model?: string
  timeout?: number
}

// ===== 流式事件类型（转发给前端 SSE）=====
//
// 真 token 流：每个 delta 立即透传，不在服务端累积解析
export type StreamEvent =
  | { type: 'status'; stage: 'searching' | 'analyzing' | 'done' | 'fallback'; message: string }
  | { type: 'sources'; urls: string[] }
  | { type: 'reasoning_delta'; text: string } // 思考过程增量（逐 token）
  | { type: 'reasoning_done'; text: string } // 思考完成（完整文本）
  | { type: 'output_delta'; text: string } // 最终分析增量（逐 token，Markdown）
  | { type: 'output_done'; text: string } // 最终分析完成（完整 Markdown）
  | { type: 'complete'; text: string; reasoning: string } // 全部完成
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
    // 模型由 CC-Switch 默认配置决定；仅在显式配置时才发送 model 字段
    ...(model ? { model } : {}),
    input,
    instructions,
    tools: [{ type: 'web_search' }],
    tool_choice: { type: 'web_search' },
    reasoning: { effort: 'medium', summary: 'auto' },
    stream: false,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (config.llm.apiKey) {
      headers.Authorization = `Bearer ${config.llm.apiKey}`
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Responses API HTTP ${res.status}: ${errText.slice(0, 300)}`)
    }

    const json = (await res.json()) as ResponsesAPIBody

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

// ===== 解析 Responses API 输出（自由文本模式）=====
// response.output 数组可能包含：
// 1. web_search_call 项 -> action.sources (URL 列表)
// 2. reasoning 项 -> summary[].text (思考摘要，可选)
// 3. message 项 -> content[].text (LLM 输出的 Markdown 文本)

export function parseResponseOutput(response: ResponsesAPIBody): ParsedResponse {
  const output = response.output || []

  const sources: string[] = []
  let reasoningText = ''
  let outputText = ''

  for (const item of output) {
    if (item.type === 'web_search_call' && item.action?.sources) {
      for (const src of item.action.sources) {
        if (src.url) {
          sources.push(src.url)
        }
      }
    } else if (item.type === 'reasoning') {
      if (item.summary && item.summary.length > 0) {
        reasoningText = item.summary
          .map((s) => s.text || '')
          .filter(Boolean)
          .join('\n')
      }
    } else if (item.type === 'message' && item.content && item.content.length > 0) {
      const textContent = item.content.find((c) => c.text)
      if (textContent?.text) {
        outputText = textContent.text
      }
    }
  }

  // 兜底：顶层 reasoning
  if (!reasoningText && response.reasoning?.summary) {
    reasoningText = response.reasoning.summary
      .map((s) => s.text || '')
      .filter(Boolean)
      .join('\n')
  }
  if (!reasoningText && response.reasoning?.content) {
    reasoningText = response.reasoning.content
      .map((s) => s.text || '')
      .filter(Boolean)
      .join('\n')
  }

  if (!outputText) {
    throw new Error('Responses API returned no message content to parse')
  }

  return {
    sources,
    text: outputText,
    reasoning: reasoningText,
    analysis: tryExtractArticlesFromMarkdown(outputText),
  }
}

// 兼容兜底：尝试从 Markdown 提取结构化 articles
// 自由文本模式下不保证结构化数据，仅当 LLM 在 Markdown 中嵌入 JSON 块时提取
function tryExtractArticlesFromMarkdown(text: string): LLMAnalysis {
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (jsonBlockMatch) {
    try {
      const analysis = JSON.parse(jsonBlockMatch[1].trim()) as LLMAnalysis
      if (analysis.articles && Array.isArray(analysis.articles)) {
        if (typeof analysis.market_context !== 'string') {
          analysis.market_context = ''
        }
        return analysis
      }
    } catch {
      // ignore
    }
  }
  return { articles: [], market_context: '' }
}

// ===== 流式调用 Responses API =====
// SSE 事件序列（OpenAI Responses API）:
//   response.created -> response.in_progress
//   -> response.reasoning.delta (思考增量，多次) ← 透传
//   -> response.reasoning.done (思考完成)
//   -> response.web_search_call.in_progress/searching/completed (联网搜索)
//   -> response.output_text.delta (LLM 输出增量，多次) ← 直接透传
//   -> response.output_text.done
//   -> response.completed (携带完整 response)
//
// 策略：真 token 流透传
//   - reasoning.delta -> emit reasoning_delta（逐 token 透传思考）
//   - output_text.delta -> emit output_delta（逐 token 透传分析）
//   - response.completed -> emit complete（携带完整文本）
//
// 兼容性：部分兼容端点可能用 reasoning_summary.delta（较新命名）
// 或 DeepSeek 的 reasoning_content.delta，统一兼容

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
    // 模型由 CC-Switch 默认配置决定；仅在显式配置时才发送 model 字段
    ...(model ? { model } : {}),
    input,
    instructions,
    tools: [{ type: 'web_search' }],
    tool_choice: { type: 'web_search' },
    reasoning: { effort: 'medium', summary: 'auto' },
    stream: true,
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    // 构建请求头：CC-Switch 模式下不需要 Authorization
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (config.llm.apiKey) {
      headers.Authorization = `Bearer ${config.llm.apiKey}`
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
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

    // SSE 解析
    let accumulatedReasoning = ''
    let accumulatedOutput = ''
    let allSources: string[] = []
    let webSearchStarted = false

    const decoder = new TextDecoder()
    let buffer = ''

    // node-fetch v2 的 res.body 是 NodeJS.ReadableStream
    const reader = (res.body as unknown as NodeJS.ReadableStream)
    
    await new Promise<void>((resolve, reject) => {
      reader.on('data', (chunk: Buffer) => {
        const text = decoder.decode(chunk, { stream: true })
        buffer += text
        
        // 按双换行分割 SSE 事件块（兼容 \n\n 和 \r\n\r\n）
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop() || '' // 保留最后不完整的块

        for (const block of blocks) {
          const lines = block.split(/\r?\n/)
          let eventType = ''
          let dataStr = ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('event:')) {
              eventType = trimmed.slice(6).trim()
            } else if (trimmed.startsWith('data:')) {
              dataStr += trimmed.slice(5).trim()
            }
          }
          
          if (!dataStr) continue
          if (dataStr === '[DONE]') {
            resolve()
            return
          }

          try {
            const evt = JSON.parse(dataStr) as { type: string; [key: string]: unknown }
            const evtType = eventType || evt.type
            handleSSEEvent({ ...evt, type: evtType })
          } catch {
            // 非 JSON 行跳过
          }
        }
      })

      reader.on('end', () => {
        if (buffer.trim()) {
          const lines = buffer.split(/\r?\n/)
          let dataStr = ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              dataStr += trimmed.slice(5).trim()
            }
          }
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
        console.error(`[llm-stream] event: ${evt.type}`)
        switch (evt.type) {
          // ===== 思考过程（reasoning）逐 token 透传 =====
          case 'response.reasoning.delta':
          case 'response.reasoning_summary.delta': {
            const delta = (evt as { delta?: string }).delta || ''
            if (delta) {
              accumulatedReasoning += delta
              onEvent({ type: 'reasoning_delta', text: delta })
            }
            break
          }
          case 'response.reasoning.done':
          case 'response.reasoning_summary.done': {
            // 部分 API 在 done 事件携带完整 summary
            const item = evt as { item?: { summary?: Array<{ text?: string }> } }
            const fullText = item.item?.summary
              ? item.item.summary.map((s) => s.text || '').filter(Boolean).join('\n')
              : accumulatedReasoning
            if (fullText && fullText !== accumulatedReasoning) {
              accumulatedReasoning = fullText
            }
            onEvent({ type: 'reasoning_done', text: accumulatedReasoning })
            break
          }

          // ===== 联网搜索 =====
          case 'response.web_search_call.in_progress':
          case 'response.web_search_call.searching': {
            if (!webSearchStarted) {
              webSearchStarted = true
              onEvent({ type: 'status', stage: 'searching', message: '正在联网搜索财经新闻...' })
            }
            break
          }
          case 'response.web_search_call.completed': {
            const item = evt as { item?: { action?: { sources?: WebSearchSource[] } } } | undefined
            const sources = (item as { item?: { action?: { sources?: WebSearchSource[] } } })?.item?.action?.sources || []
            const urls = sources.map((s) => s.url).filter(Boolean)
            if (urls.length > 0) {
              allSources.push(...urls)
              onEvent({ type: 'sources', urls })
            }
            onEvent({ type: 'status', stage: 'analyzing', message: '搜索完成，正在撰写分析...' })
            break
          }

          // ===== 最终输出（自由 Markdown，逐 token 透传）=====
          case 'response.output_text.delta': {
            const delta = (evt as { delta?: string }).delta || ''
            if (delta) {
              accumulatedOutput += delta
              onEvent({ type: 'output_delta', text: delta })
            }
            break
          }
          case 'response.output_text.done': {
            onEvent({ type: 'output_done', text: accumulatedOutput })
            break
          }

          // ===== 完成 =====
          case 'response.completed': {
            const response = (evt as { response?: ResponsesAPIBody }).response
            console.error(`[llm-stream] completed, has response: ${!!response}, reasoning len: ${accumulatedReasoning.length}, output len: ${accumulatedOutput.length}`)

            let finalText = accumulatedOutput
            let finalReasoning = accumulatedReasoning
            if (response) {
              try {
                const parsed = parseResponseOutput(response)
                if (!finalText && parsed.text) finalText = parsed.text
                if (!finalReasoning && parsed.reasoning) finalReasoning = parsed.reasoning
              } catch (e) {
                console.error(`[llm-stream] parseResponseOutput failed: ${(e as Error).message}`)
              }
            }

            onEvent({
              type: 'complete',
              text: finalText,
              reasoning: finalReasoning,
            })
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

    // 兜底：如果完整事件未触发但有输出，补发 complete
    if (accumulatedOutput && !webSearchStarted) {
      onEvent({
        type: 'complete',
        text: accumulatedOutput,
        reasoning: accumulatedReasoning,
      })
    }

    void allSources
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Responses API stream timeout after ${timeout}ms`)
    }
    throw err
  }
  clearTimeout(timer)
}

