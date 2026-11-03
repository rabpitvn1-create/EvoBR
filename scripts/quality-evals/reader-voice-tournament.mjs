#!/usr/bin/env node
/**
 * P1 four-voice tournament. Only real 20-turn baseline reports can enter
 * blind packets. Style-to-label mapping remains in organizer-key.json,
 * never in participant HTML/JSON. No mocks or alternative model transport.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createBlindPackets, parseCompletedBaseline, renderBlindReviewHtml,
  validateBlindReview, DIMENSIONS } from './reader-blind-review.mjs'
import { getVoiceProfileV1, TOURNAMENT_PROFILES_V1 } from './reader-voice-profiles.mjs'

const hash = x => createHash('sha256').update(x).digest('hex')
const outJson = value => JSON.stringify(value, null, 2) + '\n'
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const SCHEMA = 'evobr.reader-voice-tournament'
const AUDIT_CODES = new Set(['named-canon', 'history-contradiction', 'forced-ending'])
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const pctl = (numbers, frac) => {
  if (!numbers.length) return null
  const s = [...numbers].sort((a, b) => a - b), v = (s.length - 1) * frac
  return s[Math.floor(v)] + (s[Math.ceil(v)] - s[Math.floor(v)]) * (v - Math.floor(v))
}
const metricsFromReport = report => {
  const a = report.turns.flatMap(t => t.attempts)
  const good = a.filter(x => x.ok)
  const costsKnown = a.every(x => typeof x.estimatedCostUSD === 'number' &&
    Number.isFinite(x.estimatedCostUSD) && x.estimatedCostUSD >= 0)
  const countsKnown = good.every(x => Number.isFinite(x.inputTokens) && Number.isFinite(x.outputTokens))
  const latency = good.map(x => x.durationMs)
  const errors = {}
  for (const item of a.filter(x => !x.ok)) {
    const label = (item.name || 'Error') + ':' + (item.status ?? 'unknown')
    errors[label] = (errors[label] || 0) + 1
  }
  return {
    turns: report.turns.length,
    calls: a.length, successfulCalls: good.length, failedCalls: a.length - good.length,
    retries: report.turns.reduce((s, t) => s + t.retries, 0),
    inputTokens: countsKnown ? good.reduce((s, t) => s + t.inputTokens, 0) : null,
    outputTokens: countsKnown ? good.reduce((s, t) => s + t.outputTokens, 0) : null,
    estimatedCostUSD: costsKnown ? a.reduce((s, t) => s + t.estimatedCostUSD, 0) : null,
    pricingStatus: costsKnown ? 'estimated-from-reported-usage-and-operator-prices' : 'unknown',
    latencyMs: { p50: pctl(latency, .5), p95: pctl(latency, .95) },
    errors,
    perTurn: report.summary.turns,
  }
}
function assertProfileReport(report, id, expectedScenarioHash = null, expectedModel = null) {
  parseCompletedBaseline(report)
  const profile = getVoiceProfileV1(id)
  const expectedHash = hash(JSON.stringify({ id, ...profile }))
  if (report.voiceProfileId !== id || report.voiceProfileHash !== expectedHash ||
    report.voiceProfileVersion !== profile.version || report.promptVersion !== 'reader-prose-voice-selection-v1' ||
    report.scenario?.id !== 'evobr-p1-cao-minh-level0-v1' ||
    report.scenarioHash !== hash(JSON.stringify(report.scenario)) ||
    !/^[a-f0-9]{64}$/.test(report.systemPromptHash || '')) {
    throw Error('Profile/Canon/prompt evidence mismatch for ' + id)
  }
  if (expectedScenarioHash && report.scenarioHash !== expectedScenarioHash) throw Error('Scenario mismatch across profiles')
  const conf = JSON.stringify(report.modelConfig)
  if (expectedModel && conf !== expectedModel) throw Error('Provider/model/settings mismatch across profiles')
  return { scenarioHash: report.scenarioHash, modelConfig: conf, profileHash: expectedHash }
}
const shuffle = items => {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
async function runOne(out, id) {
  const child = spawn(process.execPath,
    ['scripts/quality-evals/reader-vietnamese-baseline.mjs', out],
    { cwd: process.cwd(), env: { ...process.env, EVO_P1_VOICE_PROFILE: id }, stdio: 'inherit' })
  const code = await new Promise((done, fail) => {
    child.once('error', fail)
    child.once('close', done)
  })
  if (code !== 0) throw Error('Real-provider 20-turn run for ' + id + ' failed or was blocked; exit=' + code)
  const files = (await readdir(out)).filter(name => /^baseline-[0-9a-f-]{36}\.json$/i.test(name))
  if (files.length !== 1) throw Error('Expected exactly one baseline report for ' + id)
  const path = join(out, files[0])
  const report = await readJson(path)
  return { path, report }
}
async function generate(outRoot) {
  if (!outRoot) throw Error('Usage: generate NEW_EMPTY_OUTPUT_DIR')
  const root = resolve(outRoot)
  await mkdir(root, { recursive: true })
  if ((await readdir(root)).length) throw Error('Refusing to reuse a nonempty run dir; prevents billed request replay')
  const manifest = {
    schema: SCHEMA, version: 1, tournamentId: randomUUID(), startedAt: new Date().toISOString(),
    status: 'running', profileIds: [...TOURNAMENT_PROFILES_V1], reports: [],
  }
  const save = () => writeFile(join(root, 'tournament-manifest.json'), outJson(manifest))
  await save()
  let common = null
  try {
    for (const id of TOURNAMENT_PROFILES_V1) {
      const dir = join(root, 'series', id)
      await mkdir(dir, { recursive: true })
      const { path, report } = await runOne(dir, id)
      const proof = assertProfileReport(report, id, common?.scenarioHash, common?.modelConfig)
      common ||= proof
      manifest.reports.push({
        profileId: id, profileHash: proof.profileHash,
        path: path.slice(root.length + 1), reportHash: hash(JSON.stringify(report)),
        runId: report.runId, metrics: metricsFromReport(report),
      })
      await save()
    }
    manifest.status = 'completed'
    manifest.finishedAt = new Date().toISOString()
    await save()
    process.stdout.write('Completed four REAL 20-turn style chains. Tournament: ' + join(root, 'tournament-manifest.json') + '\n')
  } catch (error) {
    manifest.status = 'blocked'
    manifest.errorCode = 'real-provider-or-environment-blocked'
    await save()
    throw error
  }
}
async function openTournament(dir) {
  const root = resolve(dir)
  const manifest = await readJson(join(root, 'tournament-manifest.json'))
  if (manifest.schema !== SCHEMA || manifest.version !== 1 ||
    manifest.status !== 'completed' || manifest.reports?.length !== 4 ||
    TOURNAMENT_PROFILES_V1.some(id => !manifest.reports.some(item => item.profileId === id))) {
    throw Error('All four complete real-provider voice series are required')
  }
  let common = null
  const rows = []
  for (const item of manifest.reports) {
    if (!TOURNAMENT_PROFILES_V1.includes(item.profileId) ||
      !/^series\/[a-z_]+\/baseline-[a-f0-9-]{36}\.json$/i.test(item.path)) {
      throw Error('Invalid profile report path')
    }
    const report = await readJson(join(root, item.path))
    if (hash(JSON.stringify(report)) !== item.reportHash || report.runId !== item.runId) {
      throw Error('Tournament report integrity mismatch')
    }
    const proof = assertProfileReport(report, item.profileId, common?.scenarioHash, common?.modelConfig)
    common ||= proof
    rows.push({ profileId: item.profileId, profileHash: proof.profileHash, report,
      metrics: metricsFromReport(report) })
  }
  return { manifest, rows }
}
async function pack(tournamentDir, blindDir, participant = 'Muse') {
  if (!tournamentDir || !blindDir) throw Error('Usage: pack COMPLETED_TOURNAMENT_DIR NEW_BLIND_DIR [participant]')
  const { manifest, rows } = await openTournament(tournamentDir)
  const root = resolve(blindDir)
  await mkdir(root, { recursive: true })
  if ((await readdir(root)).length) throw Error('Refusing to overwrite blinded packets or organizer mapping')
  await mkdir(join(root, 'participants'))
  const studyId = 'voice_' + manifest.tournamentId.replaceAll('-', '').slice(0, 20)
  // Uniformly shuffle profile-to-sample mapping using system entropy.
  const ordered = shuffle(rows)
  const map = []
  for (let i = 0; i < ordered.length; i++) {
    const row = ordered[i], sampleCode = 'sample-' + String(i + 1).padStart(2, '0')
    const { packets } = createBlindPackets(row.report, [participant], studyId)
    const packet = packets[0]
    await writeFile(join(root, 'participants', sampleCode + '.html'),
      renderBlindReviewHtml(packet), { flag: 'wx' })
    await writeFile(join(root, 'participants', sampleCode + '.json'),
      outJson(packet), { flag: 'wx' })
    // An empty incidents array is not a zero-error certification. Muse must
    // inspect all 20 turns and explicitly change reviewed to true.
    await writeFile(join(root, 'participants', sampleCode + '-canon-template.json'),
      outJson({ schema: 'evobr.reader-voice-canon-audit', version: 1,
        sampleCode, reviewer: 'Muse', reviewed: false, incidents: [] }), { flag: 'wx' })
    map.push({ sampleCode, profileId: row.profileId, profileHash: row.profileHash,
      runId: row.report.runId, modelConfig: row.report.modelConfig,
      systemPromptHash: row.report.systemPromptHash, metrics: row.metrics,
      packetId: packet.packetId, contentHashes: packet.samples.map(x => x.contentHash) })
  }
  const key = {
    schema: 'evobr.reader-voice-organizer-key', version: 1, tournamentId: manifest.tournamentId,
    studyId, participant, mapping: map,
    instruction: 'KEEP PRIVATE until Muse has completed and sealed all four score sheets and Canon audits. Never distribute this file to the reviewer beforehand.',
  }
  await writeFile(join(root, 'organizer-key.json'), outJson(key), { flag: 'wx' })
  process.stdout.write('Four neutral blinded packets produced in participants/. Keep organizer-key.json away from the reviewer.\n')
}
function verifyCanonAudit(audit, sampleCode, packet) {
  if (!audit || audit.schema !== 'evobr.reader-voice-canon-audit' || audit.version !== 1 ||
    audit.sampleCode !== sampleCode || audit.reviewer !== 'Muse' ||
    audit.reviewed !== true || !Array.isArray(audit.incidents)) {
    throw Error('Muse Canon audit missing or not signed for ' + sampleCode)
  }
  const verdicts = []
  for (const incident of audit.incidents) {
    const sample = packet.samples.find(x => x.sequence === incident.turn)
    if (!sample || !AUDIT_CODES.has(incident.category) ||
      !['confirmed', 'uncertain'].includes(incident.verdict) ||
      typeof incident.quote !== 'string' || incident.quote.length < 6 ||
      !sample.prose.includes(incident.quote) ||
      typeof incident.comparison !== 'string' || !incident.comparison.trim()) {
      throw Error('Canon audit evidence invalid for ' + sampleCode)
    }
    verdicts.push({ ...incident, sampleCode })
  }
  return verdicts
}
async function rank(blindDir, scoringDir, output) {
  if (!blindDir || !scoringDir || !output) throw Error('Usage: rank BLIND_DIR SEALED_REVIEWS_DIR OUTPUT.json')
  const key = await readJson(join(resolve(blindDir), 'organizer-key.json'))
  if (key.schema !== 'evobr.reader-voice-organizer-key' || key.mapping?.length !== 4) {
    throw Error('Invalid organizer identity mapping')
  }
  const results = []
  for (const m of key.mapping) {
    const packet = await readJson(join(resolve(blindDir), 'participants', m.sampleCode + '.json'))
    if (packet.packetId !== m.packetId || packet.samples?.length !== 20 ||
      packet.samples.some((x, i) => x.contentHash !== m.contentHashes[i])) {
      throw Error('Packet source tampered: ' + m.sampleCode)
    }
    const review = await readJson(join(resolve(scoringDir), m.sampleCode + '-review.json'))
    const valid = validateBlindReview(packet, review)
    if (!valid.complete) throw Error('All 20 reviews required: ' + m.sampleCode)
    const audit = await readJson(join(resolve(scoringDir), m.sampleCode + '-canon.json'))
    const incidents = verifyCanonAudit(audit, m.sampleCode, packet)
    const dimensions = {}
    const all = []
    for (const [axis] of DIMENSIONS) {
      const scores = review.answers.map(x => x.scores[axis])
      if (scores.some(x => !Number.isInteger(x) || x < 1 || x > 5)) {
        throw Error('All six axes must have numeric 1–5 Muse scores for ' + m.sampleCode)
      }
      dimensions[axis] = mean(scores)
      all.push(...scores)
    }
    const overall = mean(all)
    const confirmedCanonCount = incidents.filter(x => x.verdict === 'confirmed').length
    const uncertainCanonCount = incidents.filter(x => x.verdict === 'uncertain').length
    const eligible = overall >= 4.0 && Object.values(dimensions).every(x => x >= 3.5) &&
      dimensions.voice >= 4.0 && confirmedCanonCount === 0 && uncertainCanonCount === 0
    results.push({
      sampleCode: m.sampleCode, profileId: m.profileId, profileHash: m.profileHash,
      modelConfig: m.modelConfig, systemPromptHash: m.systemPromptHash,
      modelMeasurements: m.metrics, overallMean: overall, dimensions,
      verifiedSeriousCanonIncidents: confirmedCanonCount, unresolvedCanonIncidents: uncertainCanonCount,
      incidents, qualified: eligible, turnsRated: valid.completed,
      perTurn: review.answers.map(a => ({
        turn: a.sequence, scores: a.scores, mean: mean(Object.values(a.scores)),
        continuation: a.continuation, readTo: a.readTo,
      })),
    })
  }
  const candidates = results.filter(x => x.qualified)
    .sort((a, b) => b.overallMean - a.overallMean || b.dimensions.voice - a.dimensions.voice)
  const top = candidates[0] || null
  const tied = Boolean(top && candidates[1] &&
    candidates[1].overallMean === top.overallMean &&
    candidates[1].dimensions.voice === top.dimensions.voice)
  const winner = !tied && top ? {
    ...top, p4PromptDirective: getVoiceProfileV1(top.profileId).instruction,
    instructionVersion: getVoiceProfileV1(top.profileId).version,
    promptDirectiveHash: hash(getVoiceProfileV1(top.profileId).instruction),
  } : null
  const result = {
    schema: 'evobr.reader-voice-selection-result', version: 1, tournamentId: key.tournamentId,
    scoredBy: 'Muse', allProfiles: results,
    winner, decision: tied ? 'needs-Muse-tie-decision' : winner ? 'qualified-winner' : 'new-round-required',
    aggregateMeasurements: {
      calls: key.mapping.reduce((n, m) => n + m.metrics.calls, 0),
      completedTurns: key.mapping.reduce((n, m) => n + m.metrics.turns, 0),
      inputTokens: key.mapping.every(m => m.metrics.inputTokens !== null)
        ? key.mapping.reduce((n, m) => n + m.metrics.inputTokens, 0) : null,
      outputTokens: key.mapping.every(m => m.metrics.outputTokens !== null)
        ? key.mapping.reduce((n, m) => n + m.metrics.outputTokens, 0) : null,
      estimatedCostUSD: key.mapping.every(m => m.metrics.estimatedCostUSD !== null)
        ? key.mapping.reduce((n, m) => n + m.metrics.estimatedCostUSD, 0) : null,
      errors: Object.fromEntries([...new Set(key.mapping.flatMap(m => Object.keys(m.metrics.errors)))].map(k =>
        [k, key.mapping.reduce((n, m) => n + (m.metrics.errors[k] || 0), 0)])),
    },
    thresholds: { overallMean: 4, minimumEachDimension: 3.5, voiceMean: 4,
      maximumConfirmedCanonIncidents: 0, unresolvedIncidentsMustBeZero: true },
    note: 'Operational ceilings must be registered by Muse from real P1.2 measurements separately.',
  }
  await writeFile(resolve(output), outJson(result), { flag: 'wx' })
  process.stdout.write('Selection report produced with all four profiles; decision=' + result.decision + '\n')
}
async function main() {
  const [cmd, a, b, c] = process.argv.slice(2)
  if (cmd === 'generate') return generate(a)
  if (cmd === 'pack') return pack(a, b, c || 'Muse')
  if (cmd === 'rank') return rank(a, b, c)
  throw Error('Usage: reader-voice-tournament.mjs generate OUT_DIR | pack COMPLETED_RUN_DIR BLIND_DIR [participant] | rank BLIND_DIR SEALED_REVIEWS_DIR OUT.json')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write('Voice tournament error: ' + String(error?.message || 'unknown error').slice(0, 220) + '\n')
    process.exitCode = 1
  })
}
