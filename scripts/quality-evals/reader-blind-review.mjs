#!/usr/bin/env node
/**
 * P1 single-arm blinded reader review, independent from model invocation.
 * Takes a real completed 20-turn baseline report. Never synthesizes prose.
 * Unlike longform-choice-questionnaire.mjs, it does NOT claim to have A/B pairs.
 */
import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DIMENSIONS = Object.freeze([
  ['immersion', 'Nhập tâm và sức hấp dẫn'],
  ['causality', 'Nhân quả và động cơ hành động'],
  ['payoff', 'Sức nặng cảm xúc và sự đáp ứng kỳ vọng'],
  ['voice', 'Giọng kể và độ tự nhiên của nhân vật'],
  ['pace', 'Nhịp văn và hạn chế lặp lại'],
  ['continuity', 'Tính liên tục giữa các lượt'],
])
const SHA = /^[a-f0-9]{64}$/
const safeId = s => typeof s === 'string' && /^[A-Za-z0-9_-]{1,70}$/.test(s)
const hash = s => createHash('sha256').update(s).digest('hex')
const escapeJson = v => JSON.stringify(v).replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

export function parseCompletedBaseline(source) {
  if (!source || source.schema !== 'evobr.reader-p1-baseline' || source.version !== 1 ||
    source.status !== 'completed' || source.summary?.completedTurns !== 20 ||
    source.summary?.expectedTurns !== 20 || source.realProvider !== true ||
    !Array.isArray(source.turns) || source.turns.length !== 20) {
    throw Error('A fully completed, real-provider 20-turn baseline is required. Mock or partial runs are forbidden.')
  }
  const previous = []
  const turns = source.turns.map((turn, i) => {
    if (turn.turn !== i + 1 || turn.status !== 'completed' || turn.historyLength !== i ||
      typeof turn.text !== 'string' || !turn.text.trim() || turn.text.length > 100_000 ||
      turn.hash !== hash(turn.text.trim()) || !SHA.test(turn.hash) ||
      !Array.isArray(turn.attempts) || !turn.attempts.some(a => a.ok === true)) {
      throw Error('Baseline turn or evidence invalid at ' + (i + 1))
    }
    previous.push(turn.hash)
    return { sequence: i + 1, text: turn.text, hash: turn.hash }
  })
  return { turns, originalRunId: source.runId, promptVersion: source.promptVersion }
}

export function createBlindPackets(source, participants, studyId, seed = randomBytes(32).toString('hex')) {
  if (!safeId(studyId) || !Array.isArray(participants) || !participants.length ||
      participants.some(x => !safeId(x)) || new Set(participants).size !== participants.length) {
    throw Error('Invalid study or participant IDs')
  }
  const validated = parseCompletedBaseline(source)
  // No A/B. One anonymous real-provider series is presented in natural order
  // so continuity can be assessed. Provider, prompt, prices and run ID remain
  // outside each participant's packet.
  const packetBase = {
    schema: 'evobr.reader-single-arm-blind-packet', version: 1,
    studyId, mode: 'single-arm', language: 'vi', dimensions: DIMENSIONS,
    samples: validated.turns.map(row => ({
      sequence: row.sequence, prose: row.text, contentHash: row.hash,
    })),
  }
  const packets = participants.map(participantCode => {
    const identity = hash(seed + ':' + participantCode + ':' + hash(JSON.stringify(packetBase))).slice(0, 20)
    const payload = { ...packetBase, participantCode, seriesCode: identity }
    return { ...payload, packetId: hash(JSON.stringify(payload)) }
  })
  const organizerKey = {
    schema: 'evobr.reader-single-arm-organizer', version: 1, studyId,
    originalRunId: validated.originalRunId, promptVersion: validated.promptVersion,
    sourceReportHash: hash(JSON.stringify(source)), participants,
    packets: packets.map(p => ({ participantCode: p.participantCode, packetId: p.packetId,
      seriesCode: p.seriesCode })),
    note: 'Single-arm blind review: no A/B identity or experimental control exists.',
  }
  return { packets, organizerKey }
}

export function validateBlindReview(packet, review) {
  if (!packet || packet.schema !== 'evobr.reader-single-arm-blind-packet' ||
    !review || review.schema !== 'evobr.reader-single-arm-review' || review.version !== 1 ||
    review.packetId !== packet.packetId || review.participantCode !== packet.participantCode ||
    review.studyId !== packet.studyId || review.mode !== 'single-arm' ||
    !Array.isArray(review.answers) || review.answers.length !== 20) {
    throw Error('Review identity/shape mismatch')
  }
  let completed = 0
  const seen = new Set()
  for (const answer of review.answers) {
    const sample = packet.samples.find(x => x.sequence === answer.sequence)
    if (!sample || seen.has(answer.sequence) || answer.contentHash !== sample.contentHash ||
      !answer.scores || typeof answer.scores !== 'object' || Array.isArray(answer.scores)) {
      throw Error('Review sample identity mismatch')
    }
    seen.add(answer.sequence)
    if (Object.keys(answer.scores).sort().join(',') !== DIMENSIONS.map(x => x[0]).sort().join(',')) {
      throw Error('Invalid six-dimensional score shape')
    }
    for (const key of Object.keys(answer.scores)) {
      const score = answer.scores[key]
      if (score !== null && score !== 'unknown' &&
          !(Number.isInteger(score) && score >= 1 && score <= 5)) throw Error('Score out of bounds')
    }
    if (![null, 'yes', 'maybe', 'no', 'unknown'].includes(answer.continuation) ||
        ![null, 'end', 'not-started'].includes(answer.readTo) &&
        !(Number.isInteger(answer.readTo) && answer.readTo >= 1 &&
          answer.readTo <= sample.prose.split(/\n+/).filter(Boolean).length)) {
      throw Error('Invalid read progress/continuation')
    }
    if (Object.values(answer.scores).every(x => x !== null) && answer.continuation !== null &&
        answer.readTo !== null) completed++
  }
  return { completed, total: 20, complete: completed === 20 }
}

function browserClient() {
  const packet = JSON.parse(document.querySelector('#packet').textContent)
  const dimensions = packet.dimensions
  const key = 'evobr-blind:' + packet.packetId
  const empty = () => ({
    schema: 'evobr.reader-single-arm-review', version: 1, studyId: packet.studyId,
    packetId: packet.packetId, participantCode: packet.participantCode, mode: 'single-arm',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    answers: packet.samples.map(s => ({
      sequence: s.sequence, contentHash: s.contentHash,
      readTo: null, continuation: null,
      scores: Object.fromEntries(dimensions.map(([id]) => [id, null])),
    })),
  })
  let data = empty()
  try {
    const old = JSON.parse(localStorage.getItem(key) || 'null')
    if (old && old.packetId === data.packetId && old.answers?.length === 20) data = old
  } catch { /* no storage; manual JSON download remains available */ }
  const root = document.querySelector('#review')
  const status = document.querySelector('#status')
  const save = () => {
    data.updatedAt = new Date().toISOString()
    try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* use export */ }
    const completed = data.answers.filter(a => Object.values(a.scores).every(x => x !== null) &&
      a.continuation !== null && a.readTo !== null).length
    status.textContent = completed + '/20 lượt đã trả lời. Có thể tải kết quả bất kỳ lúc nào.'
  }
  function field(name, values, selected, set, parent) {
    const container = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = name; container.append(legend)
    for (const [value, label] of values) {
      const line = document.createElement('label')
      const control = document.createElement('input')
      control.type = 'radio'
      control.name = name + ':' + parent.dataset.sequence
      control.value = String(value)
      control.checked = selected === value
      control.addEventListener('change', () => { set(value); save() })
      line.append(control, document.createTextNode(label))
      container.append(line)
    }
    parent.append(container)
  }
  for (const sample of packet.samples) {
    const answer = data.answers.find(a => a.sequence === sample.sequence)
    const box = document.createElement('section')
    box.dataset.sequence = String(sample.sequence)
    const h = document.createElement('h2')
    h.textContent = 'Đoạn ' + sample.sequence + ' / 20'
    box.append(h)
    const prose = document.createElement('article')
    for (const paragraph of sample.prose.split(/\n+/).filter(Boolean)) {
      const p = document.createElement('p'); p.textContent = paragraph; prose.append(p)
    }
    box.append(prose)
    const progressValues = [['end', 'Đọc hết'], ['not-started', 'Chưa đọc'],
      ...sample.prose.split(/\n+/).filter(Boolean).map((_, i) => [i + 1, 'Dừng sau đoạn ' + (i + 1)])]
    field('Đã đọc đến đâu?', progressValues, answer.readTo, value => { answer.readTo = value }, box)
    field('Muốn đọc tiếp?', [['yes','Có'],['maybe','Có thể'],['no','Không'],['unknown','Không rõ']],
      answer.continuation, value => { answer.continuation = value }, box)
    for (const [axis,label] of dimensions) {
      const values = [[1,'1'],[2,'2'],[3,'3'],[4,'4'],[5,'5'],['unknown','Chưa đủ thông tin']]
      field(label, values, answer.scores[axis], value => { answer.scores[axis] = value }, box)
    }
    root.append(box)
  }
  document.querySelector('#export').addEventListener('click', () => {
    save()
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url
    link.download = packet.studyId + '-' + packet.participantCode + '-review.json'
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  })
  save()
}

export function renderBlindReviewHtml(packet) {
  if (packet?.schema !== 'evobr.reader-single-arm-blind-packet' || packet.samples?.length !== 20) {
    throw Error('Invalid packet')
  }
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; object-src \'none\'; connect-src \'none\'">' +
    '<title>Đánh giá mù văn xuôi</title><style>' +
    'body{font:16px/1.65 system-ui,sans-serif;background:#f6f6f3;color:#202526;margin:auto;max-width:820px;padding:16px}' +
    'section{background:white;margin:22px 0;padding:20px;border:1px solid #ddd;border-radius:10px}' +
    'article{white-space:pre-wrap;line-height:1.8}article p{margin:1em 0}' +
    'fieldset{border:0;border-top:1px solid #ddd;margin-top:14px;padding:12px 0}' +
    'label{display:inline-flex;align-items:center;gap:4px;margin:4px 14px 4px 0}' +
    'input{width:18px;height:18px}button{padding:10px 20px;font:inherit}' +
    'footer{position:sticky;bottom:0;padding:12px;background:#f6f6f3ee;border-top:1px solid #bbb}</style></head><body>' +
    '<h1>Đánh giá truyện bằng tiếng Việt</h1><p>Một chuỗi truyện gồm 20 đoạn, không phải so sánh A/B. ' +
    'Mỗi đoạn chấm 6 chiều từ 1 (yếu) đến 5 (xuất sắc); chọn “Chưa đủ thông tin” nếu chưa thể kết luận. ' +
    'Không trao đổi đáp án với người khác. Văn bản hiển thị theo trình tự để đánh giá tính liên tục.</p>' +
    '<p>Mã ẩn danh: <strong>' + packet.seriesCode + '</strong></p><main id="review"></main>' +
    '<footer><button id="export">Tải JSON đã trả lời</button> <span id="status"></span></footer>' +
    '<script id="packet" type="application/json">' + escapeJson(packet) + '</script>' +
    '<script>(' + browserClient.toString() + ')();</script></body></html>'
}

async function main() {
  const [command, file, arg1, arg2] = process.argv.slice(2)
  if (command === 'pack') {
    if (!file || !arg1 || !arg2) throw Error('Usage: pack COMPLETED_REPORT.json OUTPUT_DIR participant1,participant2')
    const source = JSON.parse(await readFile(resolve(file), 'utf8'))
    const participants = arg2.split(',').map(s => s.trim())
    const studyId = process.env.EVO_P1_STUDY_ID || 'reader_baseline_v1'
    const { packets, organizerKey } = createBlindPackets(source, participants, studyId)
    const out = resolve(arg1)
    await mkdir(join(out, 'participants'), { recursive: true })
    for (const packet of packets) {
      await writeFile(join(out, 'participants', packet.participantCode + '.html'),
        renderBlindReviewHtml(packet), { flag: 'wx' })
      await writeFile(join(out, 'participants', packet.participantCode + '.json'),
        JSON.stringify(packet, null, 2), { flag: 'wx' })
    }
    await writeFile(join(out, 'organizer-key.json'), JSON.stringify(organizerKey, null, 2), { flag: 'wx' })
    process.stdout.write('Created ' + packets.length + ' single-arm blind participant packets.\n')
    return
  }
  if (command === 'validate') {
    if (!file || !arg1) throw Error('Usage: validate PACKET.json REVIEW.json')
    const packet = JSON.parse(await readFile(resolve(file), 'utf8'))
    const review = JSON.parse(await readFile(resolve(arg1), 'utf8'))
    process.stdout.write(JSON.stringify(validateBlindReview(packet, review), null, 2) + '\n')
    return
  }
  throw Error('Usage: node scripts/quality-evals/reader-blind-review.mjs pack REPORT.json OUTPUT_DIR participant1,participant2 | validate PACKET.json REVIEW.json')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write('Blind pack error: ' + error.message + '\n'); process.exitCode = 1 })
}
