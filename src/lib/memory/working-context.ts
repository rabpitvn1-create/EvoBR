import { db } from '../db/schema'
import type {
  AnyAgentRunEventV1,
  WorkingContextCompactionCheckpointV1,
  WorkingContextSourceDecisionV1,
  WorkspaceScope,
} from '../types'
import {
  createAgentRunCheckpointV1,
  readLatestVerifiedAgentRunCheckpointV1,
  verifyAgentRunCheckpointV1,
} from '../agent/run/checkpoint'
import { readAgentRunV1 } from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import {
  inspectAgentRunArtifactAvailabilityV1,
  readAgentRunArtifactExactV1,
} from './artifact-store'

const HASH = /^[a-f0-9]{64}$/

export class WorkingContextContractError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'WorkingContextContractError'
  }
}

function requireHash(value: string, field: string): void {
  if (!HASH.test(value)) throw new WorkingContextContractError('invalid-hash', `${field} 必须是 SHA-256 hash`)
}

function normalizeSources(
  sources: readonly WorkingContextSourceDecisionV1[],
): WorkingContextSourceDecisionV1[] {
  const seen = new Set<string>()
  const normalized = sources.map(source => {
    if (!source.sourceKey || !source.sourceRevision || !source.reasonCode) {
      throw new WorkingContextContractError('invalid-source', '压缩来源必须包含 key、revision 和 reason')
    }
    requireHash(source.contentHash, `source(${source.sourceKey}).contentHash`)
    if (!Number.isSafeInteger(source.span.start) || !Number.isSafeInteger(source.span.end)
      || source.span.start < 0 || source.span.end < source.span.start) {
      throw new WorkingContextContractError('invalid-span', `source(${source.sourceKey}) span 非法`)
    }
    const identity = `${source.sourceKey}\u0000${source.sourceRevision}\u0000${source.span.start}\u0000${source.span.end}`
    if (seen.has(identity)) throw new WorkingContextContractError('duplicate-source', `压缩来源重复: ${source.sourceKey}`)
    seen.add(identity)
    return {
      ...source,
      span: { start: source.span.start, end: source.span.end },
    }
  })
  return normalized.sort((left, right) => (
    left.sourceKey.localeCompare(right.sourceKey)
      || left.sourceRevision.localeCompare(right.sourceRevision)
      || left.span.start - right.span.start
      || left.span.end - right.span.end
  ))
}

export function parseWorkingContextCompactionCheckpointV1(
  value: unknown,
): WorkingContextCompactionCheckpointV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkingContextContractError('invalid-payload', '工作上下文 checkpoint 必须是对象')
  }
  const payload = value as Partial<WorkingContextCompactionCheckpointV1>
  if (payload.version !== 1 || payload.kind !== 'working-context-compaction') {
    throw new WorkingContextContractError('unsupported-version', '不支持的工作上下文 checkpoint 版本')
  }
  if (!Number.isSafeInteger(payload.generation) || payload.generation! < 1) {
    throw new WorkingContextContractError('invalid-generation', 'checkpoint generation 非法')
  }
  if (payload.baseCheckpointHash !== null) requireHash(payload.baseCheckpointHash!, 'baseCheckpointHash')
  if (!Number.isSafeInteger(payload.tailFromSequence) || payload.tailFromSequence! < 1) {
    throw new WorkingContextContractError('invalid-tail', 'tailFromSequence 非法')
  }
  requireHash(payload.originalPacketHash!, 'originalPacketHash')
  requireHash(payload.replacementPacketHash!, 'replacementPacketHash')
  if (!Array.isArray(payload.sources)) throw new WorkingContextContractError('invalid-sources', 'sources 必须是数组')
  if (typeof payload.strategy !== 'string' || !payload.strategy) {
    throw new WorkingContextContractError('invalid-strategy', 'strategy 不得为空')
  }
  if (payload.provider !== null && typeof payload.provider !== 'string') {
    throw new WorkingContextContractError('invalid-provider', 'provider 必须为字符串或 null')
  }
  if (payload.promptVersion !== null && typeof payload.promptVersion !== 'string') {
    throw new WorkingContextContractError('invalid-prompt', 'promptVersion 必须为字符串或 null')
  }
  if (typeof payload.gatewayVersion !== 'string' || !payload.gatewayVersion) {
    throw new WorkingContextContractError('invalid-gateway', 'gatewayVersion 不得为空')
  }
  if (!Number.isSafeInteger(payload.beforeTokens) || !Number.isSafeInteger(payload.afterTokens)
    || payload.beforeTokens! < 0 || payload.afterTokens! < 0 || payload.afterTokens! > payload.beforeTokens!) {
    throw new WorkingContextContractError('invalid-token-count', '压缩后 token 不得大于压缩前')
  }
  if (!Array.isArray(payload.rawArtifactRefs)) {
    throw new WorkingContextContractError('invalid-artifact-refs', 'rawArtifactRefs 必须是数组')
  }
  const rawArtifactRefs = [...new Set(payload.rawArtifactRefs)]
  rawArtifactRefs.forEach((hash, index) => requireHash(hash, `rawArtifactRefs[${index}]`))
  if (!rawArtifactRefs.includes(payload.originalPacketHash!)) {
    throw new WorkingContextContractError('missing-original-artifact', 'compaction 必须保留原始 Context Packet artifact ref')
  }
  return {
    version: 1,
    kind: 'working-context-compaction',
    generation: payload.generation!,
    baseCheckpointHash: payload.baseCheckpointHash!,
    tailFromSequence: payload.tailFromSequence!,
    originalPacketHash: payload.originalPacketHash!,
    replacementPacketHash: payload.replacementPacketHash!,
    sources: normalizeSources(payload.sources),
    strategy: payload.strategy,
    provider: payload.provider!,
    promptVersion: payload.promptVersion!,
    gatewayVersion: payload.gatewayVersion,
    beforeTokens: payload.beforeTokens!,
    afterTokens: payload.afterTokens!,
    rawArtifactRefs: rawArtifactRefs.sort(),
  }
}

async function assertWorkingContextArtifactsAvailableV1(
  projectId: number,
  payload: WorkingContextCompactionCheckpointV1,
): Promise<void> {
  for (const [label, contentHash] of [
    ['originalPacketHash', payload.originalPacketHash],
    ['replacementPacketHash', payload.replacementPacketHash],
  ] as const) {
    const availability = await inspectAgentRunArtifactAvailabilityV1({
      projectId,
      artifactKind: 'context-packet',
      contentHash,
    })
    if (availability.state !== 'available') {
      throw new WorkingContextContractError('packet-artifact-unavailable', `${label} 的 exact Context Packet 当前为 ${availability.state}`)
    }
    await readAgentRunArtifactExactV1({ projectId, artifactKind: 'context-packet', contentHash })
  }
  const available = await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()
  for (const contentHash of payload.rawArtifactRefs) {
    if (!available.some(row => row.contentHash === contentHash && row.retentionState === 'available')) {
      throw new WorkingContextContractError('raw-artifact-unavailable', `rawArtifactRef ${contentHash} 没有可回读的 exact body`)
    }
  }
}

export async function createWorkingContextCompactionCheckpointV1(input: {
  scope: WorkspaceScope
  runId: number
  expectedLastSequence?: number
  originalPacketHash: string
  replacementPacketHash: string
  sources: readonly WorkingContextSourceDecisionV1[]
  strategy: string
  provider: string | null
  promptVersion: string | null
  gatewayVersion: string
  beforeTokens: number
  afterTokens: number
  rawArtifactRefs: readonly string[]
  now?: number
}) {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (input.expectedLastSequence != null && input.expectedLastSequence !== snapshot.projection.lastSequence) {
    throw new WorkingContextContractError('sequence-conflict', '运行已推进，拒绝基于旧工作上下文压缩')
  }
  const previous = await db.agentRunCheckpoints.where('runId').equals(input.runId).last()
  if (previous?.id != null && !await verifyAgentRunCheckpointV1(input.scope, previous.id)) {
    throw new WorkingContextContractError('broken-base-chain', '上一个 checkpoint 未通过事件 replay 校验')
  }
  const payload = parseWorkingContextCompactionCheckpointV1({
    version: 1,
    kind: 'working-context-compaction',
    generation: snapshot.run.generation,
    baseCheckpointHash: previous?.checkpointHash ?? null,
    tailFromSequence: previous == null ? 1 : previous.throughSequence + 2,
    originalPacketHash: input.originalPacketHash,
    replacementPacketHash: input.replacementPacketHash,
    sources: input.sources,
    strategy: input.strategy,
    provider: input.provider,
    promptVersion: input.promptVersion,
    gatewayVersion: input.gatewayVersion,
    beforeTokens: input.beforeTokens,
    afterTokens: input.afterTokens,
    rawArtifactRefs: input.rawArtifactRefs,
  })
  await assertWorkingContextArtifactsAvailableV1(input.scope.projectId, payload)
  return createAgentRunCheckpointV1({
    scope: input.scope,
    runId: input.runId,
    expectedLastSequence: snapshot.projection.lastSequence,
    resumePayload: payload,
    now: input.now,
  })
}

export async function readWorkingContextReplayV1(scope: WorkspaceScope, runId: number): Promise<null | {
  checkpointHash: string
  checkpointChainHashes: string[]
  compaction: WorkingContextCompactionCheckpointV1
  tailEvents: AnyAgentRunEventV1[]
  replayHash: string
}> {
  const verified = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!verified) return null
  const candidate = verified.resumePayload as { kind?: unknown } | null
  if (candidate?.kind !== 'working-context-compaction') return null
  const compaction = parseWorkingContextCompactionCheckpointV1(verified.resumePayload)
  if (compaction.generation !== verified.checkpoint.generation) {
    throw new WorkingContextContractError('stale-generation', 'compaction generation 与 checkpoint 不一致')
  }
  const checkpoints = await db.agentRunCheckpoints.where('runId').equals(runId).sortBy('throughSequence')
  const byHash = new Map(checkpoints.map(row => [row.checkpointHash, row]))
  const checkpointChainHashes: string[] = []
  const seen = new Set<string>()
  let cursor = verified.checkpoint
  while (true) {
    if (seen.has(cursor.checkpointHash)) {
      throw new WorkingContextContractError('broken-base-chain', 'compaction base checkpoint 链形成循环')
    }
    seen.add(cursor.checkpointHash)
    checkpointChainHashes.push(cursor.checkpointHash)
    if (!await verifyAgentRunCheckpointV1(scope, cursor.id!)) {
      throw new WorkingContextContractError('broken-base-chain', `checkpoint ${cursor.checkpointHash} 无法通过事件 replay 校验`)
    }
    let payload: WorkingContextCompactionCheckpointV1
    try {
      payload = parseWorkingContextCompactionCheckpointV1(JSON.parse(cursor.resumePayloadJson ?? 'null'))
    } catch (error) {
      if (cursor.checkpointHash === verified.checkpoint.checkpointHash) throw error
      break
    }
    if (payload.generation !== cursor.generation) {
      throw new WorkingContextContractError('stale-generation', 'base compaction generation 与 checkpoint 不一致')
    }
    await assertWorkingContextArtifactsAvailableV1(scope.projectId, payload)
    if (payload.baseCheckpointHash == null) {
      if (payload.tailFromSequence !== 1) {
        throw new WorkingContextContractError('broken-base-chain', '首个 compaction 必须从事件 1 开始 replay')
      }
      break
    }
    const base = byHash.get(payload.baseCheckpointHash)
    if (!base || base.throughSequence >= cursor.throughSequence
      || payload.tailFromSequence !== base.throughSequence + 2) {
      throw new WorkingContextContractError('broken-base-chain', 'base checkpoint 与 tail 边界不一致')
    }
    cursor = base as typeof verified.checkpoint
  }
  checkpointChainHashes.reverse()
  const tailEvents = verified.snapshot.events.filter(
    event => event.sequence > verified.checkpoint.throughSequence + 1,
  )
  const replayHash = await hashCanonicalValue({
    checkpointHash: verified.checkpoint.checkpointHash,
    checkpointChainHashes,
    compaction,
    tailEvents,
  })
  return { checkpointHash: verified.checkpoint.checkpointHash, checkpointChainHashes, compaction, tailEvents, replayHash }
}
