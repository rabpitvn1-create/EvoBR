import type {
  ExactRunArtifactIdentityV1,
  ExactRunArtifactPruneReceiptV1,
  MemoryArtifactRefV1,
} from '../types'
import { hashCanonicalValue } from '../agent/run/hash'

function key(identity: ExactRunArtifactIdentityV1): string {
  return `${identity.artifactKind}\u0000${identity.contentHash}`
}

/**
 * Pure retention planner used by the future content-addressed store. Run
 * cleanup is mark-and-sweep; explicit retention may prune a still-referenced
 * body only when it leaves a portable tombstone receipt. Canon is never input.
 */
export async function planExactArtifactRetentionV1(input: {
  artifacts: readonly ExactRunArtifactIdentityV1[]
  liveRefs: readonly MemoryArtifactRefV1[]
  mode: 'mark-and-sweep' | 'explicit-retention-prune'
  explicitTargets?: readonly ExactRunArtifactIdentityV1[]
  now: number
}): Promise<{
  keep: ExactRunArtifactIdentityV1[]
  prune: ExactRunArtifactPruneReceiptV1[]
}> {
  const artifacts = [...new Map(input.artifacts.map(artifact => [key(artifact), artifact])).values()]
    .sort((left, right) => key(left).localeCompare(key(right)))
  const live = new Set(input.liveRefs
    .filter((ref): ref is MemoryArtifactRefV1 & { artifactKind: ExactRunArtifactIdentityV1['artifactKind'] } => (
      ref.sourceKind === 'agent-run-artifact' && ref.artifactKind != null
    ))
    .map(ref => key({ artifactKind: ref.artifactKind, contentHash: ref.contentHash })))
  const explicit = new Set((input.explicitTargets ?? []).map(key))
  if (input.mode === 'explicit-retention-prune' && explicit.size === 0) {
    throw new Error('[artifact-retention] 显式裁剪必须指定 exact artifact')
  }
  const keep: ExactRunArtifactIdentityV1[] = []
  const prune: ExactRunArtifactPruneReceiptV1[] = []
  for (const artifact of artifacts) {
    const artifactKey = key(artifact)
    const shouldPrune = input.mode === 'mark-and-sweep'
      ? !live.has(artifactKey)
      : explicit.has(artifactKey)
    if (!shouldPrune) {
      keep.push(artifact)
      continue
    }
    const body = {
      version: 1 as const,
      ...artifact,
      state: 'evidence-pruned' as const,
      reasonCode: input.mode === 'mark-and-sweep'
        ? 'unreferenced-run-cleanup' as const
        : 'explicit-retention-prune' as const,
      prunedAt: input.now,
    }
    prune.push({ ...body, receiptHash: await hashCanonicalValue(body) })
  }
  return { keep, prune }
}
