import { describe, expect, it } from 'vitest'
import type {
  ContextAccessPolicyV1,
  ContextResourceDescriptorV1,
  ContextResourceProviderV1,
  ContextSource,
  ResourcePageV1,
} from '../../src/lib/registry/types'
import {
  ContextGatewayContractError,
  assertContextReadPermissionV1,
  assertContextResourceDescriptorV1,
  assertContextSourceRefV1,
  assertResourcePageV1,
  createAgentRunArtifactWireV1,
  createContextGatewayContractSnapshotV1,
  createContextPacketV1,
  createContextSufficiencyReportV1,
  createRetrievalTraceV1,
  filterContextResourcePageV1,
  parseContextGatewayContractSnapshotV1,
} from '../../src/lib/context-gateway/contracts'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const SCOPE_HASH = 'd'.repeat(64)

const descriptor: ContextResourceDescriptorV1 = {
  version: 1,
  resourceKey: 'worldview:w-main:races',
  sourceKey: 'worldviewResources',
  kind: 'worldview-field',
  title: '种族与民族',
  shortSummary: '三个相互制衡的边境民族。',
  authority: 'author-canon',
  contentRevision: 9,
  contentHash: '1'.repeat(64),
  policyRevision: 0,
  policyHash: '2'.repeat(64),
  scope: { projectId: 1, worldId: 7, worldGroupId: null },
  relations: [],
  sourceRefs: [{
    table: 'worldviews', recordId: 9, field: 'races', revision: 'rv-4', contentHash: HASH_A,
  }],
  tokenEstimate: { index: 20, summary: 60, focused: 160, full: 400, original: 400 },
  availableDepths: ['index', 'summary', 'focused', 'full', 'original'],
  priority: 'must-read',
}

function provider(id: string, backend: 'canon' | 'fixture'): ContextResourceProviderV1 {
  const page = (): ResourcePageV1 => ({
    version: 1,
    items: [{ ...descriptor, relations: [], sourceRefs: descriptor.sourceRefs.map(ref => ({ ...ref })) }],
    nextCursor: null,
    scopeFingerprint: SCOPE_HASH,
  })
  return {
    version: 'context-resource-provider-v1',
    providerId: id,
    providerVersion: '1.0.0',
    normalizationVersion: 'resource-text-v1',
    kinds: ['worldview-field'],
    async listMetadata() { return page() },
    async searchMetadata() { return page() },
    async read(input) {
      return {
        version: 1,
        descriptor: page().items[0],
        depth: input.depth,
        content: backend === 'canon' ? '山民、河民与迁徙民。' : '山民、河民与迁徙民。',
        contentHash: HASH_A,
        tokenCount: 8,
        sourceRefs: descriptor.sourceRefs,
      }
    },
    async readOriginal() {
      return {
        version: 1,
        descriptor: page().items[0],
        sourceRef: descriptor.sourceRefs[0],
        content: '山民、河民与迁徙民。',
        contentHash: HASH_A,
        tokenCount: 8,
      }
    },
    async fingerprint() { return SCOPE_HASH },
  }
}

function source(resources = provider('worldview-provider', 'canon')): ContextSource {
  return {
    key: 'worldviewResources',
    label: '世界观可寻址资源',
    scope: 'world',
    layer: 'L1',
    ownerFrom: 'world',
    budgetTokens: 4000,
    resources,
    async read() { return '' },
  }
}

function policy(candidateAccess: ContextAccessPolicyV1['candidateAccess'] = 'forbidden'): ContextAccessPolicyV1 {
  return {
    version: 'context-access-policy-v1',
    policyId: 'worldview-field-create-v1',
    mandatorySourceKeys: ['worldviewResources'],
    allowedSourceKeys: ['worldviewResources'],
    allowedResourceKinds: ['worldview-field'],
    allowedDepths: ['index', 'summary', 'focused', 'full'],
    selectorPolicyId: 'selector-v1',
    maxReadCalls: 2,
    maxRetrievedTokens: 3000,
    allowOriginalRead: false,
    candidateAccess,
  }
}

describe('CTXG-1 · contract, provider, permission and version', () => {
  it('freezes a serializable stable snapshot without serializing Provider functions', async () => {
    const input = {
      policy: policy(),
      sources: [source()],
      gatewayVersion: 'gateway-v1',
      selectorVersion: 'selector-v1',
      sufficiencyObligationsVersion: 'worldview-obligations-v1',
      toolSchemaHash: HASH_B,
      normalizationVersion: 'packet-normalization-v1',
    }
    const first = await createContextGatewayContractSnapshotV1(input)
    const second = await createContextGatewayContractSnapshotV1({ ...input, sources: [source()] })
    expect(first.snapshotHash).toBe(second.snapshotHash)
    expect(JSON.stringify(first)).not.toContain('listMetadata')
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(await parseContextGatewayContractSnapshotV1(JSON.parse(JSON.stringify(first)))).toEqual(first)

    const currentProviderChanged = source({ ...provider('worldview-provider', 'canon'), providerVersion: '2.0.0' })
    expect((await createContextGatewayContractSnapshotV1({ ...input, sources: [currentProviderChanged] })).snapshotHash)
      .not.toBe(first.snapshotHash)
    expect((await parseContextGatewayContractSnapshotV1(first)).snapshotHash).toBe(first.snapshotHash)
  })

  it('keeps metadata/source-ref identity stable when the Provider backend is replaced', async () => {
    const canonSource = source(provider('worldview-provider', 'canon'))
    const fixtureSource = source(provider('worldview-provider', 'fixture'))
    const canonPage = await canonSource.resources!.listMetadata({ scope: { projectId: 1, worldId: 7 }, limit: 10 })
    const fixturePage = await fixtureSource.resources!.listMetadata({ scope: { projectId: 1, worldId: 7 }, limit: 10 })
    expect(assertResourcePageV1({ page: canonPage, source: canonSource, expectedScopeFingerprint: SCOPE_HASH, maxItems: 10 }))
      .toEqual(assertResourcePageV1({ page: fixturePage, source: fixtureSource, expectedScopeFingerprint: SCOPE_HASH, maxItems: 10 }))
    expect(canonPage.items[0].resourceKey).toBe(fixturePage.items[0].resourceKey)
    expect(canonPage.items[0].sourceRefs).toEqual(fixturePage.items[0].sourceRefs)
  })

  it('derives table owner from PROJECT_TABLES and rejects unknown source/table/kind/depth/provider', async () => {
    expect(() => assertContextSourceRefV1(descriptor.sourceRefs[0])).not.toThrow()
    expect(() => assertContextSourceRefV1({ ...descriptor.sourceRefs[0], table: 'shadowCanon' }))
      .toThrow('PROJECT_TABLES')
    expect(() => assertContextResourceDescriptorV1({
      descriptor: { ...descriptor, kind: 'unknown-kind' as any }, source: source(),
    })).toThrow('kind')
    expect(() => assertContextResourceDescriptorV1({ descriptor, source: { ...source(), resources: undefined } }))
      .toThrow('provider')
    expect(() => assertContextReadPermissionV1({
      descriptor, depth: 'original', policy: policy(),
    })).toThrow('depth')
    await expect(createContextGatewayContractSnapshotV1({
      policy: { ...policy(), allowedSourceKeys: ['unregisteredSource'], mandatorySourceKeys: [] },
      sources: [source()],
      gatewayVersion: 'v1', selectorVersion: 'v1', sufficiencyObligationsVersion: 'v1',
      toolSchemaHash: HASH_A, normalizationVersion: 'v1',
    })).rejects.toThrow('CONTEXT_SOURCES')
  })

  it('keeps candidate resources out of list/search and permits only explicit keyed reads when enabled', () => {
    const candidate = { ...descriptor, authority: 'candidate' as const, resourceKey: 'worldview:w-main:races-candidate' }
    const page = { version: 1 as const, items: [descriptor, candidate], nextCursor: null, scopeFingerprint: SCOPE_HASH }
    expect(filterContextResourcePageV1({ page, policy: policy() }).items.map(item => item.resourceKey))
      .toEqual([descriptor.resourceKey])
    expect(filterContextResourcePageV1({ page, policy: policy('explicit-resource-key-only') }).items)
      .toEqual([descriptor])
    expect(filterContextResourcePageV1({
      page,
      policy: policy('explicit-resource-key-only'),
      explicitResourceKey: candidate.resourceKey,
    }).items.map(item => item.resourceKey)).toEqual([descriptor.resourceKey, candidate.resourceKey])
  })

  it('separates metadata from bodies and rejects a Provider page that smuggles full content', () => {
    const leaking = { ...descriptor, content: '整段正文不应进入 metadata' }
    expect(() => assertResourcePageV1({
      page: { version: 1, items: [leaking], nextCursor: null, scopeFingerprint: SCOPE_HASH },
      source: source(), expectedScopeFingerprint: SCOPE_HASH, maxItems: 10,
    })).toThrow('夹带正文')
  })

  it('hashes sufficiency, trace, packet and sanitized artifact as one portable evidence chain', async () => {
    const sufficiency = await createContextSufficiencyReportV1({
      obligations: [
        {
          id: 'target', kind: 'mandatory-source', required: true, status: 'satisfied',
          evidenceResourceKeys: [descriptor.resourceKey], reasonCode: 'target-present',
        },
        {
          id: 'conflict-neighbor', kind: 'conflict-check', required: false, status: 'missing',
          evidenceResourceKeys: [], reasonCode: 'not-read-yet',
        },
      ],
      readsAllowed: true,
    })
    expect(sufficiency.additionalRead).toBe('needed')
    const trace = await createRetrievalTraceV1({
      catalogVersion: 'catalog-v1', selectorPolicyId: 'selector-v1',
      mandatory: [{
        resourceKey: descriptor.resourceKey, sourceKey: descriptor.sourceKey,
        reason: 'target', depth: 'full', revision: 'rv-4', contentHash: HASH_A,
        sourceRefs: descriptor.sourceRefs, tokenCount: 8,
      }],
      autoSelected: [], agentReads: [], omitted: [], queries: [], fallbackUsed: false,
    })
    const packet = await createContextPacketV1({
      scopeFingerprint: SCOPE_HASH,
      gatewayVersionHash: HASH_B,
      policyHash: HASH_C,
      sufficiencyReportHash: sufficiency.reportHash,
      retrievalTraceHash: trace.traceHash,
      content: '山民、河民与迁徙民。',
      sourceRefs: descriptor.sourceRefs,
    })
    expect(packet.packetHash).toMatch(/^[a-f0-9]{64}$/)
    const artifact = await createAgentRunArtifactWireV1({
      artifactKind: 'context-packet', projectId: 1, scopeFingerprint: SCOPE_HASH,
      encoding: 'utf-8', content: packet.content, createdAt: 100,
    })
    expect(artifact.contentHash).toBe(packet.contentHash)
    await expect(createAgentRunArtifactWireV1({
      artifactKind: 'rendered-request', projectId: 1, scopeFingerprint: SCOPE_HASH,
      encoding: 'utf-8', content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz', createdAt: 100,
    })).rejects.toThrow('认证')
  })

  it('fails read-only recovery when a frozen snapshot is tampered or from an unknown future version', async () => {
    const frozen = await createContextGatewayContractSnapshotV1({
      policy: policy(), sources: [source()], gatewayVersion: 'gateway-v1', selectorVersion: 'selector-v1',
      sufficiencyObligationsVersion: 'obligations-v1', toolSchemaHash: HASH_A,
      normalizationVersion: 'normalization-v1',
    })
    await expect(parseContextGatewayContractSnapshotV1({ ...frozen, snapshotHash: HASH_C }))
      .rejects.toBeInstanceOf(ContextGatewayContractError)
    await expect(parseContextGatewayContractSnapshotV1({ ...frozen, version: 2 }))
      .rejects.toThrow('只支持')
  })
})
