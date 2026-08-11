// LLM 新闻归因分析：调用 Responses API（内置 web_search）检索并分析基金相关新闻
// 作为 searchNews 的优先路径，失败时由 news.ts 降级到 GDELT 链
//
// 【设计决策】采用自由 Markdown 文本输出 + 真 token 流式透传：
// - LLM 输出自由 Markdown 分析报告（不再强制 JSON）
// - reasoning.delta（思考）和 output_text.delta（分析）逐 token 透传给前端
// - 前端直接逐字渲染，实现 ChatGPT 式打字机效果
import { callResponsesAPI, callResponsesAPIStream, parseResponseOutput } from './llm'
import type { StreamEvent } from './llm'
import { cacheGet, cacheSet } from '../utils/cache'

export interface LLMNewsResult {
  // LLM 输出的自由 Markdown 分析全文
  text: string
  // 思考过程全文（reasoning，可能为空）
  reasoning: string
  // web_search 来源 URL
  sources: string[]
}

// 构建检索 + 分析的 prompt（自由 Markdown 输出）
function buildPrompt(date: string, sectors: string[], fundName?: string): { input: string; instructions: string } {
  const sectorText = sectors.length > 0 ? sectors.join('、') : '混合/宽基'

  const input = [
    `基金: ${fundName || '未知'}`,
    `领域: ${sectorText}`,
    `日期: ${date}`,
    '',
    `请检索 ${date} 前后 1 天内,影响"${sectorText}"领域的重大财经新闻。`,
    '',
    '请用中文撰写一份结构清晰的 Markdown 分析报告,包含以下部分:',
    '1. **市场概述** - 该时期市场整体环境概述(1-2 段)',
    '2. **重要新闻** - 列出 3-6 条相关新闻,每条包含:',
    '   - 新闻标题(附来源链接)',
    '   - 发布日期',
    '   - 影响判断:利好/利空/中性',
    '   - 一句话摘要',
    '   - 对该基金领域的影响原因',
    '3. **总结** - 综合判断对该基金的影响',
    '',
    '用 Markdown 标题(#)、列表(-)、加粗(**)等格式组织,让报告易读。',
    '新闻标题用 [标题](url) 的链接格式。影响判断用 emoji 标注:利好📈 利空📉 中性➖',
  ].join('\n')

  const instructions =
    '你是基金新闻归因分析师,擅长分析财经新闻对基金净值的影响。'
    + '使用 web_search 工具检索真实新闻,然后撰写一份专业的 Markdown 分析报告。'
    + '报告要基于真实检索到的新闻,不要编造。如果检索到的新闻较少,如实说明。'

  return { input, instructions }
}

// ===== 主入口：用 LLM + web_search 检索并归因分析新闻（非流式，降级用）=====

export async function searchNewsByLLM(
  date: string,
  sectors: string[],
  fundName?: string
): Promise<LLMNewsResult> {
  const cacheKey = `news-llm:${date}:${sectors.join(',')}`
  const cached = cacheGet<LLMNewsResult>(cacheKey)
  if (cached) return cached

  const { input, instructions } = buildPrompt(date, sectors, fundName)

  const response = await callResponsesAPI(input, instructions)
  const parsed = parseResponseOutput(response)

  const result: LLMNewsResult = {
    text: parsed.text,
    reasoning: parsed.reasoning,
    sources: parsed.sources,
  }
  cacheSet(cacheKey, result, 30 * 60 * 1000)
  return result
}

// ===== 流式版本：真 token 流透传，通过回调 emit 事件 =====
// onEvent: 接收 StreamEvent，由路由层转发为 SSE
// 返回最终结果（用于缓存）

export async function searchNewsByLLMStream(
  date: string,
  sectors: string[],
  fundName: string | undefined,
  onEvent: (event: StreamEvent) => void
): Promise<LLMNewsResult> {
  const cacheKey = `news-llm:${date}:${sectors.join(',')}`
  const cached = cacheGet<LLMNewsResult>(cacheKey)
  if (cached) {
    // 缓存命中：直接 emit complete
    onEvent({
      type: 'complete',
      text: cached.text,
      reasoning: cached.reasoning,
    })
    return cached
  }

  const { input, instructions } = buildPrompt(date, sectors, fundName)

  // 透传所有流式事件，同时收集最终结果用于缓存
  let finalText = ''
  let finalReasoning = ''
  const collectedSources: string[] = []

  await callResponsesAPIStream(
    input,
    instructions,
    (event) => {
      switch (event.type) {
        case 'sources':
          collectedSources.push(...event.urls)
          break
        case 'complete':
          finalText = event.text
          finalReasoning = event.reasoning
          break
        case 'reasoning_done':
          finalReasoning = event.text
          break
        case 'output_done':
          finalText = event.text
          break
      }
      onEvent(event)
    }
  )

  const result: LLMNewsResult = {
    text: finalText,
    reasoning: finalReasoning,
    sources: collectedSources,
  }
  cacheSet(cacheKey, result, 30 * 60 * 1000)
  return result
}
