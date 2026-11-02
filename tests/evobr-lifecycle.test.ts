import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/lib/db/schema'
import { openCurrentSchema } from '../src/lib/db/ensure-schema'
import { createWorkspace } from '../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../src/lib/workspace/scope'
import { deriveExportProjectJSON } from '../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../src/lib/export/registry-import'
import { inspectProjectBackup } from '../src/lib/export/backup-trust'
import { transactionTablesFor } from '../src/lib/registry/lifecycle'
import { PROJECT_TABLES } from '../src/lib/registry/project-tables'

describe('EvoBR isolated Long Form persistence', () => {
  beforeEach(async () => { await db.delete(); await openCurrentSchema() })
  afterEach(() => db.close())

  async function savedNovel() {
    const { scope } = await createWorkspace({ name: 'EvoBR continuity', genres: ['fantasy'], description: '', targetWordCount: 1_000_000, status: 'drafting' })
    const now = Date.now()
    const outlineId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      parentId: null, type: 'chapter', title: 'Chapter one', summary: 'The key changes hands.', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'work' })) as number
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      outlineNodeId: outlineId, title: 'Chapter one', content: '<p>Minh gave Lan the key.</p>', wordCount: 6, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
    }, { owner: 'work' })) as number
    return { scope, chapterId }
  }

  it('reopens saved content and performs a registry-derived full backup round trip', async () => {
    const { scope, chapterId } = await savedNovel()
    db.close()
    await openCurrentSchema()
    expect((await db.chapters.get(chapterId))?.content).toContain('Lan the key')
    const backup = await deriveExportProjectJSON(scope.projectId)
    expect(inspectProjectBackup(backup).valid).toBe(true)
    for (const spec of PROJECT_TABLES.filter(s => s.exportable && s.name !== 'projects')) expect(Array.isArray((backup as any)[spec.name])).toBe(true)
    const imported = await deriveImportProjectJSON(backup)
    const restored = await db.chapters.where('projectId').equals(imported).first()
    expect(restored?.content).toBe((await db.chapters.get(chapterId))?.content)
    expect(restored?.id).not.toBe(chapterId)
  })

  it('rolls back a failed import and preserves every existing manuscript', async () => {
    const { scope, chapterId } = await savedNovel()
    const backup = await deriveExportProjectJSON(scope.projectId)
    const projectCount = await db.projects.count()
    await expect(deriveImportProjectJSON(backup, { finalizeInTransaction: () => { throw new Error('simulated storage failure') } })).rejects.toThrow('simulated storage failure')
    expect(await db.projects.count()).toBe(projectCount)
    expect((await db.chapters.get(chapterId))?.content).toContain('Minh gave Lan')
  })

  it('rejects excluded product records rather than silently dropping them during restore', async () => {
    const { scope } = await savedNovel()
    const backup = await deriveExportProjectJSON(scope.projectId)
    const foreign = { ...backup, productRuntimeSessions: [{ _exportId: 0, kind: 'text-adventure' }] }
    expect(inspectProjectBackup(foreign).valid).toBe(false)
    await expect(deriveImportProjectJSON(foreign)).rejects.toThrow()
    expect(await db.projects.count()).toBe(1)
  })

  it('derives deletion/import transactions from the retained table registry', () => {
    const actual = transactionTablesFor('importProject').map(table => table.name)
    expect(actual).toEqual(expect.arrayContaining(['works', 'chapters', 'agentRuns', 'temporalFacts', 'knowledgeLedger']))
    expect(actual.some(name => /^(product|ttrpg|avg|motionDrama)/.test(name))).toBe(false)
  })
})
