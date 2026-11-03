/** P5: immutable Reader intents and precommit authorization. */
import type { AIConfig, WorkspaceScope } from '../types'
import type { ReaderGenerationCandidateV1 } from './generation'
import { db } from '../db/schema'
import { hashCanonicalValue } from '../agent/run/hash'
import { resolveScope } from '../workspace/scope'
import { resolveReaderLineageV1 } from './lineage'
import { verifyReaderCanonBaselineV1 } from './baseline'

export type ReaderTurnIntentV1 =
  | { kind:'opening'; sessionId:number; requestKey:string; expectedRevision:number }
  | { kind:'choice'; sessionId:number; sourceTurnId:number; choiceId:number;
      requestKey:string; expectedRevision:number }

export interface ReaderPublicationReceiptV1 {
  version:1
  sessionId:number
  requestKey:string
  requestFingerprint:string
  runId:number
  candidateHash:string
  contextManifestHash:string
  semanticArtifactHash:string
  expectedRevision:number
  previousHeadTurnId:number|null
  resultTurnId:number
  resultRevision:number
  contentHash:string
  choices:Array<{id:number;choiceKey:string;kind:'branch'|'continue';text:string}>
  decisionId:number|null
}

export interface ReaderPublicationRequestV1 {
  workspace:WorkspaceScope
  intent:ReaderTurnIntentV1
  config:AIConfig
  inputBudgetTokens:number
  maxBaselineBytes:number
  maxChoiceRetries?:number
  signal?:AbortSignal
}

export class ReaderPublicationConflictV1 extends Error {
  constructor(message:string) {super('[readerPublication] '+message);this.name='ReaderPublicationConflictV1'}
}
export function rejectReaderPublicationV1(message:string):never {
  throw new ReaderPublicationConflictV1(message)
}
function positive(id:number):boolean{return Number.isSafeInteger(id)&&id>0}
export async function readerIntentFingerprintV1(
  scope:WorkspaceScope,intent:ReaderTurnIntentV1,
):Promise<string> {
  if(!positive(intent.sessionId)||!Number.isSafeInteger(intent.expectedRevision)||
    intent.expectedRevision<0||typeof intent.requestKey!=='string'||
    !intent.requestKey.trim()||intent.requestKey.length>160||
    (intent.kind==='choice'&&(!positive(intent.sourceTurnId)||!positive(intent.choiceId)))||
    !['opening','choice'].includes(intent.kind))rejectReaderPublicationV1('invalid immutable intent')
  // Fingerprint is independent of the current head, so a lost response can replay
  // even after a different later request has advanced the session.
  return hashCanonicalValue({version:1,projectId:scope.projectId,
    worldId:scope.worldId,workId:scope.workId,intent})
}
export async function lookupReaderPublicationV1(
  workspace:WorkspaceScope,intent:ReaderTurnIntentV1,fingerprint:string,
):Promise<ReaderPublicationReceiptV1|null> {
  const receipt=await db.readerPublicationRuns.where('[sessionId+requestKey]')
    .equals([intent.sessionId,intent.requestKey]).first()
  if(!receipt)return null
  if(receipt.projectId!==workspace.projectId||
    receipt.requestFingerprint!==fingerprint||receipt.status!=='committed')
    rejectReaderPublicationV1('requestKey already committed with different fingerprint or owner')
  let decoded:ReaderPublicationReceiptV1
  try{decoded=JSON.parse(receipt.receiptJson) as ReaderPublicationReceiptV1}
  catch{return rejectReaderPublicationV1('committed receipt is malformed')}
  if(decoded.version!==1||decoded.resultTurnId!==receipt.resultTurnId||
    decoded.runId!==receipt.runId||decoded.candidateHash!==receipt.candidateHash||
    decoded.requestFingerprint!==fingerprint||decoded.sessionId!==intent.sessionId||
    decoded.requestKey!==intent.requestKey)
    rejectReaderPublicationV1('committed receipt is inconsistent')
  const turn=await db.readerTurns.get(decoded.resultTurnId)
  if(!turn||turn.sessionId!==intent.sessionId||turn.projectId!==workspace.projectId||
    turn.status!=='published'||turn.contentHash!==decoded.contentHash)
    rejectReaderPublicationV1('committed turn missing or altered')
  return decoded
}
export async function authorizeReaderIntentV1(
  workspace:WorkspaceScope,intent:ReaderTurnIntentV1,
):Promise<{headTurnId:number|null;selectedDecisionText:string|null;turnOrdinal:number}> {
  await resolveScope({scope:workspace})
  const lineage=await resolveReaderLineageV1(workspace,intent.sessionId,intent.expectedRevision)
  const session=lineage.session
  if(session.status!=='active')rejectReaderPublicationV1('reader session not active')
  await verifyReaderCanonBaselineV1(session)
  if(intent.kind==='opening'){
    if(session.parentSessionId!==null||session.headTurnId!==null||
      session.revision!==0||lineage.turns.length!==0)
      rejectReaderPublicationV1('opening requires empty root session')
    return {headTurnId:null,selectedDecisionText:null,turnOrdinal:1}
  }
  if(session.headTurnId!==intent.sourceTurnId||
    !lineage.turns.some(t=>t.id===intent.sourceTurnId))
    rejectReaderPublicationV1('choice source is not reachable active head')
  const source=await db.readerTurns.get(intent.sourceTurnId)
  const selected=await db.readerChoices.get(intent.choiceId)
  if(!source||!selected||source.status!=='published'||
    selected.turnId!==intent.sourceTurnId||
    selected.sessionId!==source.sessionId||selected.projectId!==workspace.projectId||
    selected.status!=='available'||!['branch','continue'].includes(selected.kind))
    rejectReaderPublicationV1('choice is missing or foreign to active head')
  const own=await db.readerTurns.where('sessionId').equals(intent.sessionId).toArray()
  return {headTurnId:session.headTurnId,selectedDecisionText:selected.text,
    turnOrdinal:own.length+1}
}
export async function assertReaderPrecommitEvidenceV1(
  candidate:ReaderGenerationCandidateV1,intent:ReaderTurnIntentV1,
  expectedHead:number|null,
):Promise<void> {
  if(candidate.sessionId!==intent.sessionId||
    candidate.expectedRevision!==intent.expectedRevision||
    candidate.headTurnId!==expectedHead||candidate.v3.status!=='passed'||
    candidate.v3.finalProseHash!==candidate.finalProseHash||
    candidate.choices.finalProseHash!==candidate.finalProseHash||
    candidate.choices.choices.length===0||
    candidate.modelCalls>6)
    rejectReaderPublicationV1('candidate evidence cannot authorize publication')
  const choices=candidate.choices.choices
  if(candidate.choices.fallbackContinue){
    if(choices.length!==1||choices[0].kind!=='continue'||
      choices[0].choiceKey!=='continue')
      rejectReaderPublicationV1('invalid deterministic Continue fallback')
  }else if(choices.some(c=>c.kind!=='branch'||!c.sourceQuote||
    !candidate.finalProse.includes(c.sourceQuote)))
    rejectReaderPublicationV1('branch source quote not present in final prose')
}
