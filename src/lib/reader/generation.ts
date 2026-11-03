/**
 * P4 production Reader candidate. This file is an AI orchestration boundary,
 * not a publication coordinator. Only P5 can atomically write Reader tables.
 */
import type { AIConfig,WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { appendAgentRunEventV1 } from '../agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { hashCanonicalValue,canonicalStringify } from '../agent/run/hash'
import { prepareReaderContextV1,assertReaderContextCurrentV1 } from './context'
import type { ReaderFrozenContextAssemblyV1 } from './context'
import { buildReaderProseMessagesV1,assertReaderVietnameseProseV1,
  READER_PROSE_PROMPT_VERSION_V1 } from './prose'
import { resolveFrozenReaderModelV1,callReaderModelV1 } from './model'
import { createReaderDurableRunV1,READER_STEPS_V1,beginReaderModelStepV1,
  finishReaderModelStepV1,completeReaderModelStepV1,failReaderModelStepV1,
  READER_MODEL_CALL_LIMIT_V1,assertReaderFrozenStageInputV1,type ReaderRunHandleV1 } from './run'
import { runReaderDurableSemanticReviewV1,verifyReaderSemanticReceiptV1,
  type ReaderSemanticReceiptV1 } from './semantic-review'
import { runReaderChoiceStageV1,verifyReaderChoicesReceiptV1,
  type ReaderChoicesReceiptV1 } from './choices'

export const READER_GENERATION_CANDIDATE_VERSION_V1='reader-prose-choice-candidate-v1'
export const READER_DEFAULT_CHOICE_RETRIES_V1=0 as const
function fail(why:string):never{throw Error('[readerGeneration] '+why)}
export class ReaderSemanticBlockedErrorV1 extends Error{
  constructor(readonly runId:number,readonly semanticReceiptHash:string){
    super('[readerGeneration] V3 blocked Reader prose; zero choices authorized')
    this.name='ReaderSemanticBlockedErrorV1'
  }
}
export interface ReaderGenerationCandidateV1{
  version:typeof READER_GENERATION_CANDIDATE_VERSION_V1
  runId:number
  sessionId:number
  expectedRevision:number
  headTurnId:number|null
  attemptHash:string
  contextManifestHash:string
  canonBaselineHash:string
  lineageFingerprint:string
  voiceProfile:'restrained_intimate'
  voicePromptVersion:typeof READER_PROSE_PROMPT_VERSION_V1
  provider:string
  model:string
  originalProse:string
  originalProseHash:string
  finalProse:string
  finalProseHash:string
  v3:ReaderSemanticReceiptV1
  choices:ReaderChoicesReceiptV1
  modelCalls:number
  modelCallRecords:ReaderRunHandleV1['records']
  /** Scene hints are optional and never give adoption authority. */
  sceneHints?:unknown
  candidateHash:string
}
export async function verifyReaderGenerationCandidateV1(input:{
  workspace:WorkspaceScope;frozen:ReaderFrozenContextAssemblyV1
  handle:ReaderRunHandleV1;candidate:ReaderGenerationCandidateV1
}):Promise<boolean>{
  try{
    const {workspace,frozen,handle,candidate}=input
    await assertReaderContextCurrentV1(workspace,frozen)
    await assertReaderFrozenStageInputV1(handle)
    if(candidate.version!==READER_GENERATION_CANDIDATE_VERSION_V1||
      candidate.runId!==handle.snapshot.run.id||
      candidate.sessionId!==frozen.scope.sessionId||
      candidate.expectedRevision!==frozen.scope.expectedRevision||
      candidate.headTurnId!==frozen.scope.headTurnId||
      candidate.attemptHash!==handle.identity.attemptHash||
      candidate.contextManifestHash!==frozen.contextManifestHash||
      candidate.canonBaselineHash!==frozen.scope.canonBaselineHash||
      candidate.lineageFingerprint!==frozen.scope.lineageFingerprint||
      candidate.voiceProfile!=='restrained_intimate'||
      candidate.voicePromptVersion!==READER_PROSE_PROMPT_VERSION_V1||
      candidate.modelCalls>READER_MODEL_CALL_LIMIT_V1||
      candidate.modelCallRecords.length!==candidate.modelCalls||
      candidate.v3.status!=='passed'||candidate.v3.correlatedJudge!==true||
      candidate.originalProseHash!==await hashCanonicalValue(candidate.originalProse)||
      candidate.finalProseHash!==await hashCanonicalValue(candidate.finalProse)||
      candidate.v3.finalProseHash!==candidate.finalProseHash||
      candidate.choices.finalProseHash!==candidate.finalProseHash)return false
    const {candidateHash,...body}=candidate
    if(candidateHash!==await hashCanonicalValue(body))return false
    if(!await verifyReaderSemanticReceiptV1({
      handle,receipt:candidate.v3,originalText:candidate.originalProse}))return false
    return verifyReaderChoicesReceiptV1(handle,candidate.choices,candidate.finalProse)
  }catch{return false}
}
async function markFailed(handle:ReaderRunHandleV1,why:string):Promise<void>{
  if(handle.snapshot.projection.state!=='failed'&&handle.snapshot.projection.state!=='cancelled'){
    handle.snapshot=await appendAgentRunEventV1({
      scope:handle.scope,runId:handle.snapshot.run.id,type:'run.failed',
      payload:{code:why.slice(0,100),retryable:false},
      expectedLastSequence:handle.snapshot.projection.lastSequence,
    })
  }
}
export async function generateReaderTurnCandidateV1(input:{
  workspace:WorkspaceScope
  sessionId:number
  expectedRevision:number
  inputBudgetTokens:number
  maxBaselineBytes:number
  config:AIConfig
  selectedDecisionText?:string|null
  maxChoiceRetries?:number
  signal?:AbortSignal
}):Promise<{candidate:ReaderGenerationCandidateV1;handle:ReaderRunHandleV1;frozen:ReaderFrozenContextAssemblyV1}>{
  const retries=input.maxChoiceRetries??READER_DEFAULT_CHOICE_RETRIES_V1
  if(!Number.isSafeInteger(retries)||retries<0||retries>2)fail('D2 choice retries must be within 0..2')
  const frozen=await prepareReaderContextV1({
    workspace:input.workspace,sessionId:input.sessionId,
    expectedRevision:input.expectedRevision,
    inputBudgetTokens:input.inputBudgetTokens,maxBaselineBytes:input.maxBaselineBytes,
  })
  await assertReaderContextCurrentV1(input.workspace,frozen)
  // Only a choice actually offered at this Reader head may steer prose.
  // P5 will recheck it atomically; this preflight does not perform publication.
  if(input.selectedDecisionText != null){
    const head=frozen.scope.headTurnId
    if(head==null||!input.selectedDecisionText.trim())fail('selected Reader choice missing from published head')
    const origin=await db.readerTurns.get(head)
    if(!origin||origin.projectId!==input.workspace.projectId)fail('selected Reader head is not published')
    const choices=await db.readerChoices.where('turnId').equals(head).toArray()
    if(!choices.some(c=>c.sessionId===origin.sessionId&&c.status==='available'&&
      c.text===input.selectedDecisionText))fail('selected choice does not belong to current reader head')
  }
  const resolution=resolveFrozenReaderModelV1(input.config)
  const handle=await createReaderDurableRunV1({
    scope:input.workspace,frozen,
    maxInputTokens:Math.max(input.inputBudgetTokens*READER_MODEL_CALL_LIMIT_V1,160_000),
    maxChoiceRetries:retries,
  })
  try{
    const generationMessages=buildReaderProseMessagesV1(
      frozen,input.selectedDecisionText??null)
    const started=await beginReaderModelStepV1({
      handle,stepId:READER_STEPS_V1.prose,
      messages:generationMessages,maxOutputTokens:1800,
    })
    let originalProse:string
    try{
      const response=await callReaderModelV1({
        handle,stage:READER_STEPS_V1.prose,
        messages:generationMessages,resolution,signal:input.signal,
      })
      originalProse=response.text
      await finishReaderModelStepV1({
        handle,stepId:READER_STEPS_V1.prose,attempt:started.attempt,
        startedAt:started.startedAt,output:originalProse,complete:false,...response.usage,requestLifecycle:response.requestLifecycle,
      })
      assertReaderVietnameseProseV1(originalProse)
      await completeReaderModelStepV1(handle,READER_STEPS_V1.prose,
        started.attempt,await hashCanonicalValue(originalProse))
    }catch(error){
      await failReaderModelStepV1(handle,READER_STEPS_V1.prose,started.attempt,error)
      throw error
    }
    // Model 1: prose only. Model 2: V3 review; optional revision+rereview.
    const v3=await runReaderDurableSemanticReviewV1({
      handle,originalText:originalProse,
      generationMessages,resolution,signal:input.signal,
    })
    if(v3.status!=='passed'){
      throw new ReaderSemanticBlockedErrorV1(handle.snapshot.run.id,v3.receiptHash)
    }
    const finalProse=v3.cycle.outputText
    const finalProseHash=await hashCanonicalValue(finalProse)
    // Only from this point may choices or their read-only verifier be called.
    const choices=await runReaderChoiceStageV1({
      handle,finalProse,finalProseHash,v3,originalProse,resolution,
      maxChoiceRetries:retries,signal:input.signal,
    })
    if(!await verifyReaderChoicesReceiptV1(handle,choices,finalProse))
      fail('choice evidence or frozen finalProseHash invalid')
    await assertReaderContextCurrentV1(input.workspace,frozen)
    const body={
      version:READER_GENERATION_CANDIDATE_VERSION_V1 as typeof READER_GENERATION_CANDIDATE_VERSION_V1,
      runId:handle.snapshot.run.id,sessionId:frozen.scope.sessionId,
      expectedRevision:frozen.scope.expectedRevision,
      headTurnId:frozen.scope.headTurnId,
      attemptHash:handle.identity.attemptHash,
      contextManifestHash:frozen.contextManifestHash,
      canonBaselineHash:frozen.scope.canonBaselineHash,
      lineageFingerprint:frozen.scope.lineageFingerprint,
      voiceProfile:'restrained_intimate' as const,
      voicePromptVersion:READER_PROSE_PROMPT_VERSION_V1 as typeof READER_PROSE_PROMPT_VERSION_V1,
      provider:resolution.config.provider,model:resolution.config.model,
      originalProse,originalProseHash:await hashCanonicalValue(originalProse),
      finalProse,finalProseHash,
      v3,choices,modelCalls:handle.calls,
      modelCallRecords:handle.records.map(r=>({...r})),
    }
    const candidate:ReaderGenerationCandidateV1={
      ...body,candidateHash:await hashCanonicalValue(body),
    }
    await recordAgentRunArtifactV1({
      scope:handle.scope,runId:handle.snapshot.run.id,
      artifactKind:'source-snapshot',content:canonicalStringify(candidate),
    })
    handle.snapshot=await (await import('../agent/run/event-store')).readAgentRunV1(
      handle.scope,handle.snapshot.run.id)
    if(!await verifyReaderGenerationCandidateV1({
      workspace:input.workspace,frozen,handle,candidate}))fail('Reader candidate evidence invalid')
    return {candidate,handle,frozen}
  }catch(error){
    await markFailed(handle,error instanceof ReaderSemanticBlockedErrorV1?'reader-v3-blocked':'reader-generation-failed')
    throw error
  }
}
