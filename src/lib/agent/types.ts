import type { AIProvider } from '../types/ai'
import type { AssembleContextSourceEvidence, ContextSourceTransformer } from '../registry/types'
import type { AgentContextPolicy } from './context-policy'
import type { WorkspaceScope } from '../types/world-ownership'
import type { ContextGatewayToolSessionV1 } from '../context-gateway/tool-session'
import type { ContextSourceRefV1 } from '../registry/types'

export type AgentToolRisk = 'read' | 'generate' | 'write'

export interface AgentToolExecutionContext {
  projectId: number
  scope?: WorkspaceScope
  /**
   * 当前工作区选中的世界。多世界项目必须显式传；单世界项目会归一为 null。
   * 工具参数不能覆盖这个值。
   */
  worldGroupId?: number | null
  provider?: AIProvider
  model?: string
  /** 只由宿主编排层注入；模型工具参数不能覆盖。 */
  contextPolicy?: AgentContextPolicy
  /** Host-only semantic compression hook; model tool arguments cannot supply it. */
  sourceTransformer?: ContextSourceTransformer
  /** Host-only frozen Context Gateway scope/policy/counters/capabilities. */
  contextGatewaySession?: ContextGatewayToolSessionV1
}

export interface AgentToolJsonSchemaProperty {
  type: 'string' | 'integer' | 'array' | 'object'
  description?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  enum?: readonly string[]
  items?: AgentToolJsonSchemaProperty
  properties?: Record<string, AgentToolJsonSchemaProperty>
  required?: readonly string[]
  additionalProperties?: false
}

export interface AgentToolJsonSchema {
  type: 'object'
  properties: Record<string, AgentToolJsonSchemaProperty>
  required?: readonly string[]
  additionalProperties: false
}

export interface AgentToolResult {
  ok: boolean
  content: string
  error?: string
  meta: {
    toolName: string
    sourceKeys: readonly string[]
    included: string[]
    omitted: string[]
    trimmed: string[]
    sourceEvidence?: AssembleContextSourceEvidence[]
    totalInputTokens: number
    inputBudget: number
    overBudgetBeforeTrim: boolean
    overBudgetAfterTrim: boolean
    gateway?: {
      version: 1
      operation: 'list' | 'search' | 'read' | 'original'
      scopeFingerprint: string
      policyId: string
      policyHash: string
      providerIds: string[]
      resourceKeys: string[]
      contentHashes: string[]
      sourceRefCapabilities: string[]
      /** Host-only durable replay material; Runner never copies this into model-visible tool content. */
      sourceRefEvidence: Array<{
        capability: string
        resourceKey: string
        descriptorContentHash: string
        descriptorPolicyHash: string
        sourceRef: ContextSourceRefV1
      }>
      nextCursor: string | null
      readCallsUsed: number
      retrievedTokensUsed: number
    }
  }
}

export interface AgentToolDefinition {
  name: string
  description: string
  risk: AgentToolRisk
  parameters: AgentToolJsonSchema
  sourceKeys: readonly string[]
  inputBudgetTokens: number
  execute: (
    context: AgentToolExecutionContext,
    args: Record<string, unknown>,
  ) => Promise<AgentToolResult>
}
