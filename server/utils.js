// 统一响应包装
export function ok(data, message = 'success') {
  return { code: 0, message, data }
}
export function fail(message, code = 500) {
  return { code, message, data: null }
}

import nodeFetch from 'node-fetch'

// 带超时和重试的 fetch 封装（使用 node-fetch 以获得更好的 TLS 兼容性）
export async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await nodeFetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
        ...(options.headers || {}),
      },
    })
    const text = await res.text()
    return text
  } catch (e) {
    // socket hang up / ECONNRESET 等瞬时错误，自动重试一次
    if (isTransientError(e) && !options.__retried) {
      await sleep(800)
      return fetchJson(url, { ...options, __retried: true }, timeoutMs)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function isTransientError(e) {
  const m = (e.message || '').toLowerCase()
  return m.includes('socket hang up') || m.includes('econnreset') || m.includes('etimedout') || m.includes('fetch failed')
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// 并发限制器：限制同时执行的 Promise 数量
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      try {
        results[i] = await fn(items[i], i)
      } catch (e) {
        results[i] = null
      }
    }
  })
  await Promise.all(workers)
  return results
}

// 专门用于 fetch JSON API 的封装（带状态码检查）
export async function fetchJsonApi(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await nodeFetch(url, {
      ...options,
      signal: controller.signal,
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

// 简易内存缓存（5 分钟）
const cache = new Map()
export function cached(key, ttlMs = 5 * 60 * 1000) {
  const hit = cache.get(key)
  if (!hit) return null
  const ttl = hit.ttl || ttlMs
  if (Date.now() - hit.t > ttl) return null
  return hit.v
}
export function setCache(key, v, ttlMs) {
  cache.set(key, { v, t: Date.now(), ttl: ttlMs })
}

// 日期工具
export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function daysAgoStr(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parseDate(s) {
  // 支持 YYYY-MM-DD 或 YYYYMMDD
  const m = s.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/)
  if (!m) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}
