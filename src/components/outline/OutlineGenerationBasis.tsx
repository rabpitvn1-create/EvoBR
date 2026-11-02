import { AlertTriangle, BookOpenCheck, Loader2 } from 'lucide-react'
import { CONTEXT_SOURCE_BY_KEY } from '../../lib/registry/context-sources'
import type { AssembleContextResult } from '../../lib/registry/types'

function contextSourceLabel(key: string): string {
  return CONTEXT_SOURCE_BY_KEY.get(key)?.label ?? key
}

function contextExcerpt(assembled: AssembleContextResult, key: string, maxChars = 180): string {
  const index = assembled.included.indexOf(key)
  const content = index >= 0 ? assembled.segments[index]?.content ?? '' : ''
  const compact = content
    .replace(/^【[^】]+】\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (compact.length <= maxChars) return compact
  return `${compact.slice(0, maxChars)}...`
}

export default function OutlineGenerationBasis({
  context,
  loading,
  error,
}: {
  context: AssembleContextResult | null
  loading: boolean
  error: string
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted" data-testid="outline-basis-loading">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取本次生成依据...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 text-xs text-error" role="alert">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>生成依据读取失败：{error}</span>
      </div>
    )
  }

  if (!context) return null

  const storyCore = contextExcerpt(context, 'storyCore')
  const storyArcs = contextExcerpt(context, 'storyArcs')
  const existingVolumes = contextExcerpt(context, 'existingVolumeOutlines')
  const selectedFields = context.included.includes('ragSelection')

  return (
    <div className="space-y-2 text-xs" data-testid="outline-generation-basis">
      <div className="flex items-center gap-2 text-text-primary">
        <BookOpenCheck className="h-3.5 w-3.5 text-accent" />
        <span className="font-medium">本次生成依据</span>
        <span className="text-[10px] text-text-muted">
          约 {context.totalInputTokens.toLocaleString()} / {context.inputBudget.toLocaleString()} tokens
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5" aria-label="已读取来源">
        {context.included.map(key => (
          <span key={key} className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">
            {contextSourceLabel(key)}
          </span>
        ))}
        {context.included.length === 0 && <span className="text-warning">没有读取到已登记的作品资料</span>}
      </div>

      {storyCore ? (
        <p className="leading-5 text-text-secondary"><span className="text-text-muted">故事核心：</span>{storyCore}</p>
      ) : storyArcs ? (
        <p className="leading-5 text-text-secondary"><span className="text-text-muted">已确认故事线：</span>{storyArcs}</p>
      ) : selectedFields ? (
        <p className="leading-5 text-text-secondary">本次按需读取已确认的资料字段，可展开核对实际内容。</p>
      ) : (
        <p className="leading-5 text-warning">本次未读取故事核心或故事线，将依据上方资料与补充要求生成；这不代表作品中没有这些内容。</p>
      )}
      {selectedFields && <details className="rounded border border-border p-2">
        <summary className="cursor-pointer">查看本次读取的资料</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5">{context.text}</pre>
      </details>}
      {existingVolumes && (
        <p className="leading-5 text-text-secondary"><span className="text-text-muted">已有卷纲：</span>{existingVolumes}</p>
      )}

      {context.omitted.length > 0 && (
        <p className="text-text-muted">
          无可用内容：{context.omitted.map(contextSourceLabel).join('、')}
        </p>
      )}
      {context.trimmed.length > 0 && (
        <p className="text-warning">
          因模型上下文预算未发送：{context.trimmed.map(contextSourceLabel).join('、')}
        </p>
      )}
      <p className="text-text-muted">未采纳的灵感草稿不会进入生成上下文。</p>
    </div>
  )
}
