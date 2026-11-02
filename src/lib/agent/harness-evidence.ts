import type { WorkspaceContentRevisionVectorV1 } from '../authoring/content-revision'
import type { AgentContextEvidence } from './context-policy'
import type { PromptExecutionEvidenceV1 } from './prompt-execution'

export const HARNESS_LIFECYCLE_STAGE_IDS_V1 = [
  'author-edits-saved',
  'context-frozen',
  'candidate-persisted',
  'adoptable',
  'terminal-verified',
] as const

export type HarnessLifecycleStageIdV1 = typeof HARNESS_LIFECYCLE_STAGE_IDS_V1[number]
export type HarnessLifecycleStageStatusV1 = 'passed' | 'pending' | 'blocked' | 'unavailable'

export interface HarnessLifecycleStageEvidenceV1 {
  id: HarnessLifecycleStageIdV1
  label: string
  status: HarnessLifecycleStageStatusV1
  detail: string
}

export interface HarnessLifecycleEvidenceV1 {
  version: 1
  runId: number | null
  candidateEventId: number | null
  contentRevisionHash?: string
  contextManifestHash?: string
  candidateHash?: string
  adoptionHash?: string
  terminalReceiptHash?: string
  contextEvidence?: AgentContextEvidence
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  stages: HarnessLifecycleStageEvidenceV1[]
}

const LABELS: Record<HarnessLifecycleStageIdV1, string> = {
  'author-edits-saved': '作者编辑已保存',
  'context-frozen': '上下文已冻结',
  'candidate-persisted': '候选已持久化',
  adoptable: '候选可采纳',
  'terminal-verified': '终态已验证',
}

function stage(
  id: HarnessLifecycleStageIdV1,
  status: HarnessLifecycleStageStatusV1,
  detail: string,
): HarnessLifecycleStageEvidenceV1 {
  return { id, label: LABELS[id], status, detail }
}

export function buildPendingHarnessLifecycleEvidenceV1(input: {
  runId?: number
  candidateEventId?: number
  contentRevision?: WorkspaceContentRevisionVectorV1
  contextManifestHash?: string
  candidateHash?: string
  contextEvidence?: AgentContextEvidence
  promptExecutionEvidence?: PromptExecutionEvidenceV1
  blockedReason?: string
}): HarnessLifecycleEvidenceV1 {
  const saved = Boolean(input.contentRevision?.vectorHash)
  const contextFrozen = Boolean(input.contextEvidence && input.contextManifestHash)
  const persisted = Boolean(input.candidateEventId && input.candidateHash)
  const adoptable = saved && contextFrozen && persisted && !input.blockedReason
  return {
    version: 1,
    runId: input.runId ?? null,
    candidateEventId: input.candidateEventId ?? null,
    ...(input.contentRevision ? { contentRevisionHash: input.contentRevision.vectorHash } : {}),
    ...(input.contextManifestHash ? { contextManifestHash: input.contextManifestHash } : {}),
    ...(input.candidateHash ? { candidateHash: input.candidateHash } : {}),
    ...(input.contextEvidence ? { contextEvidence: input.contextEvidence } : {}),
    ...(input.promptExecutionEvidence ? { promptExecutionEvidence: input.promptExecutionEvidence } : {}),
    stages: [
      stage(
        'author-edits-saved',
        saved ? 'passed' : 'unavailable',
        saved ? '内容修订向量已冻结' : '旧候选没有保存屏障证据',
      ),
      stage(
        'context-frozen',
        contextFrozen ? 'passed' : 'unavailable',
        contextFrozen ? 'Context Manifest 已绑定' : '旧候选没有 Context Manifest',
      ),
      stage(
        'candidate-persisted',
        persisted ? 'passed' : 'unavailable',
        persisted ? `候选事件 #${input.candidateEventId}` : '缺少候选事件或候选哈希',
      ),
      stage(
        'adoptable',
        adoptable ? 'passed' : input.blockedReason ? 'blocked' : 'unavailable',
        input.blockedReason ?? (adoptable ? '等待作者确认' : '缺少完整前置证据'),
      ),
      stage('terminal-verified', 'pending', '采纳后由确定性终态验证器签发回执'),
    ],
  }
}

export function buildSettledHarnessLifecycleEvidenceV1(input: {
  pending: HarnessLifecycleEvidenceV1
  adoptionHash: string
  terminal: 'passed' | 'pending' | 'blocked'
  terminalReceiptHash?: string
  terminalDetail: string
}): HarnessLifecycleEvidenceV1 {
  return {
    ...input.pending,
    adoptionHash: input.adoptionHash,
    ...(input.terminalReceiptHash ? { terminalReceiptHash: input.terminalReceiptHash } : {}),
    stages: input.pending.stages.map(item => (
      item.id === 'adoptable'
        ? stage('adoptable', 'passed', '作者确认且正式采纳已提交')
        : item.id === 'terminal-verified'
          ? stage('terminal-verified', input.terminal, input.terminalDetail)
          : item
    )),
  }
}
