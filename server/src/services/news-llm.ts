// LLM 新闻归因分析：调用 Responses API（内置 web_search）检索并分析基金相关新闻
// 作为 searchNews 的优先路径，失败时由 news.ts 降级到 GDELT 链
import { callResponsesAPI, callResponsesAPIStream, parseResponseOutput } from './llm'
import type { StreamEvent, LLMAnalysisArticle } from './llm'
import { cacheGet, cacheSet } from '../utils/cache'
import type { NewsArticle } from './news'

export interface LLMNewsResult {
  articles: NewsArticle[]
  market_context: string
}

// ===== 主入口：用 LLM + web_search 检索并归因分析新闻 =====
// date: 中心日期 YYYY-MM-DD
// sectors: 基金领域关键词（用于聚焦检索）
// fundName: 基金名称（可选，作为 prompt 上下文）
export async function searchNewsByLLM(
  date: string,
  sectors: string[],
  fundName?: string
): Promise<LLMNewsResult> {
  const cacheKey = `news-llm:${date}:${sectors.join(',')}`
  const cached = cacheGet<LLMNewsResult>(cacheKey)
  if (cached) return cached

  const sectorText = sectors.length > 0 ? sectors.join('、') : '混合/宽基'

  const input = [
    `基金: ${fundName || '未知'}`,
    `领域: ${sectorText}`,
    `日期: ${date}`,
    '',
    `请检索 ${date} 前后 7 天内,影响"${sectorText}"领域的重大财经新闻。`,
    '对每条新闻分析:摘要、影响(positive/negative/neutral)、影响原因、分类、相关度(0-1)、受影响领域。',
    '最后给出该时期市场整体环境概述。',
    '',
    '重要:你必须只输出纯 JSON,不要输出任何 Markdown 格式、标题、解释或额外文本。',
    'JSON 格式如下:',
    '{"articles":[{"title":"新闻标题","url":"来源URL","date":"YYYY-MM-DD","summary":"一句话摘要","impact":"positive|negative|neutral","impact_reason":"影响原因","category":"分类","relevance":0.0-1.0,"affected_sectors":["领域1"]}],"market_context":"市场整体概述"}',
  ].join('\n')

  const instructions =
    '你是基金新闻归因分析师,擅长分析财经新闻对基金净值的影响。使用 web_search 工具检索真实新闻,然后进行归因分析。'
    + '【输出格式要求】你必须只输出纯 JSON 对象,不要输出任何 Markdown 标题、代码块标记、解释文字或额外内容。'
    + '输出格式: {"articles":[...],"market_context":"..."}'

  const response = await callResponsesAPI(input, instructions)
  const { sources, analysis } = parseResponseOutput(response)

  // 将 LLM 输出的 articles 与 web_search 来源 URL 合并
  // LLM 输出的 url 可能不全，用 sources 列表补充缺失的 URL
  const remainingSources = [...sources]
  const articles: NewsArticle[] = analysis.articles.map((a) => {
    let url = a.url || ''
    if (!url && remainingSources.length > 0) {
      url = remainingSources.shift() || ''
    }
    return {
      title: a.title,
      url,
      date: a.date,
      domain: extractDomain(url),
      sourceCountry: '',
      language: /[\u4e00-\u9fa5]/.test(a.title) ? 'zh' : 'en',
      impact: a.impact,
      category: a.category,
      source: 'llm' as const,
      summary: a.summary,
      impact_reason: a.impact_reason,
      relevance: a.relevance,
      affected_sectors: a.affected_sectors,
    }
  })

  const result: LLMNewsResult = {
    articles,
    market_context: analysis.market_context,
  }
  cacheSet(cacheKey, result, 30 * 60 * 1000) // 30 分钟
  return result
}

// ===== 辅助：从 URL 提取域名 =====
function extractDomain(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname
  } catch {
    return ''
  }
}

// ===== 流式版本：边检索边输出，通过回调 emit 事件 =====
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
      articles: cached.articles.map((a) => ({
        title: a.title,
        url: a.url,
        date: a.date,
        summary: a.summary || '',
        impact: a.impact,
        impact_reason: a.impact_reason,
        category: a.category,
        relevance: a.relevance,
        affected_sectors: a.affected_sectors,
      })),
      market_context: cached.market_context,
    })
    return cached
  }

  const sectorText = sectors.length > 0 ? sectors.join('、') : '混合/宽基'

  const input = [
    `基金: ${fundName || '未知'}`,
    `领域: ${sectorText}`,
    `日期: ${date}`,
    '',
    `请检索 ${date} 前后 7 天内,影响"${sectorText}"领域的重大财经新闻。`,
    '对每条新闻分析:摘要、影响(positive/negative/neutral)、影响原因、分类、相关度(0-1)、受影响领域。',
    '最后给出该时期市场整体环境概述。',
    '',
    '重要:你必须只输出纯 JSON,不要输出任何 Markdown 格式、标题、解释或额外文本。',
    'JSON 格式如下:',
    '{"articles":[{"title":"新闻标题","url":"来源URL","date":"YYYY-MM-DD","summary":"一句话摘要","impact":"positive|negative|neutral","impact_reason":"影响原因","category":"分类","relevance":0.0-1.0,"affected_sectors":["领域1"]}],"market_context":"市场整体概述"}',
  ].join('\n')

  const instructions =
    '你是基金新闻归因分析师,擅长分析财经新闻对基金净值的影响。使用 web_search 工具检索真实新闻,然后进行归因分析。'
    + '【输出格式要求】你必须只输出纯 JSON 对象,不要输出任何 Markdown 标题、代码块标记、解释文字或额外内容。'
    + '输出格式: {"articles":[...],"market_context":"..."}'

  // 收集流式结果
  const collectedArticles: LLMAnalysisArticle[] = []
  let collectedContext = ''
  let collectedSources: string[] = []

  await callResponsesAPIStream(
    input,
    instructions,
    (event) => {
      switch (event.type) {
        case 'sources':
          collectedSources.push(...event.urls)
          break
        case 'article':
          collectedArticles.push(event.article)
          break
        case 'market_context':
          collectedContext = event.text
          break
        case 'complete':
          // 用 complete 事件的完整数据覆盖（防止增量解析遗漏）
          collectedArticles.length = 0
          collectedArticles.push(...event.articles)
          collectedContext = event.market_context
          break
      }
      onEvent(event)
    }
  )

  // 映射为 NewsArticle[]（与非流式版本逻辑一致）
  const remainingSources = [...collectedSources]
  const articles: NewsArticle[] = collectedArticles.map((a) => {
    let url = a.url || ''
    if (!url && remainingSources.length > 0) {
      url = remainingSources.shift() || ''
    }
    return {
      title: a.title,
      url,
      date: a.date,
      domain: extractDomain(url),
      sourceCountry: '',
      language: /[\u4e00-\u9fa5]/.test(a.title) ? 'zh' : 'en',
      impact: a.impact,
      category: a.category,
      source: 'llm' as const,
      summary: a.summary,
      impact_reason: a.impact_reason,
      relevance: a.relevance,
      affected_sectors: a.affected_sectors,
    }
  })

  const result: LLMNewsResult = {
    articles,
    market_context: collectedContext,
  }
  cacheSet(cacheKey, result, 30 * 60 * 1000)
  return result
}
