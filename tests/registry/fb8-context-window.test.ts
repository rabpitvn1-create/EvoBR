/**
 * FB-8 · 本地/自定义模型上下文窗口可配置(社区反馈 zzjj)
 *
 * 根因:context-budget.ts 对识别不到的模型兜底 maxContext=8000,且无用户覆盖口子 →
 * 本地 256K 模型被当 8K,误报「上下文超出窗口」。
 * 修复:calculateBudget 增加 contextWindowOverride 参数,优先级 用户>预设>8K兜底。
 */
import { describe, it, expect } from 'vitest'
import { calculateBudget, trimMessagesToFit, type ContextSegment } from '../../src/lib/ai/context-budget'

const seg = (tokens: number): ContextSegment => ({
  label: 'x', layer: 'L1', content: 'x', tokens, trimmable: true,
})

describe('FB-8 · 上下文窗口可配置', () => {
  it('未知模型默认兜底 8K(复现 bug 前提)', () => {
    const b = calculateBudget('ollama' as any, '某本地模型', [seg(100)])
    // ollama 预设就是 8000(代表本地模型默认偏小)
    expect(b.maxContext).toBe(8000)
  })

  it('用户填了 contextWindow → 以用户值为准(修复)', () => {
    const b = calculateBudget('ollama' as any, '某本地模型', [seg(100)], 170000)
    expect(b.maxContext).toBe(170000)
  })

  it('误报超窗场景:4.8K 上下文在 8K 下超窗,填 170K 后不再超窗', () => {
    const segments = [seg(4800)]
    const without = calculateBudget('ollama' as any, 'local', segments)        // 8K 窗
    const withWin = calculateBudget('ollama' as any, 'local', segments, 170000) // 170K 窗
    expect(without.overBudget).toBe(true)   // 旧行为:误报超窗
    expect(withWin.overBudget).toBe(false)  // 修复:填了真实窗口后不再超
  })

  it('已知模型不传 override → 使用当前官方窗口预设', () => {
    const b1 = calculateBudget('deepseek' as any, 'deepseek-chat', [seg(100)])
    expect(b1.maxContext).toBe(1_000_000) // DeepSeek V4 历史别名已迁移到当前窗口
  })

  it('override=0/undefined → 回退预设(留空等于用预设)', () => {
    const b = calculateBudget('ollama' as any, 'local', [seg(100)], 0)
    expect(b.maxContext).toBe(8000)
  })

  it('request-side trimMessagesToFit 也尊重 contextWindow override', () => {
    const huge = '长'.repeat(6000)
    const messages = [
      { role: 'system' as const, content: 'system' },
      { role: 'user' as const, content: huge },
    ]
    const without = trimMessagesToFit(messages, 'ollama' as any, 'local', 4096)
    const withOverride = trimMessagesToFit(messages, 'ollama' as any, 'local', 4096, 170000)

    expect(without.trimmed).toBe(true)
    expect(withOverride.trimmed).toBe(false)
    expect(withOverride.messages[1].content).toBe(huge)
  })
})
