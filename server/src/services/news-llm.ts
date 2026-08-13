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
// 单基金与多基金共用入口，根据 funds 数量走不同指令
function buildPrompt(
  date: string,
  funds: Array<{ code: string; name: string; sectors: string[] }>,
): { input: string; instructions: string } {
  const isMulti = funds.length > 1

  // ===== 单基金分支（保持与原行为完全一致） =====
  if (!isMulti) {
    const f = funds[0] || { code: '', name: '', sectors: [] }
    const sectorText = f.sectors.length > 0 ? f.sectors.join('、') : '混合/宽基'

    const input = [
      `基金: ${f.name || '未知'}`,
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
      + '\n\n【报告开头格式要求】在撰写任何标题或正文之前,首先在报告最开头单独输出一行简述,格式严格如下:'
      + '\n**简述**: <4-8个汉字概括本次分析的核心影响>'
      + '\n- 简述必须基于真实检索到的新闻内容提炼,不得编造'
      + '\n- 字数严格控制在 4-8 个汉字之间(不含"简述"二字和标点)'
      + '\n- 示例: "白酒回调"、"半导体利好"、"新能源震荡"、"蓝筹回暖"、"政策面利好"'
      + '\n- 这一行必须出现在报告的最顶部,位于第一个 # 标题之前'

    return { input, instructions }
  }

  // ===== 多基金分支（跨行业关联分析） =====
  const fundLines = funds
    .map((f) => {
      const sectors = f.sectors.length > 0 ? f.sectors.join('、') : '混合/宽基'
      return `- ${f.name || '未知'} (${f.code}) - 领域: ${sectors}`
    })
    .join('\n')

  const input = [
    `基金组合(共 ${funds.length} 支):`,
    fundLines,
    '',
    `日期: ${date}`,
    '',
    `请综合检索影响这些领域在 ${date} 前后 1 天内的重大财经新闻,`,
    '重点关注**行业间关联**:',
    '- **板块共振**: 多支基金同时受同一条新闻影响',
    '- **资金跷跷板**: 资金从 A 板块流向 B 板块时对各基金的差异化影响',
    '- **政策传导链**: 政策事件如何依次传导到不同行业',
    '- **风险传染**: 单一利空如何扩散到关联行业',
    '',
    '报告结构:',
    '1. **简述**: <6-10字概括多基金联动特征,例"白酒半导体分化"、"蓝筹共振回暖"',
    '2. **市场整体环境**: 1-2 段宏观背景(说明当下是普涨/普跌/分化)',
    '3. **跨行业新闻** (重点): 列出 3-6 条新闻,每条包含:',
    '   - 新闻标题(附来源链接)',
    '   - 发布日期',
    '   - 影响基金清单: 在末尾标注 `(影响: 005827, 161725)` 或 `(影响: 全部)`',
    '   - 影响程度: 强/中/弱',
    '   - 一句话摘要',
    '   - 行业间关联说明',
    '4. **逐基金影响判断**: 对每支基金单独给出"利好📈/利空📉/中性➖"+ 一句话原因',
    '   格式: `- **{name} ({code})**: 📈 一句话原因`',
    '5. **总结**: 综合判断组合的协同/对冲效应',
    '',
    '用 Markdown 标题(#)、列表(-)、加粗(**)等格式组织,让报告易读。',
    '新闻标题用 [标题](url) 的链接格式。emoji 标注:利好📈 利空📉 中性➖',
  ].join('\n')

  const instructions =
    '你是多基金组合的新闻关联研判分析师,擅长从跨行业视角分析新闻事件对基金组合的协同影响。'
    + '特别关注:板块共振、资金跷跷板、政策传导链、风险传染。'
    + '使用 web_search 工具检索真实新闻,然后撰写跨基金关联分析报告。'
    + '报告要基于真实检索到的新闻,不要编造。如果检索到的新闻较少,如实说明。'
    + '\n\n【报告开头格式要求】在撰写任何标题或正文之前,首先在报告最开头单独输出一行简述,格式严格如下:'
    + '\n**简述**: <6-10个汉字概括本次分析的核心影响>'
    + '\n- 简述必须基于真实检索到的新闻内容提炼,不得编造'
    + '\n- 字数严格控制在 6-10 个汉字之间(不含"简述"二字和标点)'
    + '\n- 示例: "白酒回调"、"半导体利好"、"新能源震荡"、"蓝筹回暖"、"政策面利好"'
    + '\n- 多基金场景示例: "白酒半导体分化"、"蓝筹共振回暖"、"消费科技同跌"'
    + '\n- 这一行必须出现在报告的最顶部,位于第一个 # 标题之前'

  return { input, instructions }
}

// ===== 主入口：用 LLM + web_search 检索并归因分析新闻（非流式，降级用）=====

export async function searchNewsByLLM(
  date: string,
  funds: Array<{ code: string; name: string; sectors: string[] }>,
): Promise<LLMNewsResult> {
  // 缓存 key 用 code 列表（排序），避免不同基金但同领域串台
  const cacheKey = `news-llm:${date}:${funds.map((f) => f.code).sort().join(',')}`
  const cached = cacheGet<LLMNewsResult>(cacheKey)
  if (cached) return cached

  const { input, instructions } = buildPrompt(date, funds)

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
  funds: Array<{ code: string; name: string; sectors: string[] }>,
  onEvent: (event: StreamEvent) => void
): Promise<LLMNewsResult> {
  // 缓存 key 用 code 列表（排序），避免不同基金但同领域串台
  const cacheKey = `news-llm:${date}:${funds.map((f) => f.code).sort().join(',')}`
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

  const { input, instructions } = buildPrompt(date, funds)

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
