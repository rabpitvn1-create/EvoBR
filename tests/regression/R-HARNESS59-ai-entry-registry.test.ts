import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FORMAL_AI_ENTRY_REGISTRY_V1, assertFormalAIEntryCallV1, parseFormalAIEntryRegistryV1 } from '../../src/lib/agent/formal-ai-entry'


interface Entry {
  entryId: string
  skillId: string
  entryKind: 'formal' | 'auxiliary' | 'evaluation' | 'experimental'
  adoptAllowed: boolean
  adoptionTargets?: string[]
  allowedCallers: string[]
}

const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8')) as {
  version: number
  entries: Entry[]
}

describe('R-HARNESS59 / WEH-0H · 正式 AI 入口机器绑定', () => {


  it('AST 守卫证明实际 member/alias/wrapper 调用均携带登记 entryId', () => {
    const output = execFileSync(process.execPath, ['scripts/check-ai-entry-registry.mjs'], { encoding: 'utf8' })
    expect(output).toContain(`${registry.entries.length} bindings`)
    expect(output).toContain('formal')
  })

  it('唯一注册表严格解析且每项连接 Skill、执行器、候选和调用方', () => {
    expect(registry.version).toBe(2)
    expect(FORMAL_AI_ENTRY_REGISTRY_V1.entries).toHaveLength(registry.entries.length)
    for (const retiredId of ['world.setting.lookup.qa', 'world.setting.lookup.extract']) {
      expect(FORMAL_AI_ENTRY_REGISTRY_V1.entries.some(entry => entry.entryId === retiredId)).toBe(false)
    }
    for (const entry of FORMAL_AI_ENTRY_REGISTRY_V1.entries) {
      expect(entry.skillId).not.toBe('')
      expect(entry.runContractBuilderId).not.toBe('')
      expect(entry.candidateKind).not.toBe('')
      expect(entry.allowedCallers.length).toBeGreaterThan(0)
    }
  })


  it('辅助、评测和实验入口由机器权限证明不可采纳', () => {
    const nonFormal = registry.entries.filter(entry => entry.entryKind !== 'formal')
    expect(nonFormal.length).toBeGreaterThan(0)
    expect(nonFormal.every(entry => entry.adoptAllowed === false)).toBe(true)
    expect(nonFormal.every(entry => (entry.adoptionTargets?.length ?? 0) === 0)).toBe(true)
  })

  it('有限语音扩展不进入正式执行器，旧冻结注册表仍可严格解析', () => {
    const full = JSON.parse(JSON.stringify(registry))
    expect(() => parseFormalAIEntryRegistryV1(full)).not.toThrow()
    expect(FORMAL_AI_ENTRY_REGISTRY_V1.entries.some((entry) => entry.entryId.startsWith('longform.voice'))).toBe(false)
    delete full.limitedTransports
    expect(parseFormalAIEntryRegistryV1(full).entries).toHaveLength(registry.entries.length)
    const legacy = { ...full, entries: full.entries.filter((entry: Entry) => !['ttrpg.open.local-voice', 'ttrpg.open.brief', 'ttrpg.open.situation-propose', 'ttrpg.open.public-situation-propose', 'ttrpg.open.entity-propose', 'ttrpg.open.common-oracle-interpret', 'ttrpg.open.authoring-design', 'ttrpg.open.authoring-design.full'].includes(entry.entryId)) }
    expect(parseFormalAIEntryRegistryV1(legacy).entries).toHaveLength(registry.entries.length)
    expect(legacy.entries.some((entry: Entry) => entry.entryId.startsWith('ttrpg.open.authoring-design'))).toBe(false)
    for (const patch of [{ adoptAllowed: true }, { adoptionTargets: ['chapters'] }, { boundary: 'durable-run' }]) {
      const invalid = JSON.parse(JSON.stringify(registry))
      Object.assign(invalid.limitedTransports[0], patch)
      expect(() => parseFormalAIEntryRegistryV1(invalid)).toThrow(/有限语音/)
    }
  })

  it('unknown entry 和错配 category 在发起 provider 请求前 fail closed', () => {
    expect(() => assertFormalAIEntryCallV1({
      formalEntryId: 'unknown.entry',
      category: 'chapter.content',
    })).toThrow(/未登记正式 AI 入口/)
    expect(() => assertFormalAIEntryCallV1({
      formalEntryId: 'prose.chapter.generate',
      category: 'chapter.continue',
    })).toThrow(/不允许 category/)
  })


  it('显式音频评测传输保持脚本、只读和零采纳边界，不进入正式创作执行器', () => {
    const full = JSON.parse(JSON.stringify(registry))
    const entry = { entryId: 'eval.avg.audio-input-test', boundary: 'eval-only', adoptAllowed: false,
      caller: 'scripts/evaluate-avg-audio-input.mjs', contract: 'scripts/avg-audio-input-contract.mjs',
      transport: 'configured-chat-audio-input-v1', reason: '仅显式工程WAV/静音对照；不读作者数据库、不采纳、不发布。' }
    full.offlineEvaluations.push(entry)
    expect(parseFormalAIEntryRegistryV1(full).entries).toEqual(FORMAL_AI_ENTRY_REGISTRY_V1.entries)
    expect(() => assertFormalAIEntryCallV1({ formalEntryId: entry.entryId, category: 'chapter.content' })).toThrow(/未登记正式/)
    for (const patch of [{ adoptAllowed: true }, { adoptionTargets: ['productBuildArtifacts'] }, { boundary: 'durable-run' },
      { caller: 'src/lib/avg/assembly-service.ts' }, { contract: '../outside.mjs' }, { transport: 'unrestricted-http' }]) {
      const bad = structuredClone(full)
      Object.assign(bad.offlineEvaluations.at(-1), patch)
      expect(() => parseFormalAIEntryRegistryV1(bad)).toThrow(/离线评测/)
    }
  })

  it('删除 Skill 绑定、非法开放辅助采纳和未知 schema 字段均被拒绝', () => {
    const base = JSON.parse(JSON.stringify(registry)) as typeof registry
    const unknownSkill = JSON.parse(JSON.stringify(base)) as typeof registry
    unknownSkill.entries[0].skillId = 'missing.skill'
    expect(() => parseFormalAIEntryRegistryV1(unknownSkill)).toThrow(/未知 Skill/)

    const auxiliaryWrite = JSON.parse(JSON.stringify(base)) as typeof registry
    const auxiliary = auxiliaryWrite.entries.find(entry => entry.entryKind === 'auxiliary')!
    auxiliary.adoptAllowed = true
    auxiliary.adoptionTargets = ['chapters']
    expect(() => parseFormalAIEntryRegistryV1(auxiliaryWrite)).toThrow(/不得开放采纳/)

    const unknownField = JSON.parse(JSON.stringify(base)) as typeof registry & { surprise?: boolean }
    unknownField.surprise = true
    expect(() => parseFormalAIEntryRegistryV1(unknownField)).toThrow(/未知或缺失字段/)
  })

  it('正式写入口的 adoptionTargets 与 Skill 写集合机验一致', () => {
    const writable = FORMAL_AI_ENTRY_REGISTRY_V1.entries.filter(entry => entry.adoptAllowed)
    expect(writable.map(entry => entry.entryId)).toEqual(expect.arrayContaining([
      'prose.chapter.generate',
      'outline.volume.generate',
      'outline.detail.scene',
    ]))
    expect(writable.every(entry => entry.adoptionTargets.length > 0)).toBe(true)
  })
})
