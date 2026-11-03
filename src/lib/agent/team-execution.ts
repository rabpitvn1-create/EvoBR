import type {
  GenerationGateIssue,
  GenerationGateResult,
  GenerationNode,
  GenerationNodeRunResult,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { runGenerationNode } from '../generation/generation-node'
import type { ChatMessage } from '../types'
import {
  AgentTeamBudgetTracker,
  type AgentTeamCallReservation,
} from './team-budget'
import {
  buildStructuredOutputRepairMessagesV1,
  classifyStructuredGateIssueV1,
  readStructuredOutputEvidenceV1,
  StructuredOutputPipelineErrorV1,
  StructuredOutputRepairFailedErrorV1,
  type StructuredOutputAttemptEvidenceV1,
  type StructuredOutputRunEvidenceV1,
} from './structured-output-pipeline'

export type BudgetedGenerationNodeResultV1<TOutput, TAdoption> =
  GenerationNodeRunResult<TOutput, TAdoption> & {
    structuredOutputEvidence?: StructuredOutputRunEvidenceV1
  }

function mergeIssues(
  gate: GenerationGateResult | null,
  extra: readonly GenerationGateIssue[],
): GenerationGateIssue[] {
  const issues = [...(gate?.issues ?? []), ...extra]
  return [...new Map(issues.map(issue => [`${issue.code}:${issue.message}`, issue])).values()]
}

function correctionMessage(issues: readonly GenerationGateIssue[]): ChatMessage {
  return {
    role: 'user',
    content: [
      '【确定性 Canon 校验打回】上一版不会进入候选，也没有写入项目。',
      ...issues.map(issue => `- ${issue.code}: ${issue.message}`),
      '只修复这些明确问题，继续遵守原任务、原输出格式和所有已提供的项目事实；不要解释。',
    ].join('\n'),
  }
}

type RunOnceOutcome<TOutput, TAdoption> =
  | {
      kind: 'success'
      result: GenerationNodeRunResult<TOutput, TAdoption>
      issues: GenerationGateIssue[]
      evidence: StructuredOutputAttemptEvidenceV1 | null
    }
  | {
      kind: 'structured-error'
      error: StructuredOutputPipelineErrorV1
    }

async function runOnce<TInput, TOutput, TAdoption>(input: {
  node: GenerationNode<TInput, TOutput, TAdoption>
  prepared: PreparedGenerationNode
  messages: ChatMessage[]
  budget: AgentTeamBudgetTracker
  callLabel: string
  maxOutputTokens: number
  validate?: (output: TOutput) => Promise<GenerationGateIssue[]> | GenerationGateIssue[]
}): Promise<RunOnceOutcome<TOutput, TAdoption>> {
  let reservation: AgentTeamCallReservation | null = null
  let settled = false
  try {
    reservation = input.budget.reserveCall({
      label: input.callLabel,
      messages: input.messages,
      maxOutputTokens: input.maxOutputTokens,
    })
    const result = await runGenerationNode(input.node, input.prepared, { messages: input.messages })
    const structuredEvidence = readStructuredOutputEvidenceV1(result.output)
    input.budget.settleCall(reservation, structuredEvidence?.originalText ?? result.output)
    settled = true
    const extra = result.gate?.status === 'blocked'
      ? []
      : await input.validate?.(result.output) ?? []
    return {
      kind: 'success',
      result,
      issues: mergeIssues(result.gate, extra),
      evidence: structuredEvidence,
    }
  } catch (error) {
    if (reservation && !settled && error instanceof StructuredOutputPipelineErrorV1) {
      // The provider returned a response; only its deterministic parse failed.
      // Settle it as a real call instead of pretending it was a network failure.
      input.budget.settleCall(reservation, error.evidence.originalText)
      settled = true
      return { kind: 'structured-error', error }
    }
    if (reservation && !settled) input.budget.settleFailedCall(reservation)
    throw error
  }
}

function evidenceWithGateIssues(
  evidence: StructuredOutputAttemptEvidenceV1,
  issues: readonly GenerationGateIssue[],
): StructuredOutputAttemptEvidenceV1 {
  const classified = issues.map(classifyStructuredGateIssueV1)
  return {
    ...evidence,
    status: classified.some(item => !item.repairable) ? 'blocked' : 'manual-repair',
    issues: [...evidence.issues, ...classified],
  }
}

function runEvidence(input: {
  first: StructuredOutputAttemptEvidenceV1
  second?: StructuredOutputAttemptEvidenceV1
  repaired: boolean
}): StructuredOutputRunEvidenceV1 {
  const firstFingerprint = input.first.issues[0]?.fingerprint
    ?? (input.first.normalizationSteps.join(':') || 'structured-output')
  return {
    version: 1,
    schemaId: input.first.schemaId,
    target: input.first.target,
    status: input.second?.status ?? input.first.status,
    attempts: [
      { callIndex: 1, purpose: 'generate', evidence: input.first },
      ...(input.second
        ? [{ callIndex: 2 as const, purpose: 'repair' as const, evidence: input.second }]
        : []),
    ],
    repair: input.second
      ? {
          callIndex: 2,
          sourceFingerprint: firstFingerprint,
          result: input.repaired ? 'repaired' : 'failed',
        }
      : null,
  }
}

function addEvidence<TOutput, TAdoption>(
  result: GenerationNodeRunResult<TOutput, TAdoption>,
  evidence: StructuredOutputRunEvidenceV1 | null,
): BudgetedGenerationNodeResultV1<TOutput, TAdoption> {
  return evidence ? { ...result, structuredOutputEvidence: evidence } : result
}

/**
 * One domain task receives one generation call and at most one controlled
 * correction call. Structured parse/schema/target errors and deterministic
 * Canon gate errors share that single retry allowance; provider, cancellation,
 * permission, scope, stale and length failures are never auto-retried here.
 */
export async function runBudgetedGenerationNode<TInput, TOutput, TAdoption>(input: {
  node: GenerationNode<TInput, TOutput, TAdoption>
  prepared: PreparedGenerationNode
  budget: AgentTeamBudgetTracker
  callLabel: string
  maxOutputTokens: number
  validate?: (output: TOutput) => Promise<GenerationGateIssue[]> | GenerationGateIssue[]
}): Promise<BudgetedGenerationNodeResultV1<TOutput, TAdoption>> {
  const first = await runOnce({ ...input, messages: input.prepared.messages })
  if (first.kind === 'success' && first.issues.length === 0) {
    return addEvidence(
      first.result,
      first.evidence ? runEvidence({ first: first.evidence, repaired: false }) : null,
    )
  }

  let firstEvidence: StructuredOutputAttemptEvidenceV1 | null = null
  let repairMessages: ChatMessage[]
  let retryIssues: GenerationGateIssue[]
  if (first.kind === 'structured-error') {
    if (!first.error.retryable) throw first.error
    firstEvidence = first.error.evidence
    retryIssues = first.error.evidence.issues.map(item => ({
      code: item.code,
      message: item.message,
    }))
    repairMessages = buildStructuredOutputRepairMessagesV1({ evidence: firstEvidence })
  } else {
    retryIssues = first.issues
    if (first.evidence) {
      firstEvidence = evidenceWithGateIssues(first.evidence, first.issues)
      if (firstEvidence.issues.some(item => !item.repairable)) {
        throw new StructuredOutputPipelineErrorV1(firstEvidence)
      }
      repairMessages = buildStructuredOutputRepairMessagesV1({ evidence: firstEvidence })
    } else {
      repairMessages = [...input.prepared.messages, correctionMessage(first.issues)]
    }
  }

  input.budget.claimCanonRetry(retryIssues)
  const retry = await runOnce({
    ...input,
    callLabel: `${input.callLabel}（定向修复）`,
    messages: repairMessages,
  })
  if (retry.kind === 'structured-error') {
    throw new StructuredOutputRepairFailedErrorV1(runEvidence({
      first: firstEvidence ?? retry.error.evidence,
      second: retry.error.evidence,
      repaired: false,
    }))
  }
  if (retry.issues.length > 0) {
    if (firstEvidence && retry.evidence) {
      throw new StructuredOutputRepairFailedErrorV1(runEvidence({
        first: firstEvidence,
        second: evidenceWithGateIssues(retry.evidence, retry.issues),
        repaired: false,
      }))
    }
    throw new Error(`确定性 Canon 校验打回后仍未通过：${retry.issues.map(issue => issue.message).join('；')}`)
  }
  return addEvidence(
    retry.result,
    firstEvidence && retry.evidence
      ? runEvidence({ first: firstEvidence, second: retry.evidence, repaired: true })
      : retry.evidence
        ? runEvidence({ first: retry.evidence, repaired: false })
        : null,
  )
}
