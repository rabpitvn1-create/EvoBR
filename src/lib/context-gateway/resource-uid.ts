import type { TableSpec } from '../registry/types'

const RESOURCE_UID = /^res:v1:([a-z][a-z0-9-]{0,63}):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i

export class ContextResourceIdentityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[context-resource:${code}] ${message}`)
    this.name = 'ContextResourceIdentityError'
  }
}

export function isPortableResourceUidV1(value: unknown, resourceKind?: string): value is string {
  if (typeof value !== 'string') return false
  const match = RESOURCE_UID.exec(value.trim())
  return match != null && (resourceKind == null || match[1] === resourceKind)
}

export function createPortableResourceUidV1(resourceKind: string): string {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(resourceKind)) {
    throw new ContextResourceIdentityError('kind', `非法 resource kind: ${resourceKind}`)
  }
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new ContextResourceIdentityError('random', '当前运行环境不支持 crypto.randomUUID()')
  }
  return `res:v1:${resourceKind}:${globalThis.crypto.randomUUID()}`
}

/** Stamps only PROJECT_TABLES-declared resources and rejects caller-supplied fake identities. */
export function stampResourceIdentityV1(
  spec: Pick<TableSpec, 'name' | 'resourceIdentity'>,
  row: Record<string, unknown>,
): void {
  const identity = spec.resourceIdentity
  if (!identity) return
  const existing = row[identity.field]
  if (existing == null || existing === '') {
    row[identity.field] = createPortableResourceUidV1(identity.resourceKind)
    return
  }
  if (!isPortableResourceUidV1(existing, identity.resourceKind)) {
    throw new ContextResourceIdentityError(
      'invalid',
      `${spec.name}.${identity.field} 不是 ${identity.resourceKind} 的 portable UID`,
    )
  }
}
