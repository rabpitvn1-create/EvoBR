/** P5 publication regressions: real fake-indexeddb adopt transactions, mocked model only. */
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedCurrentWorkspace} from '../helpers/current-workspace'
import {createRootReaderSessionV1} from '../../src/lib/reader/baseline'
import {publishReaderTurnV1,recoverReaderPublicationV1} from '../../src/lib/reader/recovery'
import type {ReaderTurnIntentV1} from '../../src/lib/reader/publication'
import {callReaderModelV1} from '../../src/lib/reader/model'
import type {AIConfig,WorkspaceScope} from '../../src/lib/types'

vi.mock('../../src/lib/reader/model',async importActual=>{
  const original=await importActual<typeof import('../../src/lib/reader/model')>()
  return {...original,callReaderModelV1:vi.fn()}
})
const prose='Cao Minh chạm tay vào cánh cửa khép hờ. Tiếng đèn huỳnh quang kêu rền phía trên, còn hành lang vàng vẫn im lặng đáng ngờ.'
const quote='cánh cửa khép hờ'
const pass=JSON.stringify({issues:[]})
const branches=JSON.stringify({choices:[{choiceKey:'look-door',
  text:'Quan sát cánh cửa khép hờ',sourceQuote:quote}]})
const empty=JSON.stringify({choices:[]})
const config:AIConfig={provider:'custom',apiKey:'test-local-only',
  model:'model-local-mock',baseUrl:'http://localhost:19090',
  temperature:0.8,maxTokens:1400,contextWindow:150000}
function fakeProvider(choiceOutput=branches){
  const calls:string[]=[]
  vi.mocked(callReaderModelV1).mockImplementation(async({stage})=>{
    calls.push(stage)
    const output=stage==='reader-prose'?prose:
      stage==='reader-v3-review'?pass:
      stage==='reader-choices'?choiceOutput:
      stage==='reader-choice-verifier'?pass:undefined
    if(output===undefined)throw Error('unexpected P5 stage '+stage)
    return {text:output,usage:{inputTokens:100,outputTokens:70}}
  })
  return calls
}
async function setup(){
  const {scope}=await seedCurrentWorkspace('P5 reader publication')
  const sid=await createRootReaderSessionV1(scope,{maxSnapshotBytes:2000000})
  return {scope,sid}
}
function opening(sid:number,key='open'):ReaderTurnIntentV1{
  return {kind:'opening',sessionId:sid,requestKey:key,expectedRevision:0}
}
function choice(sid:number,sourceTurnId:number,choiceId:number,key='next',revision=1):ReaderTurnIntentV1{
  return {kind:'choice',sessionId:sid,sourceTurnId,choiceId,requestKey:key,expectedRevision:revision}
}
function request(scope:WorkspaceScope,intent:ReaderTurnIntentV1){
  return {workspace:scope,intent,config,inputBudgetTokens:120000,maxBaselineBytes:2000000}
}
describe('P5 Reader publication gate P01-P13',()=>{
  beforeEach(async()=>{vi.clearAllMocks();await db.delete();await db.open()})
  afterEach(()=>{db.close()})
  it('P01/P06/P07: opening atomic, no decision; crash replay has zero model calls, altered key fingerprint rejected',async()=>{
    const {scope,sid}=await setup(),calls=fakeProvider()
    const input=request(scope,opening(sid))
    const first=await publishReaderTurnV1(input)
    expect(first.receipt.resultTurnId).toBe(first.turn.id)
    expect(first.receipt.resultRevision).toBe(1)
    expect(first.choices).toHaveLength(1)
    expect(first.decision).toBeNull()
    expect(await db.readerDecisions.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(1)
    expect((await db.readerSessions.get(sid))?.headTurnId).toBe(first.turn.id)
    const before=calls.length
    const replay=await recoverReaderPublicationV1({workspace:scope,intent:input.intent})
    expect(replay?.receipt).toEqual(first.receipt)
    expect(replay?.replayed).toBe(true)
    expect(calls).toHaveLength(before)
    await expect(publishReaderTurnV1(request(scope,opening(sid,'second')))).rejects.toThrow()
    await expect(recoverReaderPublicationV1({workspace:scope,intent:{
      kind:'opening',sessionId:sid,requestKey:'open',expectedRevision:9,
    }})).rejects.toThrow(/fingerprint/)
  })
  it('P6: optional signed scene hints persist in the same committed reader turn',async()=>{
    const {scope,sid}=await setup()
    const output=JSON.stringify({choices:[{choiceKey:'look-door',
      text:'Quan sát cánh cửa khép hờ',sourceQuote:quote}],
      sceneHints:{levelId:'level-0',entityIds:['brownie']}})
    fakeProvider(output)
    const published=await publishReaderTurnV1(request(scope,opening(sid)))
    const stored=await db.readerTurns.get(published.receipt.resultTurnId)
    expect(stored?.sceneHintsJson).toBe('{"levelId":"level-0","entityIds":["brownie"]}')
    expect(published.turn.sceneHintsJson).toBe(stored?.sceneHintsJson)
    expect(await db.readerPublicationRuns.count()).toBe(1)
  })
  it('P6: missing optional scene hints are stored as null',async()=>{
    const {scope,sid}=await setup();fakeProvider()
    const published=await publishReaderTurnV1(request(scope,opening(sid)))
    expect((await db.readerTurns.get(published.receipt.resultTurnId))?.sceneHintsJson)
      .toBeNull()
    expect(await db.readerPublicationRuns.count()).toBe(1)
  })
  it('P6: malformed optional scene hints fall back to null without blocking publication',async()=>{
    const invalid=[42,{'levelId':'unknown','entityIds':['brownie']},
      {'levelId':'level-0','entityIds':'brownie'},
      {'levelId':'level-0','entityIds':[{'id':'brownie'}]}]
    for(const [index,sceneHints] of invalid.entries()){
      const {scope,sid}=await setup()
      fakeProvider(JSON.stringify({choices:[{choiceKey:'look-door',
        text:'Quan sát cánh cửa khép hờ',sourceQuote:quote}],sceneHints}))
      const published=await publishReaderTurnV1(request(scope,opening(sid,'invalid-'+index)))
      expect(published.turn.sceneHintsJson).toBeNull()
      expect((await db.readerTurns.get(published.receipt.resultTurnId))?.sceneHintsJson)
        .toBeNull()
      expect((await db.readerSessions.get(sid))?.revision).toBe(1)
      // Each iteration is a separate signed turn, never a partial candidate.
      await db.delete();await db.open()
    }
  })
  it('P02: deterministic Continue has numeric choice ID and ordinary decision path',async()=>{
    const {scope,sid}=await setup();fakeProvider(empty)
    const first=await publishReaderTurnV1(request(scope,opening(sid)))
    expect(first.choices).toHaveLength(1)
    expect(first.choices[0].kind).toBe('continue')
    expect(first.choices[0].id).toBeGreaterThan(0)
    const next=await publishReaderTurnV1(request(scope,choice(sid,
      first.turn.id!,first.choices[0].id!)))
    expect(next.decision?.sourceTurnId).toBe(first.turn.id)
    expect(next.decision?.choiceId).toBe(first.choices[0].id)
    expect(next.turn.parentTurnId).toBe(first.turn.id)
    expect(next.choices[0].kind).toBe('continue')
    expect((await db.readerChoices.get(first.choices[0].id!))?.status).toBe('available')
  })
  it('P04: real registered choice adopt short write rolls back turn, receipt and session',async()=>{
    const {scope,sid}=await setup();fakeProvider()
    await expect(publishReaderTurnV1(request(scope,opening(sid)),
      {forceChoiceShortWrite:true})).rejects.toThrow(/adopt did not write/)
    expect(await db.readerTurns.count()).toBe(0)
    expect(await db.readerChoices.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(0)
    expect((await db.readerSessions.get(sid))?.revision).toBe(0)
  })
  it('P05: real registered session CAS skip rolls back all writes and receipt',async()=>{
    const {scope,sid}=await setup();fakeProvider()
    await expect(publishReaderTurnV1(request(scope,opening(sid)),
      {forceCasSkip:true})).rejects.toThrow(/adopt did not write/)
    expect(await db.readerTurns.count()).toBe(0)
    expect(await db.readerChoices.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(0)
    expect((await db.readerSessions.get(sid))?.headTurnId).toBeNull()
  })
  it('P03/P09: distinct request keys from the same revision have one winner; stale candidate is unusable',async()=>{
    const {scope,sid}=await setup();fakeProvider()
    const one=publishReaderTurnV1(request(scope,opening(sid,'a')))
    const two=publishReaderTurnV1(request(scope,opening(sid,'b')))
    const results=await Promise.allSettled([one,two])
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1)
    expect(await db.readerTurns.count()).toBe(1)
    expect(await db.readerPublicationRuns.count()).toBe(1)
    expect((await db.readerSessions.get(sid))?.revision).toBe(1)
  })
  it('P08: foreign/stale choice is rejected before model dispatch',async()=>{
    const {scope,sid}=await setup();fakeProvider()
    const first=await publishReaderTurnV1(request(scope,opening(sid)))
    vi.mocked(callReaderModelV1).mockClear()
    await expect(publishReaderTurnV1(request(scope,choice(sid,
      first.turn.id!,999999)))).rejects.toThrow()
    expect(callReaderModelV1).not.toHaveBeenCalled()
  })
  it('P10: a later adopt rejection leaves no partial decision, receipt, or head advance',async()=>{
    const {scope,sid}=await setup();fakeProvider()
    const first=await publishReaderTurnV1(request(scope,opening(sid)))
    const priorRuns=await db.readerPublicationRuns.count()
    await expect(publishReaderTurnV1(request(scope,choice(sid,
      first.turn.id!,first.choices[0].id!,'reject')),{forceCasSkip:true})).rejects.toThrow()
    expect(await db.readerTurns.count()).toBe(1)
    expect(await db.readerDecisions.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(priorRuns)
    expect((await db.readerSessions.get(sid))?.revision).toBe(1)
  })
  it('P11/P12: receipt readback survives simulated refresh, saga is outside publication',async()=>{
    const {scope,sid}=await setup(),calls=fakeProvider()
    const first=await publishReaderTurnV1(request(scope,opening(sid)))
    await db.close();await db.open()
    const replay=await recoverReaderPublicationV1({workspace:scope,intent:opening(sid)})
    expect(replay?.turn.content).toBe(first.turn.content)
    expect(replay?.choices.map(c=>c.id)).toEqual(first.choices.map(c=>c.id))
    expect(replay?.receipt).toEqual(first.receipt)
    expect(calls).toHaveLength(4)
    expect(['reader_memory_pending','reader_memory_partial','reader_memory_ready',
      'reader_memory_failed']).toContain(replay?.memorySagaStatus)
  })
})
