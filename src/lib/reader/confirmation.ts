/**
 * P3 deterministic reader ledger confirmation gate. An extractor may propose
 * candidate rows but cannot elevate them without exact published source and
 * pinned-world conflict checks. No Work-level fact/knowledge mutation.
 */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types/world-ownership'
import { resolveReaderLineageV1 } from './lineage'
import type { ReaderFactV1 } from '../types/reader'

function fail(message:string):never{throw Error('[readerConfirmation] '+message)}
type FactLike=Pick<ReaderFactV1,'predicate'|'subjectRef'|'valueJson'>
function sameFactKey(a:FactLike,b:FactLike):boolean{
  return a.predicate===b.predicate&&a.subjectRef===b.subjectRef
}
function baselineRows(snapshot:string):Array<Record<string,unknown>> {
  const parsed=JSON.parse(snapshot)
  if(!Array.isArray(parsed.resources))fail('baseline missing registered resource list')
  return parsed.resources.flatMap((resource:any)=>Array.isArray(resource.records)?resource.records:[])
}
export function assertReaderFactNonconflictingV1(
  row:FactLike,existing:FactLike[],canonSnapshotJson:string,
):void {
  for(const confirmed of existing) {
    if(sameFactKey(row,confirmed)&&row.valueJson!==confirmed.valueJson) {
      fail('candidate overrides a visible confirmed reader fact')
    }
  }
  for(const canon of baselineRows(canonSnapshotJson)) {
    if(typeof canon.predicate==='string'&&typeof canon.subjectRef==='string'&&
      typeof canon.valueJson==='string'&&sameFactKey(row,canon as FactLike)&&
      row.valueJson!==canon.valueJson) {
      fail('candidate overrides pinned World Canon')
    }
  }
}
export async function confirmReaderFactV1(scope:WorkspaceScope,factId:number):Promise<void>{
  const candidate=await db.readerFacts.get(factId)
  if(!candidate||candidate.projectId!==scope.projectId||candidate.status!=='candidate') {
    fail('fact is not an in-scope candidate')
  }
  const lineage=await resolveReaderLineageV1(scope,candidate.sessionId)
  const turn=lineage.turns.find(t=>t.id===candidate.originTurnId&&t.sessionId===candidate.sessionId)
  if(!turn||candidate.sourceHash!==turn.contentHash||
    !candidate.evidenceQuote?.trim()||!turn.content.includes(candidate.evidenceQuote)) {
    fail('candidate fact has no exact published quote/hash')
  }
  const visibleIds=new Set(lineage.turns.map(t=>t.id))
  const confirmed=await db.readerFacts.where('projectId').equals(scope.projectId).toArray()
  assertReaderFactNonconflictingV1(candidate,confirmed.filter(f=>f.status==='confirmed'&&
    visibleIds.has(f.originTurnId)),lineage.session.canonBaselineSnapshotJson)
  await db.transaction('rw',db.readerFacts,db.readerSessions,async()=>{
    const live=await db.readerSessions.get(candidate.sessionId)
    const current=await db.readerFacts.get(factId)
    if(!live||live.headTurnId!==lineage.scope.headTurnId||
      live.revision!==lineage.scope.expectedRevision||
      current?.status!=='candidate'||current.sourceHash!==candidate.sourceHash) {
      fail('fact candidate or lineage changed during confirmation')
    }
    await db.readerFacts.update(factId,{status:'confirmed'})
  })
}
export async function confirmReaderKnowledgeV1(
  scope:WorkspaceScope,knowledgeId:number,
):Promise<void>{
  const candidate=await db.readerKnowledge.get(knowledgeId)
  if(!candidate||candidate.projectId!==scope.projectId||candidate.status!=='candidate') {
    fail('knowledge is not an in-scope candidate')
  }
  const lineage=await resolveReaderLineageV1(scope,candidate.sessionId)
  const turn=lineage.turns.find(t=>t.id===candidate.originTurnId&&t.sessionId===candidate.sessionId)
  if(!turn||!candidate.sourceQuote?.trim()||!turn.content.includes(candidate.sourceQuote)||
    !Number.isSafeInteger(candidate.characterId)) {
    fail('candidate knowledge has no exact published evidence')
  }
  const visibleIds=new Set(lineage.turns.map(t=>t.id))
  const confirmed=await db.readerKnowledge.where('projectId').equals(scope.projectId).toArray()
  if(confirmed.some(k=>k.status==='confirmed'&&visibleIds.has(k.originTurnId)&&
    k.characterId===candidate.characterId&&k.knowledgeKey===candidate.knowledgeKey&&
    k.statement!==candidate.statement))fail('candidate contradicts confirmed reader knowledge')
  await db.transaction('rw',db.readerKnowledge,db.readerSessions,async()=>{
    const live=await db.readerSessions.get(candidate.sessionId)
    const current=await db.readerKnowledge.get(knowledgeId)
    if(!live||live.revision!==lineage.scope.expectedRevision||
      live.headTurnId!==lineage.scope.headTurnId||current?.status!=='candidate') {
      fail('knowledge candidate changed during confirmation')
    }
    await db.readerKnowledge.update(knowledgeId,{status:'confirmed'})
  })
}
