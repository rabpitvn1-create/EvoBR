import { useState, useCallback, useRef, useEffect } from 'react'
import type { BlockChoice, ChunkedGenerationProgress, ChunkedGenerationResult } from '../../lib/outline/chunked-generator'
import { runChunkedOutlineGeneration } from '../../lib/outline/chunked-generator'
import type { ChunkedGenerationConfig } from '../../lib/outline/generation-modes'
import type { AssembleContextResult } from '../../lib/registry/types'
import type { Project } from '../../lib/types'
import { createChunkedOutlineSession, restoreChunkedOutlineSession, saveChunkedOutlineSession, runChunkedChapterModel, adoptChunkedOutlineSession, dismissChunkedOutlineSession, type ChunkedOutlineSession } from '../../lib/outline/chunked-session'
import { prepareOutlineGatewayAssemblyV1 } from '../../lib/outline/gateway-context'
import { assertWorkspaceContentRevisionFreshV1 } from '../../lib/authoring/content-revision'
import { useAIConfigStore } from '../../stores/ai-config'

interface Options {
  project: Project; volumeId: number; volumeTitle: string; volumeSummary: string; totalChapters: number; authorHint?: string
  config: ChunkedGenerationConfig; assembled: AssembleContextResult; storyArcContext?: string
  onProgress?: (progress: ChunkedGenerationProgress) => void; onInfo?: (message: string) => void; onError?: (message: string) => void
}
interface PendingChoice {
  resolve: (result: { action: 'accept'; choiceId: string } | { action: 'cancel' }) => void
  regenerate: () => Promise<BlockChoice>
}
function resultFromSession(session: ChunkedOutlineSession): ChunkedGenerationResult {
  return { blocks: session.blocks, totalChapters: session.blocks.reduce((sum, block) => sum + block.chapters.length, 0), cancelled: session.phase !== 'completed', elapsed: 0 }
}
export function useChunkedGeneration(project: Project) {
  const [progress, setProgress] = useState<ChunkedGenerationProgress | null>(null)
  const [result, setResult] = useState<ChunkedGenerationResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [session, setSession] = useState<ChunkedOutlineSession | null>(null)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState(true)
  const signalRef = useRef<AbortController | null>(null)
  const pendingChoiceRef = useRef<PendingChoice | null>(null)
  const currentSession = useRef<ChunkedOutlineSession | null>(null)
  const busyRef = useRef(false)
  const publish = useCallback((value: ChunkedOutlineSession) => {
    currentSession.current = value; setSession({ ...value })
  }, [])
  useEffect(() => {
    let active = true
    setRestoring(true)
    void restoreChunkedOutlineSession(project.id!).then(value => {
      if (!active) return
      if (value) { publish(value); if (value.blocks.length) setResult(resultFromSession(value)); setError(value.error ?? '') }
    }).catch(cause => { if (active) setError(`精细生成恢复失败：${String(cause)}`) }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false; signalRef.current?.abort(); pendingChoiceRef.current?.resolve({ action: 'cancel' }) }
  }, [project.id, publish])

  const run = useCallback(async (value: ChunkedOutlineSession, options?: Options) => {
    if (busyRef.current) return
    busyRef.current = true; setIsRunning(true); setError(''); setResult(null)
    const controller = new AbortController(); signalRef.current = controller
    try {
      await assertWorkspaceContentRevisionFreshV1(value.revision, { scope: value.scope, worldGroupId: value.worldGroupId })
      const assembled = await prepareOutlineGatewayAssemblyV1({ projectId: value.scope.projectId, scope: value.scope, worldGroupId: value.worldGroupId, request: { kind: 'chapters', volumeId: value.volumeId }, authorRequest: '按分块规划章纲剧情走向', config: useAIConfigStore.getState().config, signal: controller.signal })
      const generated = await runChunkedOutlineGeneration({
        projectId: value.scope.projectId, volumeId: value.volumeId, volumeTitle: value.volumeTitle, volumeSummary: value.volumeSummary,
        userHint: value.authorHint, worldContext: assembled.text, characterContext: '', worldRulesContext: '', storyArcContext: assembled.segments[assembled.included.indexOf('storyArcs')]?.content, config: value.config, totalChapters: value.totalChapters,
        signal: controller.signal, resume: { blocks: value.blocks, choices: value.choices, selectedChoiceId: value.selectedChoiceId },
        onCheckpoint: async checkpoint => {
          if (checkpoint.phase === 'direction') await assertWorkspaceContentRevisionFreshV1(value.revision, { scope: value.scope, worldGroupId: value.worldGroupId })
          Object.assign(value, checkpoint, { error: undefined })
          if (checkpoint.phase === 'ready') value.inFlightRunId = undefined
          await saveChunkedOutlineSession(value); publish(value)
        },
        runChapterModel: (messages, blockIndex) => runChunkedChapterModel(value, messages, blockIndex, controller.signal),
        onProgress: next => { setProgress(next); options?.onProgress?.(next) },
        onChoiceNeeded: (_choice, _favorites, regenerate) => new Promise(resolve => { pendingChoiceRef.current = { resolve, regenerate } }),
      })
      if (!generated.cancelled) {
        value.phase = 'completed'; value.inFlightRunId = undefined
        await saveChunkedOutlineSession(value); publish(value); setResult(generated)
        options?.onInfo?.(`精细生成完成：共 ${generated.totalChapters} 章，等待你确认采纳。`)
      } else if (value.blocks.length) setResult(resultFromSession(value))
    } catch (cause) {
      const message = controller.signal.aborted ? '已停止请求，已保存的进度仍可查看。' : `精细生成停止：${cause instanceof Error ? cause.message : String(cause)}`
      setError(message); value.error = message
      try { await saveChunkedOutlineSession(value); publish(value) } catch (saveError) { setError(`${message}；进度保存失败：${String(saveError)}`) }
      if (value.blocks.length) setResult(resultFromSession(value))
      options?.onError?.(message)
    } finally {
      busyRef.current = false; setIsRunning(false); setProgress(null); signalRef.current = null; pendingChoiceRef.current = null
    }
  }, [publish])
  const start = useCallback(async (options: Options) => {
    if (busyRef.current || restoring) return
    busyRef.current = true; setIsRunning(true)
    try {
      const value = await createChunkedOutlineSession({ projectId: options.project.id!, volumeId: options.volumeId, config: options.config, totalChapters: options.totalChapters, authorHint: options.authorHint })
      publish(value); setFavorites(new Set()); busyRef.current = false; await run(value, options)
    } catch (cause) { const message = String(cause); setError(message); options.onError?.(message) }
    finally { busyRef.current = false; setIsRunning(false) }
  }, [publish, restoring, run])
  const resume = useCallback(async () => { if (currentSession.current) await run(currentSession.current) }, [run])
  const selectChoice = useCallback(async (choiceId: string) => {
    if (isRegenerating || !pendingChoiceRef.current) return
    pendingChoiceRef.current.resolve({ action: 'accept', choiceId }); pendingChoiceRef.current = null
  }, [isRegenerating])
  const cancel = useCallback(() => {
    pendingChoiceRef.current?.resolve({ action: 'cancel' }); pendingChoiceRef.current = null; signalRef.current?.abort()
  }, [])
  const regenerateChoice = useCallback(async () => {
    if (!pendingChoiceRef.current || !progress || isRegenerating) return
    setIsRegenerating(true)
    try {
      if (currentSession.current) await assertWorkspaceContentRevisionFreshV1(currentSession.current.revision, { scope: currentSession.current.scope, worldGroupId: currentSession.current.worldGroupId })
      const choice = await pendingChoiceRef.current.regenerate()
      setProgress({ ...progress, choices: [choice, ...(currentSession.current?.choices.filter(row => row.id !== choice.id) ?? [])] })
    } catch (cause) { setError(`重新生成失败：${String(cause)}；原方案仍可选择。`) }
    finally { setIsRegenerating(false) }
  }, [progress, isRegenerating])
  const toggleFavorite = useCallback(async (choiceId: string) => { setFavorites(previous => { const next = new Set(previous); if (next.has(choiceId)) next.delete(choiceId); else next.add(choiceId); return next }) }, [])
  const adopt = useCallback(async () => {
    if (!currentSession.current || busyRef.current) return
    busyRef.current = true; setIsRunning(true); setError('')
    try { await adoptChunkedOutlineSession(currentSession.current); setSession(null); currentSession.current = null; setResult(null) }
    catch (cause) { setError(`采纳失败：${String(cause)}`); throw cause }
    finally { busyRef.current = false; setIsRunning(false) }
  }, [])
  const dismiss = useCallback(async () => {
    if (!currentSession.current || busyRef.current) return
    try { await dismissChunkedOutlineSession(currentSession.current); currentSession.current = null; setSession(null); setResult(null); setProgress(null); setError('') }
    catch (cause) { setError(`关闭任务失败：${String(cause)}`) }
  }, [])
  return { progress, result, isRunning, isRegenerating, favorites, session, restoring, error, start, resume, selectChoice, regenerateChoice, toggleFavorite, cancel, adopt, dismiss }
}
