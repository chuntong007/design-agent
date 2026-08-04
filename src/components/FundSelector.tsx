import React, { useState, useRef, useEffect } from 'react'
import { Search, Plus, X, TrendingUp, TrendingDown, Loader2, Layers } from 'lucide-react'
import type { Fund, FundSearchResult } from '../types'
import { fundApi } from '../api'
import { clsx } from 'clsx'
import { changeColor, formatSign } from './UI'

interface Props {
  funds: Fund[] // 已加载的基金
  loadingCodes: string[] // 正在加载的基金 code
  onAdd: (code: string) => void
  onRemove: (id: string) => void
  activeFundId: string
  onSetActive: (id: string) => void
}

export const FundSelector: React.FC<Props> = ({ funds, loadingCodes, onAdd, onRemove, activeFundId, onSetActive }) => {
  const [searchOpen, setSearchOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState<FundSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<any>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!keyword.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const list = await fundApi.search(keyword.trim())
        setResults(list)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
  }, [keyword])

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  const handleAdd = (item: FundSearchResult) => {
    onAdd(item.code)
    setSearchOpen(false)
    setKeyword('')
    setResults([])
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {funds.map((f) => {
          const active = activeFundId === f.id
          const m = f.metrics
          return (
            <div
              key={f.id}
              onClick={() => onSetActive(f.id)}
              className={clsx(
                'relative rounded-2xl p-4 cursor-pointer transition-all duration-300 border',
                active
                  ? 'bg-white border-brand-300 shadow-lg shadow-brand-100 ring-2 ring-brand-100'
                  : 'bg-white/60 border-slate-200/70 hover:border-slate-300 hover:shadow-md',
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(f.id)
                }}
                className="absolute top-3 right-3 w-5 h-5 rounded-md hover:bg-rose-50 flex items-center justify-center text-slate-300 hover:text-rose-500 transition-colors"
              >
                <X size={13} />
              </button>
              <div className="w-full h-1 rounded-full mb-3" style={{ backgroundColor: f.color }} />
              <div className="pr-6">
                <div className="text-xs text-slate-400 tabular-nums">{f.code}</div>
                <div className="text-sm font-semibold text-slate-800 truncate mt-0.5">{f.name}</div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{f.type}</div>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-lg font-bold tabular-nums text-slate-800">
                    {m.latestNav ? m.latestNav.toFixed(4) : '--'}
                  </div>
                  <div className={clsx('text-xs font-medium tabular-nums flex items-center gap-0.5', changeColor(m.latestGrowth))}>
                    {m.latestGrowth > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                    {m.latestGrowth ? formatSign(m.latestGrowth, '%') : '--'}
                  </div>
                </div>
                <div className="text-right">
                  <div className={clsx('text-xs font-medium tabular-nums', changeColor(m.totalReturn))}>
                    {m.totalReturn ? formatSign(m.totalReturn, '%') : '--'}
                  </div>
                  <div className="text-[10px] text-slate-400">区间收益</div>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Layers size={11} /> {m.scale || '--'}
                </span>
                <span className="truncate ml-2">{f.manager || '--'}</span>
              </div>
              {f.establishDate && (
                <div className="mt-1.5 text-[10px] text-slate-400">
                  成立于 {f.establishDate}
                </div>
              )}
            </div>
          )
        })}

        {loadingCodes.map((code) => (
          <div
            key={code}
            className="rounded-2xl p-4 border border-dashed border-brand-200 bg-brand-50/30 flex flex-col items-center justify-center min-h-[160px]"
          >
            <Loader2 size={20} className="animate-spin text-brand-400 mb-2" />
            <div className="text-xs text-brand-500 font-medium">{code}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">加载中...</div>
          </div>
        ))}

        {funds.length + loadingCodes.length < 6 && (
          <button
            onClick={() => setSearchOpen(true)}
            className="rounded-2xl p-4 border-2 border-dashed border-slate-200 hover:border-brand-300 hover:bg-brand-50/30 flex flex-col items-center justify-center min-h-[160px] text-slate-400 hover:text-brand-500 transition-all duration-300 group"
          >
            <div className="w-10 h-10 rounded-full bg-slate-100 group-hover:bg-brand-100 flex items-center justify-center mb-2 transition-colors">
              <Plus size={20} />
            </div>
            <div className="text-sm font-medium">添加基金</div>
            <div className="text-[11px] mt-0.5">搜索代码或名称</div>
          </button>
        )}
      </div>

      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 backdrop-blur-sm pt-[15vh] px-4 animate-fade-in"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <Search size={18} className="text-slate-400" />
                <input
                  ref={inputRef}
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="输入基金代码或名称，如 161725、白酒、易方达"
                  className="flex-1 outline-none text-sm text-slate-700 placeholder:text-slate-300"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && results[0]) handleAdd(results[0])
                    if (e.key === 'Escape') setSearchOpen(false)
                  }}
                />
                {searching && <Loader2 size={16} className="animate-spin text-brand-400" />}
                <button onClick={() => setSearchOpen(false)} className="text-slate-300 hover:text-slate-500">
                  <X size={18} />
                </button>
              </div>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              {results.length === 0 && keyword.trim() && !searching && (
                <div className="py-10 text-center text-sm text-slate-400">未找到相关基金，试试其他关键词</div>
              )}
              {!keyword.trim() && (
                <div className="py-10 text-center text-sm text-slate-400">输入基金代码或名称开始搜索</div>
              )}
              {results.map((r) => {
                const alreadyAdded = funds.some((f) => f.code === r.code)
                return (
                  <button
                    key={r.code}
                    onClick={() => handleAdd(r)}
                    disabled={alreadyAdded}
                    className={clsx(
                      'w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors text-left border-b border-slate-50',
                      alreadyAdded && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    <div>
                      <div className="text-sm font-medium text-slate-800">{r.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        <span className="tabular-nums">{r.code}</span>
                        {r.type && <span className="ml-2">{r.type}</span>}
                      </div>
                    </div>
                    {alreadyAdded ? (
                      <span className="text-xs text-slate-400">已添加</span>
                    ) : (
                      <Plus size={16} className="text-brand-400" />
                    )}
                  </button>
                )
              })}
            </div>
            <div className="px-4 py-2.5 bg-slate-50 text-xs text-slate-400 flex items-center justify-between">
              <span>数据来源：天天基金</span>
              <span>Enter 确认 · Esc 关闭</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
