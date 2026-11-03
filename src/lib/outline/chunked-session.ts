import { db } from '../db/schema'
import { appendAgentEvent, getOrCreateAgentConversation, readAgentEvents } from '../agent/conversations'
import { parseAgentEventPayload, type ChatMessage, type OutlineNode, type WorkspaceScope } from '../types'
import { assertRecordInScope, readOwnedRows, resolveScope } from '../workspace/scope'
import { assertWorkspaceContentRevisionFreshV1, captureWorkspaceContentRevisionV1, type WorkspaceContentRevisionVectorV1 } from '../authoring/content-revision'
import { useAIConfigStore } from '../../stores/ai-config'
import { executeRegisteredAIEntryV1 } from '../agent/formal-ai-entry'
import { readAgentRunV1 } from '../agent/run'
import { prepareOutlineGatewayAssemblyV1 } from './gateway-context'
import { createOutlineGenerationTraceV1, readOutlineGenerationCandidateV1, adoptOutlineGenerationCandidateV1, rejectOutlineGenerationCandidateV1, type OutlineGenerationCandidateV1 } from './harness'
import { divideChaptersIntoBlocks, getBlockLabels, type ChunkedGenerationConfig } from './generation-modes'
import { parseChapterOutlineOutput } from '../ai/parse-outline-output'
import type { BlockChoice, BlockGenerationResult } from './chunked-generator'

const TYPE = 'outline-chunked-session-v1'
export interface ChunkedOutlineSession {
  type: typeof TYPE
  sessionId: string
  conversationId: number
  sequence: number
  scope: WorkspaceScope
  worldGroupId: number | null
  volumeId: number
  volumeTitle: string
  volumeSummary: string
  config: ChunkedGenerationConfig
  totalChapters: number
  authorHint?: string
  revision: WorkspaceContentRevisionVectorV1
  blocks: BlockGenerationResult[]
  choices: BlockChoice[]
  selectedChoiceId?: string
  phase: 'ready' | 'direction' | 'choice' | 'chapters' | 'completed' | 'dismissed' | 'adopted'
  candidateRunId?: number
  inFlightRunId?: number
  error?: string
}

/** Checkpoints use the existing Work-owned conversation lifecycle, with an optimistic writer lock. */
export async function saveChunkedOutlineSession(session: ChunkedOutlineSession): Promise<void> {
  await db.transaction('rw', db.agentConversations, db.agentEvents, async () => {
    const events = await readAgentEvents(session.conversationId, session.scope)
    const latest = [...events].reverse().find(event => parseAgentEventPayload<{ type?: string }>(event, {}).type === TYPE)
    if ((latest?.sequence ?? 0) !== session.sequence) throw new Error('精细生成进度已在其他页面更新，请刷新后继续。')
    const event = await appendAgentEvent({ projectId: session.scope.projectId, scope: session.scope, conversationId: session.conversationId, kind: 'plan', content: `精细章纲：${session.volumeTitle} · ${session.blocks.length}/${session.config.blockCount} 块 · ${session.phase}`, payload: session })
    session.sequence = event.sequence
  })
}

export async function createChunkedOutlineSession(input: { projectId: number; volumeId: number; config: ChunkedGenerationConfig; totalChapters: number; authorHint?: string }): Promise<ChunkedOutlineSession> {
  if (!Number.isInteger(input.config.blockCount) || input.config.blockCount < 3 || input.config.blockCount > 7
    || !Number.isInteger(input.totalChapters) || input.totalChapters < input.config.blockCount || input.totalChapters > 500) throw new Error('精细生成需要 3–7 块，目标章数须不小于分块数且不超过 500。')
  const scope = await resolveScope({ projectId: input.projectId })
  const volume = await db.outlineNodes.get(input.volumeId)
  if (!volume || volume.type !== 'volume' || !await assertRecordInScope(scope, 'outlineNodes', volume, { owner: 'work' })) throw new Error('目标卷不属于当前作品。')
  const worldGroupId = volume.worldGroupId ?? null
  const conversation = await getOrCreateAgentConversation({ projectId: input.projectId, scope, worldGroupId, purpose: `outline-chunked:${input.volumeId}`, title: `精细章纲 · ${volume.title}` })
  const events = await readAgentEvents(conversation.id!, scope)
  const latest = [...events].reverse().find(event => parseAgentEventPayload<{ type?: string }>(event, {}).type === TYPE)
  if (latest) {
    const previous = parseAgentEventPayload<ChunkedOutlineSession>(latest, {} as ChunkedOutlineSession)
    if (!['dismissed', 'adopted'].includes(previous.phase)) throw new Error('该卷已有未处理的精细生成任务，请先继续或关闭它。')
  }
  const session: ChunkedOutlineSession = { type: TYPE, sessionId: `chunked-${crypto.randomUUID()}`, conversationId: conversation.id!, sequence: latest?.sequence ?? 0, scope, worldGroupId, volumeId: input.volumeId, volumeTitle: volume.title, volumeSummary: volume.summary, config: input.config, totalChapters: input.totalChapters, authorHint: input.authorHint, revision: await captureWorkspaceContentRevisionV1({ scope, worldGroupId }), blocks: [], choices: [], phase: 'ready' }
  await saveChunkedOutlineSession(session)
  return session
}

export async function restoreChunkedOutlineSession(projectId: number): Promise<ChunkedOutlineSession | null> {
  const scope = await resolveScope({ projectId })
  const conversations = await readOwnedRows<{ id: number; purpose: string; updatedAt: number }>(scope, 'agentConversations', { owner: 'work' })
  for (const conversation of conversations.filter(row => row.purpose.startsWith('outline-chunked:')).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const event = [...await readAgentEvents(conversation.id, scope)].reverse().find(row => parseAgentEventPayload<{ type?: string }>(row, {}).type === TYPE)
    if (!event) continue
    const session = parseAgentEventPayload<ChunkedOutlineSession>(event, {} as ChunkedOutlineSession)
    if (['dismissed', 'adopted'].includes(session.phase)) continue
    // Scope comes from validated owned rows, never from a serialized checkpoint.
    session.scope = scope; session.sequence = event.sequence; session.conversationId = conversation.id
    if (session.inFlightRunId) {
      const candidate = await readOutlineGenerationCandidateV1(scope, session.inFlightRunId)
      if (candidate?.chunked?.sessionId === session.sessionId) {
        const blockIndex = candidate.chunked.blockIndex
        const choice = session.choices.find(row => row.id === session.selectedChoiceId)
        if (!choice || blockIndex !== session.blocks.length) throw new Error('精细章纲的方向 checkpoint 与候选不匹配。')
        session.blocks.push({ blockIndex, blockLabel: getBlockLabels(session.config.blockCount)[blockIndex], chapterRange: divideChaptersIntoBlocks(session.totalChapters, session.config.blockCount)[blockIndex].chapterRange, chapters: parseChapterOutlineOutput(candidate.chunked.rawOutput), selectedChoiceId: choice.id, selectedChoice: choice })
        session.candidateRunId = candidate.runId; session.inFlightRunId = undefined
        session.choices = []; session.selectedChoiceId = undefined; session.phase = session.blocks.length === session.config.blockCount ? 'completed' : 'ready'
        await saveChunkedOutlineSession(session)
      }
    }
    return session
  }
  return null
}

export async function runChunkedChapterModel(session: ChunkedOutlineSession, messages: ChatMessage[], blockIndex: number, signal?: AbortSignal): Promise<string> {
  await assertWorkspaceContentRevisionFreshV1(session.revision, { scope: session.scope, worldGroupId: session.worldGroupId })
  const predecessor = session.candidateRunId ? await readOutlineGenerationCandidateV1(session.scope, session.candidateRunId) : null
  const prior = predecessor?.output
  const config = useAIConfigStore.getState().config
  const request = { kind: 'chapters' as const, volumeId: session.volumeId }
  const assembled = await prepareOutlineGatewayAssemblyV1({ projectId: session.scope.projectId, scope: session.scope, worldGroupId: session.worldGroupId, request, authorRequest: `按作者选定的走向生成第 ${blockIndex + 1} 块章纲`, config, priorOutlineCandidateText: prior, signal })
  const exactMessages: ChatMessage[] = [{ role: 'system', content: `使用以下注册上下文创作；前序候选仅用于承接，不得重复输出。\n${assembled.text}` }, ...messages]
  const trace = await createOutlineGenerationTraceV1({ projectId: session.scope.projectId, worldGroupId: session.worldGroupId, request, assembled, priorOutlineCandidateText: prior, contentRevision: session.revision })
  session.inFlightRunId = trace.durable!.runId
  await saveChunkedOutlineSession(session)
  try {
    if (signal?.aborted) throw new DOMException('作者停止生成', 'AbortError')
    await trace.beforeModel({ prepared: { nodeId: 'outline.chapter', kind: 'outline', editableInput: true, messages: exactMessages }, messages: exactMessages })
    const raw = await executeRegisteredAIEntryV1('outline.chapter.generate', exactMessages, config, { category: 'outline.chapter', projectId: session.scope.projectId }, signal)
    await trace.modelResponded(raw)
    const expected = divideChaptersIntoBlocks(session.totalChapters, session.config.blockCount)[blockIndex].chapterCount
    if (parseChapterOutlineOutput(raw).length !== expected) {
      const error = new Error(`第 ${blockIndex + 1} 块需要 ${expected} 章，返回内容未通过章数校验。`)
      await trace.stepFailed({ phase: 'gate', error }); throw error
    }
    const candidate = await trace.persistCandidate(JSON.stringify([...(prior ? parseChapterOutlineOutput(prior) : []), ...parseChapterOutlineOutput(raw)]), { sessionId: session.sessionId, blockIndex, blockTotal: session.config.blockCount, predecessorRunId: predecessor?.runId, rawOutput: raw })
    if (!candidate) throw new Error('精细章纲候选未能持久化，已停止。')
    session.candidateRunId = candidate.runId
    // Keep inFlightRunId until the block checkpoint commits, so refresh can recover this exact response.
    return raw
  } catch (error) {
    await trace.terminateRun({ status: signal?.aborted ? 'cancelled' : 'failed', code: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

export async function adoptChunkedOutlineSession(session: ChunkedOutlineSession): Promise<void> {
  if (!session.candidateRunId) throw new Error('没有可采纳的已保存章纲候选。')
  const candidate = await readOutlineGenerationCandidateV1(session.scope, session.candidateRunId)
  if (!candidate || candidate.chunked?.sessionId !== session.sessionId) throw new Error('精细章纲候选来源不匹配。')
  const run = await readAgentRunV1(session.scope, candidate.runId)
  if (run.projection.state !== 'completed') {
    const nodes = await readOwnedRows<OutlineNode>(session.scope, 'outlineNodes', { owner: 'work' })
    const siblings = nodes.filter(row => row.type === 'chapter' && row.parentId === session.volumeId)
    await adoptOutlineGenerationCandidateV1({ candidate, intent: { version: 1, kind: 'chapters', destinationVolumeId: session.volumeId, items: parseChapterOutlineOutput(candidate.output), startingOrder: siblings.length, baseExistingTitles: siblings.map(row => row.title) } })
  }
  let previous = candidate.chunked?.predecessorRunId ? await readOutlineGenerationCandidateV1(session.scope, candidate.chunked.predecessorRunId) : null
  const seen = new Set<number>()
  while (previous && !seen.has(previous.runId)) {
    seen.add(previous.runId)
    await rejectOutlineGenerationCandidateV1(previous, '此中间候选已合入最终精细章纲并采纳，不再单独采纳。')
    previous = previous.chunked?.predecessorRunId ? await readOutlineGenerationCandidateV1(session.scope, previous.chunked.predecessorRunId) : null
  }
  session.phase = 'adopted'; session.inFlightRunId = undefined
  await saveChunkedOutlineSession(session)
}

export async function dismissChunkedOutlineSession(session: ChunkedOutlineSession): Promise<void> {
  let candidate: OutlineGenerationCandidateV1 | null = session.candidateRunId ? await readOutlineGenerationCandidateV1(session.scope, session.candidateRunId) : null
  while (candidate) {
    await rejectOutlineGenerationCandidateV1(candidate, '作者关闭精细生成任务，保留历史证据。')
    candidate = candidate.chunked?.predecessorRunId ? await readOutlineGenerationCandidateV1(session.scope, candidate.chunked.predecessorRunId) : null
  }
  session.phase = 'dismissed'; await saveChunkedOutlineSession(session)
}
