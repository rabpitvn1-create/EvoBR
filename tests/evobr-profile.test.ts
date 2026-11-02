import { describe, expect, it } from 'vitest'
import { checkRegistry } from '../src/lib/registry/validate'
import { validateAgentSkillDefinitionsV1, AGENT_SKILLS } from '../src/lib/agent/skill-registry'
import { getAgentToolSchemaSnapshotV1 } from '../src/lib/agent/tool-registry'
import { hashCanonicalValue } from '../src/lib/agent/run/hash'
import { AGENT_TOOL_SCHEMA_HASH_V1 } from '../src/lib/agent/execution-binding'
import { PROJECT_TABLES } from '../src/lib/registry/project-tables'
import { normalizeNewWorkClassification, assertStoredWorkClassification } from '../src/lib/workspace/work-kind'

describe('EvoBR Long Form import boundary', () => {
  it('keeps all three registries closed and all retained Skills valid', () => {
    expect(checkRegistry()).toEqual({ ok: true, errors: [] })
    expect(() => validateAgentSkillDefinitionsV1(AGENT_SKILLS)).not.toThrow()
    expect(PROJECT_TABLES.some(t => /^(product|ttrpg|avg|comic|screenplay|motionDrama|shortNovel)/.test(t.name))).toBe(false)
  })
  it('freezes the exact Long Form tool schema', async () => {
    const actual = await hashCanonicalValue(getAgentToolSchemaSnapshotV1())
    expect(actual).toBe(AGENT_TOOL_SCHEMA_HASH_V1)
  })
  it('only creates and restores long novels, with no fixed chapter limit', () => {
    expect(normalizeNewWorkClassification({ targetWordCount: 50_000_000 })).toEqual({ kind: 'novel', novelProfile: 'long' })
    expect(() => normalizeNewWorkClassification({ kind: 'avg', targetWordCount: 1000 })).toThrow()
    expect(() => normalizeNewWorkClassification({ novelProfile: 'short', targetWordCount: 10000 })).toThrow()
    expect(() => assertStoredWorkClassification({ kind: 'screenplay', novelProfile: null })).toThrow()
  })
})
