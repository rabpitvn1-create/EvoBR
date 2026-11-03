/**
 * P4 session-bound V3 semantic cycle. The chapter wrapper is intentionally not
 * invoked: its boundary requires a genuine Chapter and is not Reader-compatible.
 */
import type { ChatMessage } from '../types'
import { hashCanonicalValue } from '../agent/run/hash'
import { AgentTeamBudgetTracker } from '../agent/team-budget'
import { verifyProseSemanticReviewArtifactV1,
  verifyProseSemanticRevisionArtifactV1,
  runProseSemanticReviewCycleV1,
  READER_SEMANTIC_REVIEW_PROMPT_VERSION_V1,
  READER_SEMANTIC_REVISION_PROMPT_VERSION_V1,
  PROSE_SEMANTIC_ISSUE_CODES_V1,
  type ProseSemanticReviewArtifactV1,
  type ProseSemanticReviewCycleResultV1,
} from '../agent/prose-semantic-review'
import type { ReaderRunHandleV1, ReaderStepV1 } from './run'
import { READER_STEPS_V1, beginReaderModelStepV1,
  finishReaderModelStepV1, completeReaderModelStepV1,
  failReaderModelStepV1 } from './run'
import { callReaderModelV1 } from './model'
import type { AIRequestConfigResolution } from '../ai/client'
import { assertReaderVietnameseProseV1 } from './prose'
import { assertReaderContextCurrentV1 } from './context'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { canonicalStringify } from '../agent/run/hash'
import type { AgentSkillExecutionBindingV2 } from '../types/agent-run'

export const READER_V3_RECEIPT_VERSION_V1 = 'reader-v3-session-bound-v1'
function fail(message:string):never{throw Error('[readerV3] '+message)}
const sources=(handle:ReaderRunHandleV1)=>handle.frozen.assembly.included.map((key,i)=>(
  '<source key="'+key+'">\n'+(handle.frozen.assembly.segments[i]?.content??'')+'\n</source>'
)).join('\n\n')
export function buildReaderSemanticReviewPromptV1(
  input:{chapterTitle:string;candidateText:string;assembled:ReaderRunHandleV1['frozen']['assembly']},
):ChatMessage[]{
  const listed=input.assembled.included.map((key,i)=>
    '<source key="'+key+'">\n'+(input.assembled.segments[i]?.content??'')+'\n</source>'
  ).join('\n\n')
  return [
    {role:'system',content:[
      'Bạn là bộ đánh giá ngữ nghĩa V3 cho tiểu thuyết Reader bằng tiếng Việt.',
      'Chỉ đánh giá mâu thuẫn trực tiếp có chứng cứ. Không đánh giá gu văn, không lấp chỗ trống hay biến phục bút thành lỗi.',
      'Chỉ xuất một object JSON đúng dạng:',
      '{"issues":[{"code":"'+PROSE_SEMANTIC_ISSUE_CODES_V1.join('|')+'","severity":"blocking|warning|uncertain","candidateQuote":"trích nguyên văn prose","evidence":[{"sourceKey":"reader.*","quote":"trích nguyên văn nguồn được cấp"}],"reason":"lý do","revisionInstruction":"sửa cục bộ hoặc chuỗi rỗng","autoRevisable":true}]}',
      'Mỗi blocking phải có ít nhất một evidence quote nằm nguyên văn trong đúng sourceKey và candidateQuote nằm trong prose.',
      'Không có bằng chứng rõ thì warning/uncertain, không blocking. Không sửa lại tác giả, không bịa Canon.',
      'Không có vấn đề trả {"issues":[]}. Không viết giải thích ngoài JSON.',
    ].join('\n')},
    {role:'user',content:'Cảnh Reader: '+input.chapterTitle+
      '\n\nPROSE CẦN DUYỆT:\n'+input.candidateText+
      '\n\nCHỈ NHỮNG NGUỒN READER ĐƯỢC ĐĂNG KÝ:\n'+listed+
      '\n\nChỉ xuất JSON theo giao thức.'},
  ]
}
export function buildReaderSemanticRevisionPromptV1(input:{
  generationMessages:readonly ChatMessage[]
  candidateText:string
  review:ProseSemanticReviewArtifactV1
}):ChatMessage[]{
  const blocking=input.review.issues.filter(i=>i.severity==='blocking'&&i.autoRevisable)
  return [...input.generationMessages.map(m=>({...m})),
    {role:'assistant',content:input.candidateText},
    {role:'user',content:[
      'BẢN VỪA RỒI CHƯA XUẤT BẢN. Chỉ sửa những mâu thuẫn có quote chính xác sau đây.',
      'Viết lại CHỈ văn xuôi tiếng Việt, không JSON, không menu lựa chọn.',
      'Giữ các chi tiết không bị chỉ ra, Canon, thứ tự nhân quả và toàn bộ giới hạn Reader.',
      ...blocking.map(i=>i.code+': '+i.reason+'\nTrích văn: '+i.candidateQuote+
        '\nChỉ đạo sửa: '+(i.revisionInstruction??'')),
    ].join('\n\n')},
  ]
}
function skillBinding(handle:ReaderRunHandleV1,stepId:ReaderStepV1):AgentSkillExecutionBindingV2{
  const binding=handle.snapshot.contract.executionBindings?.find(b=>b.stepId===stepId)
  if(!binding||binding.version!==2)fail('missing frozen reader Skill binding')
  const {stepId:_stepId,formalEntry:_formalEntry,...rest}=binding
  return rest
}
export interface ReaderSemanticReceiptV1{
  version:typeof READER_V3_RECEIPT_VERSION_V1
  runId:number
  attemptHash:string
  contextManifestHash:string
  originalProseHash:string
  finalProseHash:string
  status:'passed'|'blocked'
  correlatedJudge:boolean
  cycle:ProseSemanticReviewCycleResultV1
  receiptHash:string
}
export async function verifyReaderSemanticReceiptV1(input:{
  handle:ReaderRunHandleV1;receipt:ReaderSemanticReceiptV1;originalText:string
}):Promise<boolean>{
  const {handle,receipt}=input
  try{
    if(receipt.version!==READER_V3_RECEIPT_VERSION_V1||
      receipt.runId!==handle.snapshot.run.id||
      receipt.attemptHash!==handle.identity.attemptHash||
      receipt.contextManifestHash!==handle.frozen.contextManifestHash||
      receipt.originalProseHash!==await hashCanonicalValue(input.originalText)||
      receipt.finalProseHash!==await hashCanonicalValue(receipt.cycle.outputText)||
      receipt.status!==receipt.cycle.status||
      receipt.correlatedJudge!==receipt.cycle.finalReview.reviewer.correlatedJudge
    )return false
    const {receiptHash,...body}=receipt
    if(receiptHash!==await hashCanonicalValue(body))return false
    const check=async(a:ProseSemanticReviewArtifactV1,textHash:string)=>
      verifyProseSemanticReviewArtifactV1({artifact:a,candidateTextHash:textHash,
        contextManifestHash:handle.frozen.contextManifestHash,
        expectedSkillId:'reader.prose.review',
        expectedPromptVersion:READER_SEMANTIC_REVIEW_PROMPT_VERSION_V1})
    if(!await check(receipt.cycle.initialReview,receipt.originalProseHash))return false
    if(!await check(receipt.cycle.finalReview,receipt.finalProseHash))return false
    if(receipt.cycle.revision){
      if(!await verifyProseSemanticRevisionArtifactV1(receipt.cycle.revision,{
        expectedSkillId:'reader.prose.revise',
        expectedPromptVersion:READER_SEMANTIC_REVISION_PROMPT_VERSION_V1,
      })||receipt.cycle.initialReview.verdict!=='revise'||
        receipt.cycle.revision.sourceCandidateTextHash!==receipt.originalProseHash||
        receipt.cycle.revision.outputTextHash!==receipt.finalProseHash||
        receipt.cycle.finalReview.round!==2)return false
    }else if(receipt.cycle.finalReview.artifactHash!==receipt.cycle.initialReview.artifactHash)return false
    return receipt.status==='passed'&&receipt.cycle.finalReview.verdict==='pass'
  }catch{return false}
}
export async function runReaderDurableSemanticReviewV1(input:{
  handle:ReaderRunHandleV1
  originalText:string
  generationMessages:readonly ChatMessage[]
  resolution:AIRequestConfigResolution
  signal?:AbortSignal
}):Promise<ReaderSemanticReceiptV1>{
  const {handle}=input
  await assertReaderContextCurrentV1(handle.scope,handle.frozen)
  assertReaderVietnameseProseV1(input.originalText)
  const reviewerBinding=skillBinding(handle,READER_STEPS_V1.review)
  const revisionBinding=skillBinding(handle,READER_STEPS_V1.revise)
  if(reviewerBinding.promptVersion!==READER_SEMANTIC_REVIEW_PROMPT_VERSION_V1||
    revisionBinding.promptVersion!==READER_SEMANTIC_REVISION_PROMPT_VERSION_V1)fail('reader semantic prompt version changed')
  const budget=new AgentTeamBudgetTracker('balanced')
  let phase:'review'|'revision'|'rereview'='review'
  let active:{stepId:ReaderStepV1;attempt:number;startedAt:number}|null=null
  let observedUsage:{inputTokens:number|null;outputTokens:number|null}={inputTokens:null,outputTokens:null}
  const stageFromPhase={
    review:READER_STEPS_V1.review,
    revision:READER_STEPS_V1.revise,
    rereview:READER_STEPS_V1.rereview,
  } as const
  const rawCall=async(messages:ChatMessage[]):Promise<string>=>{
    const result=await callReaderModelV1({
      handle,stage:stageFromPhase[phase],
      messages,resolution:input.resolution,signal:input.signal,
    })
    observedUsage=result.usage
    return result.text
  }
  let cycle:ProseSemanticReviewCycleResultV1
  try{
    cycle=await runProseSemanticReviewCycleV1({
      chapterTitle:'Reader session '+handle.identity.sessionId,
      originalText:input.originalText,
      generationMessages:input.generationMessages,
      assembled:handle.frozen.assembly,
      contextManifestHashes:{initial:handle.frozen.contextManifestHash,
        final:handle.frozen.contextManifestHash},
      reviewer:{
        provider:input.resolution.config.provider,model:input.resolution.config.model,
        promptVersion:READER_SEMANTIC_REVIEW_PROMPT_VERSION_V1,
        executionBinding:reviewerBinding,correlatedJudge:true,
      },
      revisionExecutionBinding:revisionBinding,budget,
      review:rawCall,revise:rawCall,
      promptBuilders:{review:buildReaderSemanticReviewPromptV1,
        revision:buildReaderSemanticRevisionPromptV1},
      validateRevision:text=>{assertReaderVietnameseProseV1(text);return []},
      onCall:async event=>{
        phase=event.phase
        const stepId=stageFromPhase[event.phase]
        if(event.state==='requested'){
          const started=await beginReaderModelStepV1({
            handle,stepId,messages:event.messages??[],maxOutputTokens:event.reservedOutputTokens,
          })
          active={stepId,attempt:started.attempt,startedAt:started.startedAt}
        }else{
          if(!active||active.stepId!==stepId)fail('V3 callback phase switched without matched request')
          await finishReaderModelStepV1({handle,stepId,attempt:active.attempt,
            startedAt:active.startedAt,output:event.output??'',complete:false,
            inputTokens:observedUsage.inputTokens,outputTokens:observedUsage.outputTokens})
        }
      },
      onReviewArtifact:async artifact=>{
        const stepId=artifact.round===1?READER_STEPS_V1.review:READER_STEPS_V1.rereview
        if(!active||active.stepId!==stepId)fail('V3 review artifact phase mismatch')
        if(!await verifyProseSemanticReviewArtifactV1({
          artifact,candidateTextHash:artifact.candidateTextHash,
          contextManifestHash:handle.frozen.contextManifestHash,
          expectedSkillId:'reader.prose.review',
          expectedPromptVersion:READER_SEMANTIC_REVIEW_PROMPT_VERSION_V1,
        }))fail('V3 reviewer evidence or hash invalid')
        await completeReaderModelStepV1(handle,stepId,active.attempt,artifact.artifactHash)
        active=null
      },
      onRevisionArtifact:async artifact=>{
        if(!active||active.stepId!==READER_STEPS_V1.revise)fail('revision artifact without current Reader step')
        if(!await verifyProseSemanticRevisionArtifactV1(artifact,{
          expectedSkillId:'reader.prose.revise',
          expectedPromptVersion:READER_SEMANTIC_REVISION_PROMPT_VERSION_V1,
        }))fail('revision artifact invalid')
        await completeReaderModelStepV1(handle,READER_STEPS_V1.revise,
          active.attempt,artifact.artifactHash)
        active=null
      },
    })
  }catch(error){
    if(active)await failReaderModelStepV1(handle,active.stepId,active.attempt,error)
    throw error
  }
  await assertReaderContextCurrentV1(handle.scope,handle.frozen)
  if(cycle.status==='passed')assertReaderVietnameseProseV1(cycle.outputText)
  const body={
    version:READER_V3_RECEIPT_VERSION_V1,runId:handle.snapshot.run.id,
    attemptHash:handle.identity.attemptHash,
    contextManifestHash:handle.frozen.contextManifestHash,
    originalProseHash:await hashCanonicalValue(input.originalText),
    finalProseHash:await hashCanonicalValue(cycle.outputText),
    status:cycle.status,correlatedJudge:true,cycle,
  }
  const receipt:ReaderSemanticReceiptV1={...body,receiptHash:await hashCanonicalValue(body)}
  await recordAgentRunArtifactV1({scope:handle.scope,runId:handle.snapshot.run.id,
    artifactKind:'source-snapshot',content:canonicalStringify(receipt)})
  handle.snapshot=await (await import('../agent/run/event-store')).readAgentRunV1(
    handle.scope,handle.snapshot.run.id)
  if(cycle.status==='passed'&&!await verifyReaderSemanticReceiptV1({
    handle,receipt,originalText:input.originalText}))fail('Reader V3 final receipt invalid')
  return receipt
}
