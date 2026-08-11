// 后端配置：代理、端口、超时
// 用户本地开了翻墙，对境外 API（GDELT/Wikipedia/翻译）走 socks5h 代理
// socks5h 的 "h" = 让代理服务器做 DNS 解析，避免 DNS 污染导致的证书不匹配

// LLM 配置：通过 CC-Switch 本地代理转发，认证由 CC-Switch 完成
// 后端不需要配置任何 API Key，只需发请求到 CC-Switch 地址
// CC-Switch 接收标准 OpenAI 请求，注入正确 Authorization 转发到 DeepSeek
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://127.0.0.1:15721'

export const config = {
  port: Number(process.env.PORT) || 8787,
  // socks5h 代理地址；可通过环境变量 PROXY_URL 覆盖
  proxyUrl: process.env.PROXY_URL || 'socks5h://127.0.0.1:1080',
  // 默认请求超时（ms）
  timeout: 30000,
  // LLM 配置：标准 OpenAI Responses API 协议（经 CC-Switch 透明转发）
  // 认证由 CC-Switch 完成，后端不需要 apiKey
  llm: {
    // 运行时 getter：支持热切换环境变量，不缓存启动时的值
    get baseUrl() { return process.env.LLM_BASE_URL || LLM_BASE_URL },
    get apiKey() { return process.env.LLM_API_KEY || '' },
    get model() { return process.env.LLM_MODEL || 'deepseek-v4-flash' },
    get timeout() { return Number(process.env.LLM_TIMEOUT) || 60000 },
  },
}

// 需要走代理的境外域名
export const PROXIED_HOSTS = [
  'api.gdeltproject.org',
  'en.wikipedia.org',
  'api.mymemory.translated.net',
]

export function shouldUseProxy(url: string): boolean {
  return PROXIED_HOSTS.some((h) => url.includes(h))
}
