/** P3 closed Reader source gateway. No regular Work source may be read through it. */
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import type { AssembleContextInput, ReaderContextScopeV1 } from '../registry/types'

export const READER_SOURCE_KEYS_V1 = [
  'reader.baseline',
  'reader.published-history',
  'reader.decisions',
  'reader.confirmed-facts',
  'reader.confirmed-knowledge',
  'reader.continuity',
  'reader.retrieval',
] as const
export type ReaderSourceKeyV1 = typeof READER_SOURCE_KEYS_V1[number]
const READER_KEYS = new Set<string>(READER_SOURCE_KEYS_V1)
export const READER_SELECTION_POLICY_V1 = 'reader-lineage-context-v1'

function fail(message: string): never { throw Error('[readerGateway] ' + message) }
const matchScope = (a: ReaderContextScopeV1, b: ReaderContextScopeV1): boolean =>
  a.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId &&
  a.sessionId === b.sessionId && a.headTurnId === b.headTurnId &&
  a.expectedRevision === b.expectedRevision && a.canonBaselineHash === b.canonBaselineHash &&
  a.lineageFingerprint === b.lineageFingerprint && a.selectionPolicyVersion === b.selectionPolicyVersion

/** Called before any registered source read, including direct assembleContext misuse. */
export async function assertReaderAssemblyBoundaryV1(input: AssembleContextInput): Promise<void> {
  const keys = input.sourceKeys ?? []
  const hasReaderKey = keys.some(k => k.startsWith('reader.'))
  if (!input.readerContextScope && !input.readerFrozenSources) {
    if (hasReaderKey) fail('reader source requires authenticated reader assembly')
    return
  }
  const scope = input.readerContextScope, snapshot = input.readerFrozenSources
  if (!scope || !snapshot || !input.scope || !Array.isArray(input.sourceKeys) ||
    keys.length !== READER_SOURCE_KEYS_V1.length || new Set(keys).size !== keys.length ||
    !keys.every(key => READER_KEYS.has(key))) fail('reader assembly must use exactly seven registered reader sources')
  if (!Number.isSafeInteger(scope.projectId) || !Number.isSafeInteger(scope.worldId) ||
    !Number.isSafeInteger(scope.workId) || !Number.isSafeInteger(scope.sessionId) ||
    (scope.headTurnId !== null && !Number.isSafeInteger(scope.headTurnId)) ||
    !Number.isSafeInteger(scope.expectedRevision) || scope.expectedRevision < 0 ||
    !scope.canonBaselineHash || !scope.lineageFingerprint ||
    scope.selectionPolicyVersion !== READER_SELECTION_POLICY_V1) fail('reader scope invalid')
  if (input.projectId !== scope.projectId || input.scope.projectId !== scope.projectId ||
    input.scope.worldId !== scope.worldId || input.scope.workId !== scope.workId ||
    !matchScope(snapshot.scope, scope) || snapshot.version !== 1) {
    fail('reader/Workspace/Gateway scope mismatch')
  }
  if (input.chapterId != null || input.outlineNodeId != null || input.worldGroupId !== undefined ||
    input.ragEntryKeys?.length || input.searchQuery || input.manualSourceText ||
    input.sourceTransformer || input.sourceBudgetScale !== undefined ||
    input.continuitySnapshot != null || input.productRuntimeSessionId != null) {
    fail('authoring/Chapter/Work fallback parameters forbidden in reader context')
  }
  if (Object.keys(snapshot.contentByKey).length !== keys.length ||
    Object.keys(snapshot.sourceHashes).length !== keys.length ||
    !keys.every(k => typeof snapshot.contentByKey[k] === 'string' &&
      typeof snapshot.sourceHashes[k] === 'string')) fail('reader source packet incomplete')
  for (const key of keys) {
    if (await sha256Text(snapshot.contentByKey[key]) !== snapshot.sourceHashes[key]) {
      fail('reader source hash invalid: ' + key)
    }
  }
  const { snapshotHash, ...body } = snapshot
  if (await hashCanonicalValue(body) !== snapshotHash) fail('reader frozen source packet altered')
}

export async function readReaderFrozenSourceV1(
  input: AssembleContextInput, key: ReaderSourceKeyV1,
): Promise<string> {
  if (!input.readerContextScope || !input.readerFrozenSources || !READER_KEYS.has(key) ||
    !matchScope(input.readerContextScope, input.readerFrozenSources.scope)) {
    fail('unauthorized reader source: ' + key)
  }
  const content = input.readerFrozenSources.contentByKey[key]
  if (typeof content !== 'string') fail('missing frozen reader source: ' + key)
  return content
}
