/** P7 extra P10 proof: receipt-adoption errors after earlier writes are atomic. */
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedCurrentWorkspace} from '../helpers/current-workspace'
import {createRootReaderSessionV1} from '../../src/lib/reader/baseline'
import {publishReaderTurnV1,recoverReaderPublicationV1} from '../../src/lib/reader/recovery'
import {callReaderModelV1} from '../../src/lib/reader/model'
import type {AIConfig} from '../../src/lib/types'

vi.mock('../../src/lib/reader/model',async importActual=>{
  const original=await importActual<typeof import('../../src/lib/reader/model')>()
  return {...original,callReaderModelV1:vi.fn()}
})
const prose='Cao Minh dừng trước cánh cửa khép hờ. Tiếng đèn trên trần rền mãi, khiến anh không phân biệt được phía sau cánh cửa có người hay không.'
const config:AIConfig={provider:'custom',apiKey:'fake-test-only',model:'fake-evidence-only',
  baseUrl:'http://localhost:19090',temperature:0.8,maxTokens:1400,contextWindow:150000}
describe('P7 missing-evidence repair: P10 receipt adoption rollback',()=>{
  beforeEach(async()=>{vi.resetAllMocks();await db.delete();await db.open()})
  afterEach(()=>db.close())
  it('rejects failure at receipt adopt after turn/choices and rolls back all earlier records',async()=>{
    const {scope}=await seedCurrentWorkspace('P7 receipt atomicity')
    const sessionId=await createRootReaderSessionV1(scope,{maxSnapshotBytes:2000000})
    const intent={kind:'opening' as const,sessionId,requestKey:'p7-receipt-rollback',expectedRevision:0}
    const stages:string[]=[]
    vi.mocked(callReaderModelV1).mockImplementation(async({stage})=>{
      stages.push(stage)
      const text=stage==='reader-prose'?prose:
        stage==='reader-v3-review'?'{"issues":[]}':
        stage==='reader-choices'?JSON.stringify({choices:[{
          choiceKey:'door',text:'Nhìn qua cánh cửa',sourceQuote:'cánh cửa',
        }]}):
        stage==='reader-choice-verifier'?'{"issues":[]}':null
      if(text===null)throw Error('Unexpected model stage')
      return {text,usage:{inputTokens:40,outputTokens:50}}
    })
    const writes:string[]=[]
    await expect(publishReaderTurnV1({
      workspace:scope,intent,config,inputBudgetTokens:120000,maxBaselineBytes:2000000,
    },{beforeAdopt:target=>{
      writes.push(target)
      if(target==='readerPublicationRuns')throw Error('receipt writer injected failure')
    }})).rejects.toThrow('receipt writer injected failure')
    expect(writes).toContain('readerTurns')
    expect(writes).toContain('readerChoices')
    expect(writes).toContain('readerPublicationRuns')
    expect(stages).toEqual([
      'reader-prose','reader-v3-review','reader-choices','reader-choice-verifier',
    ])
    expect(await db.readerTurns.count()).toBe(0)
    expect(await db.readerChoices.count()).toBe(0)
    expect(await db.readerDecisions.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(0)
    const session=await db.readerSessions.get(sessionId)
    expect(session?.headTurnId).toBeNull()
    expect(session?.revision).toBe(0)
    expect(await recoverReaderPublicationV1({workspace:scope,intent})).toBeNull()
  })
})
