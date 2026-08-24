// AI 新闻分析抽屉：抽屉对照模式的核心组件
// 从右侧推出，占据 50% 宽度，展示多检索会话 + 真 token 流式报告
// 特性：多会话切换、思考折叠、Markdown 逐字流、来源列表、锚定、日期联动图表
// 多基金检索：检索范围由 App.tsx 的 newsTargetCodes 决定（FundList 顶部 chip 区），头部仅显示只读徽章
import { useState, useEffect, useRef } from 'react'
import type { NewsSession, ChatMessage } from '../types'
import type { AnchorNews } from '../storage'
import { makeStyles, type Palette } from '../theme'
import { useTheme } from '../ThemeContext'

interface FundOption {
  code: string
  name: string
}

interface Props {
  sessions: NewsSession[]
  activeSessionId: string | null
  onSwitchSession: (id: string) => void
  onRemoveSession: (id: string) => void
  onClose: () => void
  onAnchor: () => void
  anchors: AnchorNews[]
  // 点击报告中的日期 -> 联动图表高亮
  onHighlightDate: (date: string | null) => void
  // 【多基金检索】可选基金列表(用于头部只读徽章解析基金名)
  availableFunds?: FundOption[]
  // 【对话延伸】发送追问（基于当前会话报告）
  onSendChat?: (sessionId: string, question: string) => void
}

export function NewsDrawer({
  sessions,
  activeSessionId,
  onSwitchSession,
  onRemoveSession,
  onClose,
  onAnchor,
  anchors,
  onHighlightDate,
  availableFunds,
  onSendChat,
}: Props) {
  const { palette: p } = useTheme()
  const styles = makeStyles(p)
  const bodyRef = useRef<HTMLDivElement>(null)

  const active = sessions.find((s) => s.id === activeSessionId) || null

  // 流式输出时自动滚动到底部（报告生成中 或 对话生成中）
  const chatStreaming = !!active?.chat?.some((m) => m.loading)
  const lastChatContentLen = active?.chat?.length ? (active.chat[active.chat.length - 1].content.length) : 0
  useEffect(() => {
    if (bodyRef.current && (active?.loading || chatStreaming)) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [active?.outputText, active?.reasoning, active?.loading, chatStreaming, active?.chat?.length, lastChatContentLen])

  const isAnchored = active
    ? anchors.some((a) => a.date === active.date && a.fundCode === active.fundCode && a.text)
    : false
  // 【简述】LLM 报告开头必含 `**简述**` 标记，未出现说明报告未完整生成，禁止锚定
  const hasSummary = active ? active.outputText.includes('**简述**') : false
  const canAnchor = !!active && !!active.outputText && !active.loading && hasSummary

  return (
    <div style={{
      ...styles.card,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      height: '100%',
      boxShadow: `0 8px 32px rgba(0,0,0,0.18)`,
    }}>
      {/* 头部：标题 + 收起按钮（固定，保留会话状态） */}
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${p.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          <span style={{ ...styles.label }}>AI 新闻分析</span>
          {active && (
            <span style={{ fontSize: '11px', color: p.accent }}>
              {active.date} ±1天
            </span>
          )}
          {/* 多基金同步检索徽章: 同一批次有 ≥2 个 loading 会话时显示 */}
          {(() => {
            const multiCount = sessions.filter((s) => s.isMultiFundSession && s.loading).length
            if (multiCount < 2) return null
            return (
              <span
                style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: p.accent,
                  color: p.bg0,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
                title={`正在同步检索 ${multiCount} 支基金`}
              >
                <span style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: p.bg0,
                  animation: 'news-blink 1s steps(2) infinite',
                }} />
                ×{multiCount} 同步检索中
              </span>
            )
          })()}
          {/* 当前检索范围徽章(只读, 由 FundList 顶部 chip 区决定) */}
          {active && active.targetFundCodes && (
            <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '10px', background: p.accentSoft, color: p.accent, fontWeight: 600, border: `1px solid ${p.accent}33` }}>
              {active.targetFundCodes.length === 1
                ? `🔍 仅 ${availableFunds?.find(f => f.code === active.targetFundCodes![0])?.name || active.fundName || active.targetFundCodes![0]}`
                : `🔍 检索组合 (${active.targetFundCodes.length} 支)`}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: `1px solid ${p.border}`,
              color: p.text2,
              cursor: 'pointer',
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '4px',
              lineHeight: 1.2,
              fontWeight: 500,
            }}
            title="收起抽屉（保留会话，点击右侧展开分析恢复）"
          >
            收起 ▸
          </button>
        </div>
      </div>

      {/* 会话切换标签（固定） */}
      {sessions.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '4px',
          padding: '6px 8px',
          borderBottom: `1px solid ${p.border}`,
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  background: isActive ? p.bg3 : 'transparent',
                  border: `1px solid ${isActive ? p.accent : p.border}`,
                  fontSize: '10px',
                  color: isActive ? p.accent : p.text2,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
                onClick={() => onSwitchSession(s.id)}
              >
                <span>{s.date}</span>
                {s.loading && (
                  <span style={spinnerStyle(p.accent)} />
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveSession(s.id) }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: p.text2,
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '0 2px',
                    lineHeight: 1,
                  }}
                  title="移除此检索"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 主体：报告流（滚动区域） */}
      <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}>
        {active ? (
          <ReportFlow
            session={active}
            onHighlightDate={onHighlightDate}
            onSendChat={onSendChat}
          />
        ) : (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: p.text2, fontSize: '12px' }}>
            点击净值曲线任意点位<br />触发 AI 联网检索分析
          </div>
        )}
      </div>

      {/* Footer：锚定按钮（固定底部，不随内容滚动） */}
      {active && active.outputText && !active.loading && (
        <div style={{
          padding: '8px 12px',
          borderTop: `1px solid ${p.border}`,
          background: p.bg1,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '10px', color: p.text2 }}>
            {hasSummary
              ? `分析完成 · ${active.outputText.length} 字`
              : '报告中(等待简述标记出现)'}
          </span>
          <button
            onClick={onAnchor}
            disabled={isAnchored || !canAnchor}
            style={{
              background: isAnchored ? `${p.accent}22` : canAnchor ? p.accent : p.bg2,
              color: isAnchored ? p.accent : canAnchor ? p.bg0 : p.text2,
              border: `1px solid ${isAnchored ? p.accent : canAnchor ? p.accent : p.border}`,
              borderRadius: '4px',
              padding: '5px 14px',
              fontSize: '11px',
              cursor: isAnchored || !canAnchor ? 'default' : 'pointer',
              fontWeight: 600,
              opacity: canAnchor || isAnchored ? 1 : 0.6,
            }}
            title={!hasSummary ? '等待 LLM 输出 **简述** 标记' : '锚定此分析报告到净值点位'}
          >
            {isAnchored ? '✓ 已锚定' : '📍 锚定到图表'}
          </button>
        </div>
      )}
      <style>{`@keyframes drawer-slide-in { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes news-spin { to { transform: rotate(360deg); } } @keyframes news-blink { 50% { opacity: 0; } }`}</style>
    </div>
  )
}

// 【对话延伸】单条对话气泡：user 右对齐浅底，assistant 左对齐含思考折叠 + Markdown
function ChatBubble({
  msg,
  palette: p,
  onDateClick,
}: {
  msg: ChatMessage
  palette: Palette
  onDateClick: (date: string | null) => void
}) {
  const [showReasoning, setShowReasoning] = useState(false)

  if (msg.role === 'user') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          maxWidth: '88%',
          padding: '6px 10px',
          borderRadius: '10px 10px 2px 10px',
          background: p.accent,
          color: p.bg0,
          fontSize: '12px',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          fontWeight: 500,
        }}>
          {msg.content}
        </div>
      </div>
    )
  }

  // assistant
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '96%' }}>
      {/* 思考过程折叠 */}
      {msg.reasoning && (
        <div style={{
          borderRadius: '6px',
          background: p.bg3,
          border: `1px solid ${p.border}`,
          overflow: 'hidden',
        }}>
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            style={{
              width: '100%',
              padding: '4px 8px',
              background: 'transparent',
              border: 'none',
              color: p.text2,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '10px',
              fontWeight: 600,
            }}
          >
            <span>{msg.loading && !msg.content ? '思考中…' : '思考过程'}</span>
            <span>{showReasoning ? '▲' : '▼'}</span>
          </button>
          {showReasoning && (
            <div style={{
              padding: '6px 10px',
              borderTop: `1px solid ${p.border}`,
              fontSize: '10px',
              lineHeight: 1.6,
              color: p.text2,
              whiteSpace: 'pre-wrap',
              fontFamily: '"JetBrains Mono", monospace',
              maxHeight: 180,
              overflowY: 'auto',
            }}>
              {msg.reasoning}
            </div>
          )}
        </div>
      )}

      {/* 回答内容（Markdown） */}
      {(msg.content || msg.error) && (
        <div style={{
          padding: '8px 10px',
          borderRadius: '10px 10px 10px 2px',
          background: p.bg2,
          border: `1px solid ${p.border}`,
        }}>
          {msg.content ? (
            <MarkdownRenderer text={msg.content} palette={p} onDateClick={onDateClick} />
          ) : (
            <span style={{ fontSize: '12px', color: p.impactNegative }}>生成失败：{msg.error}</span>
          )}
          {msg.loading && msg.content && (
            <span style={{
              display: 'inline-block',
              width: '7px',
              height: '14px',
              background: p.accent,
              marginLeft: '2px',
              animation: 'news-blink 1s steps(2) infinite',
              verticalAlign: 'text-bottom',
            }} />
          )}
        </div>
      )}

      {/* 生成中且暂无内容：加载指示 */}
      {msg.loading && !msg.content && !msg.reasoning && (
        <div style={{
          padding: '8px 10px',
          borderRadius: '10px 10px 10px 2px',
          background: p.bg2,
          border: `1px solid ${p.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: p.accent,
        }}>
          <span style={spinnerStyle(p.accent)} />
          正在检索与思考…
        </div>
      )}
    </div>
  )
}

// 报告流：思考折叠 + 来源 + Markdown 逐字（不含锚定按钮，锚定在 footer）
// 【对话延伸】报告完成后下方提供多轮追问输入区
function ReportFlow({
  session,
  onHighlightDate,
  onSendChat,
}: {
  session: NewsSession
  onHighlightDate: (date: string | null) => void
  onSendChat?: (sessionId: string, question: string) => void
}) {
  const { palette: p } = useTheme()
  const [showReasoning, setShowReasoning] = useState(false)
  const [question, setQuestion] = useState('')
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const { reasoning, outputText, sources, sector, loading, status, error } = session

  // 有思考内容且加载中时自动展开
  useEffect(() => {
    if (reasoning && loading) setShowReasoning(true)
  }, [reasoning, loading])

  // 对话生成中自动聚焦输入框外，发送后清空输入
  const chatGenerating = !!session.chat?.some((m) => m.loading)
  const canChat = !!outputText && !loading && !chatGenerating && !!onSendChat

  const handleSend = () => {
    const q = question.trim()
    if (!q || !canChat) return
    onSendChat?.(session.id, q)
    setQuestion('')
  }

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  // 加载中且无任何内容：显示进度
  if (loading && !reasoning && !outputText) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        {status ? (
          <>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: p.accent,
              marginBottom: '8px',
            }}>
              <span style={spinnerStyle(p.accent)} />
              {status.message}
            </div>
            <StageIndicator stage={status.stage} palette={p} />
          </>
        ) : (
          <div style={{ fontSize: '12px', color: p.text2 }}>正在启动检索...</div>
        )}
      </div>
    )
  }

  if (error && !reasoning && !outputText) {
    return <div style={{ padding: '20px', textAlign: 'center', color: p.impactNegative, fontSize: '12px' }}>检索失败：{error}</div>
  }

  if (!reasoning && !outputText && !loading) {
    return <div style={{ padding: '20px', textAlign: 'center', color: p.text2, fontSize: '12px' }}>该时期暂无分析数据</div>
  }

  return (
    <div>
      {/* 基金领域标签 */}
      {sector && sector.sectors.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '10px', color: p.text2 }}>基金领域：</span>
          {sector.sectors.map((s) => (
            <span key={s} style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: p.accentDim, color: p.accent }}>
              {s}
            </span>
          ))}
        </div>
      )}

      {/* 思考过程（折叠区，逐字流式） */}
      {reasoning && (
        <div style={{
          margin: '4px 0 10px',
          borderRadius: '6px',
          background: p.bg3,
          border: `1px solid ${p.border}`,
          overflow: 'hidden',
        }}>
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            style={{
              width: '100%',
              padding: '8px 10px',
              background: 'transparent',
              border: 'none',
              color: p.text1,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '11px',
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {loading && !outputText ? (
                <span style={spinnerStyle(p.accent)} />
              ) : (
                <span style={{ color: p.accent }}>✓</span>
              )}
              思考过程
            </span>
            <span style={{ color: p.text2, fontSize: '10px' }}>
              {showReasoning ? '收起 ▲' : '展开 ▼'} · {reasoning.length} 字
            </span>
          </button>
          {showReasoning && (
            <div style={{
              padding: '8px 12px 10px',
              borderTop: `1px solid ${p.border}`,
              fontSize: '11px',
              lineHeight: 1.6,
              color: p.text2,
              whiteSpace: 'pre-wrap',
              fontFamily: '"JetBrains Mono", monospace',
            }}>
              {reasoning}
              {loading && !outputText && (
                <span style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '12px',
                  background: p.accent,
                  marginLeft: '2px',
                  animation: 'news-blink 1s steps(2) infinite',
                  verticalAlign: 'middle',
                }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* 搜索来源 URL */}
      {sources.length > 0 && (
        <div style={{ margin: '4px 0 10px', fontSize: '10px', color: p.text2 }}>
          <div style={{ marginBottom: '4px' }}>来源 ({sources.length})：</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {sources.slice(0, 8).map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ color: p.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                · {extractDomain(url) || url}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* 最终分析（Markdown 逐字流式渲染，日期可点击联动） */}
      {outputText && (
        <div style={{
          padding: '12px 14px',
          borderRadius: '6px',
          background: p.bg2,
          border: `1px solid ${p.border}`,
        }}>
          <MarkdownRenderer text={outputText} palette={p} onDateClick={onHighlightDate} />
          {loading && (
            <span style={{
              display: 'inline-block',
              width: '7px',
              height: '14px',
              background: p.accent,
              marginLeft: '2px',
              animation: 'news-blink 1s steps(2) infinite',
              verticalAlign: 'text-bottom',
            }} />
          )}
        </div>
      )}

      {/* 锚定按钮已移至抽屉 footer（固定底部） */}

      {/* 【对话延伸】基于报告的多轮追问区 */}
      {outputText && !loading && onSendChat && (
        <div style={{ margin: '12px 0 4px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
            paddingTop: '8px',
            borderTop: `1px solid ${p.border}`,
          }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: p.accent }}>💬 深入追问</span>
            <span style={{ fontSize: '10px', color: p.text2 }}>基于本报告继续对话，可联网检索新信息（Enter 发送 / Shift+Enter 换行）</span>
          </div>

          {/* 对话消息列表 */}
          {(session.chat || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
              {(session.chat || []).map((m, i) => (
                <ChatBubble key={i} msg={m} palette={p} onDateClick={onHighlightDate} />
              ))}
            </div>
          )}

          {/* 对话触发的 web_search 新来源 */}
          {(session.chatSources || []).length > 0 && (
            <div style={{ fontSize: '10px', color: p.text2, marginBottom: '8px' }}>
              <div style={{ marginBottom: '2px' }}>追问新来源 ({session.chatSources!.length})：</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                {session.chatSources!.slice(0, 5).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" style={{ color: p.text2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    · {extractDomain(url) || url}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 输入区 */}
          <div style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'flex-end',
            padding: '6px',
            borderRadius: '8px',
            background: p.bg2,
            border: `1px solid ${chatGenerating ? p.accent : p.border}`,
          }}>
            <textarea
              ref={chatInputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleChatKeyDown}
              placeholder={chatGenerating ? '回答生成中，请稍候...' : '例如：这条政策后续会如何影响该基金？'}
              rows={2}
              disabled={chatGenerating}
              style={{
                flex: 1,
                resize: 'none',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: p.text0,
                fontSize: '12px',
                lineHeight: 1.5,
                fontFamily: 'inherit',
                cursor: chatGenerating ? 'not-allowed' : 'text',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!canChat || !question.trim()}
              style={{
                background: canChat && question.trim() ? p.accent : p.bg3,
                color: canChat && question.trim() ? p.bg0 : p.text2,
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: canChat && question.trim() ? 'pointer' : 'default',
                whiteSpace: 'nowrap',
              }}
            >
              {chatGenerating ? '生成中…' : '发送'}
            </button>
          </div>
        </div>
      )}

      {/* 流式加载中：底部状态 */}
      {loading && (reasoning || outputText) && status && (
        <div style={{
          padding: '8px 4px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '11px',
          color: p.accent,
        }}>
          <span style={spinnerStyle(p.accent)} />
          {status.message}
        </div>
      )}
    </div>
  )
}

// ===== 轻量 Markdown 渲染器（支持日期联动点击）=====
// 支持：标题(#)、列表(-)、链接[...](...)、加粗**...**、段落
// 日期识别：YYYY-MM-DD 格式文本渲染为可点击标签，点击联动图表高亮
function MarkdownRenderer({ text, palette: p, onDateClick }: { text: string; palette: Palette; onDateClick: (date: string) => void }) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let key = 0

  const flushList = () => {
    if (listItems.length === 0) return
    elements.push(
      <ul key={key++} style={{ margin: '4px 0 8px', paddingLeft: '20px', lineHeight: 1.6 }}>
        {listItems.map((item, i) => (
          <li key={i} style={{ fontSize: '12px', color: p.text1, marginBottom: '3px' }}>
            {renderInline(item, p, onDateClick)}
          </li>
        ))}
      </ul>
    )
    listItems = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('### ')) {
      flushList()
      elements.push(<div key={key++} style={{ fontSize: '12px', fontWeight: 700, color: p.text0, margin: '8px 0 4px' }}>{renderInline(trimmed.slice(4), p, onDateClick)}</div>)
    } else if (trimmed.startsWith('## ')) {
      flushList()
      elements.push(<div key={key++} style={{ fontSize: '13px', fontWeight: 700, color: p.text0, margin: '10px 0 4px', paddingBottom: '3px', borderBottom: `1px solid ${p.border}` }}>{renderInline(trimmed.slice(3), p, onDateClick)}</div>)
    } else if (trimmed.startsWith('# ')) {
      flushList()
      elements.push(<div key={key++} style={{ fontSize: '14px', fontWeight: 700, color: p.text0, margin: '6px 0 6px' }}>{renderInline(trimmed.slice(2), p, onDateClick)}</div>)
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listItems.push(trimmed.slice(2))
    } else if (trimmed === '') {
      flushList()
    } else {
      flushList()
      elements.push(<div key={key++} style={{ fontSize: '12px', lineHeight: 1.6, color: p.text1, margin: '4px 0' }}>{renderInline(trimmed, p, onDateClick)}</div>)
    }
  }
  flushList()
  return <>{elements}</>
}

// 渲染行内元素：加粗、链接、日期标签（可点击联动）
function renderInline(text: string, p: Palette, onDateClick: (date: string) => void): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let remaining = text
  let key = 0
  // 日期正则：YYYY-MM-DD
  const dateRe = /\d{4}-\d{2}-\d{2}/

  while (remaining.length > 0) {
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/)
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/)
    const dateMatch = remaining.match(dateRe)

    const linkIdx = linkMatch ? remaining.indexOf(linkMatch[0]) : -1
    const boldIdx = boldMatch ? remaining.indexOf(boldMatch[0]) : -1
    const dateIdx = dateMatch ? dateMatch.index! : -1

    if (linkIdx === -1 && boldIdx === -1 && dateIdx === -1) {
      nodes.push(remaining)
      break
    }

    // 取最先出现的
    const candidates = [
      { idx: boldIdx, type: 'bold' as const },
      { idx: linkIdx, type: 'link' as const },
      { idx: dateIdx, type: 'date' as const },
    ].filter((c) => c.idx !== -1)
    candidates.sort((a, b) => a.idx - b.idx)
    const first = candidates[0]

    if (first.idx > 0) nodes.push(remaining.slice(0, first.idx))

    if (first.type === 'bold') {
      nodes.push(<strong key={key++} style={{ color: p.text0, fontWeight: 600 }}>{boldMatch![1]}</strong>)
      remaining = remaining.slice(first.idx + boldMatch![0].length)
    } else if (first.type === 'link') {
      nodes.push(
        <a key={key++} href={linkMatch![2]} target="_blank" rel="noopener noreferrer" style={{ color: p.accent, textDecoration: 'none' }}>
          {linkMatch![1]}
        </a>
      )
      remaining = remaining.slice(first.idx + linkMatch![0].length)
    } else {
      // 日期标签：可点击联动图表高亮
      const dateStr = dateMatch![0]
      nodes.push(
        <button
          key={key++}
          onClick={() => onDateClick(dateStr)}
          style={{
            background: p.accentDim,
            color: p.accent,
            border: 'none',
            borderRadius: '3px',
            padding: '0 4px',
            fontSize: '11px',
            fontFamily: '"JetBrains Mono", monospace',
            cursor: 'pointer',
            verticalAlign: 'baseline',
          }}
          title={`点击在图表上高亮 ${dateStr}`}
        >
          {dateStr}
        </button>
      )
      remaining = remaining.slice(first.idx + dateStr.length)
    }
  }
  return nodes
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname
  } catch {
    return ''
  }
}

// 阶段指示器
function StageIndicator({ stage, palette: p }: { stage: string; palette: Palette }) {
  const stages = [
    { key: 'searching', label: '搜索' },
    { key: 'analyzing', label: '分析' },
    { key: 'done', label: '完成' },
  ]
  const activeIdx = stages.findIndex((s) => s.key === stage)
  if (activeIdx === -1) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginTop: '6px' }}>
      {stages.map((s, i) => (
        <div
          key={s.key}
          style={{
            width: '28px',
            height: '3px',
            borderRadius: '2px',
            background: i <= activeIdx ? p.accent : p.border,
            transition: 'background 0.3s',
          }}
        />
      ))}
    </div>
  )
}

function spinnerStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    border: `2px solid ${color}`,
    borderTopColor: 'transparent',
    animation: 'news-spin 0.8s linear infinite',
  }
}
