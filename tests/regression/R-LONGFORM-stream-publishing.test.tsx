import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAIStream, type UseAIStreamReturn } from '../../src/hooks/useAIStream'
import { useAIGenerationSessionStore } from '../../src/stores/ai-generation-session'

const mocks = vi.hoisted(() => ({ stream: vi.fn() }))
vi.mock('../../src/lib/agent/formal-ai-entry', () => ({ streamRegisteredAIEntryV1: mocks.stream }))
vi.mock('../../src/stores/ai-config', () => ({ useAIConfigStore: { getState: () => ({ config: { provider: 'ollama', baseUrl: 'http://localhost:1234/v1', model: 'test', maxTokens: 4000 } }) } }))
vi.mock('../../src/lib/ai/client', () => ({ resolveRequestConfig: (config: unknown) => ({ config }) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let current: UseAIStreamReturn
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
const meta = { formalEntryId: 'outline.detail.scene', category: 'detail.scene', projectId: 1 } as const
function View({ shared = true }: { shared?: boolean }) { current = useAIStream(shared ? 'burst-test' : undefined); return createElement('p', null, current.output) }
beforeEach(async () => {
  vi.useFakeTimers(); useAIGenerationSessionStore.setState({ sessions: {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(createElement(View)))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.clearAllMocks() })

it('coalesces a rapid burst while returning and displaying every character', async () => {
  const content = '完整中文流式内容'.repeat(500)
  mocks.stream.mockImplementation(async function* () { for (const char of content) yield char })
  const changes: string[] = []
  const unsubscribe = useAIGenerationSessionStore.subscribe(state => changes.push(state.sessions['burst-test']?.output ?? ''))
  let result = ''
  await act(async () => { result = await current.start([], undefined, meta) })
  unsubscribe()
  expect(result).toBe(content)
  expect(host.textContent).toBe(content)
  expect(changes.length).toBeLessThan(10)
  expect(current.error).toBeNull()
  expect(current.isStreaming).toBe(false)
})

it('flushes visible progress on the timer and ignores a cancelled request after a new run starts', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  mocks.stream.mockImplementationOnce(async function* () { yield '旧结果'; await pending; yield '迟到文字' })
  let previous!: Promise<string>
  await act(async () => { previous = current.start([], undefined, meta); await Promise.resolve() })
  await act(async () => { await vi.advanceTimersByTimeAsync(32) })
  expect(host.textContent).toBe('旧结果')
  await act(async () => current.stop())
  mocks.stream.mockImplementationOnce(async function* () { yield '新结果' })
  await act(async () => { await current.start([], undefined, meta); release(); await previous; await vi.runAllTimersAsync() })
  expect(host.textContent).toBe('新结果')
  expect(current.isStreaming).toBe(false)
})


it.each([true, false])('late failures cannot overwrite a newer %s stream or clear its busy state', async shared => {
  await act(async () => root.render(createElement(View, { shared })))
  let rejectOld!: (reason: Error) => void
  let finishNew!: () => void
  const oldGate = new Promise<void>((_, reject) => { rejectOld = reject })
  const newGate = new Promise<void>(resolve => { finishNew = resolve })
  mocks.stream.mockImplementationOnce(async function* () { yield '旧请求'; await oldGate })
  let old!: Promise<string>
  await act(async () => { old = current.start([], undefined, meta); await Promise.resolve() })
  mocks.stream.mockImplementationOnce(async function* () { yield '新请求'; await newGate; yield '完成' })
  let newer!: Promise<string>
  await act(async () => { newer = current.start([], undefined, meta); await vi.advanceTimersByTimeAsync(32) })
  await act(async () => { rejectOld(new Error('旧连接关闭')); await old })
  expect(current.error).toBeNull()
  expect(current.isStreaming).toBe(true)
  expect(current.output).toBe('新请求')
  await act(async () => { finishNew(); await newer })
  expect(current.output).toBe('新请求完成')
  expect(current.isStreaming).toBe(false)
})
