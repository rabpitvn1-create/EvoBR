#!/usr/bin/env node
/**
 * P1 Vietnamese prose baseline. Real StoryForge browser client, no mocks.
 * Node 24 + Vite + Playwright Chromium. Does not touch reader/authoring tables.
 * Results are written to a caller-selected local directory, not the repository DB.
 */
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { chromium } from '@playwright/test'

const TOTAL_TURNS = 20
const SCENARIO_ID = 'evobr-p1-cao-minh-level0-v1'
const sha256 = value => createHash('sha256').update(value).digest('hex')
const sleep = milliseconds => new Promise(done => setTimeout(done, milliseconds))
const percentile = (numbers, fraction) => {
  if (!numbers.length) return null
  const ordered = [...numbers].sort((a, b) => a - b)
  const index = (ordered.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (index - lower)
}
const numberEnv = (name, fallback, min = 0) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < min) throw Error('Invalid numeric option: ' + name)
  return value
}
const integerEnv = (name, fallback, min = 0) => {
  const value = numberEnv(name, fallback, min)
  if (!Number.isSafeInteger(value)) throw Error('Expected integer: ' + name)
  return value
}
const usageNumber = value => Number.isFinite(value) && value >= 0 ? value : null
const sumKnown = (items, key) => items.every(item => item[key] !== null)
  ? items.reduce((sum, item) => sum + item[key], 0)
  : null
const SCENARIO = Object.freeze({
  version: 1,
  id: SCENARIO_ID,
  protagonist: 'Cao Minh',
  setting: 'Backrooms, Level 0',
  initialConditions: [
    'Cao Minh tỉnh lại một mình trong mê cung các phòng màu vàng cũ kỹ.',
    'Đèn huỳnh quang phát tiếng rè đều; thảm trải sàn ẩm và phảng phất mùi mốc.',
    'Anh chưa biết mình ở đâu, chưa có bản đồ và không có bạn đồng hành.',
    'Không được tự đặt tên cho nhân vật khác hoặc tự tạo sự kiện đã có từ trước.',
  ],
  boundaries: [
    'Đây là văn xuôi tiểu thuyết, không phải giao diện game.',
    'Không xuất hiện nhiệm vụ, chỉ số, inventory, combat hay lựa chọn phân nhánh.',
    'Không tự tạo Canon Backrooms chưa được cung cấp; chi tiết mới có thể là trải nghiệm chủ quan, không được tuyên bố là định luật thế giới.',
    'Không kết thúc truyện cưỡng ép. Không viết lại các lượt trước.',
  ],
})
const SYSTEM_PROMPT = [
  'Bạn là người viết tiểu thuyết kinh dị tâm lý bằng tiếng Việt tự nhiên.',
  'Viết một đoạn văn xuôi hoàn chỉnh, có diễn tiến nhân quả và điểm neo cảm xúc.',
  'Chỉ xuất văn xuôi, không tiêu đề, không Markdown, không phân tích hay lựa chọn.',
  'Giữ nguyên dữ kiện của tất cả những lượt truyện trước.',
  'Không thêm nhân vật có tên hoặc lore được xem là Canon khi chưa có dữ kiện.',
  'Tránh lặp công thức văn, tránh kể lại nguyên văn đoạn vừa rồi.',
  'Mỗi lượt khoảng 180–300 từ nếu khả thi; ưu tiên tính tự nhiên và continuity.',
].join('\n')

function instructions(turn, previous) {
  const history = previous.map((item, index) => {
    return 'LƯỢT ' + (index + 1) + ' (SHA256 ' + item.hash + '):\n' + item.text
  }).join('\n\n')
  return [
    'KỊCH BẢN CỐ ĐỊNH: ' + JSON.stringify(SCENARIO),
    'ĐANG VIẾT LƯỢT ' + turn + '/20.',
    turn === 1 ? 'Bắt đầu ở đúng điều kiện ban đầu.' : 'Tiếp nối trực tiếp câu chuyện đã có, không reset.',
    'LỊCH SỬ ĐÃ CÔNG BỐ (đọc hết trước khi viết):',
    history || '(chưa có văn)',
    'Viết duy nhất lượt mới, bằng tiếng Việt.',
  ].join('\n\n')
}

function validateEnvironment() {
  const provider = process.env.EVO_P1_PROVIDER
  const model = process.env.EVO_P1_MODEL
  const baseUrl = process.env.EVO_P1_BASE_URL
  const apiKey = process.env.EVO_P1_API_KEY || ''
  if (!provider || !model || !baseUrl) {
    throw Error('REAL_PROVIDER_UNAVAILABLE: EVO_P1_PROVIDER, EVO_P1_MODEL and EVO_P1_BASE_URL are required. No mock fallback.')
  }
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) throw Error('Invalid EVO_P1_BASE_URL')
  if (!apiKey && !(provider === 'ollama' && process.env.EVO_P1_ALLOW_EMPTY_KEY === '1')) {
    throw Error('REAL_PROVIDER_UNAVAILABLE: EVO_P1_API_KEY missing. No mock fallback.')
  }
  const priceIn = numberEnv('EVO_P1_INPUT_USD_PER_M', null)
  const priceOut = numberEnv('EVO_P1_OUTPUT_USD_PER_M', null)
  if ((priceIn === null) !== (priceOut === null)) {
    throw Error('Provide both EVO_P1_INPUT_USD_PER_M and EVO_P1_OUTPUT_USD_PER_M, or neither.')
  }
  return {
    provider, model, baseUrl, apiKey,
    temperature: numberEnv('EVO_P1_TEMPERATURE', 0.8),
    maxTokens: integerEnv('EVO_P1_MAX_TOKENS', 1400, 1),
    contextWindow: integerEnv('EVO_P1_CONTEXT_WINDOW', 65536, 1024),
    priceIn, priceOut,
    maxRetries: integerEnv('EVO_P1_MAX_RETRIES', 0, 0),
    port: integerEnv('EVO_P1_VITE_PORT', 41973, 1024),
  }
}

async function startVite(port) {
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js',
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  })
  let output = ''
  const append = buffer => { output = (output + String(buffer)).slice(-3000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)
  const origin = 'http://127.0.0.1:' + port
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error('Vite failed to start: ' + output)
    try {
      const response = await fetch(origin + '/__vite_ping', { signal: AbortSignal.timeout(1500) })
      if (response.ok) return { child, origin }
    } catch { /* server not ready */ }
    await sleep(150)
  }
  child.kill()
  throw Error('Vite did not become ready: ' + output)
}

async function realClientCall(page, input, config) {
  return page.evaluate(async ({ messages, config }) => {
    // Real repo module runs under Vite in a browser context. No synthetic
    // fetch implementation or replayed response is used by this harness.
    const module = await import('/src/lib/ai/client.ts')
    const result = {}
    try {
      const text = await module.chat(messages, config, {
        category: 'reader.prose.baseline',
        contextOverflowPolicy: 'reject',
        transportRetryPolicy: 'none',
      }, undefined, result)
      if (!text || !text.trim()) throw Error('EMPTY_COMPLETION')
      return {
        ok: true,
        text,
        usage: result.usage || null,
        lifecycle: result.requestLifecycle || null,
        finishReason: result.finishReason || null,
      }
    } catch (error) {
      return {
        ok: false,
        name: error && error.name || 'UnknownError',
        status: Number.isInteger(error && error.status) ? error.status : null,
        code: typeof error?.code === 'string' ? error.code : null,
        lifecycle: result.requestLifecycle || null,
      }
    }
  }, { messages: input, config })
}

function decideRetry(failure, attempt, maxRetries) {
  if (attempt > maxRetries) return false
  // Never replay a dispatched request with unknown delivery. Only
  // a confirmed 429/503 response is eligible for the benchmark's opt-in retry.
  return failure.lifecycle?.phase === 'response-observed'
    && [429, 503].includes(failure.status)
}

function summarize(turns, config) {
  const attempts = turns.flatMap(turn => turn.attempts)
  const successful = attempts.filter(x => x.ok)
  const durations = successful.map(x => x.durationMs)
  const errorCounts = {}
  for (const attempt of attempts.filter(x => !x.ok)) {
    const key = String(attempt.name || 'UnknownError') + ':' + String(attempt.status ?? 'no-http')
    errorCounts[key] = (errorCounts[key] || 0) + 1
  }
  const totalInputTokens = sumKnown(successful, 'inputTokens')
  const totalOutputTokens = sumKnown(successful, 'outputTokens')
  const estimatedSuccessCostUSD = config.priceIn !== null && config.priceOut !== null
    && totalInputTokens !== null && totalOutputTokens !== null
    ? (totalInputTokens * config.priceIn + totalOutputTokens * config.priceOut) / 1_000_000
    : null
  // A failed dispatched call can still be billed. Never label a partial
  // observed-cost figure as a complete invoice or a definitive total.
  const failedDispatched = attempts.some(item => !item.ok && item.lifecycle?.phase !== 'pre-dispatch')
  const estimateUSD = failedDispatched ? null : estimatedSuccessCostUSD
  return {
    completedTurns: turns.filter(t => t.status === 'completed').length,
    expectedTurns: TOTAL_TURNS,
    totalCalls: attempts.length,
    successfulCalls: successful.length,
    failedCalls: attempts.length - successful.length,
    retries: turns.reduce((sum, turn) => sum + turn.retries, 0),
    inputTokensMeasured: totalInputTokens,
    outputTokensMeasured: totalOutputTokens,
    estimatedCostUSD: estimateUSD,
    pricingStatus: failedDispatched ? 'unknown-billing-for-failed-dispatched-call'
      : estimateUSD === null ? 'unpriced-or-provider-usage-missing' : 'estimated-from-user-supplied-prices',
    observedSuccessfulCallCostUSD: estimatedSuccessCostUSD,
    latencyMs: { p50: percentile(durations, 0.5), p95: percentile(durations, 0.95) },
    errors: errorCounts,
    turns: turns.map(turn => ({
      turn: turn.turn, status: turn.status, calls: turn.attempts.length,
      retries: turn.retries, durationMs: turn.durationMs,
      inputTokensMeasured: sumKnown(turn.attempts.filter(a => a.ok), 'inputTokens'),
      outputTokensMeasured: sumKnown(turn.attempts.filter(a => a.ok), 'outputTokens'),
      estimatedCostUSD: turn.attempts.every(a => a.estimatedCostUSD !== null)
        ? turn.attempts.reduce((sum, a) => sum + a.estimatedCostUSD, 0) : null,
    })),
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write('P1: node scripts/quality-evals/reader-vietnamese-baseline.mjs [OUTPUT_DIR]\n' +
      'Required environment: EVO_P1_PROVIDER, EVO_P1_MODEL, EVO_P1_BASE_URL, EVO_P1_API_KEY\n' +
      'Optional: EVO_P1_INPUT_USD_PER_M, EVO_P1_OUTPUT_USD_PER_M, EVO_P1_MAX_RETRIES (default 0).\n' +
      'Requires Node 24, npm ci and Playwright Chromium. Always uses real src/lib/ai/client.ts.\n')
    return
  }
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw Error('NODE_VERSION_UNSUPPORTED: AGENTS.md requires Node.js 24 for P1.')
  }
  const config = validateEnvironment()
  const directory = resolve(process.argv[2] || 'p1-results')
  const runId = randomUUID()
  const startedAt = new Date().toISOString()
  await mkdir(directory, { recursive: true })
  const turns = []
  const previous = []
  const safeConfig = {
    provider: config.provider, model: config.model,
    baseUrlHash: sha256(config.baseUrl), temperature: config.temperature,
    maxTokens: config.maxTokens, contextWindow: config.contextWindow,
    inputPriceUSDPerMillion: config.priceIn,
    outputPriceUSDPerMillion: config.priceOut,
    maxRetries: config.maxRetries,
  }
  const reportPath = join(directory, 'baseline-' + runId + '.json')
  const persist = async (state, lastError = null) => {
    const report = {
      schema: 'evobr.reader-p1-baseline', version: 1, runId, startedAt,
      updatedAt: new Date().toISOString(), status: state,
      scenario: SCENARIO, scenarioHash: sha256(JSON.stringify(SCENARIO)),
      promptVersion: 'reader-prose-baseline-v1',
      transport: 'repo-browser-chat-client', realProvider: true,
      modelConfig: safeConfig, summary: summarize(turns, config),
      lastError, turns,
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2))
  }
  let vite = null
  let browser = null
  try {
    await persist('starting')
    vite = await startVite(config.port)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    await page.goto(vite.origin + '/__vite_ping', { waitUntil: 'domcontentloaded' })
    const requestConfig = {
      provider: config.provider, model: config.model, baseUrl: config.baseUrl,
      apiKey: config.apiKey, temperature: config.temperature,
      maxTokens: config.maxTokens, contextWindow: config.contextWindow,
    }
    for (let turn = 1; turn <= TOTAL_TURNS; turn++) {
      const history = instructions(turn, previous)
      const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: history }]
      const record = { turn, status: 'running', historyLength: previous.length,
        historyHash: sha256(history), attempts: [], retries: 0, durationMs: 0 }
      turns.push(record)
      await persist('running')
      let finished = false
      for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
        const begin = performance.now()
        const result = await realClientCall(page, messages, requestConfig)
        const durationMs = Math.round(performance.now() - begin)
        record.durationMs += durationMs
        const usage = result.usage || {}
        record.attempts.push({
          attempt, ok: result.ok, durationMs,
          inputTokens: usageNumber(usage.inputTokens),
          outputTokens: usageNumber(usage.outputTokens),
          totalTokens: usageNumber(usage.totalTokens),
          estimatedCostUSD: result.ok && config.priceIn !== null && config.priceOut !== null
            && usageNumber(usage.inputTokens) !== null && usageNumber(usage.outputTokens) !== null
            ? (usage.inputTokens * config.priceIn + usage.outputTokens * config.priceOut) / 1_000_000
            : null,
          name: result.ok ? null : result.name,
          status: result.ok ? null : result.status,
          code: result.ok ? null : result.code,
          lifecycle: result.lifecycle,
          finishReason: result.finishReason ?? null,
        })
        if (result.ok) {
          const text = result.text.trim()
          record.text = text
          record.hash = sha256(text)
          record.status = 'completed'
          previous.push({ text, hash: record.hash })
          finished = true
          break
        }
        if (!decideRetry(result, attempt, config.maxRetries)) break
        record.retries++
        await sleep(Math.min(1000 * attempt, 4000))
      }
      if (!finished) {
        record.status = 'failed'
        await persist('failed', 'Turn ' + turn + ' did not produce a verified provider response; no mock fallback.')
        process.exitCode = 2
        return
      }
      await persist('running')
      process.stdout.write('Turn ' + turn + '/' + TOTAL_TURNS + ' completed, SHA256 ' + record.hash.slice(0, 12) + '\n')
    }
    await persist('completed')
    process.stdout.write('REAL 20-TURN RUN COMPLETE. Report: ' + reportPath + '\n')
  } catch (error) {
    await persist('blocked', { name: error?.name || 'Error', code: 'runner-error' })
    throw error
  } finally {
    await browser?.close()
    vite?.child.kill()
  }
}

main().catch(error => {
  // Never print request headers, raw provider bodies or credentials.
  process.stderr.write('P1 harness stopped: ' + (error?.name || 'Error') +
    ': ' + String(error?.message || 'unknown failure').replace(/(sk-[A-Za-z0-9_-]+)/g, '[REDACTED]').slice(0, 250) + '\n')
  process.exitCode = 1
})
