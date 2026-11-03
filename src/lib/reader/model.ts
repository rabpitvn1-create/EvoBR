import { executeFrozenFormalAIEntryV1 } from '../agent/formal-ai-entry'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { resolveRequestConfig, type AIRequestConfigResolution, type ChatResult } from '../ai/client'
import type { AIConfig, ChatMessage } from '../types'
import type { ReaderRunHandleV1, ReaderStepV1 } from './run'
import { readerStageEntryV1 } from './run'

/** Freeze once from the real app task route; no per-stage route fallback. */
export function resolveFrozenReaderModelV1(config:AIConfig):AIRequestConfigResolution {
  const resolution=resolveRequestConfig(config,{
    category:'reader.prose.generate',contextOverflowPolicy:'reject',
    transportRetryPolicy:'none',
  })
  if(!resolution.config?.model||!resolution.config.provider)throw Error('[readerModel] provider/model unavailable')
  return resolution
}

/** This is the repo's real AI client, not an alternate HTTP adapter. */
export async function callReaderModelV1(input:{
  handle:ReaderRunHandleV1
  stage:ReaderStepV1
  messages:ChatMessage[]
  resolution:AIRequestConfigResolution
  signal?:AbortSignal
}):Promise<{text:string;usage:{inputTokens:number|null;outputTokens:number|null};requestLifecycle:ChatResult['requestLifecycle']}>{
  const binding=input.handle.snapshot.contract.executionBindings?.find(b=>b.stepId===input.stage)
  const id=readerStageEntryV1(input.stage)
  if(!binding?.formalEntry||binding.skillId!==id)throw Error('[readerModel] frozen entry binding missing')
  const skill=getAgentSkillV1(id,'prose')
  // Never let a wide application preset overrun the registered Reader Skill
  // output quota. Provider/model and auth route remain frozen across the run.
  const requestedMax=input.resolution.config.maxTokens
  if(!Number.isSafeInteger(requestedMax)||requestedMax<=0)
    throw Error('[readerModel] invalid configured model output budget')
  const stageResolution:AIRequestConfigResolution={
    ...input.resolution,
    config:{...input.resolution.config,maxTokens:Math.min(requestedMax,skill.maxOutputTokens)},
  }
  const result:ChatResult={}
  let output:string
  switch(input.stage){
    case 'reader-prose':
      output=await executeFrozenFormalAIEntryV1(
        'reader.prose.generate',binding.formalEntry,getAgentSkillV1('reader.prose.generate','prose'),
        'src/lib/reader/model.ts',input.messages,stageResolution.config,
        {category:'reader.prose.generate',projectId:input.handle.scope.projectId,
          contextOverflowPolicy:'reject',transportRetryPolicy:'none'},
        input.signal,result,undefined,stageResolution)
      break
    case 'reader-v3-review':
    case 'reader-v3-rereview':
      output=await executeFrozenFormalAIEntryV1(
        'reader.prose.review',binding.formalEntry,getAgentSkillV1('reader.prose.review','prose'),
        'src/lib/reader/model.ts',input.messages,stageResolution.config,
        {category:'reader.prose.review',projectId:input.handle.scope.projectId,
          contextOverflowPolicy:'reject',transportRetryPolicy:'none'},
        input.signal,result,undefined,stageResolution)
      break
    case 'reader-v3-revision':
      output=await executeFrozenFormalAIEntryV1(
        'reader.prose.revise',binding.formalEntry,getAgentSkillV1('reader.prose.revise','prose'),
        'src/lib/reader/model.ts',input.messages,stageResolution.config,
        {category:'reader.prose.revise',projectId:input.handle.scope.projectId,
          contextOverflowPolicy:'reject',transportRetryPolicy:'none'},
        input.signal,result,undefined,stageResolution)
      break
    case 'reader-choices':
      output=await executeFrozenFormalAIEntryV1(
        'reader.choices.generate',binding.formalEntry,getAgentSkillV1('reader.choices.generate','prose'),
        'src/lib/reader/model.ts',input.messages,stageResolution.config,
        {category:'reader.choices.generate',projectId:input.handle.scope.projectId,
          contextOverflowPolicy:'reject',transportRetryPolicy:'none'},
        input.signal,result,undefined,stageResolution)
      break
    case 'reader-choice-verifier':
      output=await executeFrozenFormalAIEntryV1(
        'reader.choices.review',binding.formalEntry,getAgentSkillV1('reader.choices.review','prose'),
        'src/lib/reader/model.ts',input.messages,stageResolution.config,
        {category:'reader.choices.review',projectId:input.handle.scope.projectId,
          contextOverflowPolicy:'reject',transportRetryPolicy:'none'},
        input.signal,result,undefined,stageResolution)
      break
    default:throw Error('[readerModel] unknown stage')
  }
  return {text:output,requestLifecycle:result.requestLifecycle,usage:{
    inputTokens:result.usage?.inputTokens??null,
    outputTokens:result.usage?.outputTokens??null,
  }}
}
