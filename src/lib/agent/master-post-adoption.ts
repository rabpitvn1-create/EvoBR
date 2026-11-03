import { appendAgentEvent, readAgentEvents } from './conversations'
import { publishLongformContinuationV1 } from './longform-stage-queue'
import { parseAgentEventPayload } from '../types'
import { readLatestChapterPostAdoptionRunV1 } from './run/chapter-post-adoption-durable'
import { db } from '../db/schema'
import type { Chapter, Project, WorkspaceScope } from '../types'
import { readOwnedRows } from '../workspace/scope'
import { restoreMasterAgentCandidatesV1 } from './run/master-durable'
import { isMasterAgentCandidateBusinessStateMatchingV1 } from './run/master-adoption'
import { prepareChapterPostAdoptionV1, runChapterPostAdoptionV1 } from '../prose/post-adoption-runner'
import { hashChapterText } from '../ai/chapter-memory/text-normalization'
import { htmlToPlainText } from '../utils/html'
import { useAIConfigStore } from '../../stores/ai-config'

/** Once a master phase is verified, link each adopted chapter to the shared downstream chain. */
export async function prepareMasterChapterPostAdoptionV1(input: {
  scope: WorkspaceScope; runId: number; signal?: AbortSignal; prepareOnly?: boolean
}): Promise<string[]> {
  const restored = await restoreMasterAgentCandidatesV1(input)
  const parent = restored.snapshot
  if (parent.projection.state !== 'completed' || !parent.projection.terminalReceiptHash) throw new Error('主 Agent 本阶段尚未通过终验。')
  const project = await db.projects.get(input.scope.projectId) as Project | undefined
  if (!project) throw new Error('长篇工作区已不存在。')
  const chapters = await readOwnedRows<Chapter>(input.scope, 'chapters', { owner: 'work' })
  const messages: string[] = []
  const processed = new Set<number>()
  for (const candidate of restored.candidates) {
    if (candidate.payload.agentId !== 'prose' || !candidate.event.id || !candidate.payload.runStepId
      || parent.projection.steps[candidate.payload.runStepId]?.status !== 'succeeded') continue
    const chapter = chapters.find(row => row.outlineNodeId === candidate.payload.proseOutlineNodeId)
    if (!chapter?.id || processed.has(chapter.id)) continue
    if (!await isMasterAgentCandidateBusinessStateMatchingV1({ ...input, candidateEventId: candidate.event.id }, candidate)) continue
    processed.add(chapter.id)
    const existing = await readLatestChapterPostAdoptionRunV1({ scope: input.scope, chapterId: chapter.id })
    if (existing?.contract.lineage?.parent.runId === input.runId) {
      messages.push(`${chapter.title}：章后处理记录已存在，请在正文页查看或继续。`)
      continue
    }
    const task = { chapterId: chapter.id, chapterTitle: chapter.title, chapterContent: chapter.content, chapterPlainText: htmlToPlainText(chapter.content), parent: { runId: input.runId, receiptHash: parent.projection.terminalReceiptHash, artifactHash: await hashChapterText(chapter.content) } }
    const aiConfig = useAIConfigStore.getState().config
    const prepared = await prepareChapterPostAdoptionV1({ project, aiConfig, task })
    if (!prepared.snapshot) { messages.push(`${chapter.title}：${prepared.reason ?? '章后任务未启动'}`); continue }
    if (input.prepareOnly) {
      messages.push(`${chapter.title}：章后交接已恢复，请在正文页确认或继续；本次没有调用模型。`)
    } else if (prepared.settings.policy === 'suggest') {
      messages.push(`${chapter.title}：章后整理与记忆待授权，请在“正文”打开该章确认。`)
    } else if (prepared.snapshot.projection.state !== 'completed') {
      const errors: string[] = []
      await runChapterPostAdoptionV1({ project, aiConfig, task: { ...task, resumeRunId: prepared.snapshot.run.id }, signal: input.signal, callbacks: { onError: error => errors.push(error) } })
      messages.push(`${chapter.title}：${errors.length ? errors.join('；') : '章后流程已处理，请在“正文”查看结果并确认整理候选。'}`)
    }
  }
  return messages
}

/** Recover only the latest settled phase. Refresh never retries any model operation. */
export async function recoverLongformPhaseHandoffV1(scope: WorkspaceScope, conversationId: number): Promise<void> {
  const events = await readAgentEvents(conversationId, scope)
  const last = [...events].reverse().find(event => event.kind === 'candidate' && event.durableRunId != null)
  if (last?.durableRunId == null) return
  const runId = last.durableRunId
  if (events.some(event => parseAgentEventPayload<{ handoffRunId?: number }>(event, {}).handoffRunId === runId)) return
  const restored = await restoreMasterAgentCandidatesV1({ scope, runId })
  if (restored.snapshot.projection.state !== 'completed') return
  const continued = await publishLongformContinuationV1(scope, runId)
  const messages = await prepareMasterChapterPostAdoptionV1({ scope, runId, prepareOnly: true })
  await appendAgentEvent({ projectId: scope.projectId, scope, conversationId, kind: 'message', role: 'assistant', content: [continued ? '后续任务已恢复为待确认计划。' : '本阶段交接已核对。', ...messages].join('\n'), payload: { type: 'longform-phase-handoff-v1', handoffRunId: runId } })
}
