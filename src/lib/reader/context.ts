/**
 * P3 Reader-only Context Gateway adapter. One immutable assembly per attempt.
 * Neither this module nor its seven registered sources reads Work chapters,
 * chapter memory, live Work facts, authoring RAG or other editor-only sources.
 */
import { db } from '../db/schema'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { estimateTokens } from '../ai/context-budget'
import { assembleContext } from '../registry/assemble-context'
import type {
  AssembleContextResult, ReaderContextScopeV1, ReaderFrozenSourceSnapshotV1,
} from '../registry/types'
import type { WorkspaceScope } from '../types/world-ownership'
import type { ReaderTurnV1, ReaderDecisionV1, ReaderMemoryV1 } from '../types/reader'
import { resolveReaderLineageV1, type ReaderVisibleLineageV1 } from './lineage'
import { assertReaderFactNonconflictingV1 } from './confirmation'
import { READER_SOURCE_KEYS_V1 } from './gateway-sources'
import { invalidateContextGatewayCacheV1 } from '../context-gateway/provider-cache'

const MANDATORY_KEYS = new Set<string>([
  'reader.baseline', 'reader.published-history', 'reader.decisions', 'reader.continuity',
])
const OPTIONAL_KEYS = ['reader.confirmed-facts','reader.confirmed-knowledge','reader.retrieval'] as const
export const READER_SUMMARY_POLICY_V1 = 'reader-contiguous-summary-v1'
export const READER_CONTEXT_MANIFEST_VERSION_V1 = 'reader-context-manifest-v1'
function fail(message: string): never { throw Error('[readerContext] ' + message) }
const visibleKey = (scope: ReaderContextScopeV1) => ({
  sessionId: scope.sessionId, canonBaselineHash: scope.canonBaselineHash,
  lineageFingerprint: scope.lineageFingerprint,
  selectionPolicyVersion: scope.selectionPolicyVersion,
  headTurnId: scope.headTurnId, expectedRevision: scope.expectedRevision,
})
/** Never cache by Work alone. A new tab or import must re-verify current state. */
export function readerContextCacheKeyV1(scope: ReaderContextScopeV1, inputBudgetTokens: number): string {
  return JSON.stringify({version:1,projectId:scope.projectId,worldId:scope.worldId,
    workId:scope.workId,...visibleKey(scope),inputBudgetTokens})
}
export interface ReaderFrozenContextAssemblyV1 {
  version: 1
  scope: ReaderContextScopeV1
  sourcePacket: ReaderFrozenSourceSnapshotV1
  assembly: AssembleContextResult
  contextManifestHash: string
  textHash: string
  continuityMode: 'full' | 'compressed'
  selectedSummaryThroughTurnId: number | null
  optionalOmitted: string[]
}
interface VerifiedReaderRecordsV1 {
  decisions: Array<ReaderDecisionV1 & { sourceOrdinal: number; resultOrdinal: number; choiceKey: string; choiceText: string }>
  facts: unknown[]
  knowledge: unknown[]
  retrieval: unknown[]
}
function allRowsOnPath<T extends { sessionId: number; originTurnId?: number; sourceTurnId?: number }>(
  lineage: ReaderVisibleLineageV1, rows: T[], idField: 'originTurnId' | 'sourceTurnId',
): T[] {
  const turns = new Map(lineage.turns.map(turn=>[turn.id!,turn]))
  return rows.filter(row=>{
    const turn = turns.get(row[idField]!)
    return !!turn && turn.sessionId===row.sessionId
  })
}
async function collectRecords(lineage: ReaderVisibleLineageV1): Promise<VerifiedReaderRecordsV1> {
  const projectId = lineage.scope.projectId
  const [decisions,choices,facts,knowledge,retrieval] = await Promise.all([
    db.readerDecisions.where('projectId').equals(projectId).toArray(),
    db.readerChoices.where('projectId').equals(projectId).toArray(),
    db.readerFacts.where('projectId').equals(projectId).toArray(),
    db.readerKnowledge.where('projectId').equals(projectId).toArray(),
    db.readerRetrievalChunks.where('projectId').equals(projectId).toArray(),
  ])
  const path = new Map(lineage.turns.map((turn,i)=>[turn.id!,{turn,i}]))
  const choiceMap = new Map(choices.map(choice=>[choice.id!,choice]))
  const chosen: VerifiedReaderRecordsV1['decisions'] = []
  for (const row of decisions) {
    const result = path.get(row.resultTurnId), source = path.get(row.sourceTurnId)
    if (!result) continue
    const choice = choiceMap.get(row.choiceId)
    if (!source || !choice || choice.turnId!==row.sourceTurnId ||
      choice.sessionId!==source.turn.sessionId || choice.kind!=='branch' && choice.kind!=='continue' ||
      !choice.choiceKey || !choice.text || result.i<=source.i ||
      result.turn.sessionId!==row.sessionId) fail('selected decision is not verifiable on published path')
    chosen.push({...row,sourceOrdinal:source.i,resultOrdinal:result.i,
      choiceKey:choice.choiceKey,choiceText:choice.text})
  }
  chosen.sort((a,b)=>a.resultOrdinal-b.resultOrdinal)
  if (new Set(chosen.map(d=>d.resultTurnId)).size!==chosen.length) fail('multiple selected decisions for a published turn')
  const confirmedFacts = allRowsOnPath(lineage,facts.filter(f=>f.status==='confirmed'),'originTurnId')
  const verifiedFacts: unknown[] = []
  for (const row of confirmedFacts) {
    const turn = path.get(row.originTurnId)!.turn
    if (!row.evidenceQuote?.trim() || !turn.content.includes(row.evidenceQuote) ||
      row.sourceHash!==turn.contentHash) fail('confirmed Reader fact provenance mismatch')
    assertReaderFactNonconflictingV1(row,confirmedFacts.filter(f=>f.id!==row.id),lineage.session.canonBaselineSnapshotJson)
    verifiedFacts.push({sessionId:row.sessionId,originTurnId:row.originTurnId,
      predicate:row.predicate,subjectRef:row.subjectRef,valueJson:row.valueJson,
      evidenceQuote:row.evidenceQuote,sourceHash:row.sourceHash})
  }
  const confirmedKnowledge = allRowsOnPath(lineage,knowledge.filter(k=>k.status==='confirmed'),'originTurnId')
  for(const item of confirmedKnowledge) {
    if(confirmedKnowledge.some(other=>other.id!==item.id&&other.characterId===item.characterId&&
      other.knowledgeKey===item.knowledgeKey&&other.statement!==item.statement)) {
      fail('conflicting confirmed Reader knowledge on one visible path')
    }
  }
  const verifiedKnowledge: unknown[] = []
  for (const row of confirmedKnowledge) {
    const turn = path.get(row.originTurnId)!.turn
    if (!row.sourceQuote?.trim() || !turn.content.includes(row.sourceQuote) ||
      !Number.isSafeInteger(row.characterId)) fail('confirmed Reader knowledge provenance mismatch')
    verifiedKnowledge.push({sessionId:row.sessionId,originTurnId:row.originTurnId,
      characterId:row.characterId,knowledgeKey:row.knowledgeKey,
      statement:row.statement,sourceQuote:row.sourceQuote})
  }
  const verifiedRetrieval: unknown[] = []
  for (const row of allRowsOnPath(lineage,retrieval,'sourceTurnId')) {
    const turn = path.get(row.sourceTurnId)!.turn
    if (!row.sourceQuote?.trim() || !turn.content.includes(row.sourceQuote) ||
      await sha256Text(row.content)!==row.contentHash) {
      fail('Reader retrieval content/source proof invalid')
    }
    verifiedRetrieval.push({sessionId:row.sessionId,sourceTurnId:row.sourceTurnId,
      content:row.content,contentHash:row.contentHash,sourceQuote:row.sourceQuote})
  }
  return {decisions:chosen,facts:verifiedFacts,knowledge:verifiedKnowledge,retrieval:verifiedRetrieval}
}
function continuationRows(turns: ReaderTurnV1[]) {
  return turns.map(t=>({turnId:t.id,sessionId:t.sessionId,ordinal:t.turnOrdinal,
    contentHash:t.contentHash,content:t.content}))
}
function decisionRows(records: VerifiedReaderRecordsV1['decisions']) {
  return records.map(d=>({sessionId:d.sessionId,sourceTurnId:d.sourceTurnId,
    resultTurnId:d.resultTurnId,choiceId:d.choiceId,choiceKey:d.choiceKey,
    choiceText:d.choiceText,requestKey:d.requestKey}))
}
export async function readerPrefixProofV1(
  turns: ReaderTurnV1[], decisions: VerifiedReaderRecordsV1['decisions'],
): Promise<{lineageFingerprint:string;sourceTextHash:string}> {
  const prefix = turns.map(t=>({id:t.id,sessionId:t.sessionId,contentHash:t.contentHash}))
  const selected = decisions.filter(d=>d.resultOrdinal<turns.length)
  return {
    lineageFingerprint:await hashCanonicalValue({policy:READER_SUMMARY_POLICY_V1,path:prefix}),
    sourceTextHash:await hashCanonicalValue({policy:READER_SUMMARY_POLICY_V1,
      turns:continuationRows(turns),decisions:decisionRows(selected)}),
  }
}
async function selectSummary(
  lineage: ReaderVisibleLineageV1, records: VerifiedReaderRecordsV1,
): Promise<{memory:ReaderMemoryV1;prefixLength:number}|null> {
  if (lineage.turns.length<2) return null
  const memoryRows = await db.readerMemory.where('projectId').equals(lineage.scope.projectId).toArray()
  const visibleSessions = new Set(lineage.sessions.map(s=>s.id!))
  const eligible = memoryRows.filter(row=>row.status==='ready' &&
    visibleSessions.has(row.sessionId) && row.summary?.trim() &&
    row.summaryPolicyVersion===READER_SUMMARY_POLICY_V1)
  for (let prefixLength=lineage.turns.length-1;prefixLength>0;prefixLength--) {
    const last = lineage.turns[prefixLength-1]
    const rows = eligible.filter(row=>row.throughTurnId===last.id)
    if (!rows.length) continue
    const proof = await readerPrefixProofV1(lineage.turns.slice(0,prefixLength),records.decisions)
    for (const row of rows) {
      let saga: {version?:number;summaryContentHash?:string;tasks?:Array<{taskKind:string;status:string}>}|null=null
      try{saga=JSON.parse(row.continuityJson)}catch{saga=null}
      if(row.lineageFingerprint===proof.lineageFingerprint &&
        row.sourceTextHash===proof.sourceTextHash && saga?.version===1 &&
        saga.tasks?.some(t=>t.taskKind==='summary'&&t.status==='completed') &&
        saga.summaryContentHash===await sha256Text(row.summary)) {
        return {memory:row,prefixLength}
      }
    }
  }
  return null
}
/** Deterministic provenance window used by memory saga and compression. */
export async function readerMemoryWindowProofV1(
  workspace:WorkspaceScope,sessionId:number,throughTurnId:number,
):Promise<{lineageFingerprint:string;sourceTextHash:string;scope:ReaderContextScopeV1}> {
  const lineage=await resolveReaderLineageV1(workspace,sessionId)
  const pos=lineage.turns.findIndex(t=>t.id===throughTurnId)
  if(pos<0)fail('memory window is outside effective lineage')
  const records=await collectRecords(lineage)
  return {...await readerPrefixProofV1(lineage.turns.slice(0,pos+1),records.decisions),scope:lineage.scope}
}

function serialize(value: unknown): string { return JSON.stringify(value) }
function makeContents(
  lineage: ReaderVisibleLineageV1, records: VerifiedReaderRecordsV1,
  summary: {memory:ReaderMemoryV1;prefixLength:number}|null,
): Record<string,string> {
  const turns = summary ? lineage.turns.slice(summary.prefixLength) : lineage.turns
  return {
    'reader.baseline':lineage.session.canonBaselineSnapshotJson,
    'reader.published-history':serialize({version:1,mode:summary?'exact-suffix':'full',
      turns:continuationRows(turns)}),
    'reader.decisions':serialize({version:1,selected:decisionRows(records.decisions)}),
    'reader.confirmed-facts':serialize({version:1,facts:records.facts}),
    'reader.confirmed-knowledge':serialize({version:1,knowledge:records.knowledge}),
    'reader.continuity':serialize(summary
      ? {version:1,mode:'compressed',summary:summary.memory.summary,
        throughTurnId:summary.memory.throughTurnId,
        lineageFingerprint:summary.memory.lineageFingerprint,
        sourceTextHash:summary.memory.sourceTextHash,
        summaryPolicyVersion:summary.memory.summaryPolicyVersion}
      : {version:1,mode:'full',summary:null}),
    'reader.retrieval':serialize({version:1,chunks:records.retrieval}),
  }
}
function tokenCount(contents: Record<string,string>): number {
  return Object.values(contents).reduce((sum,text)=>sum+estimateTokens(text),0)
}
function fitOptional(contents: Record<string,string>, budget:number): {contents:Record<string,string>;omitted:string[]} {
  const adjusted={...contents},omitted:string[]=[]
  for(const key of OPTIONAL_KEYS) {
    if(tokenCount(adjusted)<=budget)break
    adjusted[key]=''
    omitted.push(key)
  }
  return{contents:adjusted,omitted}
}

/**
 * Assemble exactly once from registered readers. All seven original source
 * strings are frozen before entering the common Gateway. It never selects
 * implicit default (Work-wide) sources, even if optional Reader facts are empty.
 */
export async function prepareReaderContextV1(input: {
  workspace:WorkspaceScope;sessionId:number;expectedRevision:number;
  inputBudgetTokens:number;maxBaselineBytes:number
}):Promise<ReaderFrozenContextAssemblyV1> {
  if(!Number.isSafeInteger(input.inputBudgetTokens)||input.inputBudgetTokens<=0 ||
    !Number.isSafeInteger(input.maxBaselineBytes)||input.maxBaselineBytes<=0) fail('explicit positive budgets required')
  const lineage=await resolveReaderLineageV1(input.workspace,input.sessionId,input.expectedRevision)
  const baselineBytes=new TextEncoder().encode(lineage.session.canonBaselineSnapshotJson).byteLength
  if(baselineBytes>input.maxBaselineBytes) fail('pinned baseline exceeds hard byte cap')
  const records=await collectRecords(lineage)
  let summary:null|{memory:ReaderMemoryV1;prefixLength:number}=null
  let assembled=fitOptional(makeContents(lineage,records,null),input.inputBudgetTokens)
  if(tokenCount(assembled.contents)>input.inputBudgetTokens) {
    summary=await selectSummary(lineage,records)
    if(!summary) fail('full history exceeds budget and no verified contiguous ready summary exists')
    assembled=fitOptional(makeContents(lineage,records,summary),input.inputBudgetTokens)
  }
  if(tokenCount(assembled.contents)>input.inputBudgetTokens) {
    fail('mandatory pinned Canon/history/decision continuity exceeds budget; no silent trimming')
  }
  if(![...MANDATORY_KEYS].every(key=>assembled.contents[key]?.trim())) fail('required reader source missing')
  // Ensure all mutable reader state remained stable while it was being read.
  const current=await resolveReaderLineageV1(input.workspace,input.sessionId,input.expectedRevision)
  if(current.scope.lineageFingerprint!==lineage.scope.lineageFingerprint ||
    current.scope.canonBaselineHash!==lineage.scope.canonBaselineHash) fail('reader scope advanced during assembly')
  const sourceHashes:Record<string,string>={}
  for(const key of READER_SOURCE_KEYS_V1)sourceHashes[key]=await sha256Text(assembled.contents[key])
  const body={version:1 as const,scope:lineage.scope,contentByKey:assembled.contents,sourceHashes}
  const sourcePacket:ReaderFrozenSourceSnapshotV1={...body,snapshotHash:await hashCanonicalValue(body)}
  const result=await assembleContext({
    projectId:input.workspace.projectId,scope:input.workspace,
    readerContextScope:lineage.scope,readerFrozenSources:sourcePacket,
    sourceKeys:[...READER_SOURCE_KEYS_V1],inputBudgetTokens:input.inputBudgetTokens,
  })
  if(result.trimmed.length || result.overBudgetAfterTrim ||
    [...MANDATORY_KEYS].some(k=>!result.included.includes(k)) ||
    result.sourceEvidence?.some(e=>e.status==='included'&&e.delivery!=='full')) {
    fail('Gateway must never truncate or omit mandatory Reader continuity')
  }
  const textHash=await sha256Text(result.text)
  const contextManifestHash=await hashCanonicalValue({
    version:READER_CONTEXT_MANIFEST_VERSION_V1,scope:lineage.scope,
    sourcePacketHash:sourcePacket.snapshotHash,sourceHashes,
    evidence:result.sourceEvidence,omitted:result.omitted,trimmed:result.trimmed,
    inputBudget:result.inputBudget,textHash,
  })
  return {version:1,scope:lineage.scope,sourcePacket,assembly:result,
    contextManifestHash,textHash,continuityMode:summary?'compressed':'full',
    selectedSummaryThroughTurnId:summary?.memory.throughTurnId??null,
    optionalOmitted:assembled.omitted}
}
/** Verify a frozen attempt identity before P4/P5 reuse without reconstructing its prose. */
export async function assertReaderContextCurrentV1(
  workspace:WorkspaceScope, frozen:ReaderFrozenContextAssemblyV1,
):Promise<void> {
  const live=await resolveReaderLineageV1(workspace,frozen.scope.sessionId,frozen.scope.expectedRevision)
  if(JSON.stringify(live.scope)!==JSON.stringify(frozen.scope)) fail('stale reader context attempt')
  if(await sha256Text(frozen.assembly.text)!==frozen.textHash) fail('frozen reader text altered')
  const {snapshotHash,...body}=frozen.sourcePacket
  if(await hashCanonicalValue(body)!==snapshotHash) fail('frozen reader packet altered')
  const computed=await hashCanonicalValue({
    version:READER_CONTEXT_MANIFEST_VERSION_V1,scope:frozen.scope,
    sourcePacketHash:snapshotHash,sourceHashes:frozen.sourcePacket.sourceHashes,
    evidence:frozen.assembly.sourceEvidence,omitted:frozen.assembly.omitted,
    trimmed:frozen.assembly.trimmed,inputBudget:frozen.assembly.inputBudget,
    textHash:frozen.textHash,
  })
  if(computed!==frozen.contextManifestHash) fail('frozen reader manifest altered')
}
export function invalidateReaderContextAfterImportOrRefreshV1():void {
  invalidateContextGatewayCacheV1('reader-import-or-refresh')
}

// Public P3 reader memory task entrypoints share the same governed reader adapter.
export {
  beginReaderMemorySagaV1, settleReaderMemoryTaskV1, retryReaderMemoryTaskV1,
  inspectReaderMemorySagaV1,
} from './memory-saga'

// P5 public coordinator entrypoint; no Reader UI is mounted in this stage.
export { publishReaderTurnV1, recoverReaderPublicationV1 } from './recovery'
export type { ReaderPublishedResultV1 } from './recovery'
export type { ReaderTurnIntentV1, ReaderPublicationReceiptV1, ReaderPublicationRequestV1 } from './publication'
