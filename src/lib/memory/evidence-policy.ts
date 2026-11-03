import type { ExactRunArtifactKindV1 } from '../types'

const FORBIDDEN_KEY = /^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)$/i
const HIDDEN_REASONING_KEY = /^(reasoning_content|chain_of_thought|hidden_reasoning|thinking)$/i
const SECRET_TEXT = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/i,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /(?:api[-_ ]?key|access[-_ ]?token|authorization)\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}/i,
]
const HIDDEN_REASONING = [
  /<\/?(?:thinking|analysis|chain[-_ ]?of[-_ ]?thought)>/i,
  /["'](?:reasoning_content|chain_of_thought|hidden_reasoning)["']\s*:/i,
]

export class ExactRunArtifactPolicyError extends Error {
  constructor(readonly code: 'secret-material' | 'hidden-reasoning' | 'unsupported-value', message: string) {
    super(message)
    this.name = 'ExactRunArtifactPolicyError'
  }
}

function inspectString(value: string): void {
  if (SECRET_TEXT.some(pattern => pattern.test(value))) {
    throw new ExactRunArtifactPolicyError('secret-material', '运行证据包含密钥或认证材料，拒绝持久化')
  }
  if (HIDDEN_REASONING.some(pattern => pattern.test(value))) {
    throw new ExactRunArtifactPolicyError('hidden-reasoning', '运行证据包含 provider 隐藏推理，拒绝持久化')
  }
}

function inspect(value: unknown, seen: Set<object>): void {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return
  if (typeof value === 'string') {
    inspectString(value)
    return
  }
  if (typeof value !== 'object') {
    throw new ExactRunArtifactPolicyError('unsupported-value', '运行证据只能包含可序列化数据')
  }
  if (seen.has(value)) {
    throw new ExactRunArtifactPolicyError('unsupported-value', '运行证据不能包含循环引用')
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) inspect(item, seen)
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) {
        throw new ExactRunArtifactPolicyError('secret-material', `运行证据包含禁止字段 ${key}`)
      }
      if (HIDDEN_REASONING_KEY.test(key)) {
        throw new ExactRunArtifactPolicyError('hidden-reasoning', `运行证据包含 provider 隐藏推理字段 ${key}`)
      }
      inspect(child, seen)
    }
  }
  seen.delete(value)
}

/** Fail-closed storage/export boundary. It performs no model call and returns no redacted substitute. */
export function assertExactRunArtifactBodySafeV1(input: {
  artifactKind: ExactRunArtifactKindV1
  body: unknown
}): void {
  inspect(input.body, new Set())
}
