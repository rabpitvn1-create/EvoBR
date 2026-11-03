/**
 * P4 Reader-only durable AgentRun. Reader session identity is carried in the
 * immutable Gateway attempt artifact, NEVER in a fabricated chapterId.
 * Run is Work-owned as the existing Agent Harness requires, but its allowed
 * reads are the seven Reader sources and every step is session-bound.
 * No reader publication writes are performed here (P5).
 */
import { createAgentRunV1, appendAgentRunEventV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { createAgentSkillExecutionBindingV2 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { estimateTokens } from '../ai/context-budget'
import type { WorkspaceScope, ChatMessage } from '../types'
import type { AgentRunContractV2, AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1 } from '../types/agent-run'
import { assertReaderContextCurrentV1, type ReaderFrozenContextAssemblyV1 } from './context'
import { READER_SOURCE_KEYS_V1 } from './gateway-sources'

export const READER_MODEL_CALL_LIMIT_V1 = 6 as const
export const READER_STEPS_V1 = {
  prose: 'reader-prose',
  review: 'reader-v3-review',
  revise: 'reader-v3-revision',
  rereview: 'reader-v3-rereview',
  choices: 'reader-choices',
  choiceCheck: 'reader-choice-verifier',
} as const
export type ReaderStepV1 = typeof READER_STEPS_V1[keyof typeof READER_STEPS_V1]
const STEP_ENTRY:Record<ReaderStepV1,string> = {
  'reader-prose':'reader.prose.generate',
  'reader-v3-review':'reader.prose.review',
  'reader-v3-revision':'reader.prose.revise',
  'reader-v3-rereview':'reader.prose.review',
  'reader-choices':'reader.choices.generate',
  'reader-choice-verifier':'reader.choices.review',
}
const fail=(why:string):never=>{throw Error('[readerDurable] '+why)}
export type ReaderRunEvidenceV1 = {
  version:1
  runId:number
  sessionId:number
  contextManifestHash:string
  sourcePacketHash:string
  lineageFingerprint:string
  scopeHash:string
  attemptHash:string
}
export interface ReaderRunHandleV1 {
  scope:WorkspaceScope
  snapshot:AgentRunSnapshotV1
  frozen:ReaderFrozenContextAssemblyV1
  identity:ReaderRunEvidenceV1
  calls:number
  records:Array<{
    stepId:ReaderStepV1
    attempt:number
    requestHash:string
    dispatchStarted:boolean
    responseHash:string|null
    estimatedInputTokens:number
    reservedOutputTokens:number
    inputTokens:number|null
    outputTokens:number|null
    latencyMs:number|null
    requestLifecycle:{phase:'pre-dispatch'|'request-dispatched'|'response-observed';responseStatus:number|null}|null
    error:string|null
  }>
}
const steps=Object.values(READER_STEPS_V1)
async function runEvent<T extends AgentRunEventTypeV1>(
  handle:ReaderRunHandleV1,type:T,payload:AgentRunEventPayloadByTypeV1[T],
):Promise<void> {
  handle.snapshot=await appendAgentRunEventV1({
    scope:handle.scope,runId:handle.snapshot.run.id,type,payload,
    expectedLastSequence:handle.snapshot.projection.lastSequence,
  })
}
export async function createReaderDurableRunV1(input:{
  scope:WorkspaceScope
  frozen:ReaderFrozenContextAssemblyV1
  maxInputTokens:number
  maxOutputTokens?:number
  maxChoiceRetries?:number
}):Promise<ReaderRunHandleV1>{
  const {frozen,scope}=input
  if(frozen.scope.projectId!==scope.projectId||frozen.scope.worldId!==scope.worldId||
    frozen.scope.workId!==scope.workId||!Number.isSafeInteger(input.maxInputTokens)||
    input.maxInputTokens<=0)fail('invalid reader run scope or budget')
  if(frozen.scope.selectionPolicyVersion!=='reader-lineage-context-v1'||
    !frozen.contextManifestHash||!frozen.sourcePacket.snapshotHash)fail('missing P3 frozen manifest')
  const maxOutputTokens=input.maxOutputTokens??16_000
  if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<16_000)fail('V3 revision requires 16000 reserved output tokens')
  const executionBindings=await Promise.all(steps.map(async stepId=>{
    const entry=STEP_ENTRY[stepId]
    const skill=getAgentSkillV1(entry,'prose')
    const binding=await createAgentSkillExecutionBindingV2(skill,{writeTargets:[]})
    const formalEntry=await freezeFormalAIEntryBindingV1(entry)
    return {stepId,...binding,formalEntry}
  }))
  const contract:AgentRunContractV2={
    version:2,
    objective:`Reader prose, V3 review and post-V3 choices for session ${frozen.scope.sessionId}, revision ${frozen.scope.expectedRevision}; never publish here`,
    workflowKind:'generate-verify-revise',
    scope:{projectId:scope.projectId,worldGroupId:null},
    permissions:{contextSourceKeys:[...READER_SOURCE_KEYS_V1],writeTargets:[]},
    executionBindings,
    budget:{
      maxModelCalls:READER_MODEL_CALL_LIMIT_V1,maxToolCalls:0,
      maxInputTokens:input.maxInputTokens,maxOutputTokens,
      maxAttemptsPerStep:Math.max(1,Math.min(3,(input.maxChoiceRetries??0)+1)),
      maxProtocolErrors:0,
    },
    acceptance:[
      {id:'reader.candidate',kind:'output-present',required:true},
      {id:'reader.v3-semantic-review',kind:'semantic-review',required:true},
    ],
    verificationPlan:[{
      id:'reader.prepublication',kind:'terminal',
      verifier:'reader-v3-choice-sealed-v1',
      criterionIds:['reader.candidate','reader.v3-semantic-review'],
    }],
    failurePolicy:{
      onProtocolError:'fail',onVerificationFailure:'fail',
      onStaleInput:'pause-for-author',
    },
  }
  const snapshot=await createAgentRunV1({scope,worldGroupId:null,contract})
  const scopeHash=await hashCanonicalValue(frozen.scope)
  const identityBody={
    version:1 as const,runId:snapshot.run.id,sessionId:frozen.scope.sessionId,
    contextManifestHash:frozen.contextManifestHash,
    sourcePacketHash:frozen.sourcePacket.snapshotHash,
    lineageFingerprint:frozen.scope.lineageFingerprint,scopeHash,
  }
  const identity:ReaderRunEvidenceV1={
    ...identityBody,attemptHash:await hashCanonicalValue(identityBody),
  }
  // A durable artifact makes the precise Reader session manifest recoverable
  // without rewriting the P3 packet or asking the Work Gateway again.
  await recordAgentRunArtifactV1({
    scope,runId:snapshot.run.id,artifactKind:'source-snapshot',
    content:canonicalStringify({version:1,readerAttempt:identity,
      frozenSourcePacket:frozen.sourcePacket,
      assemblyHash:frozen.textHash}),
  })
  return {scope,snapshot:await readAgentRunV1(scope,snapshot.run.id),frozen,identity,calls:0,records:[]}
}

/**
 * A caller must not mutate segment bytes while retaining the previously
 * signed manifest and aggregate assembly.text. Verify source-to-segment
 * equality at EVERY model dispatch, not only at initial Reader preflight.
 */
export async function assertReaderFrozenStageInputV1(handle:ReaderRunHandleV1):Promise<void>{
  await assertReaderContextCurrentV1(handle.scope,handle.frozen)
  const {assembly,sourcePacket}=handle.frozen
  if(assembly.included.length!==assembly.segments.length)fail('Reader segment count changed')
  for(let i=0;i<assembly.included.length;i++){
    const key=assembly.included[i],exact=sourcePacket.contentByKey[key]
    if(!exact||assembly.segments[i].content!==exact)
      fail('Reader source segment altered after frozen Gateway assembly: '+key)
  }
  if(assembly.text!==assembly.segments.map(s=>s.content).join('\n\n'))
    fail('Reader Gateway text/segments disagree')
}

export async function beginReaderModelStepV1(input:{
  handle:ReaderRunHandleV1;stepId:ReaderStepV1;attempt?:number
  messages:readonly ChatMessage[];maxOutputTokens:number
}):Promise<{attempt:number;requestHash:string;startedAt:number}>{
  const {handle,stepId}=input,attempt=input.attempt??1
  await assertReaderFrozenStageInputV1(handle)
  const binding=handle.snapshot.contract.executionBindings?.find(b=>b.stepId===stepId)
  if(!binding)throw Error('[readerDurable] missing frozen Skill binding')
  if(binding.skillId!==STEP_ENTRY[stepId]||handle.calls>=READER_MODEL_CALL_LIMIT_V1)
    throw Error('[readerDurable] invalid frozen Skill or six-call limit reached')
  if(!Number.isSafeInteger(attempt)||attempt<1||
    attempt>handle.snapshot.contract.budget.maxAttemptsPerStep)fail('step retry budget exceeded')
  const requestHash=await hashCanonicalValue({
    version:1,readerAttempt:handle.identity.attemptHash,
    stepId,attempt,messages:input.messages,
    contextManifestHash:handle.frozen.contextManifestHash,
    formalEntry:binding.formalEntry,
  })
  if(attempt===1)await runEvent(handle,'step.scheduled',{stepId})
  await runEvent(handle,'step.started',{stepId,attempt})
  await runEvent(handle,'context.assembled',{
    stepId,attempt,manifestHash:handle.frozen.contextManifestHash,
  })
  await runEvent(handle,'model.requested',{
    stepId,attempt,bindingHash:await hashCanonicalValue({binding,requestHash}),
  })
  const estimatedInputTokens=input.messages.reduce((n,m)=>n+estimateTokens(m.content),0)
  const reservedTokens=estimatedInputTokens+input.maxOutputTokens
  await runEvent(handle,'budget.reserved',{
    stepId,modelCalls:1,toolCalls:0,tokens:reservedTokens,
  })
  handle.calls++
  handle.records.push({
    stepId,attempt,requestHash,dispatchStarted:false,responseHash:null,
    estimatedInputTokens,reservedOutputTokens:input.maxOutputTokens,
    inputTokens:null,outputTokens:null,latencyMs:null,requestLifecycle:null,error:null,
  })
  return {attempt,requestHash,startedAt:Date.now()}
}
export async function finishReaderModelStepV1(input:{
  handle:ReaderRunHandleV1;stepId:ReaderStepV1;attempt:number
  output:string;startedAt:number
  inputTokens?:number|null;outputTokens?:number|null
  requestLifecycle?:{phase:'pre-dispatch'|'request-dispatched'|'response-observed';responseStatus:number|null}
  artifactHash?:string
  complete?:boolean
}):Promise<void>{
  const {handle,stepId,attempt}=input
  const record=[...handle.records].reverse().find(x=>x.stepId===stepId&&x.attempt===attempt)
  if(!record)throw Error('[readerDurable] missing pending reader model request')
  if(record.responseHash)throw Error('[readerDurable] model response already recorded')
  const responseHash=await hashCanonicalValue(input.output)
  await runEvent(handle,'model.responded',{stepId,attempt,outputHash:responseHash})
  await runEvent(handle,'budget.settled',{stepId,modelCalls:1,toolCalls:0,
    tokens:record.estimatedInputTokens+estimateTokens(input.output)})
  await recordAgentRunArtifactV1({
    scope:handle.scope,runId:handle.snapshot.run.id,stepId,attempt,
    artifactKind:'raw-response',content:input.output,
  })
  handle.snapshot=await readAgentRunV1(handle.scope,handle.snapshot.run.id)
  record.responseHash=responseHash
  record.latencyMs=Date.now()-input.startedAt
  record.inputTokens=input.inputTokens??null
  record.outputTokens=input.outputTokens??null
  record.requestLifecycle=input.requestLifecycle??null
  // Output may be semantic/verifier artifact hash, but must be bound to
  // the exact provider response already recorded above.
  if(input.complete!==false)await runEvent(handle,'step.succeeded',{
    stepId,attempt,outputHash:input.artifactHash??responseHash,
  })
}
export async function failReaderModelStepV1(
  handle:ReaderRunHandleV1,stepId:ReaderStepV1,attempt:number,error:unknown,
  retryable=false,
):Promise<void>{
  const reason=error instanceof Error?error.message:String(error)
  const record=[...handle.records].reverse().find(x=>x.stepId===stepId&&x.attempt===attempt)
  if(record)record.error=reason.slice(0,400)
  if(handle.snapshot.projection.steps[stepId]?.status==='running'){
    await runEvent(handle,'step.failed',{
      stepId,attempt,code:'reader_model_or_validation_failed',retryable,
      category:retryable?'deterministic':'protocol',action:retryable?'retry':'fail',
    })
  }
}
export function readerStageEntryV1(stepId:ReaderStepV1):string{return STEP_ENTRY[stepId]}

export async function completeReaderModelStepV1(
  handle:ReaderRunHandleV1,stepId:ReaderStepV1,attempt:number,artifactHash:string,
):Promise<void>{
  if(handle.snapshot.projection.steps[stepId]?.status!=='running')fail('reader step not running')
  await runEvent(handle,'step.succeeded',{stepId,attempt,outputHash:artifactHash})
}
