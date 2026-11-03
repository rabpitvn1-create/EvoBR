/**
 * P2 D07: real registry-export/import round-trip over fake IndexedDB.
 * No mock importer: these tests call production Dexie table definitions,
 * ownership remaps and the normal backup trust/transaction boundary.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { deriveExportProjectJSON, CURRENT_EXPORT_VERSION } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { CURRENT_BACKUP_VERSION, inspectProjectBackup } from '../../src/lib/export/backup-trust'

type BackupV18 = Awaited<ReturnType<typeof deriveExportProjectJSON>>
type Portable = Record<string, any>
const now = 1740000000000

const session = (projectId: number, workId: number, tag: string, parentSessionId: number | null) => ({
  projectId, workId, parentSessionId, forkTurnId: null as number | null,
  headTurnId: null as number | null, memoryReadyThroughTurnId: null as number | null,
  revision: 0, status: 'active' as const,
  canonBaselineRef: tag, canonBaselineHash: 'b'.repeat(64),
  canonBaselineSnapshotJson: JSON.stringify({ version: 1, tag }),
  createdAt: now, updatedAt: now,
})
const turn = (projectId: number, sessionId: number, turnOrdinal: number, parentTurnId: number | null) => ({
  projectId, sessionId, turnOrdinal, parentTurnId,
  content: 'Cao Minh đi tiếp ' + sessionId + '/' + turnOrdinal,
  contentHash: 'a'.repeat(64), status: 'published' as const,
  sceneHintsJson: null, createdAt: now,
})
async function seedBranchingReader() {
  const { scope } = await createWorkspace({
    name: 'D07 Reader portability', genres: ['horror'],
    description: '', targetWordCount: 0, status: 'drafting',
  })
  const root = await db.readerSessions.add(session(scope.projectId, scope.workId, 'root', null))
  const t1 = await db.readerTurns.add(turn(scope.projectId, root, 1, null))
  const t2 = await db.readerTurns.add(turn(scope.projectId, root, 2, t1))
  await db.readerSessions.update(root, { headTurnId: t2, memoryReadyThroughTurnId: t1, revision: 2 })

  const child = await db.readerSessions.add({
    ...session(scope.projectId, scope.workId, 'child', root),
    forkTurnId: t1, headTurnId: t1,
  })
  const t3 = await db.readerTurns.add(turn(scope.projectId, child, 1, t1))
  await db.readerSessions.update(child, { headTurnId: t3, memoryReadyThroughTurnId: t1, revision: 1 })

  const grandchild = await db.readerSessions.add({
    ...session(scope.projectId, scope.workId, 'grandchild', child),
    forkTurnId: t3, headTurnId: t3, memoryReadyThroughTurnId: t1,
  })
  const t4 = await db.readerTurns.add(turn(scope.projectId, grandchild, 1, t3))
  await db.readerSessions.update(grandchild, { headTurnId: t4, revision: 1 })
  return { scope, root, child, grandchild, t1, t2, t3, t4 }
}
const readerPortable = (backup: BackupV18, table: string): Portable[] =>
  (backup as unknown as Record<string, Portable[]>)[table]
async function expectAtomicFailure(backup: BackupV18, label: string) {
  const projectCount = await db.projects.count()
  const sessionCount = await db.readerSessions.count()
  const turnCount = await db.readerTurns.count()
  await expect(deriveImportProjectJSON(backup)).rejects.toThrow(label)
  expect(await db.projects.count()).toBe(projectCount)
  expect(await db.readerSessions.count()).toBe(sessionCount)
  expect(await db.readerTurns.count()).toBe(turnCount)
}

describe('P2 D07 reader session/turn portable remapping', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('v18 export and import preserve all three deferred session pointers and nested fork trees', async () => {
    const { scope, t1, t2, t3, t4 } = await seedBranchingReader()
    expect(CURRENT_EXPORT_VERSION).toBe(18)
    expect(CURRENT_BACKUP_VERSION).toBe(18)
    const backup = await deriveExportProjectJSON(scope.projectId)
    expect(backup.version).toBe(18)
    expect(inspectProjectBackup(backup).valid).toBe(true)
    const sourceSessions = readerPortable(backup, 'readerSessions')
    const sourceTurns = readerPortable(backup, 'readerTurns')
    expect(sourceSessions).toHaveLength(3)
    expect(sourceTurns).toHaveLength(4)
    expect(sourceSessions.every(row => !('workId' in row) && !('headTurnId' in row)
      && !('forkTurnId' in row) && Number.isInteger(row._workExportId))).toBe(true)
    expect(sourceTurns.every(row => !('sessionId' in row) && Number.isInteger(row._sessionExportId))).toBe(true)

    const importedId = await deriveImportProjectJSON(backup)
    expect(importedId).not.toBe(scope.projectId)
    const sessions = await db.readerSessions.where('projectId').equals(importedId).toArray()
    const turns = await db.readerTurns.where('projectId').equals(importedId).toArray()
    expect(sessions).toHaveLength(3)
    expect(turns).toHaveLength(4)
    const byTag = Object.fromEntries(sessions.map(row => [row.canonBaselineRef, row]))
    const root = byTag.root!, child = byTag.child!, grand = byTag.grandchild!
    expect(root.parentSessionId).toBeNull()
    expect(child.parentSessionId).toBe(root.id)
    expect(grand.parentSessionId).toBe(child.id)
    expect(child.forkTurnId).not.toBeNull()
    expect(grand.forkTurnId).not.toBeNull()

    const own = (sid: number | undefined) => turns.filter(row => row.sessionId === sid)
    const rootTurns = own(root.id), childTurns = own(child.id), grandTurns = own(grand.id)
    expect(rootTurns).toHaveLength(2)
    expect(childTurns).toHaveLength(1)
    expect(grandTurns).toHaveLength(1)
    const rootFirst = rootTurns.find(row => row.turnOrdinal === 1)!
    const rootSecond = rootTurns.find(row => row.turnOrdinal === 2)!
    const childFirst = childTurns[0]!, grandFirst = grandTurns[0]!
    expect(rootSecond.parentTurnId).toBe(rootFirst.id)
    expect(childFirst.parentTurnId).toBe(rootFirst.id)
    expect(grandFirst.parentTurnId).toBe(childFirst.id)
    expect(root.headTurnId).toBe(rootSecond.id)
    expect(child.headTurnId).toBe(childFirst.id)
    expect(grand.headTurnId).toBe(grandFirst.id)
    expect(child.forkTurnId).toBe(rootFirst.id)
    expect(grand.forkTurnId).toBe(childFirst.id)
    expect(root.memoryReadyThroughTurnId).toBe(rootFirst.id)
    expect(child.memoryReadyThroughTurnId).toBe(rootFirst.id)
    expect(grand.memoryReadyThroughTurnId).toBe(rootFirst.id)
    expect(rootFirst.id).not.toBe(t1)
    expect(rootSecond.id).not.toBe(t2)
    expect(childFirst.id).not.toBe(t3)
    expect(grandFirst.id).not.toBe(t4)
  })

  for (const [field, label] of [
    ['_headTurnExportId', 'headTurnId'],
    ['_forkTurnExportId', 'forkTurnId'],
    ['_memoryReadyThroughTurnExportId', 'memoryReadyThroughTurnId'],
  ] as const) {
    it('rejects missing required deferred mapping ' + field + ' without partial project import', async () => {
      const { scope } = await seedBranchingReader()
      const backup = await deriveExportProjectJSON(scope.projectId)
      const child = readerPortable(backup, 'readerSessions').find(row => row.canonBaselineRef === 'child')!
      child[field] = 1000000
      await expectAtomicFailure(backup, '缺失延迟外键映射')
    })
  }

  it('rejects dangling parent session instead of silently materializing a root', async () => {
    const { scope } = await seedBranchingReader()
    const backup = await deriveExportProjectJSON(scope.projectId)
    readerPortable(backup, 'readerSessions').find(row => row.canonBaselineRef === 'child')!._parentExportId = 1000000
    await expectAtomicFailure(backup, 'reader tree parent reference missing')
  })

  it('rejects parent-turn cycles without importing half a lineage', async () => {
    const { scope } = await seedBranchingReader()
    const backup = await deriveExportProjectJSON(scope.projectId)
    const rows = readerPortable(backup, 'readerTurns')
    const first = rows.find(row => row._parentExportId == null)!
    const second = rows.find(row => row._parentExportId === first._exportId)!
    first._parentExportId = second._exportId
    await expectAtomicFailure(backup, 'reader tree cycle')
  })

  it('fails export if a published session claims a missing local head turn', async () => {
    const { scope, root } = await seedBranchingReader()
    await db.readerSessions.update(root, { headTurnId: 9999999 })
    await expect(deriveExportProjectJSON(scope.projectId)).rejects.toThrow('缺失必填外键映射:readerSessions.headTurnId')
  })

  it('rejects v17 backup that illegally contains reader tables instead of silently stripping them', async () => {
    const { scope } = await seedBranchingReader()
    const backup = await deriveExportProjectJSON(scope.projectId)
    const mislabeled = { ...backup, version: 17 }
    expect(inspectProjectBackup(mislabeled).valid).toBe(false)
    await expectAtomicFailure(mislabeled, 'v17 不允许携带')
  })
})
