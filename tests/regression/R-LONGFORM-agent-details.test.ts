import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { OutlineNode } from '../../src/lib/types'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { runDurableMasterAgentPlanV1, restoreMasterAgentCandidatesV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { prepareDetailedOutlineAuthoringV1, adoptDetailedOutlineAuthoringV1 } from '../../src/lib/agent/detailed-outline-authoring'
import * as entries from '../../src/lib/agent/formal-ai-entry'

const output = JSON.stringify({ openingHook: '来信上的印章仍然温热。', endingCliffhanger: '门外响起失踪亲人的敲门声。', sceneLocation: '旧港邮局', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], prohibitions: [], scenes: [{ title: '查验来信', summary: '邮差拒绝承认送过这封信，主角必须找到登记簿证明自己的记忆。', location: '邮局柜台', conflict: '主角需要证据，邮差却急于关门。', pace: 'fast', characterIds: [], estimatedWords: 1200 }] })
async function seed() {
  const fixture = await seedCurrentWorkspace('Agent 场景细纲验收')
  const volumeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { parentId: null, type: 'volume', title: '第一卷', summary: '追寻旧信', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { parentId: volumeId, type: 'chapter', title: '旧港来信', summary: '主角收到不可能寄出的家书，前往邮局寻找证据。', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
  return { ...fixture, outlineNodeId }
}
describe.sequential('main Agent shares the stepped scene outline capability', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('routes a scene request to outline.details, restores its candidate and adopts into the same detailed outline', async () => {
    const fixture = await seed()
    const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '生成第一章的场景细纲' })
    expect(plan.tasks).toHaveLength(1); expect(plan.tasks[0].skillId).toBe('outline.details')
    const conversation = await getOrCreateAgentConversation({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, purpose: 'master-authoring' })
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1').mockResolvedValue(output)
    const result = await runDurableMasterAgentPlanV1({ scope: fixture.scope, worldGroupId: null, conversationId: conversation.id!, plan })
    expect(model).toHaveBeenCalledOnce()
    expect(await db.detailedOutlines.count()).toBe(0)
    const restored = await restoreMasterAgentCandidatesV1({ scope: fixture.scope, runId: result.runId })
    expect(restored.candidates).toHaveLength(1)
    await commitMasterAgentCandidateAdoptionV1({ scope: fixture.scope, runId: result.runId, candidateEventId: restored.candidates[0].event.id!, worldGroupId: null })
    const detail = await db.detailedOutlines.where('outlineNodeId').equals(fixture.outlineNodeId).first()
    expect(detail?.scenes[0].title).toBe('查验来信')
    expect((await verifyMasterAgentRunV1({ scope: fixture.scope, runId: result.runId })).accepted).toBe(true)
  })
  it('refuses adoption after the author changes the selected outline', async () => {
    const fixture = await seed()
    const prepared = await prepareDetailedOutlineAuthoringV1({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, authorRequest: '第一章场景细纲' })
    await db.outlineNodes.update(fixture.outlineNodeId, { summary: '已修改的章纲', updatedAt: Date.now() })
    await expect(adoptDetailedOutlineAuthoringV1(fixture.scope, null, prepared.snapshot, output)).rejects.toThrow('已变化')
    expect(await db.detailedOutlines.count()).toBe(0)
  })
  it('refuses an explicit chapter that does not exist', async () => {
    const fixture = await seed()
    await expect(prepareDetailedOutlineAuthoringV1({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, authorRequest: '第99章场景细纲' })).rejects.toThrow('未找到指定')
  })
})
