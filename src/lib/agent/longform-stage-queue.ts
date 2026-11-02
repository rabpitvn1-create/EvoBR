import type { MasterAgentPlan } from './orchestrator'
import { hashMasterAgentPlanV1, parseMasterAgentPlanV1, restoreMasterAgentCandidatesV1 } from './run/master-durable'
import { appendAgentEvent, readAgentEvents } from './conversations'
import { parseAgentEventPayload, type WorkspaceScope } from '../types'

/** Keep at most one prose chapter in a phase so its shared post-chain can settle before the next chapter. */
export function splitLongformPlanAtChapterV1(input: MasterAgentPlan): { current: MasterAgentPlan; remaining: MasterAgentPlan | null } {
  const plan = parseMasterAgentPlanV1(input)
  const sorted: typeof plan.tasks = []
  const pending = [...plan.tasks]
  while (pending.length) {
    const index = pending.findIndex(task => task.dependsOn.every(id => sorted.some(row => row.id === id)))
    if (index < 0) throw new Error('创作计划依赖无法排序。')
    sorted.push(pending.splice(index, 1)[0])
  }
  const firstProse = sorted.findIndex(task => task.agentId === 'prose')
  if (firstProse < 0 || firstProse === sorted.length - 1) return { current: plan, remaining: null }
  const currentTasks = sorted.slice(0, firstProse + 1)
  const remainingTasks = sorted.slice(firstProse + 1)
  const remainingIds = new Set(remainingTasks.map(task => task.id))
  return {
    current: { ...plan, tasks: currentTasks, summary: `${plan.summary} 本阶段先完成至第一份正文候选，章后处理后继续。` },
    remaining: { ...plan, tasks: remainingTasks.map(task => ({ ...task, dependsOn: task.dependsOn.filter(id => remainingIds.has(id)) })), summary: '继续已确认方向的后续创作阶段。' },
  }
}
export async function persistLongformContinuationV1(scope: WorkspaceScope, conversationId: number, current: MasterAgentPlan, remaining: MasterAgentPlan) {
  await appendAgentEvent({ projectId: scope.projectId, scope, conversationId, kind: 'plan', content: `后续 ${remaining.tasks.length} 个任务已保存，等待本阶段与章后处理完成。`, payload: { type: 'longform-continuation-v1', currentHash: await hashMasterAgentPlanV1(current), remaining } })
}
/** Publishing a proposal is read/plan-only; it never starts the next generation on refresh. */
export async function publishLongformContinuationV1(scope: WorkspaceScope, runId: number): Promise<boolean> {
  const restored = await restoreMasterAgentCandidatesV1({ scope, runId })
  if (restored.snapshot.projection.state !== 'completed') return false
  const conversationId = restored.snapshot.run.conversationId
  if (conversationId == null) return false
  const events = await readAgentEvents(conversationId, scope)
  if (events.some(event => parseAgentEventPayload<{ continuationRunId?: number }>(event, {}).continuationRunId === runId)) return false
  const currentHash = await hashMasterAgentPlanV1(restored.plan)
  const event = [...events].reverse().find(row => {
    const payload = parseAgentEventPayload<{ type?: string; currentHash?: string }>(row, {})
    return payload.type === 'longform-continuation-v1' && payload.currentHash === currentHash
  })
  if (!event) return false
  const payload = parseAgentEventPayload<{ remaining: MasterAgentPlan }>(event, {} as { remaining: MasterAgentPlan })
  const plan = parseMasterAgentPlanV1(payload.remaining)
  await appendAgentEvent({ projectId: scope.projectId, scope, conversationId, kind: 'plan', content: plan.summary, payload: { type: 'longform-plan-draft-v1', plan: { ...plan, phase: 'proposal' }, continuationRunId: runId } })
  return true
}
