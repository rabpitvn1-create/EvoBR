/**
 * WEH-0D · local candidate draft persistence coordinator.
 *
 * Candidate text is intentionally not Canon. The coordinator only coalesces,
 * serializes and flushes writes to the existing Agent Event/Run persistence
 * boundary; it never writes a business table itself.
 */

export class CandidateDraftSyncErrorV1 extends Error {
  readonly key: string
  readonly cause: unknown

  constructor(key: string, cause: unknown) {
    const detail = cause instanceof Error && cause.message.trim()
      ? cause.message
      : String(cause)
    super(`候选草稿尚未同步，已阻止后续操作：${detail}`)
    this.name = 'CandidateDraftSyncErrorV1'
    this.key = key
    this.cause = cause
  }
}

interface CandidateDraftEntryV1 {
  key: string
  draft: string
  version: number
  persistedVersion: number
  failedVersion: number | null
  timer: ReturnType<typeof setTimeout> | null
  drain: Promise<void> | null
  persist: (draft: string) => Promise<unknown>
  onSynced?: (draft: string, result: unknown) => void
  onError?: (error: CandidateDraftSyncErrorV1) => void
}

const entries = new Map<string, CandidateDraftEntryV1>()

function normalizeKey(key: string): string {
  const normalized = key.trim()
  if (!normalized) throw new Error('Candidate draft key 不能为空')
  return normalized
}

function clearTimer(entry: CandidateDraftEntryV1): void {
  if (entry.timer == null) return
  clearTimeout(entry.timer)
  entry.timer = null
}

function scheduleDrain(entry: CandidateDraftEntryV1, delayMs: number): void {
  clearTimer(entry)
  entry.timer = setTimeout(() => {
    entry.timer = null
    void startDrain(entry).catch(() => undefined)
  }, Math.max(0, delayMs))
}

function maybeRelease(entry: CandidateDraftEntryV1): void {
  if (
    entry.drain == null
    && entry.timer == null
    && entry.persistedVersion >= entry.version
    && entry.failedVersion == null
    && entries.get(entry.key) === entry
  ) {
    entries.delete(entry.key)
  }
}

function startDrain(entry: CandidateDraftEntryV1): Promise<void> {
  clearTimer(entry)
  if (entry.drain) return entry.drain

  const operation = (async () => {
    while (entry.persistedVersion < entry.version) {
      const targetVersion = entry.version
      const targetDraft = entry.draft
      const persist = entry.persist
      try {
        const result = await persist(targetDraft)
        entry.persistedVersion = targetVersion
        entry.failedVersion = null
        entry.onSynced?.(targetDraft, result)
      } catch (cause) {
        entry.failedVersion = targetVersion
        const error = cause instanceof CandidateDraftSyncErrorV1
          ? cause
          : new CandidateDraftSyncErrorV1(entry.key, cause)
        entry.onError?.(error)
        throw error
      }
    }
  })()

  entry.drain = operation
  void operation.finally(() => {
    entry.drain = null
    // A keystroke may arrive while a failed write is in flight. It represents
    // a new retryable version and must not be stranded behind the old promise.
    if (entry.persistedVersion < entry.version && entry.failedVersion !== entry.version) {
      scheduleDrain(entry, 0)
    } else {
      maybeRelease(entry)
    }
  }).catch(() => undefined)
  return operation
}

export function queueCandidateDraftV1(input: {
  key: string
  draft: string
  persist: (draft: string) => Promise<unknown>
  debounceMs?: number
  onSynced?: (draft: string, result: unknown) => void
  onError?: (error: CandidateDraftSyncErrorV1) => void
}): void {
  const key = normalizeKey(input.key)
  let entry = entries.get(key)
  if (!entry) {
    entry = {
      key,
      draft: input.draft,
      version: 0,
      persistedVersion: 0,
      failedVersion: null,
      timer: null,
      drain: null,
      persist: input.persist,
    }
    entries.set(key, entry)
  }
  entry.version += 1
  entry.draft = input.draft
  entry.persist = input.persist
  entry.onSynced = input.onSynced
  entry.onError = input.onError
  scheduleDrain(entry, input.debounceMs ?? 300)
}

export async function flushCandidateDraftV1(key: string): Promise<void> {
  const entry = entries.get(normalizeKey(key))
  if (!entry) return
  await startDrain(entry)
  // A new version may be scheduled from a callback at the promise boundary.
  while (entries.get(entry.key) === entry && entry.persistedVersion < entry.version) {
    await startDrain(entry)
  }
  maybeRelease(entry)
}

export async function flushCandidateDraftsV1(prefix?: string): Promise<void> {
  const selected = [...entries.keys()].filter(key => prefix == null || key.startsWith(prefix))
  const settled = await Promise.allSettled(selected.map(key => flushCandidateDraftV1(key)))
  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason)
  if (failures.length) {
    const first = failures[0]
    throw first instanceof Error ? first : new Error(String(first))
  }
}

export function hasPendingCandidateDraftsV1(prefix?: string): boolean {
  return [...entries.entries()].some(([key, entry]) => (
    (prefix == null || key.startsWith(prefix))
    && (entry.persistedVersion < entry.version || entry.timer != null || entry.drain != null)
  ))
}

export function candidateDraftDiagnosticsV1(): Array<{
  key: string
  version: number
  persistedVersion: number
  saving: boolean
  failed: boolean
}> {
  return [...entries.values()].map(entry => ({
    key: entry.key,
    version: entry.version,
    persistedVersion: entry.persistedVersion,
    saving: entry.drain != null,
    failed: entry.failedVersion != null,
  })).sort((left, right) => left.key.localeCompare(right.key))
}

/** Test-only reset. In-flight browser storage operations cannot be cancelled. */
export function resetCandidateDraftCoordinatorForTestsV1(): void {
  if (import.meta.env.PROD) throw new Error('生产环境不能重置 CandidateDraftCoordinator')
  for (const entry of entries.values()) clearTimer(entry)
  entries.clear()
}
