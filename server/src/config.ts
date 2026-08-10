// 后端配置：代理、端口、超时
// 用户本地开了翻墙，对境外 API（GDELT/Wikipedia/翻译）走 socks5h 代理
// socks5h 的 "h" = 让代理服务器做 DNS 解析，避免 DNS 污染导致的证书不匹配

export const config = {
  port: Number(process.env.PORT) || 8787,
  // socks5h 代理地址；可通过环境变量 PROXY_URL 覆盖
  proxyUrl: process.env.PROXY_URL || 'socks5h://127.0.0.1:1080',
  // 默认请求超时（ms）
  timeout: 30000,
  // LLM 配置：标准 OpenAI Responses API 协议（CC-Switch 透明转发到 DeepSeek 等）
  // 不走代理：LLM 服务国内直连或经 CC-Switch 本地转发
  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'deepseek-v4-flash',
    timeout: Number(process.env.LLM_TIMEOUT) || 60000,
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
