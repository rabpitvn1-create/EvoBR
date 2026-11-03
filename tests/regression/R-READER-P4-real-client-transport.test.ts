/**
 * P4 real transport wiring smoke. Only HTTP is stubbed; production
 * client.ts, executeFrozenFormalAIEntryV1, AgentRun, P3 Gateway and
 * V3 callbacks all run for real in this test. NOT a real-provider V13 pass.
 */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedCurrentWorkspace} from '../helpers/current-workspace'
import {createRootReaderSessionV1} from '../../src/lib/reader/baseline'
import {generateReaderTurnCandidateV1,verifyReaderGenerationCandidateV1}
  from '../../src/lib/reader/generation'
import {callReaderModelV1,resolveFrozenReaderModelV1} from '../../src/lib/reader/model'
import type {AIConfig} from '../../src/lib/types'

const prose='Cao Minh dừng lại trước cánh cửa khép hờ. Mùi thảm ẩm lẩn vào hơi thở, và ánh đèn vàng khiến anh không chắc mình đã đứng đây bao lâu.'
const quote='cánh cửa khép hờ'
const mockResponses=[
  prose,
  JSON.stringify({issues:[]}),
  JSON.stringify({choices:[{choiceKey:'observe',text:'Quan sát cánh cửa khép hờ',sourceQuote:quote}]}),
  JSON.stringify({issues:[]}),
]
const config:AIConfig={
  provider:'custom',apiKey:'fake-ci-only',model:'reader-transport-fixture',
  baseUrl:'https://example.invalid/v1',temperature:0.8,maxTokens:1400,contextWindow:150000,
}
describe('P4 real-client and formal transport smoke, HTTP stubbed',()=>{
  beforeEach(async()=>{await db.delete();await db.open()})
  afterEach(()=>{vi.unstubAllGlobals();db.close()})
  it('dispatches exact four-stage V3+choices sequence with provider usage through actual client',async()=>{
    const {scope}=await seedCurrentWorkspace('P4 actual client HTTP mock')
    const sessionId=await createRootReaderSessionV1(scope,{maxSnapshotBytes:2000000})
    let calls=0
    const fetchStub=vi.fn(async(_url:unknown,_init:unknown)=>{
      const content=mockResponses[calls++]
      if(content===undefined)throw Error('unexpected fifth client request')
      return new Response(JSON.stringify({
        id:'chatcmpl-reader-smoke',object:'chat.completion',
        model:'reader-transport-fixture',choices:[{
          index:0,message:{role:'assistant',content},finish_reason:'stop',
        }],usage:{prompt_tokens:111,completion_tokens:55,total_tokens:166},
      }),{status:200,headers:{'content-type':'application/json'}})
    })
    vi.stubGlobal('fetch',fetchStub)
    const {candidate,handle,frozen}=await generateReaderTurnCandidateV1({
      workspace:scope,sessionId,expectedRevision:0,
      inputBudgetTokens:120000,maxBaselineBytes:2000000,config,
    })
    expect(calls).toBe(4)
    expect(fetchStub).toHaveBeenCalledTimes(4)
    expect(handle.calls).toBe(4)
    expect(candidate.finalProse).toBe(prose)
    expect(candidate.modelCallRecords.map(r=>r.inputTokens)).toEqual([111,111,111,111])
    expect(candidate.modelCallRecords.map(r=>r.outputTokens)).toEqual([55,55,55,55])
    expect(candidate.modelCallRecords.map(r=>r.requestLifecycle?.phase))
      .toEqual(['response-observed','response-observed','response-observed','response-observed'])
    expect(candidate.modelCallRecords.every(r=>r.latencyMs!=null&&r.latencyMs>=0)).toBe(true)
    expect(candidate.choices.choices[0].sourceQuote).toBe(quote)
    expect(candidate.v3.correlatedJudge).toBe(true)
    expect(await verifyReaderGenerationCandidateV1({workspace:scope,frozen,handle,candidate})).toBe(true)
    // The real transport itself rejects any second dispatch after the durable
    // prose step has already settled; no fifth HTTP request can escape.
    await expect(callReaderModelV1({
      handle,stage:'reader-prose',
      messages:[{role:'user',content:'Illegitimate duplicate model call'}],
      resolution:resolveFrozenReaderModelV1(config),
    })).rejects.toThrow(/single-use durable model dispatch slot/)
    expect(fetchStub).toHaveBeenCalledTimes(4)
    expect(await db.readerTurns.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(0)
  })
})
