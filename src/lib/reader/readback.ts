/** P6 Reader readback boundary: render only committed receipt-backed prose. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import type { ReaderSessionV1,ReaderTurnV1,ReaderChoiceV1 } from '../types/reader'
import { resolveReaderLineageV1 } from './lineage'
import type { ReaderPublicationReceiptV1 } from './publication'

export interface ReaderPublishedViewV1 {
  session:ReaderSessionV1
  turns:ReaderTurnV1[]
  choices:ReaderChoiceV1[]
}
function fail(reason:string):never{throw Error('[readerReadback] '+reason)}
export async function readReaderPublishedViewV1(
  scope:WorkspaceScope,sessionId:number,
):Promise<ReaderPublishedViewV1>{
  const lineage=await resolveReaderLineageV1(scope,sessionId)
  const ids=new Set(lineage.turns.map(turn=>turn.id!))
  const receipts=(await db.readerPublicationRuns.where('projectId').equals(scope.projectId).toArray())
    .filter(row=>ids.has(row.resultTurnId))
  const byId=new Map<number,ReaderPublicationReceiptV1>()
  for(const row of receipts){
    if(row.status!=='committed'||byId.has(row.resultTurnId))
      fail('duplicate or uncommitted receipt')
    let parsed:ReaderPublicationReceiptV1
    try{parsed=JSON.parse(row.receiptJson) as ReaderPublicationReceiptV1}
    catch{return fail('receipt JSON corrupted')}
    if(parsed.version!==1||parsed.resultTurnId!==row.resultTurnId||
      parsed.sessionId!==row.sessionId||parsed.requestKey!==row.requestKey||
      parsed.requestFingerprint!==row.requestFingerprint||
      parsed.candidateHash!==row.candidateHash||parsed.runId!==row.runId||
      parsed.contextManifestHash!==row.contextManifestHash||
      parsed.semanticArtifactHash!==row.semanticArtifactHash||
      parsed.expectedRevision!==row.expectedSessionRevision||
      !Array.isArray(parsed.choices))
      fail('receipt metadata mismatch')
    byId.set(row.resultTurnId,parsed)
  }
  for(const turn of lineage.turns){
    const receipt=byId.get(turn.id!)
    if(!receipt||receipt.sessionId!==turn.sessionId||
      receipt.contentHash!==turn.contentHash||receipt.resultTurnId!==turn.id)
      fail('published turn has no matching committed receipt')
  }
  const head=lineage.session.headTurnId
  let choices:ReaderChoiceV1[]=[]
  if(head!==null){
    const receipt=byId.get(head)
    if(!receipt)fail('active Reader head has no receipt')
    choices=(await db.readerChoices.where('turnId').equals(head).toArray())
      .filter(choice=>choice.status==='available')
      .sort((a,b)=>a.order-b.order)
    if(choices.length!==receipt.choices.length||
      choices.some((choice,index)=>{
        const signed=receipt.choices[index]
        return choice.id!==signed.id||choice.turnId!==head||
          choice.sessionId!==receipt.sessionId||
          choice.projectId!==scope.projectId||
          choice.kind!==signed.kind||choice.choiceKey!==signed.choiceKey||
          choice.text!==signed.text||choice.order!==index
      }))
      fail('available choices do not match the committed receipt')
  }
  return {session:lineage.session,turns:lineage.turns,choices}
}
