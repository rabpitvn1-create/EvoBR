/**
 * P4 Reader generation: V01-V13. Pure provider responses are mocked for CI;
 * a real-provider callback smoke remains an explicit Muse-side V13 gate.
 * All AgentRun, frozen Gateway, contract and artifact operations are real.
 */
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedCurrentWorkspace} from '../helpers/current-workspace'
import {createRootReaderSessionV1} from '../../src/lib/reader/baseline'
import {sha256Text} from '../../src/lib/ai/chapter-memory/text-normalization'
import {hashCanonicalValue} from '../../src/lib/agent/run/hash'
import {generateReaderTurnCandidateV1,verifyReaderGenerationCandidateV1,
  ReaderSemanticBlockedErrorV1} from '../../src/lib/reader/generation'
import {parseReaderBranchChoicesV1,parseReaderChoiceReviewV1,
  buildReaderChoiceMessagesV1,runReaderChoiceStageV1} from '../../src/lib/reader/choices'
import {prepareReaderContextV1} from '../../src/lib/reader/context'
import {createReaderDurableRunV1,assertReaderFrozenStageInputV1} from '../../src/lib/reader/run'
import {getAgentSkillV1} from '../../src/lib/agent/skill-registry'
import {freezeFormalAIEntryBindingV1,executeFrozenFormalAIEntryV1,
  getFormalAIEntryBindingV1} from '../../src/lib/agent/formal-ai-entry'
import {buildProseGenerationRunContractV1} from '../../src/lib/agent/run/prose-generation-durable'
import {buildReaderProseMessagesV1,READER_PROSE_SYSTEM_PROMPT_V1} from '../../src/lib/reader/prose'
import {callReaderModelV1,resolveFrozenReaderModelV1} from '../../src/lib/reader/model'
import type {WorkspaceScope,AIConfig} from '../../src/lib/types'

vi.mock('../../src/lib/reader/model',async importActual=>{
  const original=await importActual<typeof import('../../src/lib/reader/model')>()
  return {...original,callReaderModelV1:vi.fn()}
})
const BUDGET=120000,BASELINE_CAP=2000000
const prose='Cao Minh chạm tay vào cánh cửa khép hờ. Tiếng đèn huỳnh quang kêu rền phía trên, còn hành lang vàng vẫn im lặng đáng ngờ.'
const revised='Cao Minh rút tay khỏi cánh cửa khép hờ. Anh nghe tiếng đèn huỳnh quang kêu rền và quyết định quay lại quan sát hành lang vàng.'
const quote='cánh cửa khép hờ'
const pass=JSON.stringify({issues:[]})
const branches=JSON.stringify({choices:[
  {choiceKey:'look-door',text:'Quan sát cánh cửa khép hờ',sourceQuote:quote},
]})
const choicePass=JSON.stringify({issues:[]})
const config:AIConfig={provider:'custom',apiKey:'test-local-only',model:'model-local-mock',
  baseUrl:'http://localhost:19090',temperature:0.8,maxTokens:1400,contextWindow:150000}
function scripted(stageReplies:Record<string,string[]>) {
  const calls:string[]=[]
  vi.mocked(callReaderModelV1).mockImplementation(async ({stage})=>{
    calls.push(stage)
    const next=stageReplies[stage]?.shift()
    if(next==null)throw Error('mock provider unavailable: '+stage)
    return {text:next,usage:{inputTokens:100,outputTokens:80}}
  })
  return calls
}
function good():Record<string,string[]>{
  return {'reader-prose':[prose],'reader-v3-review':[pass],
    'reader-choices':[branches],'reader-choice-verifier':[choicePass]}
}
async function fixture(){
  const {scope}=await seedCurrentWorkspace('P4 Reader test')
  const sid=await createRootReaderSessionV1(scope,{maxSnapshotBytes:BASELINE_CAP})
  return {scope,sid}
}
async function append(scope:WorkspaceScope,sid:number,body:string){
  const session=(await db.readerSessions.get(sid))!
  const ordinal=await db.readerTurns.where('sessionId').equals(sid).count()+1
  const id=await db.readerTurns.add({projectId:scope.projectId,sessionId:sid,
    parentTurnId:session.headTurnId,turnOrdinal:ordinal,content:body,
    contentHash:await sha256Text(body),sceneHintsJson:null,status:'published',
    createdAt:Date.now()})
  await db.readerSessions.update(sid,{headTurnId:id,revision:session.revision+1})
  return id
}
async function generate(scope:WorkspaceScope,sid:number,maxChoiceRetries=0){
  const session=(await db.readerSessions.get(sid))!
  return generateReaderTurnCandidateV1({workspace:scope,sessionId:sid,
    expectedRevision:session.revision,inputBudgetTokens:BUDGET,
    maxBaselineBytes:BASELINE_CAP,config,maxChoiceRetries})
}
async function frozenHandle(scope:WorkspaceScope,sid:number){
  const session=(await db.readerSessions.get(sid))!
  const frozen=await prepareReaderContextV1({workspace:scope,sessionId:sid,
    expectedRevision:session.revision,inputBudgetTokens:BUDGET,maxBaselineBytes:BASELINE_CAP})
  const handle=await createReaderDurableRunV1({scope,frozen,maxInputTokens:160000})
  return {handle,frozen}
}
function blockingReview(sourceKey:string,evidenceQuote:string,autoRevisable=false){
  return JSON.stringify({issues:[{code:'continuity-conflict',severity:'blocking',
    candidateQuote:quote,evidence:[{sourceKey,quote:evidenceQuote}],
    reason:'Nội dung không khớp bằng chứng reader đã lưu.',
    revisionInstruction:autoRevisable?'Chỉnh lại hành động, giữ tất cả dữ kiện còn lại.':'',
    autoRevisable}]})
}
describe('P4 Reader V01-V13 governed generation',()=>{
  beforeEach(async()=>{vi.clearAllMocks();await db.delete();await db.open()})
  afterEach(()=>{vi.unstubAllGlobals();db.close()})

  it('V01: V3 pass once, generates choices only after approved prose and never writes Reader tables',async()=>{
    const {scope,sid}=await fixture(),order=scripted(good())
    const {candidate,handle,frozen}=await generate(scope,sid)
    expect(order).toEqual(['reader-prose','reader-v3-review','reader-choices','reader-choice-verifier'])
    expect(candidate.v3.status).toBe('passed')
    expect(candidate.finalProse).toBe(prose)
    expect(candidate.choices.choices[0].sourceQuote).toBe(quote)
    expect(handle.calls).toBe(4)
    expect(await verifyReaderGenerationCandidateV1({workspace:scope,frozen,handle,candidate})).toBe(true)
    expect(await db.readerTurns.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(0)
  })
  it('V02: auto-revision changes final hash; choices only see the revised prose',async()=>{
    const {scope,sid}=await fixture()
    await append(scope,sid,'Cao Minh quan sát hành lang vàng; chưa có người nào mở cánh cửa.')
    const order=scripted({'reader-prose':[prose],
      'reader-v3-review':[blockingReview('reader.published-history','Cao Minh quan sát hành lang vàng',true)],
      'reader-v3-revision':[revised],'reader-v3-rereview':[pass],
      'reader-choices':[branches],'reader-choice-verifier':[choicePass]})
    const {candidate}=await generate(scope,sid)
    expect(order).toEqual(['reader-prose','reader-v3-review','reader-v3-revision',
      'reader-v3-rereview','reader-choices','reader-choice-verifier'])
    expect(candidate.modelCalls).toBe(6)
    expect(candidate.originalProseHash).not.toBe(candidate.finalProseHash)
    expect(candidate.finalProse).toBe(revised)
    expect(candidate.choices.finalProseHash).toBe(candidate.finalProseHash)
    expect(candidate.v3.cycle.revision).toBeDefined()
  })
  it('V03: blocking V3 verdict leaves zero choice calls, unpublished candidate',async()=>{
    const {scope,sid}=await fixture()
    await append(scope,sid,'Cao Minh nghe tiếng đèn huỳnh quang.')
    const order=scripted({'reader-prose':[prose],
      'reader-v3-review':[blockingReview('reader.published-history','Cao Minh nghe tiếng đèn')]})
    await expect(generate(scope,sid)).rejects.toBeInstanceOf(ReaderSemanticBlockedErrorV1)
    expect(order).toEqual(['reader-prose','reader-v3-review'])
    expect(await db.readerPublicationRuns.count()).toBe(0)
  })
  it('V03 evidence negative: fabricated V3 source quote aborts without choice dispatch',async()=>{
    const {scope,sid}=await fixture()
    const order=scripted({'reader-prose':[prose],
      'reader-v3-review':[blockingReview('reader.baseline','không hề có trong nguồn Canon')]})
    await expect(generate(scope,sid)).rejects.toThrow(/逐字引文|invalid|quote/)
    expect(order).toEqual(['reader-prose','reader-v3-review'])
  })
  it('V03: direct choice-stage caller cannot bypass a signed V3 PASS',async()=>{
    const {scope,sid}=await fixture(),{handle}=await frozenHandle(scope,sid)
    scripted(good())
    const finalProseHash=await hashCanonicalValue(prose)
    await expect(runReaderChoiceStageV1({
      handle,finalProse:prose,finalProseHash,
      originalProse:prose,
      v3:{status:'passed',runId:handle.snapshot.run.id} as any,
      resolution:resolveFrozenReaderModelV1(config),
      maxChoiceRetries:0,
    })).rejects.toThrow(/choices denied without verified/)
    expect(vi.mocked(callReaderModelV1)).not.toHaveBeenCalled()
  })
  it('V04: invented branch quote is dropped deterministically',()=>{
    const parsed=parseReaderBranchChoicesV1(JSON.stringify({choices:[
      {choiceKey:'fake',text:'Mở hầm vô hình',sourceQuote:'Không hề có lối hầm này'},
      {choiceKey:'real',text:'Nhìn cánh cửa',sourceQuote:quote},
    ]}),prose)
    expect(parsed.rejected).toBe(1)
    expect(parsed.choices.map(c=>c.choiceKey)).toEqual(['real'])
  })
  it('V05: reviewer blocks grounded quote with contradictory action and signed issue',async()=>{
    const {scope,sid}=await fixture(),{handle}=await frozenHandle(scope,sid)
    const item={choiceKey:'x',kind:'branch' as const,text:'Mở một cánh cửa đã khóa',sourceQuote:quote}
    const raw=JSON.stringify({issues:[{choiceKey:'x',code:'choice-prose-contradiction',
      choiceQuote:item.text,evidence:{sourceKey:'finalProse',quote},reason:'Không thể mở cửa.'}]})
    const issues=parseReaderChoiceReviewV1(raw,handle,prose,[item])
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('choice-prose-contradiction')
    const forged=raw.replace(quote,'bằng chứng không có thật')
    expect(()=>parseReaderChoiceReviewV1(forged,handle,prose,[item])).toThrow(/verbatim/)
  })
  it('V13: whole JSON fences preserve choices, verifier and V3 review semantics',async()=>{
    const {scope,sid}=await fixture(),{handle}=await frozenHandle(scope,sid)
    const fenced=(value:string)=>'\`\`\`json\\n'+value+'\\n\`\`\`'
    const plainChoices=parseReaderBranchChoicesV1(branches,prose)
    expect(parseReaderBranchChoicesV1(fenced(branches),prose)).toEqual(plainChoices)
    const item=plainChoices.choices[0]
    const review=JSON.stringify({issues:[{choiceKey:item.choiceKey,
      code:'choice-prose-contradiction',choiceQuote:item.text,
      evidence:{sourceKey:'finalProse',quote},reason:'Mâu thuẫn với prose.'}]})
    expect(parseReaderChoiceReviewV1(fenced(review),handle,prose,[item]))
      .toEqual(parseReaderChoiceReviewV1(review,handle,prose,[item]))
    expect(()=>parseReaderBranchChoicesV1(fenced('not JSON'),prose)).toThrow()
    expect(()=>parseReaderChoiceReviewV1(fenced('not JSON'),handle,prose,[item])).toThrow()
    expect(()=>parseReaderBranchChoicesV1(fenced(branches)+' trailing',prose)).toThrow()
    expect(parseReaderBranchChoicesV1(fenced(JSON.stringify({choices:[{
      choiceKey:'fake',text:'Mở hầm',sourceQuote:'trích dẫn giả mạo',
    }]})),prose).choices).toEqual([])
    const badReview=review.replace(quote,'trích dẫn giả mạo')
    expect(()=>parseReaderChoiceReviewV1(fenced(badReview),handle,prose,[item])).toThrow(/verbatim/)
    const order=scripted({'reader-prose':[prose],
      'reader-v3-review':[fenced(pass)],
      'reader-choices':[fenced(branches)],
      'reader-choice-verifier':[fenced(choicePass)]})
    const result=await generate(scope,sid)
    expect(order).toEqual(['reader-prose','reader-v3-review','reader-choices','reader-choice-verifier'])
    expect(result.candidate.v3.status).toBe('passed')
    expect(result.candidate.choices.fallbackContinue).toBe(false)
    expect(result.candidate.choices.choices[0].choiceKey).toBe('look-door')
  })
  it('V06: invalid model branches exhaust retry=0, create precisely one real Continue',async()=>{
    const {scope,sid}=await fixture()
    const order=scripted({'reader-prose':[prose],'reader-v3-review':[pass],
      'reader-choices':[JSON.stringify({choices:[{
        choiceKey:'false',text:'Đi qua vách tường',sourceQuote:'lối ra không tồn tại',
      }]})]})
    const {candidate}=await generate(scope,sid)
    expect(order).toEqual(['reader-prose','reader-v3-review','reader-choices'])
    expect(candidate.choices.choices).toEqual([
      {choiceKey:'continue',kind:'continue',text:'Đọc tiếp',sourceQuote:null},
    ])
    expect(candidate.choices.generationAttempts).toBe(1)
    expect(candidate.choices.verifierResponseHash).toBeNull()
  })
  it('V06 bounded retry: one deterministically invalid branch is retried without regenerating prose',async()=>{
    const {scope,sid}=await fixture()
    const bad=JSON.stringify({choices:[{
      choiceKey:'fake',text:'Mở lối hầm',sourceQuote:'nguồn không tồn tại',
    }]})
    const order=scripted({'reader-prose':[prose],'reader-v3-review':[pass],
      'reader-choices':[bad,branches],'reader-choice-verifier':[choicePass]})
    const {candidate}=await generate(scope,sid,1)
    expect(order).toEqual(['reader-prose','reader-v3-review','reader-choices',
      'reader-choices','reader-choice-verifier'])
    expect(candidate.modelCalls).toBe(5)
    expect(candidate.choices.generationAttempts).toBe(2)
    expect(candidate.choices.fallbackContinue).toBe(false)
    expect(candidate.choices.choices[0].choiceKey).toBe('look-door')
  })
  it('V07: malformed optional sceneHints never veto valid prose or branches',async()=>{
    const {scope,sid}=await fixture(),replies=good()
    replies['reader-choices']=[JSON.stringify({choices:[{
      choiceKey:'look-door',text:'Quan sát cánh cửa',sourceQuote:quote,
    }],sceneHints:'not a valid scene hint object'})]
    scripted(replies)
    const {candidate}=await generate(scope,sid)
    expect(candidate.choices.fallbackContinue).toBe(false)
    expect(candidate.sceneHints).toBeUndefined()
  })
  it('V08: all five reader skills/entries are registered without adoption and wrong caller is rejected',async()=>{
    const entries=['reader.prose.generate','reader.prose.review','reader.prose.revise',
      'reader.choices.generate','reader.choices.review'] as const
    for(const id of entries){
      const skill=getAgentSkillV1(id,'prose')
      const entry=getFormalAIEntryBindingV1(id)
      expect(skill.writeTargets).toEqual([])
      expect(skill.readToolNames).toEqual([])
      expect(skill.contextSourceKeys.every(k=>k.startsWith('reader.'))).toBe(true)
      expect(entry.adoptAllowed).toBe(false)
      expect(entry.allowedCallers).toEqual(['src/lib/reader/model.ts'])
    }
    const {scope,sid}=await fixture(),{handle}=await frozenHandle(scope,sid)
    const binding=handle.snapshot.contract.executionBindings?.find(b=>b.stepId==='reader-prose')
    expect(binding?.formalEntry).toBeDefined()
    await expect(executeFrozenFormalAIEntryV1(
      'reader.prose.generate',binding!.formalEntry!,getAgentSkillV1('reader.prose.generate','prose'),
      'src/lib/generation/chapter-generation-node.ts',
      [],config,{category:'reader.prose.generate'})).rejects.toThrow(/caller|权限|不匹配/)
  })
  it('V09: provider failure fails closed; no reader turn or receipt published',async()=>{
    const {scope,sid}=await fixture()
    const order=scripted({'reader-prose':[]})
    await expect(generate(scope,sid)).rejects.toThrow(/unavailable/)
    expect(order).toEqual(['reader-prose'])
    expect(await db.readerTurns.count()).toBe(0)
    expect(await db.readerPublicationRuns.count()).toBe(0)
  })
  it('V09: choice transport failure cannot be disguised as successful Continue',async()=>{
    const {scope,sid}=await fixture()
    const order=scripted({'reader-prose':[prose],'reader-v3-review':[pass],
      'reader-choices':[]})
    await expect(generate(scope,sid)).rejects.toThrow(/unavailable/)
    expect(order).toEqual(['reader-prose','reader-v3-review','reader-choices'])
    expect(await db.readerPublicationRuns.count()).toBe(0)
  })
  it('V08: unauthorised selected-decision text fails before dispatch',async()=>{
    const {scope,sid}=await fixture(),order=scripted(good())
    await expect(generateReaderTurnCandidateV1({
      workspace:scope,sessionId:sid,expectedRevision:0,inputBudgetTokens:BUDGET,
      maxBaselineBytes:BASELINE_CAP,config,selectedDecisionText:'Tự nhận vật phẩm chưa được đưa ra',
    })).rejects.toThrow(/selected Reader choice/)
    expect(order).toEqual([])
  })
  it('V10: same provider reviewer records correlatedJudge instead of false independence',async()=>{
    const {scope,sid}=await fixture();scripted(good())
    const {candidate}=await generate(scope,sid)
    expect(candidate.v3.correlatedJudge).toBe(true)
    expect(candidate.v3.cycle.finalReview.reviewer.correlatedJudge).toBe(true)
    expect(candidate.v3.cycle.finalReview.reviewer.provider).toBe(candidate.provider)
    expect(candidate.v3.cycle.finalReview.reviewer.model).toBe(candidate.model)
  })
  it('V11: selected P1 voice is Vietnamese; Chapter editor semanticReview=false unchanged',async()=>{
    const {scope,sid}=await fixture(),{frozen}=await frozenHandle(scope,sid)
    const messages=buildReaderProseMessagesV1(frozen,null)
    expect(READER_PROSE_SYSTEM_PROMPT_V1).toContain('Cao Minh')
    expect(READER_PROSE_SYSTEM_PROMPT_V1).toContain('nội tâm')
    expect(messages[0].content).toContain('CHỈ ĐẠO GIỌNG VĂN')
    expect(messages[1].content).toContain('Chỉ văn xuôi tiếng Việt')
    const original=buildProseGenerationRunContractV1({
      projectId:scope.projectId,worldGroupId:null,chapterId:123,operation:'generate',
      semanticReview:false})
    expect(original.budget.maxModelCalls).toBe(1)
    expect(original.executionBindings?.some(b=>b.stepId==='prose-semantic-review')).toBe(false)
  })
  it('V12: stale lineage/manifest/candidate hash cannot be reused after head advances',async()=>{
    const {scope,sid}=await fixture();scripted(good())
    const {candidate,frozen,handle}=await generate(scope,sid)
    const tampered={...candidate,contextManifestHash:'a'.repeat(64)}
    expect(await verifyReaderGenerationCandidateV1({
      workspace:scope,frozen,handle,candidate:tampered})).toBe(false)
    await append(scope,sid,'Cao Minh tiếp tục bước đi qua vũng nước ẩm trên nền.')
    expect(await verifyReaderGenerationCandidateV1({
      workspace:scope,frozen,handle,candidate})).toBe(false)
  })
  it('V12: changing only frozen source segments is detected before any model call',async()=>{
    const {scope,sid}=await fixture(),{handle,frozen}=await frozenHandle(scope,sid)
    frozen.assembly.segments[0].content+='tampered but aggregate text unchanged'
    await expect(assertReaderFrozenStageInputV1(handle)).rejects.toThrow(/segment altered/)
    expect(vi.mocked(callReaderModelV1)).not.toHaveBeenCalled()
  })
  it('V13 preparation: frozen formal client route exists; production-provider smoke must be signed separately by Muse',async()=>{
    const {scope,sid}=await fixture(),{handle}=await frozenHandle(scope,sid)
    const entry=await freezeFormalAIEntryBindingV1('reader.prose.review')
    expect(entry.bindingHash).toMatch(/^[a-f0-9]{64}$/)
    expect(handle.snapshot.contract.budget.maxModelCalls).toBe(6)
    expect(handle.snapshot.contract.scope.chapterIds).toBeUndefined()
    expect(await hashCanonicalValue(handle.identity)).toMatch(/^[a-f0-9]{64}$/)
    expect(buildReaderChoiceMessagesV1(handle,prose,await hashCanonicalValue(prose))[1].content)
      .toContain(handle.frozen.contextManifestHash)
    // This assertion does NOT satisfy real-provider V13; no live provider
    // configured here, no token/cost/latency numbers are invented.
  })
})
