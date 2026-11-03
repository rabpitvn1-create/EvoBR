/** P5 coordinator: replay -> authorization -> governed P4 -> atomic commit -> saga. */
import { db } from '../db/schema'
import { resolveScope } from '../workspace/scope'
import { generateReaderTurnCandidateV1,verifyReaderGenerationCandidateV1 } from './generation'
import { beginReaderMemorySagaV1,inspectReaderMemorySagaV1,
  type ReaderMemorySagaStatusV1 } from './memory-saga'
import { invalidateReaderContextAfterImportOrRefreshV1 } from './context'
import { assertReaderVietnameseProseV1 } from './prose'
import { authorizeReaderIntentV1,assertReaderPrecommitEvidenceV1,
  lookupReaderPublicationV1,readerIntentFingerprintV1,rejectReaderPublicationV1,
  type ReaderPublicationReceiptV1,type ReaderPublicationRequestV1 } from './publication'
import { prepareReaderCommitV1,commitReaderPublicationV1,
  type ReaderCommitTestHooksV1 } from './commit'
import type { ReaderTurnV1,ReaderChoiceV1,ReaderDecisionV1 } from '../types/reader'

export interface ReaderPublishedResultV1 {
  receipt:ReaderPublicationReceiptV1
  turn:ReaderTurnV1
  choices:ReaderChoiceV1[]
  decision:ReaderDecisionV1|null
  memorySagaStatus:ReaderMemorySagaStatusV1
  memorySagaError?:string
  replayed:boolean
}
async function readPublishedResult(
  workspace:ReaderPublicationRequestV1['workspace'],
  receipt:ReaderPublicationReceiptV1,replayed:boolean,
):Promise<ReaderPublishedResultV1>{
  const turn=await db.readerTurns.get(receipt.resultTurnId)
  if(!turn||turn.projectId!==workspace.projectId||
    turn.sessionId!==receipt.sessionId||turn.status!=='published'||
    turn.contentHash!==receipt.contentHash)
    rejectReaderPublicationV1('receipt target turn missing or changed')
  const choices=await db.readerChoices.where('turnId').equals(receipt.resultTurnId).toArray()
  choices.sort((a,b)=>a.order-b.order)
  if(choices.length!==receipt.choices.length||
    choices.some((c,i)=>c.id!==receipt.choices[i].id||
      c.choiceKey!==receipt.choices[i].choiceKey||
      c.kind!==receipt.choices[i].kind||c.text!==receipt.choices[i].text||
      c.sessionId!==receipt.sessionId||c.status!=='available'))
    rejectReaderPublicationV1('receipt choices inconsistent with storage')
  const decision=receipt.decisionId==null?null:
    await db.readerDecisions.get(receipt.decisionId)
  if(receipt.decisionId!==null&&(!decision||
    decision.resultTurnId!==receipt.resultTurnId||
    decision.sessionId!==receipt.sessionId))
    rejectReaderPublicationV1('receipt decision is missing')
  let memorySagaStatus:ReaderMemorySagaStatusV1='reader_memory_pending'
  let memorySagaError:string|undefined
  // The derived saga is deliberately outside the publication transaction.
  try{
    await beginReaderMemorySagaV1(workspace,receipt.sessionId,receipt.resultTurnId)
    memorySagaStatus=await inspectReaderMemorySagaV1(
      workspace,receipt.sessionId,receipt.resultTurnId)
  }catch(error){
    memorySagaStatus='reader_memory_partial'
    memorySagaError=error instanceof Error?error.message:String(error)
  }
  return {receipt,turn:turn!,choices,decision:decision??null,memorySagaStatus,
    ...(memorySagaError?{memorySagaError}:{}),replayed}
}
/** A published receipt, not any uncommitted candidate, is the read boundary. */
export async function recoverReaderPublicationV1(input:{
  workspace:ReaderPublicationRequestV1['workspace']
  intent:ReaderPublicationRequestV1['intent']
}):Promise<ReaderPublishedResultV1|null>{
  const scope=await resolveScope({scope:input.workspace})
  const fingerprint=await readerIntentFingerprintV1(scope,input.intent)
  const receipt=await lookupReaderPublicationV1(scope,input.intent,fingerprint)
  return receipt?readPublishedResult(scope,receipt,true):null
}
export async function publishReaderTurnV1(
  input:ReaderPublicationRequestV1,
  /** Only regression harnesses may inject adoption failure; never a model-controlled hook. */
  testHooks?:ReaderCommitTestHooksV1,
):Promise<ReaderPublishedResultV1>{
  const scope=await resolveScope({scope:input.workspace})
  const fingerprint=await readerIntentFingerprintV1(scope,input.intent)
  // Stage A must happen before *any* lineage or provider call.
  const existing=await lookupReaderPublicationV1(scope,input.intent,fingerprint)
  if(existing)return readPublishedResult(scope,existing,true)
  // B: trusted, scope-bound source and choice resolution. C/D are P3/P4's
  // immutable Gateway preflight and durable run reservation.
  const auth=await authorizeReaderIntentV1(scope,input.intent)
  const generated=await generateReaderTurnCandidateV1({
    workspace:scope,sessionId:input.intent.sessionId,
    expectedRevision:input.intent.expectedRevision,
    selectedDecisionText:auth.selectedDecisionText,
    inputBudgetTokens:input.inputBudgetTokens,
    maxBaselineBytes:input.maxBaselineBytes,config:input.config,
    maxChoiceRetries:input.maxChoiceRetries??0,signal:input.signal,
  })
  // E-H: no reader table adoption before the *complete* governed P4 evidence.
  assertReaderVietnameseProseV1(generated.candidate.finalProse)
  if(!await verifyReaderGenerationCandidateV1({
    workspace:scope,...generated}))rejectReaderPublicationV1('P4 candidate evidence invalid')
  await assertReaderPrecommitEvidenceV1(
    generated.candidate,input.intent,auth.headTurnId)
  const prepared=await prepareReaderCommitV1({
    scope,intent:input.intent,requestFingerprint:fingerprint,
    expectedHeadTurnId:auth.headTurnId,turnOrdinal:auth.turnOrdinal,
    candidate:generated.candidate,
  })
  let receipt:ReaderPublicationReceiptV1
  try {
    receipt=await commitReaderPublicationV1(prepared,testHooks)
  }catch(error){
    // If a concurrent same-key writer committed, its receipt is authoritative.
    // A different key/CAS loser remains stale and can NEVER reuse this candidate.
    const winner=await lookupReaderPublicationV1(scope,input.intent,fingerprint)
    if(winner)return readPublishedResult(scope,winner,true)
    throw error
  }
  // J/K: saga failures are recoverable, published data is never rewritten.
  invalidateReaderContextAfterImportOrRefreshV1()
  return readPublishedResult(scope,receipt,false)
}
