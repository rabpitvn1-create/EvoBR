import { Check, X } from 'lucide-react'
import { useRef, useState } from 'react'

export default function OutlinePreviewPanel({
  label,
  items,
  onConfirm,
  onCancel,
  canConfirm = true,
  disabledReason,
}: {
  label: string
  items: { title: string; summary: string }[]
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  canConfirm?: boolean
  disabledReason?: string
}) {
  const pending = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const handleConfirm = async () => {
    if (pending.current || !canConfirm) return
    pending.current = true
    setSaving(true)
    setError('')
    try { await onConfirm() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '写入失败，请重试。') }
    finally { pending.current = false; setSaving(false) }
  }
  return (
    <div className="border border-accent/50 rounded-lg overflow-hidden">
      <div className="flex flex-wrap gap-2 items-center justify-between px-3 py-2 bg-accent/10">
        <span className="text-sm font-medium text-accent">{label}</span>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={saving}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-primary rounded transition-colors">
            <X className="w-3 h-3" /> 取消
          </button>
          <button onClick={() => { void handleConfirm() }} disabled={!canConfirm || saving}
            className="flex items-center gap-1 px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            <Check className="w-3 h-3" /> {saving ? '正在写入…' : canConfirm ? '确认写入' : (disabledReason ?? '缺少 durable 候选')}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="px-3 py-2 text-xs text-error">{error}</p>}
      <div className="divide-y divide-border max-h-60 overflow-y-auto">
        {items.map((item, index) => (
          <div key={`${item.title}:${index}`} className="px-3 py-2 bg-bg-surface">
            <div className="text-sm font-medium text-text-primary">{item.title}</div>
            {item.summary && (
              <div className="text-sm leading-6 whitespace-pre-wrap break-words text-text-secondary mt-1">{item.summary}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
