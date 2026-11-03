/** P4 choices are generated strictly after the V3-approved prose is frozen. */
import type { ChatMessage } from '../types'
import type { AIRequestConfigResolution } from '../ai/client'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { recordAgentRunArtifactV1 } from '../memory/artifact-store'
import { assertReaderContextCurrentV1 } from './context'
import type { ReaderRunHandleV1 } from './run'
import { READER_STEPS_V1, READER_MODEL_CALL_LIMIT_V1,
  beginReaderModelStepV1,finishReaderModelStepV1,
  completeReaderModelStepV1,failReaderModelStepV1 } from './run'
import { callReaderModelV1 } from './model'
import { assertReaderVietnameseProseV1 } from './prose'

export const READER_CHOICE_PROMPT_VERSION_V1='reader-choices-generate-vi-v1'
export const READER_CHOICE_VERIFIER_PROMPT_VERSION_V1='reader-choices-review-vi-v1'
export const READER_CHOICE_ISSUE_CODES_V1=[
  'unavailable-affordance','choice-prose-contradiction','scope-violation',
] as const
export type ReaderChoiceIssueCodeV1=typeof READER_CHOICE_ISSUE_CODES_V1[number]
export interface ReaderBranchChoiceV1{
  choiceKey:string
  kind:'branch'|'continue'
  text:string
  sourceQuote:string|null
}
export interface ReaderChoiceIssueV1{
  choiceKey:string
  code:ReaderChoiceIssueCodeV1
  choiceQuote:string
  evidence:{sourceKey:string;quote:string}
  reason:string
}
export interface ReaderChoicesReceiptV1{
  version:1
  runId:number
  contextManifestHash:string
  finalProseHash:string
  choices:ReaderBranchChoiceV1[]
  issues:ReaderChoiceIssueV1[]
  generationAttempts:number
  generationResponseHashes:string[]
  verifierResponseHash:string|null
  fallbackContinue:boolean
  choiceEvidenceHash:string
}
function fail(message:string):never{throw Error('[readerChoices] '+message)}
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('expected JSON object')
  return value as Record<string,unknown>
}
function exactKeys(obj:Record<string,unknown>,keys:string[]):void{
  if(Object.keys(obj).length!==keys.length||Object.keys(obj).some(k=>!keys.includes(k)))
    fail('unexpected JSON fields')
}
function parseJson(raw:string):Record<string,unknown>{
  const trimmed=raw.trim()
  if(!trimmed.startsWith('{')||!trimmed.endsWith('}'))fail('model output must be one JSON object')
  try{return object(JSON.parse(trimmed))}catch{return fail('malformed choice JSON')}
}
const sourceText=(h:ReaderRunHandleV1,key:string):string|null=>{
  if(key==='finalProse')return null
  const i=h.frozen.assembly.included.indexOf(key)
  return i>=0?h.frozen.assembly.segments[i]?.content??'':null
}
export function parseReaderBranchChoicesV1(
  raw:string,finalProse:string,
):{choices:ReaderBranchChoiceV1[];rejected:number}{
  const json=parseJson(raw)
  if(!Array.isArray(json.choices)||Object.keys(json).some(k=>!['choices','sceneHints'].includes(k)))
    fail('expected choices array; sceneHints is optional and nonauthoritative')
  if(json.choices.length>8)fail('too many model choices')
  const results:ReaderBranchChoiceV1[]=[],keys=new Set<string>()
  let rejected=0
  for(const proposal of json.choices){
    try{
      const item=object(proposal);exactKeys(item,['choiceKey','text','sourceQuote'])
      if(typeof item.choiceKey!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(item.choiceKey)||
        item.choiceKey==='continue'||keys.has(item.choiceKey)||
        typeof item.text!=='string'||!item.text.trim()||item.text.length>220||
        typeof item.sourceQuote!=='string'||item.sourceQuote.trim().length<4||
        item.sourceQuote.length>480||!finalProse.includes(item.sourceQuote))
        fail('branch choice has invalid key, text or fake final-prose quote')
      keys.add(item.choiceKey)
      results.push({choiceKey:item.choiceKey,kind:'branch',text:item.text.trim(),
        sourceQuote:item.sourceQuote})
    }catch{rejected++}
  }
  return {choices:results,rejected}
}
export function parseReaderChoiceReviewV1(
  raw:string,handle:ReaderRunHandleV1,finalProse:string,
  choices:readonly ReaderBranchChoiceV1[],
):ReaderChoiceIssueV1[]{
  const parsed=parseJson(raw);exactKeys(parsed,['issues'])
  if(!Array.isArray(parsed.issues)||parsed.issues.length>choices.length)fail('invalid choice review issue count')
  const byKey=new Map(choices.map(c=>[c.choiceKey,c])),seen=new Set<string>()
  const issues:ReaderChoiceIssueV1[]=[]
  for(const rawIssue of parsed.issues){
    const issue=object(rawIssue)
    exactKeys(issue,['choiceKey','code','choiceQuote','evidence','reason'])
    if(typeof issue.choiceKey!=='string'||seen.has(issue.choiceKey)||
      !byKey.has(issue.choiceKey))fail('verifier cited unknown or duplicate choice')
    const choice=byKey.get(issue.choiceKey)!
    if(typeof issue.choiceQuote!=='string'||issue.choiceQuote!==choice.text||
      typeof issue.code!=='string'||
      !READER_CHOICE_ISSUE_CODES_V1.includes(issue.code as ReaderChoiceIssueCodeV1)||
      typeof issue.reason!=='string'||!issue.reason.trim())fail('unverifiable verifier finding')
    const evidence=object(issue.evidence)
    exactKeys(evidence,['sourceKey','quote'])
    if(typeof evidence.sourceKey!=='string'||typeof evidence.quote!=='string'||
      !evidence.quote.trim())fail('missing verifier quote')
    const authorized=evidence.sourceKey==='finalProse'
      ?finalProse:sourceText(handle,evidence.sourceKey)
    if(!authorized||!authorized.includes(evidence.quote))
      fail('verifier evidence quote is not verbatim in frozen prose/reader source')
    seen.add(issue.choiceKey)
    issues.push({choiceKey:issue.choiceKey,code:issue.code as ReaderChoiceIssueCodeV1,
      choiceQuote:issue.choiceQuote,
      evidence:{sourceKey:evidence.sourceKey,quote:evidence.quote},
      reason:issue.reason})
  }
  return issues
}
export function buildReaderChoiceMessagesV1(
  handle:ReaderRunHandleV1,finalProse:string,finalProseHash:string,
):ChatMessage[]{
  return [
    {role:'system',content:[
      'Bạn tạo LỰA CHỌN ĐỌC TIẾP cho truyện Reader tiếng Việt, không viết lại văn xuôi.',
      'Chỉ tạo cơ hội hành động khả thi từ prose đã đóng băng. Không thêm lore/nhân vật Canon có tên.',
      'Không ép kết thúc, không ép nhiệm vụ. Mỗi nhánh phải gắn sourceQuote nguyên văn trong prose.',
      'Chỉ xuất JSON: {"choices":[{"choiceKey":"id","text":"hành động","sourceQuote":"trích prose nguyên văn"}]}.',
      'Không có lựa chọn hợp lệ thì trả {"choices":[]}. sceneHints tùy chọn, không có thẩm quyền.',
    ].join('\n')},
    {role:'user',content:'Gateway session: '+handle.identity.sessionId+
      '\nManifest: '+handle.frozen.contextManifestHash+
      '\nFinalProseHash: '+finalProseHash+
      '\nNGỮ CẢNH READER ĐÓNG BĂNG:\n'+handle.frozen.assembly.text+
      '\n\nPROSE CUỐI ĐÃ ĐƯỢC V3 DUYỆT:\n'+finalProse},
  ]
}
export function buildReaderChoiceVerifierMessagesV1(
  handle:ReaderRunHandleV1,finalProse:string,choices:ReaderBranchChoiceV1[],
):ChatMessage[]{
  return [
    {role:'system',content:[
      'Bạn là bộ kiểm tra CHỈ-ĐỌC các lựa chọn Reader. Không tạo prose/choices mới.',
      'Chỉ phát hiện lựa chọn bất khả thi, mâu thuẫn câu chuyện hoặc vượt giới hạn session.',
      'Mỗi lỗi phải chỉ đúng choiceKey, choiceQuote CHÍNH XÁC bằng text lựa chọn,',
      'evidence.sourceKey là finalProse hoặc một source key reader đang hiện diện,',
      'evidence.quote nguyên văn từ nguồn đó. Không bịa bằng chứng.',
      'Chỉ xuất {"issues":[{"choiceKey":"id","code":"unavailable-affordance|choice-prose-contradiction|scope-violation","choiceQuote":"nguyên văn option","evidence":{"sourceKey":"finalProse","quote":"nguyên văn"},"reason":"lý do"}]}.',
      'Không phát hiện mâu thuẫn có chứng cứ: {"issues":[]}.',
    ].join('\n')},
    {role:'user',content:'PROSE CUỐI:\n'+finalProse+
      '\n\nCÁC LỰA CHỌN:\n'+JSON.stringify(choices)+
      '\n\nNGỮ CẢNH READER:\n'+handle.frozen.assembly.included
        .map((key,i)=>'<source key="'+key+'">\n'+handle.frozen.assembly.segments[i].content+'\n</source>')
        .join('\n\n')},
  ]
}
function safeContinue(finalProse:string):boolean{
  // A deterministic continue never changes Canon or rewrites the frozen text.
  // It is forbidden if the prose itself fails the hard Reader text contract.
  try{assertReaderVietnameseProseV1(finalProse);return true}catch{return false}
}
export async function runReaderChoiceStageV1(input:{
  handle:ReaderRunHandleV1
  finalProse:string
  finalProseHash:string
  resolution:AIRequestConfigResolution
  maxChoiceRetries?:number
  signal?:AbortSignal
}):Promise<ReaderChoicesReceiptV1>{
  const {handle,finalProse}=input
  await assertReaderContextCurrentV1(handle.scope,handle.frozen)
  if(await hashCanonicalValue(finalProse)!==input.finalProseHash)
    fail('final prose hash changed after V3')
  const maxRetries=input.maxChoiceRetries??0
  if(!Number.isSafeInteger(maxRetries)||maxRetries<0||maxRetries>2)
    fail('choice retry limit must be 0..2')
  const responseHashes:string[]=[]
  let branches:ReaderBranchChoiceV1[]=[]
  let attempts=0
  for(let index=0;index<=maxRetries;index++){
    if(handle.calls>=READER_MODEL_CALL_LIMIT_V1)break
    const attempt=index+1
    const messages=buildReaderChoiceMessagesV1(handle,finalProse,input.finalProseHash)
    let started:null|{attempt:number;startedAt:number}=null
    try{
      started=await beginReaderModelStepV1({handle,stepId:READER_STEPS_V1.choices,
        attempt,messages,maxOutputTokens:1200})
      attempts++
      const response=await callReaderModelV1({
        handle,stage:READER_STEPS_V1.choices,
        messages,resolution:input.resolution,signal:input.signal,
      })
      const responseHash=await hashCanonicalValue(response.text)
      responseHashes.push(responseHash)
      await finishReaderModelStepV1({handle,stepId:READER_STEPS_V1.choices,
        attempt,startedAt:started.startedAt,output:response.text,complete:false,
        ...response.usage})
      const parsed=parseReaderBranchChoicesV1(response.text,finalProse)
      if(!parsed.choices.length)throw Error('no grounded model choices')
      branches=parsed.choices
      await completeReaderModelStepV1(handle,READER_STEPS_V1.choices,attempt,responseHash)
      break
    }catch(error){
      if(started)await failReaderModelStepV1(handle,READER_STEPS_V1.choices,attempt,error)
      if(attempt>maxRetries)break
    }
  }
  let issues:ReaderChoiceIssueV1[]=[]
  let verifierResponseHash:string|null=null
  if(branches.length){
    if(handle.calls>=READER_MODEL_CALL_LIMIT_V1)
      fail('six-call ceiling reached before mandatory choice verifier')
    const messages=buildReaderChoiceVerifierMessagesV1(handle,finalProse,branches)
    let started:null|{attempt:number;startedAt:number}=null
    try{
      started=await beginReaderModelStepV1({
        handle,stepId:READER_STEPS_V1.choiceCheck,messages,maxOutputTokens:1200,
      })
      const response=await callReaderModelV1({
        handle,stage:READER_STEPS_V1.choiceCheck,
        messages,resolution:input.resolution,signal:input.signal,
      })
      verifierResponseHash=await hashCanonicalValue(response.text)
      await finishReaderModelStepV1({
        handle,stepId:READER_STEPS_V1.choiceCheck,attempt:started.attempt,
        startedAt:started.startedAt,output:response.text,complete:false,
        ...response.usage,
      })
      issues=parseReaderChoiceReviewV1(response.text,handle,finalProse,branches)
      await completeReaderModelStepV1(handle,READER_STEPS_V1.choiceCheck,
        started.attempt,verifierResponseHash)
      const blocked=new Set(issues.map(i=>i.choiceKey))
      branches=branches.filter(c=>!blocked.has(c.choiceKey))
    }catch(error){
      if(started)await failReaderModelStepV1(handle,READER_STEPS_V1.choiceCheck,started.attempt,error)
      // Verifier unavailable is an unresolved semantic verdict, not permission
      // to bypass it with Continue. This turn remains unpublishable.
      throw error
    }
  }
  const fallbackContinue=branches.length===0
  if(fallbackContinue){
    if(!safeContinue(finalProse))fail('no valid branch and deterministic Continue forbidden')
    branches=[{choiceKey:'continue',kind:'continue',text:'Đọc tiếp',sourceQuote:null}]
  }
  await assertReaderContextCurrentV1(handle.scope,handle.frozen)
  const body={
    version:1 as const,runId:handle.snapshot.run.id,
    contextManifestHash:handle.frozen.contextManifestHash,
    finalProseHash:input.finalProseHash,
    choices:branches,issues,generationAttempts:attempts,
    generationResponseHashes:responseHashes,
    verifierResponseHash,fallbackContinue,
  }
  const receipt:ReaderChoicesReceiptV1={...body,choiceEvidenceHash:await hashCanonicalValue(body)}
  await recordAgentRunArtifactV1({scope:handle.scope,runId:handle.snapshot.run.id,
    artifactKind:'source-snapshot',content:canonicalStringify(receipt)})
  return receipt
}
export async function verifyReaderChoicesReceiptV1(
  handle:ReaderRunHandleV1,receipt:ReaderChoicesReceiptV1,
  finalProse:string,
):Promise<boolean>{
  if(receipt.version!==1||receipt.runId!==handle.snapshot.run.id||
    receipt.contextManifestHash!==handle.frozen.contextManifestHash||
    receipt.finalProseHash!==await hashCanonicalValue(finalProse))return false
  const {choiceEvidenceHash,...body}=receipt
  if(choiceEvidenceHash!==await hashCanonicalValue(body))return false
  if(!receipt.choices.length||new Set(receipt.choices.map(c=>c.choiceKey)).size!==receipt.choices.length)return false
  if(receipt.fallbackContinue)return receipt.choices.length===1&&receipt.choices[0].kind==='continue'&&
    receipt.choices[0].choiceKey==='continue'&&receipt.choices[0].text==='Đọc tiếp'&&
    receipt.choices[0].sourceQuote===null
  return receipt.choices.every(c=>c.kind==='branch'&&!!c.sourceQuote&&
    finalProse.includes(c.sourceQuote)&&!receipt.issues.some(i=>i.choiceKey===c.choiceKey))
}
