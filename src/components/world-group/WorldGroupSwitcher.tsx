/**
 * 世界切换器 — 面板顶部的世界组下拉选择器
 * 多世界模式下嵌入世界观/力量/地理/历史等面板的标题栏
 */
import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { WORLD_GROUP_TYPE_LABELS } from '../../lib/types/world-group'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

export default function WorldGroupSwitcher() {
  const { groups, activeGroupId, setActiveGroup } = useWorldGroupStore()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (groups.length <= 1) return null

  const active = groups.find(g => g.id === activeGroupId)

  const switchGroup = async (id: number) => {
    if (switching || id === activeGroupId) {
      setOpen(false)
      return
    }
    setSwitching(true)
    setSwitchError('')
    try {
      await flushPendingEditsV1()
      setActiveGroup(id)
      setOpen(false)
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : '当前编辑未能保存，已阻止切换世界。')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-border bg-bg-base text-text-secondary hover:border-accent/50 hover:text-text-primary transition-colors"
      >
        <span>{active?.icon || '🌐'}</span>
        <span className="max-w-[120px] truncate">{active?.name || '选择世界'}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-bg-surface border border-border rounded-lg shadow-lg z-30 overflow-hidden">
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => { void switchGroup(g.id!) }}
              disabled={switching}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                g.id === activeGroupId
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
            >
              <span className="text-base shrink-0">{g.icon || '🌐'}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{g.name}</div>
                <div className="text-[10px] text-text-muted">{WORLD_GROUP_TYPE_LABELS[g.type]}</div>
              </div>
              {g.id === activeGroupId && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              )}
            </button>
          ))}
          {switchError && (
            <div className="border-t border-border px-3 py-2 text-[11px] text-red-500" role="alert">
              {switchError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
