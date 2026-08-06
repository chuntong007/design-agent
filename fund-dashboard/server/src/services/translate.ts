// 翻译服务：MyMemory 免费翻译 API（无需 key，走代理）
// 限制：每日约 5000 词，单次请求需 300ms 间隔
// 文档：https://mymemory.translated.net/doc/spec.php
import { httpGet } from '../utils/http'
import { cacheGet, cacheSet, sleep } from '../utils/cache'

// 全局串行锁，避免触发限流
let translateLock: Promise<unknown> = Promise.resolve()
function withTranslateLock<T>(task: () => Promise<T>): Promise<T> {
  const run = translateLock.then(task, task)
  translateLock = run.then(
    () => undefined,
    () => undefined
  )
  return run as Promise<T>
}

export async function translateText(text: string, from = 'en', to = 'zh-CN'): Promise<string> {
  if (!text || text.trim().length === 0) return ''
  // 中文直接返回
  if (/[\u4e00-\u9fa5]/.test(text) && from === 'en') {
    // 仅当文本中已有大量中文时跳过；否则仍翻译
  }

  const cacheKey = `translate:${from}:${to}:${text}`
  const cached = cacheGet<string>(cacheKey)
  if (cached) return cached

  const result = await withTranslateLock(async () => {
    // MyMemory 单次请求文本上限约 500 字节，分段处理
    const chunks = chunkText(text, 480)
    const translated: string[] = []
    for (const chunk of chunks) {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${from}|${to}`
      try {
        const resp = await httpGet(url, {
          useProxy: true,
          timeout: 15000,
          retries: 2,
          retryBase: 1000,
        })
        const json = JSON.parse(resp)
        const t = json?.responseData?.translatedText || ''
        translated.push(t)
      } catch (err) {
        // 翻译失败时保留原文
        translated.push(chunk)
      }
      await sleep(350)
    }
    return translated.join(' ')
  })

  cacheSet(cacheKey, result, 24 * 60 * 60 * 1000) // 翻译结果缓存 24 小时
  return result
}

function chunkText(text: string, maxBytes: number): string[] {
  // 按句子切分，避免破坏语义
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？]?/g) || [text]
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    const candidate = cur + s
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      if (cur) chunks.push(cur)
      cur = s
    } else {
      cur = candidate
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}
