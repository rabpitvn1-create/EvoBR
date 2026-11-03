/** P5: one caller-owned Dexie transaction, one linearized publication. */
import { db } from '../db/schema'
import { adopt,hashAdoptRecordFieldsV1 } from '../registry/adopt'
import { scopeTransactionTables } from '../workspace/scope'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { serializeReaderSceneHintsV1 } from './stage-assets'
import type { WorkspaceScope } from '../types'
import type { ReaderGenerationCandidateV1 } from './generation'
import type { ReaderTurnIntentV1,ReaderPublicationReceiptV1 } from './publication'
import { rejectReaderPublicationV1 } from './publication'

type WriteTarget='readerTurns'|'readerChoices'|'readerDecisions'|'readerSessions'|'readerPublicationRuns'
type WriteHookV1=(target:WriteTarget)=>void|Promise<void>
export interface ReaderCommitTestHooksV1 {
  /** Testing only. An injected failure must reject the transaction. */
  beforeAdopt?:WriteHookV1
  forceCasSkip?:boolean
  forceChoiceShortWrite?:boolean
}
export interface ReaderPreparedCommitV1 {
  scope:WorkspaceScope
  intent:ReaderTurnIntentV1
  requestFingerprint:string
  expectedHeadTurnId:number|null
  turnOrdinal:number
  candidate:ReaderGenerationCandidateV1
  contentHash:string
  sessionCasHash:string
  sceneHintsJson:string|null
}
function fail(message:string):never{return rejectReaderPublicationV1(message)}
async function writeOne(input:{
  scope:WorkspaceScope;target:WriteTarget;data:Record<string,unknown>
  recordId?:number;cas?:{fields:readonly string[];expectedHash:string}
  hooks?:ReaderCommitTestHooksV1
}):Promise<number>{
  await input.hooks?.beforeAdopt?.(input.target)
  const result=await adopt({
    projectId:input.scope.projectId,scope:input.scope,target:input.target,
    mode:input.recordId==null?'add':'replace',
    ...(input.recordId==null?{}:{recordId:input.recordId}),
    ...(input.cas?{compareAndSet:{kind:'record-fields-value-hash' as const,
      fields:input.cas.fields,expectedHash:input.cas.expectedHash}}:{}),
    data:input.hooks?.forceChoiceShortWrite&&input.target==='readerChoices'
      ?{...input.data,kind:'unregistered-kind'}:input.data,
  })
  if(result.written.length!==1||result.skipped.length||result.fkErrors.length||
    result.unknown.length||result.typeErrors.length||
    !Number.isSafeInteger(result.written[0]?.id))
    fail('adopt did not write exactly one '+input.target+' record')
  return result.written[0].id
}
export const READER_SESSION_CAS_FIELDS_V1=['headTurnId','revision'] as const
export async function prepareReaderCommitV1(input:Omit<ReaderPreparedCommitV1,
  'contentHash'|'sessionCasHash'|'sceneHintsJson'>):Promise<ReaderPreparedCommitV1>{
  const session=await db.readerSessions.get(input.intent.sessionId)
  if(!session||session.projectId!==input.scope.projectId||
    session.workId!==input.scope.workId||
    session.revision!==input.intent.expectedRevision||
    session.headTurnId!==input.expectedHeadTurnId)
    fail('stale session before publication preparation')
  // All SHA operations occur before opening the outer write transaction.
  const [contentHash,sessionCasHash]=await Promise.all([
    sha256Text(input.candidate.finalProse),
    hashAdoptRecordFieldsV1({...session},READER_SESSION_CAS_FIELDS_V1),
  ])
  return {...input,contentHash,sessionCasHash,
    sceneHintsJson:serializeReaderSceneHintsV1(input.candidate.sceneHints)}
}
export async function commitReaderPublicationV1(
  prepared:ReaderPreparedCommitV1,hooks?:ReaderCommitTestHooksV1,
):Promise<ReaderPublicationReceiptV1>{
  const {scope,intent,candidate}=prepared
  // No HTTP, AI, dynamic imports or precommit hashing inside this callback.
  return db.transaction('rw',scopeTransactionTables(
    db.readerSessions,db.readerTurns,db.readerChoices,db.readerDecisions,
    db.readerPublicationRuns,db.agentRuns,
  ),async()=>{
    const current=await db.readerSessions.get(intent.sessionId)
    if(!current||current.projectId!==scope.projectId||
      current.workId!==scope.workId||current.status!=='active'||
      current.headTurnId!==prepared.expectedHeadTurnId||
      current.revision!==intent.expectedRevision)
      fail('commit CAS stale head/revision; candidate cannot be reused')
    if(await db.readerPublicationRuns.where('[sessionId+requestKey]')
      .equals([intent.sessionId,intent.requestKey]).first())
      fail('requestKey already committed while generation was underway')
    if(intent.kind==='opening'){
      if(current.parentSessionId!==null||current.headTurnId!==null||
        current.revision!==0)fail('opening no longer eligible')
    }else{
      if(current.headTurnId!==intent.sourceTurnId)
        fail('selected source is no longer active head')
      const source=await db.readerTurns.get(intent.sourceTurnId)
      const choice=await db.readerChoices.get(intent.choiceId)
      if(!source||!choice||source.projectId!==scope.projectId||
        source.status!=='published'||choice.projectId!==scope.projectId||
        choice.turnId!==source.id||choice.sessionId!==source.sessionId||
        choice.status!=='available'||!['branch','continue'].includes(choice.kind))
        fail('selected source or choice changed before commit')
    }
    const ownCount=await db.readerTurns.where('sessionId').equals(intent.sessionId).count()
    if(ownCount+1!==prepared.turnOrdinal)fail('reader ordinal changed before commit')
    const turnId=await writeOne({scope,target:'readerTurns',hooks,data:{
      sessionId:intent.sessionId,parentTurnId:prepared.expectedHeadTurnId,
      turnOrdinal:prepared.turnOrdinal,content:candidate.finalProse,
      contentHash:prepared.contentHash,sceneHintsJson:prepared.sceneHintsJson,
      status:'published',
    }})
    const choiceRows:ReaderPublicationReceiptV1['choices']=[]
    for(const [index,choice] of candidate.choices.choices.entries()){
      const id=await writeOne({scope,target:'readerChoices',hooks,data:{
        sessionId:intent.sessionId,turnId,choiceKey:choice.choiceKey,
        kind:choice.kind,text:choice.text,order:index,status:'available',
      }})
      choiceRows.push({id,choiceKey:choice.choiceKey,kind:choice.kind,text:choice.text})
    }
    let decisionId:number|null=null
    if(intent.kind==='choice'){
      decisionId=await writeOne({scope,target:'readerDecisions',hooks,data:{
        sessionId:intent.sessionId,requestKey:intent.requestKey,
        sourceTurnId:intent.sourceTurnId,choiceId:intent.choiceId,resultTurnId:turnId,
      }})
    }
    const receipt:ReaderPublicationReceiptV1={
      version:1,sessionId:intent.sessionId,requestKey:intent.requestKey,
      requestFingerprint:prepared.requestFingerprint,runId:candidate.runId,
      candidateHash:candidate.candidateHash,contextManifestHash:candidate.contextManifestHash,
      semanticArtifactHash:candidate.v3.receiptHash,
      expectedRevision:intent.expectedRevision,
      previousHeadTurnId:prepared.expectedHeadTurnId,
      resultTurnId:turnId,resultRevision:intent.expectedRevision+1,
      contentHash:prepared.contentHash,choices:choiceRows,decisionId,
    }
    // Receipt is committed in the same transaction, never a postcommit write.
    await writeOne({scope,target:'readerPublicationRuns',hooks,data:{
      sessionId:intent.sessionId,requestKey:intent.requestKey,
      runId:candidate.runId,candidateHash:candidate.candidateHash,
      requestFingerprint:prepared.requestFingerprint,
      contextManifestHash:candidate.contextManifestHash,
      semanticArtifactHash:candidate.v3.receiptHash,
      expectedSessionRevision:intent.expectedRevision,
      resultTurnId:turnId,receiptJson:JSON.stringify(receipt),status:'committed',
    }})
    // The registered multi-field CAS operates as a nested Dexie transaction.
    // A resolved skip is a hard failure; the outer transaction rolls back ALL rows.
    const sessionId=await writeOne({scope,target:'readerSessions',hooks,
      recordId:intent.sessionId,
      cas:{fields:READER_SESSION_CAS_FIELDS_V1,expectedHash:hooks?.forceCasSkip?'0'.repeat(64):prepared.sessionCasHash},
      data:{headTurnId:turnId,revision:intent.expectedRevision+1},
    })
    if(sessionId!==intent.sessionId)fail('session CAS wrote wrong record')
    return receipt
  })
}
