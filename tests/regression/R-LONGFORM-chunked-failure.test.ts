import { describe, it, expect, vi } from 'vitest'
import { AIError } from '../../src/lib/types'
import { runChunkedOutlineGeneration } from '../../src/lib/outline/chunked-generator'
import { DEFAULT_CHUNKED_CONFIG } from '../../src/lib/outline/generation-modes'
const calls = vi.hoisted(() => vi.fn())
vi.mock('../../src/lib/agent/formal-ai-entry', () => ({ executeRegisteredAIEntryV1: calls }))
describe('chunked generation stops on provider failures', () => {
  it.each([401, 402, 429, 500])('propagates %s without generating fallback choices or later blocks', async status => {
    calls.mockReset().mockRejectedValue(new AIError(status, 'provider rejected'))
    const choice = vi.fn()
    await expect(runChunkedOutlineGeneration({ projectId: 2, volumeId: 731, volumeTitle: '卷一', volumeSummary: '旧信', worldContext: '', characterContext: '', worldRulesContext: '', config: { ...DEFAULT_CHUNKED_CONFIG, blockCount: 3 }, totalChapters: 6, onChoiceNeeded: choice })).rejects.toBeInstanceOf(AIError)
    expect(calls).toHaveBeenCalledOnce(); expect(choice).not.toHaveBeenCalled()
    expect(calls.mock.calls[0][3].projectId).toBe(2)
  })
})
