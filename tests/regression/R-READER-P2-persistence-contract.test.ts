/**
 * P2 D01–D06, D08–D09 persistence proofs on real Dexie and fake-indexeddb.
 * D07 is separately proved by R-READER-D07-portable-lineage.test.ts.
 * P5 still owns atomic publish/CAS, so these tests do not pretend to prove it.
 */
import Dexie from 'dexie'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db, STORYFORGE_DATABASE_NAME, STORYFORGE_SCHEMA_VERSION, STORYFORGE_STORES_V13 } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import {
  createRootReaderSessionV1, captureReaderCanonBaselineV1, verifyReaderCanonBaselineV1,
  forkReaderSessionV1, archiveReaderSessionV1, assertReaderParentTurnV1,
} from '../../src/lib/reader/baseline'
import type { WorkspaceScope } from '../../src/lib/types/world-ownership'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'

const limit = 2_000_000
const now = 1740000000000
const hash = 'b'.repeat(64)
const makeTurn = (scope: WorkspaceScope, sessionId: number, ordinal: number, parentTurnId: number | null) =>
  ({ projectId: scope.projectId, sessionId, turnOrdinal: ordinal,
    parentTurnId, content: 'Cao Minh đi qua cửa ' + ordinal,
    contentHash: hash, status: 'published' as const, sceneHintsJson: null, createdAt: now })
async function workspace() {
  const { scope } = await seedCurrentWorkspace('P2 reader persistence')
  return scope
}
/** Real durable agent-run identity for receipt FK portability, never a fake chapter ID. */
async function durableRunForReceipt(scope: WorkspaceScope): Promise<number> {
  const worldGroupId = await db.worldGroups.add({
    projectId: scope.projectId, worldId: scope.worldId,
    name: 'Reader provenance world', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId: scope.projectId, workId: scope.workId, worldId: null,
    worldGroupId, parentId: null, type: 'volume', title: 'Verified run',
    summary: '', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  await stampCurrentFixtureResourceUidsV1(scope.projectId)
  const contract = {
    version: 1, runtimeBindingHash: 'a'.repeat(64),
    objective: 'Verify reader receipt FK portability',
    workflowKind: 'long-running-resumable',
    scope: { projectId: scope.projectId, worldGroupId, outlineNodeIds: [outlineNodeId] },
    permissions: {
      contextSourceKeys: ['worldview', 'storyCore'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }],
    },
    budget: {
      maxModelCalls: 3, maxToolCalls: 4, maxInputTokens: 8000,
      maxOutputTokens: 2000, maxAttemptsPerStep: 2,
    },
    acceptance: [{ id: 'outline.output', kind: 'output-present', required: true }],
    verificationPlan: [{
      id: 'outline.terminal', kind: 'terminal', verifier: 'terminal-v1',
      criterionIds: ['outline.output'],
    }],
    failurePolicy: {
      onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author',
    },
  }
  const record = await createAgentRunV1({ scope, worldGroupId, contract })
  return record.run.id
}

async function rootWithHistory(scope: WorkspaceScope) {
  const root = await createRootReaderSessionV1(scope, { maxSnapshotBytes: limit })
  const a = await db.readerTurns.add(makeTurn(scope, root, 1, null))
  const b = await db.readerTurns.add(makeTurn(scope, root, 2, a))
  await db.readerSessions.update(root, { headTurnId: b, revision: 2, memoryReadyThroughTurnId: a })
  return { root, a, b }
}

describe('P2 persistent reader contract D01–D06/D08–D09', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('D01: upgrades an actual populated Dexie v13 database to v14 with all old data unchanged', async () => {
    await db.delete()
    const legacy = new Dexie(STORYFORGE_DATABASE_NAME)
    legacy.version(13).stores(STORYFORGE_STORES_V13)
    await legacy.open()
    const legacyProjectId = await legacy.table('projects').add({
      workspaceUid: 'p2-legacy-workspace-001', workspacePurpose: 'independent-work',
      name: 'Manuscript written before reader v14',
      enableMultiWorld: false, activeWorldId: null, activeWorkId: null,
      createdAt: now, updatedAt: now,
    }) as number
    const oldData = await legacy.table('projects').get(legacyProjectId)
    legacy.close()
    await db.open()
    expect(db.verno).toBe(STORYFORGE_SCHEMA_VERSION)
    expect(STORYFORGE_SCHEMA_VERSION).toBe(14)
    expect(await db.projects.get(legacyProjectId)).toEqual(oldData)
    const newTables = [
      'readerSessions', 'readerTurns', 'readerChoices', 'readerDecisions',
      'readerFacts', 'readerKnowledge', 'readerMemory',
      'readerRetrievalChunks', 'readerPublicationRuns',
    ]
    for (const table of newTables) {
      expect(db.tables.some(t => t.name === table)).toBe(true)
      expect(await db.table(table).count()).toBe(0)
    }
  })

  it('D02: same-Work contradictory confirmed facts remain in independent sessions; foreign fork is rejected', async () => {
    const scope = await workspace()
    const first = await rootWithHistory(scope)
    const second = await rootWithHistory(scope)
    const secondTurn = await db.readerTurns.get(second.a)
    expect(secondTurn?.sessionId).toBe(second.root)
    await db.readerFacts.bulkAdd([
      { projectId: scope.projectId, sessionId: first.root, originTurnId: first.a,
        predicate: 'light', subjectRef: 'level0', valueJson: '"on"', evidenceQuote: 'Cao Minh',
        sourceHash: hash, status: 'confirmed', createdAt: now },
      { projectId: scope.projectId, sessionId: second.root, originTurnId: second.a,
        predicate: 'light', subjectRef: 'level0', valueJson: '"off"', evidenceQuote: 'Cao Minh',
        sourceHash: hash, status: 'confirmed', createdAt: now },
    ])
    const firstFacts = await db.readerFacts.where('sessionId').equals(first.root).toArray()
    const secondFacts = await db.readerFacts.where('sessionId').equals(second.root).toArray()
    expect(firstFacts.map(f => f.valueJson)).toEqual(['"on"'])
    expect(secondFacts.map(f => f.valueJson)).toEqual(['"off"'])
    await expect(forkReaderSessionV1(scope, first.root, second.a)).rejects.toThrow(/fork cutoff/)
    await expect(assertReaderParentTurnV1(scope, first.root, second.a)).rejects.toThrow(/parent turn must match/)
    await expect(assertReaderParentTurnV1(scope, first.root, first.b)).resolves.toBeUndefined()
    const other = await seedCurrentWorkspace('Different reader Work')
    await expect(forkReaderSessionV1(other.scope, first.root, first.a)).rejects.toThrow(/foreign parent/)
  })

  it('D02 negative import: a published turn cannot adopt a sibling session parent in the same Work', async () => {
    const scope = await workspace()
    const first = await rootWithHistory(scope)
    const second = await rootWithHistory(scope)
    const backup = await deriveExportProjectJSON(scope.projectId)
    const portableSessions = (backup as any).readerSessions as Array<Record<string, any>>
    const portableTurns = (backup as any).readerTurns as Array<Record<string, any>>
    const firstExportSession = portableSessions.find(r => r.headTurnId == null &&
      r._headTurnExportId != null && r._headTurnExportId !== undefined &&
      r._exportId === portableTurns.find(t => t._parentExportId == null && t._sessionExportId === r._exportId)?._sessionExportId)
    const firstSession = firstExportSession ?? portableSessions[0]
    const otherSession = portableSessions.find(s => s._exportId !== firstSession._exportId)!
    const firstChild = portableTurns.find(t => t._sessionExportId === firstSession._exportId && t._parentExportId != null)!
    const otherRoot = portableTurns.find(t => t._sessionExportId === otherSession._exportId && t._parentExportId == null)!
    firstChild._parentExportId = otherRoot._exportId
    const before = await db.projects.count()
    await expect(deriveImportProjectJSON(backup)).rejects.toThrow(/published turn parent crosses unrelated/)
    expect(await db.projects.count()).toBe(before)
    expect((await db.readerSessions.get(first.root))?.headTurnId).toBe(first.b)
    expect((await db.readerSessions.get(second.root))?.headTurnId).toBe(second.b)
  })

  it('D03: nested forks share a published ancestor prefix without editing either parent head', async () => {
    const scope = await workspace()
    const { root, a, b } = await rootWithHistory(scope)
    const child = await forkReaderSessionV1(scope, root, a)
    const c = await db.readerTurns.add(makeTurn(scope, child, 1, a))
    await db.readerSessions.update(child, { headTurnId: c, revision: 1 })
    const grandchild = await forkReaderSessionV1(scope, child, c)
    const d = await db.readerTurns.add(makeTurn(scope, grandchild, 1, c))
    await db.readerSessions.update(grandchild, { headTurnId: d, revision: 1 })
    const later = await db.readerTurns.add(makeTurn(scope, root, 3, b))
    await db.readerSessions.update(root, { headTurnId: later, revision: 3 })
    expect((await db.readerSessions.get(root))?.headTurnId).toBe(later)
    expect((await db.readerSessions.get(child))?.forkTurnId).toBe(a)
    expect((await db.readerSessions.get(grandchild))?.forkTurnId).toBe(c)
    expect((await db.readerTurns.get(d))?.parentTurnId).toBe(c)
    await expect(forkReaderSessionV1(scope, child, later)).rejects.toThrow(/fork cutoff/)
    expect(await db.readerTurns.where('sessionId').equals(root).count()).toBe(3)
    expect(await db.readerTurns.where('sessionId').equals(child).count()).toBe(1)
  })

  it('D04: immutable record kinds and identities reject duplicate publication rows without exposing disabled choices', async () => {
    const scope = await workspace()
    const { root, a } = await rootWithHistory(scope)
    const turn = makeTurn(scope, root, 1, null)
    expect((await db.readerTurns.get(a))?.status).toBe('published')
    await expect(db.readerTurns.add(turn)).rejects.toThrow()
    const choice = {
      projectId: scope.projectId, sessionId: root, turnId: a, choiceKey: 'continue',
      kind: 'continue' as const, text: 'Đọc tiếp', order: 0,
      status: 'available' as const, createdAt: now,
    }
    await db.readerChoices.add(choice)
    await expect(db.readerChoices.add(choice)).rejects.toThrow()
    expect((await db.readerChoices.where('turnId').equals(a).first())?.status).toBe('available')
    await expect(db.readerTurns.update(a, { content: 'Tampered prose' })).rejects.toThrow(/immutable/)
    const recordedChoice = await db.readerChoices.where('turnId').equals(a).first()
    await expect(db.readerChoices.update(recordedChoice!.id!, { text: 'Tampered choice' })).rejects.toThrow(/immutable/)
    expect((await db.readerTurns.get(a))?.content).not.toBe('Tampered prose')
    for (const name of ['readerTurns', 'readerChoices', 'readerPublicationRuns']) {
      expect(ADOPTION_BY_TARGET.get(name)?.duplicatePolicy).toBe('error')
    }
    // P5 must still prove atomic insert/CAS and receipt integrity across tables.
  })

  it('D05: archive preserves referenced ancestors and child pointers instead of destructive deletion', async () => {
    const scope = await workspace()
    const { root, a } = await rootWithHistory(scope)
    const child = await forkReaderSessionV1(scope, root, a)
    await archiveReaderSessionV1(scope, root)
    expect((await db.readerSessions.get(root))?.status).toBe('archived')
    expect((await db.readerSessions.get(child))?.parentSessionId).toBe(root)
    expect((await db.readerTurns.get(a))?.sessionId).toBe(root)
    await expect(forkReaderSessionV1(scope, root, a)).rejects.toThrow(/archived/)
    // Deleting the entire parent Project is an explicit separate lifecycle.
    const other = await workspace()
    const second = await rootWithHistory(other)
    await cascadeDeleteProject(other.projectId)
    expect(await db.readerSessions.get(second.root)).toBeUndefined()
    expect((await db.readerSessions.get(root))?.headTurnId).not.toBeNull()
  })

  it('D06: export/import restores a real selected choice and decision with nested fork lineage', async () => {
    const scope = await workspace()
    const { root, a } = await rootWithHistory(scope)
    const child = await forkReaderSessionV1(scope, root, a)
    const next = await db.readerTurns.add(makeTurn(scope, child, 1, a))
    await db.readerSessions.update(child, { headTurnId: next, revision: 1 })
    const choiceId = await db.readerChoices.add({
      projectId: scope.projectId, sessionId: root, turnId: a,
      choiceKey: 'go', kind: 'branch', text: 'Đi tiếp', order: 0,
      status: 'available', createdAt: now,
    })
    await db.readerDecisions.add({
      projectId: scope.projectId, sessionId: child, requestKey: 'one',
      sourceTurnId: a, choiceId, resultTurnId: next, createdAt: now,
    })
    const runId = await durableRunForReceipt(scope)
    await db.readerPublicationRuns.add({
      projectId: scope.projectId, sessionId: child, requestKey: 'one',
      runId, candidateHash: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64),
      contextManifestHash: 'c'.repeat(64), semanticArtifactHash: 'd'.repeat(64),
      expectedSessionRevision: 0, resultTurnId: next,
      receiptJson: JSON.stringify({ contractVersion: 1, status: 'committed' }),
      status: 'committed', createdAt: now,
    })
    const backup = await deriveExportProjectJSON(scope.projectId)
    expect((backup as any).readerDecisions).toHaveLength(1)
    expect((backup as any).readerPublicationRuns).toHaveLength(1)
    const restored = await deriveImportProjectJSON(backup)
    const decision = await db.readerDecisions.where('projectId').equals(restored).first()
    expect(decision).toBeDefined()
    const chosen = await db.readerChoices.get(decision!.choiceId)
    expect(chosen?.choiceKey).toBe('go')
    expect((await db.readerTurns.get(decision!.sourceTurnId))?.content).toContain('Cao Minh')
    expect((await db.readerTurns.get(decision!.resultTurnId))?.sessionId).toBe(decision!.sessionId)
    const receipt = await db.readerPublicationRuns.where('projectId').equals(restored).first()
    expect(receipt?.status).toBe('committed')
    expect(receipt?.requestFingerprint).toBe('b'.repeat(64))
    expect(receipt?.resultTurnId).toBe(decision!.resultTurnId)
    expect((await db.agentRuns.get(receipt!.runId))?.projectId).toBe(restored)
    expect(receipt?.runId).not.toBe(runId)
  })

  it('D08: snapshot is immutable across Work edits, confirmed-only and byte-identical at fork', async () => {
    const scope = await workspace()
    await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
      predicate: 'light', value: 'on', status: 'candidate',
      createdAt: now, updatedAt: now,
    }, { owner: 'work' }) as any)
    await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
      predicate: 'light', value: 'off', status: 'confirmed',
      createdAt: now, updatedAt: now,
    }, { owner: 'work' }) as any)
    const root = await createRootReaderSessionV1(scope, { maxSnapshotBytes: limit })
    const stored = (await db.readerSessions.get(root))!
    await verifyReaderCanonBaselineV1(stored)
    const snapshot = JSON.parse(stored.canonBaselineSnapshotJson)
    const facts = snapshot.resources.find((x: any) => x.table === 'temporalFacts').records
    expect(facts.some((f: any) => f.status === 'candidate')).toBe(false)
    expect(facts.filter((f: any) => f.status === 'confirmed')).toHaveLength(1)
    await db.works.update(scope.workId, { title: 'Changed title after root snapshot' })
    expect((await db.readerSessions.get(root))!.canonBaselineSnapshotJson).toBe(stored.canonBaselineSnapshotJson)
    const t = await db.readerTurns.add(makeTurn(scope, root, 1, null))
    await db.readerSessions.update(root, { headTurnId: t, revision: 1 })
    const fork = await forkReaderSessionV1(scope, root, t)
    expect((await db.readerSessions.get(fork))!.canonBaselineSnapshotJson).toBe(stored.canonBaselineSnapshotJson)
    expect((await db.readerSessions.get(fork))!.canonBaselineHash).toBe(stored.canonBaselineHash)
  })

  it('D09: rejects missing roots, altered hash and snapshot above hard byte cap without partial creation', async () => {
    const scope = await workspace()
    const initial = await db.readerSessions.count()
    await expect(createRootReaderSessionV1(scope, { maxSnapshotBytes: 1 })).rejects.toThrow(/hard bound/)
    expect(await db.readerSessions.count()).toBe(initial)
    await expect(captureReaderCanonBaselineV1({ ...scope, workId: 9999999 }, { maxSnapshotBytes: limit }))
      .rejects.toThrow(/missing or foreign/)
    const root = await createRootReaderSessionV1(scope, { maxSnapshotBytes: limit })
    const stored = (await db.readerSessions.get(root))!
    await expect(verifyReaderCanonBaselineV1({
      ...stored, canonBaselineHash: '0'.repeat(64),
    })).rejects.toThrow(/hash/)
    await expect(verifyReaderCanonBaselineV1({
      ...stored, canonBaselineSnapshotJson: '{}',
    })).rejects.toThrow(/schema/)
    expect(await db.readerSessions.count()).toBe(initial + 1)
  })
})
