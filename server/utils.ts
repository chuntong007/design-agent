import nodeFetch from 'node-fetch'
import { SocksProxyAgent } from 'socks-proxy-agent'
import type { ApiResponse } from './types.js'

// ============ 统一响应包装 ============
export function ok<T>(data: T, message = 'success'): ApiResponse<T> {
  return { code: 0, message, data }
}
export function fail(message: string, code = 500): ApiResponse<null> {
  return { code, message, data: null }
}

type FetchOptions = {
  headers?: Record<string, string>
  method?: string
  body?: string
  __retried?: boolean
  [key: string]: unknown
}

// ============ 代理配置（自动检测环境变量中的 SOCKS/HTTP 代理） ============
// node-fetch 不会自动使用系统代理，需手动注入 agent
// socks5h:// 表示让代理服务器做 DNS 解析，避免本地 DNS 污染
let _proxyAgent: SocksProxyAgent | null | undefined = undefined // undefined=未初始化
function getProxyAgent(): SocksProxyAgent | null {
  if (_proxyAgent !== undefined) return _proxyAgent
  let proxyUrl = process.env.ALL_PROXY || process.env.all_proxy || process.env.HTTPS_PROXY || process.env.https_proxy || ''
  // 统一使用 socks5h:// 让代理解析 DNS，避免 DNS 污染导致 SSL 证书不匹配
  if (proxyUrl.startsWith('socks5://')) {
    proxyUrl = proxyUrl.replace('socks5://', 'socks5h://')
  }
  if (!proxyUrl) {
    _proxyAgent = null
    return null
  }
  try {
    const agent = new SocksProxyAgent(proxyUrl)
    _proxyAgent = agent
    console.log(`[proxy] 使用代理: ${proxyUrl}`)
    return agent
  } catch (e) {
    console.warn(`[proxy] 代理初始化失败: ${(e as Error).message}`)
    _proxyAgent = null
    return null
  }
}

// ============ fetch 封装（使用 node-fetch 以获得更好的 TLS 兼容性） ============
export async function fetchJson(url: string, options: FetchOptions = {}, timeoutMs = 12000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const agent = getProxyAgent()
    const res = await nodeFetch(url, {
      ...(options as Record<string, unknown>),
      signal: controller.signal,
      ...(agent ? { agent } : {}),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
        ...(options.headers || {}),
      },
    })
    const text = await res.text()
    return text
  } catch (e) {
    if (isTransientError(e) && !options.__retried) {
      await sleep(800)
      return fetchJson(url, { ...options, __retried: true }, timeoutMs)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function isTransientError(e: unknown): boolean {
  const m = ((e as Error)?.message || '').toLowerCase()
  return m.includes('socket hang up') || m.includes('econnreset') || m.includes('etimedout') || m.includes('fetch failed')
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ============ 并发限制器 ============
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      try {
        results[i] = await fn(items[i], i)
      } catch {
        results[i] = null
      }
    }
  })
  await Promise.all(workers)
  return results
}

// ============ 专门 fetch JSON API（带状态码检查） ============
export async function fetchJsonApi(url: string, options: FetchOptions = {}, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const agent = getProxyAgent()
    const res = await nodeFetch(url, {
      ...(options as Record<string, unknown>),
      signal: controller.signal,
      ...(agent ? { agent } : {}),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json,*/*',
        ...(options.headers || {}),
      },
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url.slice(0, 60)}`)
    }
    const text = await res.text()
    return text
  } finally {
    clearTimeout(timer)
  }
}

// ============ 简易内存缓存 ============
interface CacheEntry {
  v: unknown
  t: number
  ttl?: number
}
const cache = new Map<string, CacheEntry>()

export function cached<T>(key: string, ttlMs = 5 * 60 * 1000): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  const ttl = hit.ttl || ttlMs
  if (Date.now() - hit.t > ttl) return null
  return hit.v as T
}

export function setCache<T>(key: string, v: T, ttlMs?: number): void {
  cache.set(key, { v, t: Date.now(), ttl: ttlMs })
}

// ============ 日期工具 ============
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysAgoStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseDate(s: string): string | null {
  const m = s.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}
