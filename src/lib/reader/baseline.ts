/**
 * P2 immutable root baseline capture and safe session fork creation.
 * P3 Context Gateway and P5 Publication Gate consume these boundaries;
 * no model calls or chapter writes occur here.
 */
import Dexie from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { readOwnedRows } from '../workspace/scope'
import { canonicalWorldReleaseJsonV1, hashWorldReleaseValueV1 } from '../world-engine/release-hash'
import type { WorkspaceScope } from '../types/world-ownership'
import type { ReaderSessionV1, ReaderTurnV1 } from '../types/reader'

export const READER_BASELINE_SCHEMA_V1 = 'evobr.reader-canon-baseline'
export const READER_BASELINE_SELECTION_POLICY_V1 = 'reader-canon-confirmed-v1'
const ALLOWED_AREAS = new Set(['foundation', 'entities', 'multi-world', 'characters', 'relations', 'story', 'storylines'])
const WORK_INTENT_TABLES = new Set(['creativeRules', 'userStyleProfiles'])

function fail(reason: string): never { throw new Error('[readerBaseline] ' + reason) }
function assertHardLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) fail('explicit positive maxSnapshotBytes is required')
}
function sourceSpecs() {
  return PROJECT_TABLES.filter(spec => spec.exportable && spec.resourceIdentity &&
    ((spec.worldSemantic && ALLOWED_AREAS.has(spec.worldSemantic.area)) ||
      WORK_INTENT_TABLES.has(spec.name)))
}
function intendedWorkFields(work: Record<string, unknown>): Record<string, unknown> {
  // Author intent is frozen explicitly; do not capture volatile run/history
  // state, credentials, or derived reader facts as part of root Canon.
  const keys = ['code', 'kind', 'novelProfile', 'title', 'description', 'genres',
    'customGenre', 'writingStyleId', 'methodologyId', 'targetWordCount']
  return Object.fromEntries(keys.filter(key => work[key] !== undefined).map(key => [key, work[key]]))
}
export interface ReaderCanonBaselineCaptureV1 {
  canonBaselineSnapshotJson: string
  canonBaselineHash: string
  canonBaselineRef: string
}
async function captureInTransaction(scope: WorkspaceScope, maxSnapshotBytes: number): Promise<ReaderCanonBaselineCaptureV1> {
  const [project, world, work] = await Promise.all([
    db.projects.get(scope.projectId), db.worlds.get(scope.worldId), db.works.get(scope.workId),
  ])
  if (!project || !world || !work || world.projectId !== scope.projectId ||
    work.projectId !== scope.projectId || work.worldId !== scope.worldId) {
    fail('missing or foreign World/Work baseline roots')
  }
  const resources: Array<{ table: string; resourceKind: string; authority: string; records: Record<string, unknown>[] }> = []
  for (const spec of sourceSpecs()) {
    const rows = await readOwnedRows<Record<string, unknown>>(scope, spec.name, { owner: spec.domainOwner?.defaultOwner === 'world' ? 'world' : 'work' })
    const semantic = spec.worldSemantic
    const permitted = semantic?.canonPolicy === 'confirmed-rows-only'
      ? rows.filter(row => typeof row[semantic.statusField ?? 'status'] === 'string' &&
          semantic.confirmedStatusValues?.includes(String(row[semantic.statusField ?? 'status'])))
      : rows
    const records = permitted.map(row => {
      const uid = row[spec.resourceIdentity!.field]
      if (typeof uid !== 'string' || !uid.trim()) {
        fail('missing registered portable resource identity: ' + spec.name)
      }
      return { ...row }
    }).sort((a,b) => String(a[spec.resourceIdentity!.field]).localeCompare(String(b[spec.resourceIdentity!.field])))
    resources.push({
      table: spec.name,
      resourceKind: spec.resourceIdentity!.resourceKind,
      authority: semantic?.canonPolicy ?? 'author-approved-work-intent',
      records,
    })
  }
  const snapshot = {
    schema: READER_BASELINE_SCHEMA_V1, version: 1,
    selectionPolicyVersion: READER_BASELINE_SELECTION_POLICY_V1,
    source: { worldCode: world.code, workCode: work.code },
    language: 'vi',
    workIntent: intendedWorkFields(work as unknown as Record<string, unknown>),
    resources,
  }
  const json = canonicalWorldReleaseJsonV1(snapshot)
  if (new TextEncoder().encode(json).byteLength > maxSnapshotBytes) {
    fail('full mandatory Canon snapshot exceeds configured hard bound; never truncate')
  }
  const digest = await hashWorldReleaseValueV1(snapshot)
  return {
    canonBaselineSnapshotJson: json,
    canonBaselineHash: digest,
    canonBaselineRef: 'reader-canon-v1:' + digest,
  }
}

/** Consistent, non-writing capture for diagnosis and planned reader session creation. */
export async function captureReaderCanonBaselineV1(
  scope: WorkspaceScope, options: { maxSnapshotBytes: number },
): Promise<ReaderCanonBaselineCaptureV1> {
  assertHardLimit(options.maxSnapshotBytes)
  const tables = [...new Set([db.projects, db.worlds, db.works, ...sourceSpecs().map(spec => spec.table)])]
  return db.transaction('r', tables, () => captureInTransaction(scope, options.maxSnapshotBytes))
}

export async function verifyReaderCanonBaselineV1(
  record: Pick<ReaderSessionV1, 'canonBaselineSnapshotJson' | 'canonBaselineHash' | 'canonBaselineRef'>,
): Promise<void> {
  let parsed: any
  try { parsed = JSON.parse(record.canonBaselineSnapshotJson) } catch { fail('baseline JSON malformed') }
  if (!parsed || parsed.schema !== READER_BASELINE_SCHEMA_V1 || parsed.version !== 1 ||
    parsed.selectionPolicyVersion !== READER_BASELINE_SELECTION_POLICY_V1 ||
    !Array.isArray(parsed.resources) || typeof parsed.workIntent !== 'object' ||
    parsed.language !== 'vi' || !parsed.source?.worldCode || !parsed.source?.workCode ||
    canonicalWorldReleaseJsonV1(parsed) !== record.canonBaselineSnapshotJson) {
    fail('baseline schema/policy/canonical encoding invalid')
  }
  const digest = await hashWorldReleaseValueV1(parsed)
  if (digest !== record.canonBaselineHash || record.canonBaselineRef !== 'reader-canon-v1:' + digest) {
    fail('pinned Canon baseline hash or reference mismatch')
  }
}

/** Create one root session atomically with its one consistent captured baseline. */
export async function createRootReaderSessionV1(
  scope: WorkspaceScope, options: { maxSnapshotBytes: number },
): Promise<number> {
  assertHardLimit(options.maxSnapshotBytes)
  const tables = [...new Set([db.projects, db.worlds, db.works, db.readerSessions,
    ...sourceSpecs().map(spec => spec.table)])]
  return db.transaction('rw', tables, async () => {
    const baseline = await captureInTransaction(scope, options.maxSnapshotBytes)
    const now = Date.now()
    return db.readerSessions.add({
      projectId: scope.projectId, workId: scope.workId,
      parentSessionId: null, forkTurnId: null, headTurnId: null,
      revision: 0, status: 'active', memoryReadyThroughTurnId: null,
      ...baseline, createdAt: now, updatedAt: now,
    }) as Promise<number>
  })
}

async function ancestorPathToHead(
  session: ReaderSessionV1, workId: number, projectId: number,
): Promise<Set<number>> {
  const visited = new Set<number>()
  let cursor: number | null = session.headTurnId
  while (cursor !== null) {
    if (visited.has(cursor)) fail('cycle in published reader turn ancestry')
    const turn: ReaderTurnV1 | undefined = await db.readerTurns.get(cursor)
    if (!turn || turn.projectId !== projectId || turn.status !== 'published') {
      fail('missing or foreign published ancestor turn')
    }
    const originalSession = await db.readerSessions.get(turn.sessionId)
    if (!originalSession || originalSession.workId !== workId ||
      originalSession.projectId !== projectId) fail('turn from unrelated Work')
    visited.add(cursor)
    cursor = turn.parentTurnId
  }
  return visited
}

/** Fork may reference only an actual published ancestor of the selected parent head. */
export async function forkReaderSessionV1(
  scope: WorkspaceScope, parentSessionId: number, forkTurnId: number,
): Promise<number> {
  if (!Number.isSafeInteger(parentSessionId) || !Number.isSafeInteger(forkTurnId)) {
    fail('invalid fork identity')
  }
  return db.transaction('rw', db.readerSessions, db.readerTurns, async () => {
    const parent = await db.readerSessions.get(parentSessionId)
    if (!parent || parent.projectId !== scope.projectId || parent.workId !== scope.workId ||
      parent.status === 'archived') fail('missing, archived or foreign parent session')
    await verifyReaderCanonBaselineV1(parent)
    const ancestors = await ancestorPathToHead(parent, scope.workId, scope.projectId)
    if (!ancestors.has(forkTurnId)) fail('fork cutoff is not a published ancestor of parent head')
    const now = Date.now()
    return db.readerSessions.add({
      projectId: scope.projectId, workId: scope.workId,
      parentSessionId, forkTurnId, headTurnId: forkTurnId,
      revision: 0, status: 'active', memoryReadyThroughTurnId: null,
      canonBaselineRef: parent.canonBaselineRef,
      canonBaselineHash: parent.canonBaselineHash,
      canonBaselineSnapshotJson: parent.canonBaselineSnapshotJson,
      createdAt: now, updatedAt: now,
    }) as Promise<number>
  })
}

/**
 * Non-destructive reader retirement. Referenced ancestors are archived, not
 * removed; existing children and immutable prose must stay available.
 */
export async function archiveReaderSessionV1(scope: WorkspaceScope, sessionId: number): Promise<void> {
  await db.transaction('rw', db.readerSessions, async () => {
    const record = await db.readerSessions.get(sessionId)
    if (!record || record.projectId !== scope.projectId || record.workId !== scope.workId) {
      fail('cannot archive a foreign or missing reader session')
    }
    await db.readerSessions.update(sessionId, { status: 'archived', updatedAt: Date.now() })
  })
}

/**
 * P2 parent-link preflight. A P5 publication coordinator must call this
 * again inside the commit transaction: IndexedDB FKs are not enforced by
 * Dexie itself. No Work-wide session/turn lookup is an authorization grant.
 */
export async function assertReaderParentTurnV1(
  scope: WorkspaceScope, sessionId: number, parentTurnId: number | null,
): Promise<void> {
  const session = await db.readerSessions.get(sessionId)
  if (!session || session.projectId !== scope.projectId ||
    session.workId !== scope.workId || session.status !== 'active') {
    fail('reader parent session missing, foreign or not active')
  }
  if (session.headTurnId === null) {
    if (parentTurnId !== null) fail('first reader turn cannot point to a foreign turn')
    return
  }
  if (parentTurnId !== session.headTurnId) {
    fail('parent turn must match the published session head')
  }
  const lineage = await ancestorPathToHead(session, scope.workId, scope.projectId)
  if (!lineage.has(parentTurnId)) fail('reader parent turn is not on the active lineage')
}
