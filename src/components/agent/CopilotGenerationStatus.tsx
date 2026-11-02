import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

/** Visible waiting and cancellation for the same durable field-generation run. */
export default function CopilotGenerationStatus({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  const [seconds, setSeconds] = useState(0)
  const [stopped, setStopped] = useState(false)
  useEffect(() => {
    if (!busy) return
    setSeconds(0)
    setStopped(false)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])
  if (!busy && !stopped) return null
  return <div className="my-3 flex flex-wrap items-center gap-3 rounded border border-accent/20 p-3 text-xs">
    <p role="status" className="flex items-center gap-2">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {stopped ? busy ? '正在停止…' : '已停止，未自动重试。' : `正在准备或生成候选 · ${seconds} 秒`}
    </p>
    {busy && <button type="button" disabled={stopped} className="text-accent disabled:opacity-50" onClick={() => { setStopped(true); onStop() }}>停止本次生成</button>}
  </div>
}
