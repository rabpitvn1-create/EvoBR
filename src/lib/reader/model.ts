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
  caller:'src/lib/reader/generation.ts'|'src/lib/reader/semantic-review.ts'|'src/lib/reader/choices.ts'
  messages:ChatMessage[]
  resolution:AIRequestConfigResolution
  signal?:AbortSignal
}):Promise<{text:string;usage:{inputTokens:number|null;outputTokens:number|null}}>{
  const binding=input.handle.snapshot.contract.executionBindings?.find(b=>b.stepId===input.stage)
  const id=readerStageEntryV1(input.stage)
  if(!binding?.formalEntry||binding.skillId!==id)throw Error('[readerModel] frozen entry binding missing')
  const result:ChatResult={}
  const output=await executeFrozenFormalAIEntryV1(
    id,binding.formalEntry,getAgentSkillV1(id,'prose'),
    input.caller,input.messages,input.resolution.config,
    {category:id,projectId:input.handle.scope.projectId,
      contextOverflowPolicy:'reject',transportRetryPolicy:'none'},
    input.signal,result,undefined,input.resolution,
  )
  return {text:output,usage:{
    inputTokens:result.usage?.inputTokens??null,
    outputTokens:result.usage?.outputTokens??null,
  }}
}
