// 简易内存缓存：带 TTL，避免重复请求触发限流
// GDELT 限流严重（连续 2-3 次即 429），缓存是刚需

interface CacheEntry<T> {
  value: T
  expireAt: number
}

const store = new Map<string, CacheEntry<unknown>>()

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expireAt) {
    store.delete(key)
    return undefined
  }
  return entry.value as T
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expireAt: Date.now() + ttlMs })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
