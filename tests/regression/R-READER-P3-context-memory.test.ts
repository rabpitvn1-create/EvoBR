/**
 * P3 Reader context/memory acceptance C01–C14.
 * Production Dexie, registered assembleContext and immutable Gateway packet;
 * no model adapter calls, publication coordinator or ChapterEditor writes.
 */
import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { createRootReaderSessionV1,forkReaderSessionV1 } from '../../src/lib/reader/baseline'
import { prepareReaderContextV1,assertReaderContextCurrentV1,
  readerContextCacheKeyV1,invalidateReaderContextAfterImportOrRefreshV1 } from '../../src/lib/reader/context'
import { resolveReaderLineageV1 } from '../../src/lib/reader/lineage'
import { confirmReaderFactV1,confirmReaderKnowledgeV1 } from '../../src/lib/reader/confirmation'
import { beginReaderMemorySagaV1,settleReaderMemoryTaskV1,retryReaderMemoryTaskV1,
  inspectReaderMemorySagaV1 } from '../../src/lib/reader/memory-saga'
import { contextGatewayCacheEpochV1 } from '../../src/lib/context-gateway/provider-cache'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { READER_SOURCE_KEYS_V1 } from '../../src/lib/reader/gateway-sources'
import type { WorkspaceScope } from '../../src/lib/types/world-ownership'

const BUDGET=120_000,BOUND=2_000_000
const now=1740000000000
async function workspace():Promise<WorkspaceScope>{
  return (await seedCurrentWorkspace('P3 Reader context')).scope
}
async function root(scope:WorkspaceScope):Promise<number>{
  return createRootReaderSessionV1(scope,{maxSnapshotBytes:BOUND})
}
async function append(scope:WorkspaceScope,sid:number,content:string):Promise<number>{
  const session=(await db.readerSessions.get(sid))!
  const own=await db.readerTurns.where('sessionId').equals(sid).count()
  const id=await db.readerTurns.add({projectId:scope.projectId,sessionId:sid,
    parentTurnId:session.headTurnId,turnOrdinal:own+1,content,
    contentHash:await sha256Text(content),status:'published',sceneHintsJson:null,createdAt:now})
  await db.readerSessions.update(sid,{headTurnId:id,revision:session.revision+1})
  return id
}
async function context(scope:WorkspaceScope,sid:number,budget=BUDGET){
  const session=(await db.readerSessions.get(sid))!
  return prepareReaderContextV1({workspace:scope,sessionId:sid,
    expectedRevision:session.revision,inputBudgetTokens:budget,maxBaselineBytes:BOUND})
}
async function fact(scope:WorkspaceScope,sid:number,turnId:number,value:string,quote='Cao Minh'){
  const turn=(await db.readerTurns.get(turnId))!
  return db.readerFacts.add({projectId:scope.projectId,sessionId:sid,originTurnId:turnId,
    predicate:'light',subjectRef:'level0',valueJson:JSON.stringify(value),
    evidenceQuote:quote,sourceHash:turn.contentHash,status:'candidate',createdAt:now})
}
async function addKnowledge(scope:WorkspaceScope,sid:number,turnId:number,quote='Cao Minh'){
  return db.readerKnowledge.add({projectId:scope.projectId,sessionId:sid,originTurnId:turnId,
    characterId:101,knowledgeKey:'corridor',statement:'hành lang màu vàng',
    sourceQuote:quote,status:'candidate',createdAt:now})
}
function valuesOf(packet:Awaited<ReturnType<typeof context>>,key:string):string {
  return packet.sourcePacket.contentByKey[key]
}
describe('P3 Reader Context & Memory C01–C14',()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>db.close())

  it('C01: fork cuts parent N+1..N+3 and excludes sibling turns even within one Work',async()=>{
    const scope=await workspace(),parent=await root(scope)
    const n=await append(scope,parent,'Cao Minh mở cánh cửa.')
    const child=await forkReaderSessionV1(scope,parent,n)
    await append(scope,parent,'Đường ngoài N+1.')
    await append(scope,parent,'Đường ngoài N+2.')
    await append(scope,parent,'Đường ngoài N+3.')
    const sibling=await forkReaderSessionV1(scope,parent,n)
    await append(scope,sibling,'Chỉ nhánh anh em.')
    const t=await append(scope,child,'Cao Minh nhìn bóng tối.')
    const line=await resolveReaderLineageV1(scope,child)
    expect(line.turns.map(x=>x.id)).toEqual([n,t])
    const frozen=await context(scope,child)
    expect(valuesOf(frozen,'reader.published-history')).toContain('nhìn bóng tối')
    expect(valuesOf(frozen,'reader.published-history')).not.toContain('Đường ngoài')
    expect(valuesOf(frozen,'reader.published-history')).not.toContain('Chỉ nhánh')
  })
  it('C02: contradictory sibling facts remain isolated in their own registered source',async()=>{
    const scope=await workspace(),parent=await root(scope)
    const n=await append(scope,parent,'Cao Minh dừng lại.')
    const a=await forkReaderSessionV1(scope,parent,n),b=await forkReaderSessionV1(scope,parent,n)
    const at=await append(scope,a,'Cao Minh thấy đèn sáng.')
    const bt=await append(scope,b,'Cao Minh thấy đèn tắt.')
    await confirmReaderFactV1(scope,await fact(scope,a,at,'on'))
    await confirmReaderFactV1(scope,await fact(scope,b,bt,'off'))
    const aPacket=await context(scope,a),bPacket=await context(scope,b)
    expect(JSON.parse(JSON.parse(valuesOf(aPacket,'reader.confirmed-facts')).facts[0].valueJson)).toBe('on')
    expect(JSON.parse(valuesOf(aPacket,'reader.confirmed-facts')).facts).toHaveLength(1)
    expect(JSON.parse(JSON.parse(valuesOf(bPacket,'reader.confirmed-facts')).facts[0].valueJson)).toBe('off')
    expect(aPacket.scope.lineageFingerprint).not.toBe(bPacket.scope.lineageFingerprint)
  })
  it('C03: candidate/retracted facts and knowledge never appear; confirmed quote proof required',async()=>{
    const scope=await workspace(),sid=await root(scope),t=await append(scope,sid,'Cao Minh bước vào Level 0.')
    const valid=await fact(scope,sid,t,'lit')
    const pending=await fact(scope,sid,t,'other')
    const invalid=await fact(scope,sid,t,'phantom','câu không có thật')
    await confirmReaderFactV1(scope,valid)
    await expect(confirmReaderFactV1(scope,invalid)).rejects.toThrow(/exact published/)
    await db.readerFacts.update(pending,{status:'retracted'})
    const known=await addKnowledge(scope,sid,t)
    await confirmReaderKnowledgeV1(scope,known)
    const unconfirmed=await addKnowledge(scope,sid,t,'Cao Minh')
    const packet=await context(scope,sid)
    expect(valuesOf(packet,'reader.confirmed-facts')).toContain('lit')
    expect(valuesOf(packet,'reader.confirmed-facts')).not.toContain('phantom')
    expect(valuesOf(packet,'reader.confirmed-facts')).not.toContain('other')
    expect(JSON.parse(valuesOf(packet,'reader.confirmed-knowledge')).knowledge).toHaveLength(1)
    expect(unconfirmed).toBeGreaterThan(known)
  })
  it('C04: a contradictory confirmed fact never overrides published lineage or Canon',async()=>{
    const scope=await workspace(),sid=await root(scope)
    const t=await append(scope,sid,'Cao Minh thấy đèn sáng.')
    await confirmReaderFactV1(scope,await fact(scope,sid,t,'on'))
    await expect(confirmReaderFactV1(scope,await fact(scope,sid,t,'off'))).rejects.toThrow(/overrides/)
    const packet=await context(scope,sid)
    expect(JSON.parse(JSON.parse(valuesOf(packet,'reader.confirmed-facts')).facts[0].valueJson)).toBe('on')
  })
  it('C05: missing or tampered pinned baseline rejects before any assembled packet',async()=>{
    const scope=await workspace(),sid=await root(scope)
    await db.readerSessions.update(sid,{canonBaselineHash:'0'.repeat(64)})
    await expect(context(scope,sid)).rejects.toThrow(/baseline hash|hash or reference/)
  })
  it('C06: live Work edits never change existing pinned baseline or packet hash',async()=>{
    const scope=await workspace(),sid=await root(scope)
    await append(scope,sid,'Cao Minh nghe tiếng đèn.')
    const first=await context(scope,sid)
    await db.works.update(scope.workId,{title:'Bản thảo đổi sau khi Reader bắt đầu'})
    const again=await context(scope,sid)
    expect(again.scope.canonBaselineHash).toBe(first.scope.canonBaselineHash)
    expect(again.sourcePacket.contentByKey['reader.baseline']).toBe(first.sourcePacket.contentByKey['reader.baseline'])
    expect(again.contextManifestHash).toBe(first.contextManifestHash)
  })
  it('C07: one registered reader packet/manifest is frozen for future prose V3 and choices',async()=>{
    const scope=await workspace(),sid=await root(scope)
    await append(scope,sid,'Cao Minh nhìn đường.')
    const packet=await context(scope,sid)
    expect(packet.assembly.included).toContain('reader.baseline')
    expect(packet.assembly.included).toContain('reader.published-history')
    expect(packet.scope.sessionId).toBe(sid)
    await expect(assertReaderContextCurrentV1(scope,packet)).resolves.toBeUndefined()
    expect(packet.assembly.included.every(k=>READER_SOURCE_KEYS_V1.includes(k as any))).toBe(true)
    const forbidden=['writtenChapters','previousChapterEnding','recentChapterSummaries',
      'chapterContinuityHandoff','currentFacts','characterKnowledge','retrievedPassages',
      'stateCards','itemLedger','storyTimelineEvents','ragSelection','searchResults']
    expect(packet.assembly.included.filter(k=>forbidden.includes(k))).toEqual([])
    await expect(assembleContext({projectId:scope.projectId,scope,
      sourceKeys:['reader.baseline']})).rejects.toThrow(/requires authenticated/)
  })
  it('C08: Work-only cache identity fails; sibling session/head/policy keys partition',async()=>{
    const scope=await workspace(),sid=await root(scope)
    const t=await append(scope,sid,'Cao Minh thấy cửa.')
    const a=await forkReaderSessionV1(scope,sid,t),b=await forkReaderSessionV1(scope,sid,t)
    const pa=await context(scope,a),pb=await context(scope,b)
    expect(readerContextCacheKeyV1(pa.scope,BUDGET)).not.toBe(readerContextCacheKeyV1(pb.scope,BUDGET))
    // A broken key using only workId collides: the positive isolation assertion MUST fail.
    const brokenWorkOnly=(_s:typeof pa.scope)=>String(scope.workId)
    expect(brokenWorkOnly(pa.scope)).toBe(brokenWorkOnly(pb.scope))
    expect(()=>expect(brokenWorkOnly(pa.scope)).not.toBe(brokenWorkOnly(pb.scope))).toThrow()
    const epoch=contextGatewayCacheEpochV1()
    invalidateReaderContextAfterImportOrRefreshV1()
    expect(contextGatewayCacheEpochV1()).toBeGreaterThan(epoch)
    await append(scope,a,'Cao Minh đi tiếp.')
    await expect(assertReaderContextCurrentV1(scope,pa)).rejects.toThrow(/stale/)
  })
  it('C09: retrieved chunk outside lineage is omitted; corrupted eligible proof rejected',async()=>{
    const scope=await workspace(),sid=await root(scope)
    const t=await append(scope,sid,'Cao Minh đánh dấu cánh cửa.')
    const sibling=await root(scope)
    const st=await append(scope,sibling,'Bằng chứng ở phiên khác.')
    const content='đánh dấu'
    await db.readerRetrievalChunks.add({projectId:scope.projectId,sessionId:sid,
      sourceTurnId:st,content,contentHash:await sha256Text(content),sourceQuote:'Bằng chứng',
      createdAt:now})
    const packet=await context(scope,sid)
    expect(valuesOf(packet,'reader.retrieval')).not.toContain('Bằng chứng')
    await db.readerRetrievalChunks.add({projectId:scope.projectId,sessionId:sid,
      sourceTurnId:t,content,contentHash:'0'.repeat(64),sourceQuote:'đánh dấu',createdAt:now})
    await expect(context(scope,sid)).rejects.toThrow(/retrieval content/)
  })
  it('C10: budget cannot silently truncate mandatory pinned baseline/continuity',async()=>{
    const scope=await workspace(),sid=await root(scope)
    await append(scope,sid,'Cao Minh nhìn thấy đèn.')
    await expect(context(scope,sid,1)).rejects.toThrow(/budget|summary/)
  })
  it('C11: pending memory saga does not block full exact published text and decisions',async()=>{
    const scope=await workspace(),sid=await root(scope)
    const t=await append(scope,sid,'Cao Minh đi tiếp.')
    await beginReaderMemorySagaV1(scope,sid,t)
    expect(await inspectReaderMemorySagaV1(scope,sid,t)).toBe('reader_memory_pending')
    const packet=await context(scope,sid)
    expect(packet.continuityMode).toBe('full')
    expect(packet.selectedSummaryThroughTurnId).toBeNull()
  })
  it('C12: compression fails closed without ready prefix; ready exact prefix plus suffix works',async()=>{
    const scope=await workspace(),sid=await root(scope)
    const t1=await append(scope,sid,'Cao Minh đi qua phòng. '.repeat(800))
    const t2=await append(scope,sid,'Cao Minh quay lại hành lang. '.repeat(800))
    await append(scope,sid,'Cao Minh nghe đèn kêu. '.repeat(600))
    const full=await context(scope,sid)
    const budget=Math.floor(full.assembly.totalInputTokens*0.62)
    await expect(context(scope,sid,budget)).rejects.toThrow(/summary/)
    const pending=await beginReaderMemorySagaV1(scope,sid,t2)
    const summary=pending.tasks.find(t=>t.taskKind==='summary')!
    await settleReaderMemoryTaskV1({workspace:scope,sessionId:sid,throughTurnId:t2,
      taskKind:'summary',taskId:summary.taskId,sourceHash:summary.sourceHash,
      outcome:'completed',summary:'Cao Minh đã đi qua phòng rồi quay lại hành lang.'})
    const compressed=await context(scope,sid,budget)
    expect(compressed.continuityMode).toBe('compressed')
    expect(compressed.selectedSummaryThroughTurnId).toBe(t2)
    expect(valuesOf(compressed,'reader.published-history')).toContain('nghe đèn kêu')
    expect(valuesOf(compressed,'reader.published-history')).not.toContain('đi qua phòng')
    expect(t1).not.toBe(t2)
  })
  it('C13: parent summary beyond child fork cannot be used for compressed memory',async()=>{
    const scope=await workspace(),parent=await root(scope)
    const first=await append(scope,parent,'Cao Minh tới Level 0. '.repeat(100))
    await append(scope,parent,'Cao Minh bước xa. '.repeat(700))
    const third=await append(scope,parent,'Cao Minh leo cầu thang. '.repeat(700))
    const pending=await beginReaderMemorySagaV1(scope,parent,third)
    const summary=pending.tasks.find(t=>t.taskKind==='summary')!
    await settleReaderMemoryTaskV1({workspace:scope,sessionId:parent,throughTurnId:third,
      taskKind:'summary',taskId:summary.taskId,sourceHash:summary.sourceHash,
      outcome:'completed',summary:'Cao Minh đã leo cầu thang.'})
    const child=await forkReaderSessionV1(scope,parent,first)
    await append(scope,child,'Cao Minh đi theo đường khác. '.repeat(1300))
    const full=await context(scope,child)
    await expect(context(scope,child,Math.floor(full.assembly.totalInputTokens*0.5)))
      .rejects.toThrow(/summary/)
  })
  it('C14: saga failures and explicit retry remain idempotent; prose never changes',async()=>{
    const scope=await workspace(),sid=await root(scope)
    const t=await append(scope,sid,'Cao Minh không dừng lại.')
    const original=(await db.readerTurns.get(t))!.content
    const saga=await beginReaderMemorySagaV1(scope,sid,t)
    const task=saga.tasks.find(x=>x.taskKind==='summary')!
    await settleReaderMemoryTaskV1({workspace:scope,sessionId:sid,throughTurnId:t,
      taskKind:'summary',taskId:task.taskId,sourceHash:task.sourceHash,outcome:'failed',
      error:'reader summarizer unavailable'})
    expect(await inspectReaderMemorySagaV1(scope,sid,t)).toBe('reader_memory_failed')
    await retryReaderMemoryTaskV1({workspace:scope,sessionId:sid,throughTurnId:t,
      taskKind:'summary',taskId:task.taskId,sourceHash:task.sourceHash})
    await settleReaderMemoryTaskV1({workspace:scope,sessionId:sid,throughTurnId:t,
      taskKind:'summary',taskId:task.taskId,sourceHash:task.sourceHash,outcome:'completed',
      summary:'Cao Minh tiếp tục.'})
    const repeated=await settleReaderMemoryTaskV1({workspace:scope,sessionId:sid,throughTurnId:t,
      taskKind:'summary',taskId:task.taskId,sourceHash:task.sourceHash,outcome:'completed',
      summary:'Cao Minh tiếp tục.'})
    expect(repeated.tasks.filter(x=>x.taskKind==='summary'&&x.status==='completed')).toHaveLength(1)
    expect((await db.readerTurns.get(t))!.content).toBe(original)
    expect(await db.readerMemory.where('sessionId').equals(sid).count()).toBe(1)
  })
})
