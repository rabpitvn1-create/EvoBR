/** P3 effective published Reader ancestry, cut at every declared fork boundary. */
import { db } from '../db/schema'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import { verifyReaderCanonBaselineV1 } from './baseline'
import { READER_SELECTION_POLICY_V1 } from './gateway-sources'
import type { ReaderSessionV1, ReaderTurnV1 } from '../types/reader'
import type { WorkspaceScope } from '../types/world-ownership'
import type { ReaderContextScopeV1 } from '../registry/types'

export interface ReaderVisibleLineageV1 {
  scope: ReaderContextScopeV1
  session: ReaderSessionV1
  sessions: ReaderSessionV1[]
  turns: ReaderTurnV1[]
  cutoffs: Array<{ sessionId: number; parentSessionId: number; forkTurnId: number }>
}
function fail(reason: string): never { throw Error('[readerLineage] ' + reason) }
const MAX_ANCESTRY = 100_000
export async function resolveReaderLineageV1(
  workspace: WorkspaceScope, sessionId: number, expectedRevision?: number,
): Promise<ReaderVisibleLineageV1> {
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) fail('invalid sessionId')
  const sessionCache = new Map<number, ReaderSessionV1>()
  const turnCache = new Map<number, ReaderTurnV1>()
  const sessionStack = new Set<number>()
  const cutoffs: ReaderVisibleLineageV1['cutoffs'] = []
  async function loadSession(id: number): Promise<ReaderSessionV1> {
    let row = sessionCache.get(id)
    if (!row) {
      row = await db.readerSessions.get(id)
      if (!row) fail('session missing')
      sessionCache.set(id,row)
    }
    if (row.projectId !== workspace.projectId || row.workId !== workspace.workId) {
      fail('foreign session or Work scope')
    }
    await verifyReaderCanonBaselineV1(row)
    return row
  }
  async function loadTurn(id: number, ownerSessionId: number): Promise<ReaderTurnV1> {
    let turn = turnCache.get(id)
    if (!turn) {
      turn = await db.readerTurns.get(id)
      if (!turn) fail('published turn missing')
      turnCache.set(id, turn)
    }
    if (turn.sessionId !== ownerSessionId || turn.projectId !== workspace.projectId ||
      turn.status !== 'published' || !Number.isSafeInteger(turn.turnOrdinal) ||
      turn.turnOrdinal <= 0 || !turn.contentHash) {
      fail('published turn ownership/status invalid')
    }
    if (await sha256Text(turn.content) !== turn.contentHash) fail('published turn content hash altered')
    return turn
  }
  async function walk(id: number): Promise<ReaderTurnV1[]> {
    if (sessionStack.has(id) || sessionStack.size > MAX_ANCESTRY) fail('session ancestry cycle')
    sessionStack.add(id)
    try {
      const session = await loadSession(id)
      let inherited: ReaderTurnV1[] = []
      if (session.parentSessionId != null) {
        const parent = await loadSession(session.parentSessionId)
        if (session.forkTurnId == null) fail('fork session missing cutoff')
        if (parent.canonBaselineHash !== session.canonBaselineHash ||
          parent.canonBaselineSnapshotJson !== session.canonBaselineSnapshotJson) {
          fail('fork changed pinned Canon baseline')
        }
        const parentPath = await walk(parent.id!)
        const cutoff = parentPath.findIndex(turn => turn.id === session.forkTurnId)
        if (cutoff < 0) fail('fork cutoff outside effective parent ancestry')
        inherited = parentPath.slice(0,cutoff+1)
        cutoffs.push({sessionId:id,parentSessionId:parent.id!,forkTurnId:session.forkTurnId})
      } else if (session.forkTurnId != null) fail('root has foreign fork boundary')
      const own: ReaderTurnV1[] = []
      const seen = new Set<number>()
      let cursor = session.headTurnId
      if (inherited.length && cursor === session.forkTurnId) cursor = null
      while (cursor != null) {
        if (seen.has(cursor) || own.length > MAX_ANCESTRY) fail('turn ancestry cycle')
        seen.add(cursor)
        const turn = await loadTurn(cursor,id)
        own.push(turn)
        cursor = turn.parentTurnId
        if (inherited.length && cursor === session.forkTurnId) {
          cursor = null
        } else if (inherited.length && cursor === null) {
          fail('fork turn did not connect to cutoff')
        }
      }
      own.reverse()
      if (own.length && own[0].turnOrdinal !== 1) fail('reader turn ordinal does not start at one')
      for (let i = 1; i < own.length; i++) {
        if (own[i].turnOrdinal !== own[i-1].turnOrdinal+1) fail('reader turn ordinal discontinuity')
      }
      return [...inherited,...own]
    } finally { sessionStack.delete(id) }
  }
  const session = await loadSession(sessionId)
  if (expectedRevision != null && session.revision !== expectedRevision) fail('stale expectedRevision')
  const turns = await walk(sessionId)
  const baselineHash = session.canonBaselineHash
  const lineageFingerprint = await hashCanonicalValue({
    version:1, sessionId, headTurnId:session.headTurnId,
    revision:session.revision, baselineHash,
    cutoffs, path:turns.map(t=>({sessionId:t.sessionId,turnId:t.id,contentHash:t.contentHash})),
  })
  return {
    session, turns, cutoffs,
    sessions:[...sessionCache.values()],
    scope:{
      projectId:workspace.projectId,worldId:workspace.worldId,workId:workspace.workId,
      sessionId,headTurnId:session.headTurnId,expectedRevision:session.revision,
      canonBaselineHash:baselineHash,lineageFingerprint,
      selectionPolicyVersion:READER_SELECTION_POLICY_V1,
    },
  }
}
