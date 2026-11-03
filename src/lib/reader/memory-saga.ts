/**
 * P3 reader-only derived memory saga, fitted into the signed nine-table model.
 * Saga task receipts live in readerMemory.continuityJson for that turn. No
 * Chapter/Work ledger writes, no model calls, no new table, no prose mutation.
 */
import { db } from '../db/schema'
import { hashCanonicalValue } from '../agent/run/hash'
import type { WorkspaceScope } from '../types/world-ownership'
import { readerMemoryWindowProofV1, READER_SUMMARY_POLICY_V1 } from './context'
import { resolveReaderLineageV1 } from './lineage'
import { invalidateReaderContextAfterImportOrRefreshV1 } from './context'

export const READER_MEMORY_TASK_KINDS_V1 = ['summary','facts','knowledge','retrieval'] as const
export type ReaderMemoryTaskKindV1=typeof READER_MEMORY_TASK_KINDS_V1[number]
export type ReaderMemorySagaStatusV1 =
  'reader_memory_pending'|'reader_memory_partial'|'reader_memory_failed'|'reader_memory_ready'
type TaskStatus='pending'|'completed'|'failed'
interface MemoryTaskV1 {
  taskKind:ReaderMemoryTaskKindV1
  taskId:string
  sourceHash:string
  status:TaskStatus
  error?:string
}
interface MemorySagaReceiptV1 {
  version:1
  sagaStatus:ReaderMemorySagaStatusV1
  tasks:MemoryTaskV1[]
}
function fail(message:string):never {throw Error('[readerMemorySaga] '+message)}
function parseSaga(value:string):MemorySagaReceiptV1 {
  let data:any
  try{data=JSON.parse(value)}catch{fail('saga receipt is malformed')}
  if(data?.version!==1||!Array.isArray(data.tasks)||
    !READER_MEMORY_TASK_KINDS_V1.every(kind=>data.tasks.some((t:MemoryTaskV1)=>t.taskKind===kind))) {
    fail('saga receipt is incomplete')
  }
  return data as MemorySagaReceiptV1
}
function sagaState(tasks:MemoryTaskV1[]):ReaderMemorySagaStatusV1 {
  if(tasks.every(t=>t.status==='completed'))return'reader_memory_ready'
  if(tasks.find(t=>t.taskKind==='summary')?.status==='failed')return'reader_memory_failed'
  if(tasks.some(t=>t.status!=='pending'))return'reader_memory_partial'
  return'reader_memory_pending'
}
export async function beginReaderMemorySagaV1(
  scope:WorkspaceScope,sessionId:number,throughTurnId:number,
):Promise<MemorySagaReceiptV1> {
  const proof=await readerMemoryWindowProofV1(scope,sessionId,throughTurnId)
  const tasks:MemoryTaskV1[]=[]
  for(const taskKind of READER_MEMORY_TASK_KINDS_V1) {
    tasks.push({taskKind,sourceHash:proof.sourceTextHash,status:'pending',
      taskId:await hashCanonicalValue({version:1,sessionId,turnId:throughTurnId,
        taskKind,sourceHash:proof.sourceTextHash})})
  }
  const receipt:MemorySagaReceiptV1={version:1,sagaStatus:'reader_memory_pending',tasks}
  await db.transaction('rw',db.readerMemory,db.readerSessions,async()=>{
    const session=await db.readerSessions.get(sessionId)
    if(!session||session.projectId!==scope.projectId||session.workId!==scope.workId ||
      session.canonBaselineHash!==proof.scope.canonBaselineHash)fail('reader session changed before saga registration')
    const old=await db.readerMemory.where('[sessionId+throughTurnId]').equals([sessionId,throughTurnId]).first()
    if(old) {
      if(old.sourceTextHash!==proof.sourceTextHash||old.lineageFingerprint!==proof.lineageFingerprint||
        old.summaryPolicyVersion!==READER_SUMMARY_POLICY_V1)fail('old memory window provenance conflicts')
      return
    }
    await db.readerMemory.add({
      projectId:scope.projectId,sessionId,throughTurnId,summary:'',
      continuityJson:JSON.stringify(receipt),sourceTextHash:proof.sourceTextHash,
      lineageFingerprint:proof.lineageFingerprint,summaryPolicyVersion:READER_SUMMARY_POLICY_V1,
      status:'stale',processingRunId:null,createdAt:Date.now(),
    })
  })
  invalidateReaderContextAfterImportOrRefreshV1()
  const row=await db.readerMemory.where('[sessionId+throughTurnId]').equals([sessionId,throughTurnId]).first()
  return parseSaga(row!.continuityJson)
}
/**
 * Settlement only ingests an externally validated summary artifact in P3;
 * P4/P5 own any provider invocation and the postcommit scheduling boundary.
 */
export async function settleReaderMemoryTaskV1(input:{
  workspace:WorkspaceScope;sessionId:number;throughTurnId:number;
  taskKind:ReaderMemoryTaskKindV1;taskId:string;sourceHash:string;
  outcome:'completed'|'failed';summary?:string;error?:string
}):Promise<MemorySagaReceiptV1>{
  if(!READER_MEMORY_TASK_KINDS_V1.includes(input.taskKind))fail('unknown saga task kind')
  const proof=await readerMemoryWindowProofV1(input.workspace,input.sessionId,input.throughTurnId)
  if(proof.sourceTextHash!==input.sourceHash)fail('stale task source hash')
  let next:MemorySagaReceiptV1|undefined
  await db.transaction('rw',db.readerMemory,db.readerSessions,async()=>{
    const row=await db.readerMemory.where('[sessionId+throughTurnId]').equals([input.sessionId,input.throughTurnId]).first()
    if(!row||row.projectId!==input.workspace.projectId||
      row.sourceTextHash!==proof.sourceTextHash||row.lineageFingerprint!==proof.lineageFingerprint) {
      fail('memory record missing or lineage changed')
    }
    const receipt=parseSaga(row.continuityJson)
    const task=receipt.tasks.find(t=>t.taskKind===input.taskKind)
    if(!task||task.taskId!==input.taskId||task.sourceHash!==input.sourceHash)fail('saga task identity invalid')
    if(task.status!=='pending') {
      if(task.status!==input.outcome)fail('conflicting retry for settled saga task')
      next=receipt
      return
    }
    if(input.taskKind==='summary'&&input.outcome==='completed'&&!input.summary?.trim()) {
      fail('ready summary requires real nonempty content')
    }
    task.status=input.outcome
    if(input.outcome==='failed')task.error=input.error?.slice(0,500)||'unspecified-task-error'
    receipt.sagaStatus=sagaState(receipt.tasks)
    const summary=input.taskKind==='summary'&&input.outcome==='completed'?input.summary!:row.summary
    const status=receipt.tasks.find(t=>t.taskKind==='summary')?.status==='completed'
      ?'ready' as const:receipt.sagaStatus==='reader_memory_failed'?'failed' as const:'stale' as const
    await db.readerMemory.update(row.id!,{summary,continuityJson:JSON.stringify(receipt),status})
    if(status==='ready') {
      const session=await db.readerSessions.get(input.sessionId)
      if(!session||session.projectId!==input.workspace.projectId||
        session.workId!==input.workspace.workId)fail('saga session lost ownership')
      await db.readerSessions.update(input.sessionId,{memoryReadyThroughTurnId:input.throughTurnId,
        updatedAt:Date.now()})
    }
    next=receipt
  })
  invalidateReaderContextAfterImportOrRefreshV1()
  return next!
}
/** Caller can display recovery state without implying prose must be rolled back. */
export async function inspectReaderMemorySagaV1(
  scope:WorkspaceScope,sessionId:number,throughTurnId:number,
):Promise<ReaderMemorySagaStatusV1> {
  const lineage=await resolveReaderLineageV1(scope,sessionId)
  if(!lineage.turns.some(t=>t.id===throughTurnId))fail('requested saga turn is outside reader path')
  const row=await db.readerMemory.where('[sessionId+throughTurnId]').equals([sessionId,throughTurnId]).first()
  return row?parseSaga(row.continuityJson).sagaStatus:'reader_memory_pending'
}

/** A failed task can be explicitly requeued with the SAME deterministic id. */
export async function retryReaderMemoryTaskV1(input:{
  workspace:WorkspaceScope;sessionId:number;throughTurnId:number;
  taskKind:ReaderMemoryTaskKindV1;taskId:string;sourceHash:string
}):Promise<MemorySagaReceiptV1> {
  const proof=await readerMemoryWindowProofV1(input.workspace,input.sessionId,input.throughTurnId)
  if(proof.sourceTextHash!==input.sourceHash)fail('retry source provenance changed')
  let result:MemorySagaReceiptV1|undefined
  await db.transaction('rw',db.readerMemory,async()=>{
    const row=await db.readerMemory.where('[sessionId+throughTurnId]').equals([input.sessionId,input.throughTurnId]).first()
    if(!row||row.projectId!==input.workspace.projectId||
      row.sourceTextHash!==proof.sourceTextHash||row.lineageFingerprint!==proof.lineageFingerprint) {
      fail('retry reader memory provenance differs')
    }
    const receipt=parseSaga(row.continuityJson)
    const task=receipt.tasks.find(t=>t.taskKind===input.taskKind)
    if(!task||task.taskId!==input.taskId||task.sourceHash!==input.sourceHash)fail('retry task identity invalid')
    if(task.status!=='failed')fail('only failed task can be explicitly retried')
    task.status='pending'
    delete task.error
    receipt.sagaStatus=sagaState(receipt.tasks)
    await db.readerMemory.update(row.id!,{continuityJson:JSON.stringify(receipt),
      status:receipt.tasks.find(t=>t.taskKind==='summary')?.status==='completed'?'ready':'stale'})
    result=receipt
  })
  invalidateReaderContextAfterImportOrRefreshV1()
  return result!
}
