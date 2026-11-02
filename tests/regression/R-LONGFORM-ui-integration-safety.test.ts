import { appendAgentEvent, getOrCreateAgentConversation, readAgentEvents, saveLongformPlanningSummaryV1, buildLongformPlanningDialogueV1 } from '../../src/lib/agent/conversations'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { OutlineNode } from '../../src/lib/types'
import { freezeOutlineReviewTarget, adoptOutlineReview } from '../../src/lib/outline/review-adoption'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import { createMasterAgentPlan, executeMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import * as outlineCopilot from '../../src/lib/agent/outline-copilot'
import * as progressCopilot from '../../src/lib/agent/storyline-progress-copilot'

describe('longform integration: stable targets and governed dispatch', () => {
  let fixture: Awaited<ReturnType<typeof seedCurrentWorkspace>>
  let chapter: OutlineNode
  beforeEach(async () => {
    await db.delete(); await db.open()
    fixture = await seedCurrentWorkspace('长篇隔离验收')
    const volumeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
    const row = stampNewRecord(fixture.scope, 'outlineNodes', { parentId: volumeId, type: 'chapter', title: '开端', summary: '抵达港城', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode
    const id = await db.outlineNodes.add(row)
    chapter = { ...row, id }
  })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('adopts a reviewed summary into its original chapter', async () => {
    await adoptOutlineReview(await freezeOutlineReviewTarget(chapter), fixture.project.id!, '抵达港城，寻找旧信')
    expect((await db.outlineNodes.get(chapter.id!))?.summary).toBe('抵达港城，寻找旧信')
  })
  it.each(['summary', 'order', 'title'] as const)('rejects a review after %s changes', async field => {
    const target = await freezeOutlineReviewTarget(chapter)
    const value = field === 'order' ? 3 : '作者的新内容'
    await db.outlineNodes.update(chapter.id!, { [field]: value })
    await expect(adoptOutlineReview(target, fixture.project.id!, '旧候选')).rejects.toThrow('CAS')
    expect((await db.outlineNodes.get(chapter.id!))?.[field]).toBe(value)
  })
  it('rejects a candidate belonging to another work', async () => {
    const other = await seedCurrentWorkspace('另一作品')
    await expect(adoptOutlineReview(await freezeOutlineReviewTarget(chapter), other.project.id!, '错误')).rejects.toThrow('不属于')
  })
  it('refuses an explicitly missing chapter before any model call', async () => {
    await expect(prepareProseCopilot({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, authorRequest: '写第99章正文' })).rejects.toThrow('未找到指定的第99章')
    expect((await db.outlineNodes.get(chapter.id!))?.summary).toBe(chapter.summary)
  })
  it('persists a proposal boundary and includes the scoped conversation in planning', async () => {
    const conversation = await getOrCreateAgentConversation({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, purpose: 'master-authoring' })
    await appendAgentEvent({ projectId: fixture.project.id!, scope: fixture.scope, conversationId: conversation.id!, kind: 'message', role: 'user', content: '主角禁止使用魔法，结尾必须回到故乡。' })
    let sent = ''
    const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '先讨论角色的动机，不要生成', conversationId: conversation.id!, planningOnly: true }, { complete: async messages => { sent = JSON.stringify(messages); return JSON.stringify({ summary: '他为什么要离开故乡？', tasks: [] }) } })
    expect(sent).toContain('主角禁止使用魔法')
    expect(plan.phase).toBe('proposal'); expect(plan.tasks).toHaveLength(0)
  })
  it('keeps full history while author-confirmed summaries bound planning context and enforce scope', async () => {
    const conversation = await getOrCreateAgentConversation({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, purpose: 'master-authoring' })
    await appendAgentEvent({ projectId: fixture.project.id!, scope: fixture.scope, conversationId: conversation.id!, kind: 'message', role: 'user', content: '早期探索'.repeat(13000) })
    await saveLongformPlanningSummaryV1({ projectId: fixture.project.id!, scope: fixture.scope, conversationId: conversation.id!, summary: '已确认：主角是守灯人，不使用魔法。' })
    await appendAgentEvent({ projectId: fixture.project.id!, scope: fixture.scope, conversationId: conversation.id!, kind: 'message', role: 'user', content: '下一步讨论第三卷。' })
    const events = await readAgentEvents(conversation.id!, fixture.scope)
    expect(events).toHaveLength(3)
    const dialogue = buildLongformPlanningDialogueV1(events)
    expect(dialogue).toContain('不使用魔法'); expect(dialogue).toContain('第三卷'); expect(dialogue).not.toContain('早期探索')
    const other = await seedCurrentWorkspace('摘要越界反例')
    await expect(saveLongformPlanningSummaryV1({ projectId: other.project.id!, scope: other.scope, conversationId: conversation.id!, summary: '错误摘要' })).rejects.toThrow('不属于')
    expect(await readAgentEvents(conversation.id!, fixture.scope)).toHaveLength(3)
  })
  it('keeps a proposal non-executable even when the planning model suggests tasks', async () => {
    const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '先讨论角色，不要生成' }, { complete: async () => JSON.stringify({ summary: '角色建议', tasks: [{ id: 'character-1', agentId: 'character', instruction: '创建主角', dependsOn: [] }] }) })
    expect(plan.phase).toBe('proposal')
    await expect(executeMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, plan })).rejects.toThrow('尚未获得作者确认')
  })
  it('does not replace a failed discussion with automatic generation', async () => {
    await expect(createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '先聊聊需求', planningOnly: true }, { complete: async () => { throw new Error('计划服务失败') } })).rejects.toThrow('计划服务失败')
  })
  it('keeps prose in the persisted staged plan after the outline barrier', async () => {
    const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '生成章纲，然后写第一章正文' }, { complete: async () => JSON.stringify({ summary: '先章纲，再正文', tasks: [{ id: 'outline-1', agentId: 'outline', instruction: '生成章纲', dependsOn: [] }, { id: 'prose-1', agentId: 'prose', instruction: '写第一章正文', dependsOn: [] }] }) })
    expect(plan.tasks.map(task => task.agentId)).toEqual(['outline', 'prose'])
    expect(plan.tasks[1].dependsOn).toContain('outline-1')
    expect(plan.workflow.workflowId).toBe('staged-author-confirmed')
  })
  it('keeps separate world fields and sequences same-domain tasks after adoption', async () => {
    const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '设计世界观的世界起源、力量体系，并设计一个角色' }, { complete: async () => JSON.stringify({ summary: '分字段处理', tasks: [{ id: 'world-1', agentId: 'world-origin', instruction: '生成世界起源', dependsOn: [] }, { id: 'world-2', agentId: 'world-origin', instruction: '生成力量体系', dependsOn: [] }, { id: 'character-1', agentId: 'character', instruction: '设计主角', dependsOn: ['world-2'] }] }) })
    expect(plan.tasks).toHaveLength(3)
    expect(plan.tasks[0].instruction).toBe('生成世界起源')
    expect(plan.tasks[1].dependsOn).toContain('world-1')
    expect(plan.workflow.workflowId).toBe('staged-author-confirmed')
  })
  it('dispatches a pinned storyline progress task to its specialist', async () => {
    const wrong = vi.spyOn(outlineCopilot, 'prepareOutlineCopilot').mockRejectedValue(new Error('WRONG'))
    const correct = vi.spyOn(progressCopilot, 'prepareStorylineProgressCopilotV1').mockRejectedValue(new Error('CORRECT'))
    const plan = await createMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, request: '更新本章故事线进度', pinnedTask: { agentId: 'outline', skillId: 'outline.storyline-progress', instruction: '映射指定章节', storylineProgressChapterId: chapter.id! } })
    await expect(executeMasterAgentPlan({ projectId: fixture.project.id!, scope: fixture.scope, worldGroupId: null, plan })).rejects.toThrow('CORRECT')
    expect(correct).toHaveBeenCalledOnce(); expect(wrong).not.toHaveBeenCalled()
  })
})
