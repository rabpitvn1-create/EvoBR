/**
 * Offline deterministic tests for voice selection logic. The fake reports
 * below are test fixtures ONLY, NEVER a real-provider benchmark or Muse rating.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pack, rank } from './reader-voice-tournament.mjs'
import { DIMENSIONS } from './reader-blind-review.mjs'
import { getVoiceProfileV1, buildVoiceSystemPromptV1, TOURNAMENT_PROFILES_V1 } from './reader-voice-profiles.mjs'
const hash = x => createHash('sha256').update(x).digest('hex')
const write = async(path,value) => writeFile(path, JSON.stringify(value))
function fixture(id) {
  const scenario = { id: 'evobr-p1-cao-minh-level0-v1', initialConditions: ['Cao Minh ở Level 0'] }
  const p = getVoiceProfileV1(id)
  const turns = Array.from({ length: 20 }, (_, idx) => {
    const text = 'Cao Minh bước vào phòng thứ ' + (idx + 1) + '. Đèn huỳnh quang vẫn kêu rè.'
    return {
      turn: idx + 1, historyLength: idx, text, hash: hash(text),
      status: 'completed', retries: 0, durationMs: 100,
      attempts: [{
        attempt: 1, ok: true, durationMs: 100,
        inputTokens: 12, outputTokens: 10, estimatedCostUSD: .001,
      }],
    }
  })
  return {
    schema: 'evobr.reader-p1-baseline', version: 1,
    status: 'completed', realProvider: true, // synthetic fixture, never published
    runId: id + '_test', scenario, scenarioHash: hash(JSON.stringify(scenario)),
    promptVersion: 'reader-prose-voice-selection-v1', voiceProfileId: id,
    voiceProfileVersion: p.version, voiceProfileHash: hash(JSON.stringify({ id, ...p })),
    systemPromptHash: hash(buildVoiceSystemPromptV1(id)),
    modelConfig: { provider: 'test-fixture', model: 'no-model-called', temperature: .8 },
    turns, summary: { completedTurns: 20, expectedTurns: 20,
      turns: turns.map(t => ({ turn: t.turn, durationMs: t.durationMs, calls: 1 })) },
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'evobr-p1-voice-test-'))
  const run = join(root, 'run'), blind = join(root, 'blind'), scored = join(root, 'scored')
  await mkdir(run)
  await mkdir(scored)
  const reports = []
  for (const id of TOURNAMENT_PROFILES_V1) {
    const dir = join(run, 'series', id)
    await mkdir(dir, { recursive: true })
    const value = fixture(id)
    const path = 'series/' + id + '/baseline-00000000-0000-0000-0000-000000000000.json'
    await write(join(run, path), value)
    reports.push({
      profileId: id, path, profileHash: value.voiceProfileHash,
      reportHash: hash(JSON.stringify(value)), runId: value.runId,
    })
  }
  await write(join(run, 'tournament-manifest.json'), {
    schema: 'evobr.reader-voice-tournament', version: 1,
    tournamentId: '00000000-0000-0000-0000-000000000001',
    status: 'completed', reports, profileIds: [...TOURNAMENT_PROFILES_V1],
  })
  return { root, run, blind, scored }
}
async function writeScores(blind, scored, choiceScore) {
  const organizer = JSON.parse(await readFile(join(blind, 'organizer-key.json'), 'utf8'))
  for (const m of organizer.mapping) {
    const packet = JSON.parse(await readFile(join(blind, 'participants', m.sampleCode + '.json'), 'utf8'))
    const rawScore = choiceScore(m.profileId)
    const scores = Object.fromEntries(DIMENSIONS.map(([id]) => [id, rawScore[id] ?? 4]))
    await write(join(scored, m.sampleCode + '-review.json'), {
      schema: 'evobr.reader-single-arm-review', version: 1,
      studyId: packet.studyId, packetId: packet.packetId,
      participantCode: packet.participantCode, mode: 'single-arm',
      answers: packet.samples.map(t => ({
        sequence: t.sequence, contentHash: t.contentHash, scores,
        readTo: 'end', continuation: 'yes',
      })),
    })
    await write(join(scored, m.sampleCode + '-canon.json'), {
      schema: 'evobr.reader-voice-canon-audit', version: 1,
      sampleCode: m.sampleCode, reviewer: 'Muse', reviewed: true, incidents: [],
    })
  }
}
test('voice prompts are distinct and contain the unchanged baseline', () => {
  const prompts = TOURNAMENT_PROFILES_V1.map(id => buildVoiceSystemPromptV1(id))
  assert.equal(new Set(prompts).size, 4)
  for (const p of prompts) assert.match(p, /Giữ nguyên dữ kiện/)
})
test('blind four-arm selection keeps profile labels private until scoring and respects all fixed gates', async() => {
  const dirs = await setup()
  try {
    await pack(dirs.run, dirs.blind, 'Muse')
    const listing = await readFile(join(dirs.blind, 'participants', 'sample-01.html'), 'utf8')
    for (const id of TOURNAMENT_PROFILES_V1) assert.equal(listing.includes(id), false)
    await writeScores(dirs.blind, dirs.scored, id =>
      id === 'restrained_intimate' ? { immersion: 5, causality: 5, payoff: 5, voice: 5, pace: 5, continuity: 5 }
      : id === 'cinematic_minimal' ? { voice: 4 }
      : id === 'sensory_urgent' ? { voice: 3 }
      : { immersion: 3, causality: 3, payoff: 3, voice: 3, pace: 3, continuity: 3 })
    const out = join(dirs.root, 'first-result.json')
    await rank(dirs.blind, dirs.scored, out)
    const result = JSON.parse(await readFile(out, 'utf8'))
    assert.equal(result.decision, 'qualified-winner')
    assert.equal(result.winner.profileId, 'restrained_intimate')
    assert.equal(result.allProfiles.length, 4)
    assert.equal(result.aggregateMeasurements.completedTurns, 80)
    assert.equal(result.aggregateMeasurements.calls, 80)
    assert.equal(result.winner.fullSystemPromptHash, hash(result.winner.p4FullSystemPrompt))
    assert.equal(result.allProfiles.find(p => p.profileId === 'sensory_urgent').qualified, false)
    await writeScores(dirs.blind, dirs.scored, () =>
      ({ immersion: 3, causality: 3, payoff: 3, voice: 3, pace: 3, continuity: 3 }))
    const failedOut = join(dirs.root, 'no-winner.json')
    await rank(dirs.blind, dirs.scored, failedOut)
    const failed = JSON.parse(await readFile(failedOut, 'utf8'))
    assert.equal(failed.decision, 'new-round-required')
    assert.equal(failed.winner, null)
  } finally { await rm(dirs.root, { force: true, recursive: true }) }
})
test('missing Muse Canon audit cannot silently count as zero severe incidents', async () => {
  const dirs = await setup()
  try {
    await pack(dirs.run, dirs.blind, 'Muse')
    await writeScores(dirs.blind, dirs.scored, () => ({}))
    const audit = join(dirs.scored, 'sample-01-canon.json')
    await write(audit, {
      schema: 'evobr.reader-voice-canon-audit', version: 1,
      sampleCode: 'sample-01', reviewer: 'Muse', reviewed: false, incidents: [],
    })
    await assert.rejects(rank(dirs.blind, dirs.scored, join(dirs.root, 'invalid.json')),
      /Muse Canon audit missing or not signed/)
  } finally { await rm(dirs.root, { force: true, recursive: true }) }
})
