/**
 * P2 import-only integrity for a portable reader history. Invoked after all
 * registered FK remaps and before the import transaction commits. P3 still
 * governs effective lineage/Context Gateway selection at read time.
 */
import { db } from '../db/schema'

function fail(reason: string): never { throw Error('[readerImport] ' + reason) }

/** Validate reader FK ownership and the one legitimate cross-session turn edge. */
export async function assertImportedReaderGraphV1(projectId: number): Promise<void> {
  const [sessions, turns, choices, decisions, receipts] = await Promise.all([
    db.readerSessions.where('projectId').equals(projectId).toArray(),
    db.readerTurns.where('projectId').equals(projectId).toArray(),
    db.readerChoices.where('projectId').equals(projectId).toArray(),
    db.readerDecisions.where('projectId').equals(projectId).toArray(),
    db.readerPublicationRuns.where('projectId').equals(projectId).toArray(),
  ])
  if (!sessions.length && !turns.length && !choices.length && !decisions.length && !receipts.length) return
  const bySession = new Map(sessions.map(s => [s.id!, s] as const))
  const byTurn = new Map(turns.map(t => [t.id!, t] as const))
  const byChoice = new Map(choices.map(c => [c.id!, c] as const))
  for (const session of sessions) {
    const parent = session.parentSessionId == null ? null : bySession.get(session.parentSessionId)
    if (session.parentSessionId != null &&
      (!parent || parent.workId !== session.workId || parent.projectId !== projectId)) {
      fail('session parent belongs to another Work or is missing')
    }
    if (session.forkTurnId != null && !parent) fail('fork boundary requires a parent session')
    if (session.forkTurnId != null && !byTurn.has(session.forkTurnId)) fail('fork boundary turn missing')
    if (session.headTurnId != null) {
      const head = byTurn.get(session.headTurnId)
      if (!head || (head.sessionId !== session.id &&
        !(session.parentSessionId != null && session.headTurnId === session.forkTurnId))) {
        fail('head turn not owned by session or its initial fork boundary')
      }
    }
    const seenSessions = new Set<number>()
    let cursor = session
    while (cursor.parentSessionId != null) {
      if (seenSessions.has(cursor.id!)) fail('session ancestry cycle')
      seenSessions.add(cursor.id!)
      const next = bySession.get(cursor.parentSessionId)
      if (!next) fail('session ancestry is incomplete')
      cursor = next
    }
  }
  for (const turn of turns) {
    const owner = bySession.get(turn.sessionId)
    if (!owner) fail('published turn references missing session')
    if (turn.parentTurnId == null) {
      if (owner.parentSessionId != null) fail('forked session turn cannot start as unrelated root')
      continue
    }
    const parent = byTurn.get(turn.parentTurnId)
    if (!parent) fail('published parent turn missing')
    const parentSession = bySession.get(parent.sessionId)
    if (!parentSession || parentSession.workId !== owner.workId) fail('published turn crosses Work')
    if (turn.sessionId !== parent.sessionId &&
      (owner.parentSessionId == null || turn.parentTurnId !== owner.forkTurnId)) {
      fail('published turn parent crosses unrelated reader session')
    }
  }
  for (const choice of choices) {
    const session = bySession.get(choice.sessionId)
    const turn = byTurn.get(choice.turnId)
    if (!session || !turn || turn.sessionId !== session.id) fail('reader choice owner/turn mismatch')
  }
  for (const decision of decisions) {
    const session = bySession.get(decision.sessionId)
    const source = byTurn.get(decision.sourceTurnId)
    const result = byTurn.get(decision.resultTurnId)
    const choice = byChoice.get(decision.choiceId)
    if (!session || !source || !result || !choice ||
      result.sessionId !== session.id || choice.turnId !== source.id ||
      choice.sessionId !== source.sessionId) fail('reader decision FK lineage mismatch')
  }
  for (const receipt of receipts) {
    const session = bySession.get(receipt.sessionId)
    const result = byTurn.get(receipt.resultTurnId)
    if (!session || !result || result.sessionId !== session.id) {
      fail('reader publication receipt does not point to a session-owned turn')
    }
  }
}
