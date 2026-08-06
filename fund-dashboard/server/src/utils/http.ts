// HTTP 工具：按需走 socks5h 代理，支持超时、重试、GBK 解码
import fetch from 'node-fetch'
import { SocksProxyAgent } from 'socks-proxy-agent'
import iconv from 'iconv-lite'
import { config, shouldUseProxy } from '../config'
import { sleep } from './cache'

let proxyAgent: SocksProxyAgent | null = null
function getProxyAgent(): SocksProxyAgent {
  if (!proxyAgent) {
    proxyAgent = new SocksProxyAgent(config.proxyUrl)
  }
  return proxyAgent
}

export interface FetchOptions {
  headers?: Record<string, string>
  timeout?: number
  // 显式覆盖代理判断：true 强制走代理
  useProxy?: boolean
  // GBK 解码（腾讯行情）
  gbk?: boolean
  // 重试次数（不含首次）
  retries?: number
  // 重试间隔基数（ms），逐次递增
  retryBase?: number
}

export async function httpGet(url: string, opts: FetchOptions = {}): Promise<string> {
  const useProxy = opts.useProxy ?? shouldUseProxy(url)
  const agent = useProxy ? (getProxyAgent() as any) : undefined
  const timeout = opts.timeout ?? config.timeout
  const retries = opts.retries ?? 2
  const retryBase = opts.retryBase ?? 800

  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, {
        agent,
        headers: opts.headers,
        signal: controller.signal as any,
      })
      clearTimeout(timer)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`)
      }
      if (opts.gbk) {
        const buf = Buffer.from(await res.arrayBuffer())
        return iconv.decode(buf, 'gbk')
      }
      return await res.text()
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (attempt < retries) {
        await sleep(retryBase * (attempt + 1))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
