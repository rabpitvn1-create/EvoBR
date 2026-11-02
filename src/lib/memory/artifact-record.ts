import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../agent/run/hash'
import type {
  AgentRunArtifactRecordV1,
  ExactRunArtifactKindV1,
  ExactRunArtifactPruneReceiptV1,
} from '../types'
import { assertExactRunArtifactBodySafeV1 } from './evidence-policy'

const HASH = /^[a-f0-9]{64}$/
const KINDS = new Set<ExactRunArtifactKindV1>([
  'context-manifest', 'selector-result', 'context-packet', 'source-snapshot', 'tool-result', 'rendered-request', 'raw-response',
])

function fail(message: string): never {
  throw new Error(`[agent-run-artifact:integrity] ${message}`)
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export async function assertAgentRunArtifactRecordIntegrityV1(
  row: AgentRunArtifactRecordV1,
  options: { requireProjectId?: boolean } = {},
): Promise<void> {
  if ((options.requireProjectId ?? true) && (!Number.isSafeInteger(row.projectId) || row.projectId <= 0)) {
    fail('projectId 非法')
  }
  if (!KINDS.has(row.artifactKind) || !HASH.test(row.contentHash)) fail('identity 非法')
  if (row.encoding !== 'utf-8' || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0) {
    fail('encoding/byteLength 非法')
  }
  if (row.retentionState === 'available') {
    if (typeof row.content !== 'string' || row.pruneReceiptJson != null || row.pruneReceiptHash != null) {
      fail('available artifact 的正文或 tombstone 状态非法')
    }
    assertExactRunArtifactBodySafeV1({ artifactKind: row.artifactKind, body: row.content })
    try {
      assertExactRunArtifactBodySafeV1({ artifactKind: row.artifactKind, body: JSON.parse(row.content) })
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
    if (await sha256Text(row.content) !== row.contentHash || bytes(row.content) !== row.byteLength) {
      fail('正文 hash/byteLength 不匹配')
    }
    return
  }
  if (row.retentionState !== 'evidence-pruned' || row.content !== null
    || typeof row.pruneReceiptJson !== 'string' || !HASH.test(row.pruneReceiptHash ?? '')) {
    fail('pruned artifact 缺少合法 tombstone')
  }
  let receipt: ExactRunArtifactPruneReceiptV1
  try {
    receipt = JSON.parse(row.pruneReceiptJson) as ExactRunArtifactPruneReceiptV1
  } catch {
    fail('prune receipt JSON 损坏')
  }
  const { receiptHash, ...body } = receipt
  if (receipt.version !== 1 || receipt.state !== 'evidence-pruned'
    || receipt.artifactKind !== row.artifactKind || receipt.contentHash !== row.contentHash
    || receiptHash !== row.pruneReceiptHash || await hashCanonicalValue(body) !== receiptHash) {
    fail('prune receipt hash 或 identity 不匹配')
  }
}
