/** P13: browser IndexedDB refresh proof for the real registered P5 writer.
 * Synthetic governed candidate is confined to this test harness; V3 validity
 * and model transport are covered by P4 and P5 regression tests respectively.
 */
import {test,expect} from '@playwright/test'

test('P13 browser refresh restores committed Reader head, decisions, choices and receipts',async({page})=>{
  await page.goto('./')
  const expected=await page.evaluate(async()=>{
    const {db}=await import('/src/lib/db/schema.ts')
    const {seedCurrentWorkspace}=await import('/tests/helpers/current-workspace.ts')
    const {createRootReaderSessionV1}=await import('/src/lib/reader/baseline.ts')
    const {prepareReaderContextV1}=await import('/src/lib/reader/context.ts')
    const {createReaderDurableRunV1}=await import('/src/lib/reader/run.ts')
    const {authorizeReaderIntentV1,readerIntentFingerprintV1}=await import('/src/lib/reader/publication.ts')
    const {prepareReaderCommitV1,commitReaderPublicationV1}=await import('/src/lib/reader/commit.ts')
    await db.delete();await db.open()
    const {scope}=await seedCurrentWorkspace('P13 IndexedDB browser fixture')
    const sid=await createRootReaderSessionV1(scope,{maxSnapshotBytes:2000000})
    const receipts=[]
    const intents=[]
    async function commit(intent,content){
      const auth=await authorizeReaderIntentV1(scope,intent)
      const frozen=await prepareReaderContextV1({workspace:scope,sessionId:sid,
        expectedRevision:intent.expectedRevision,inputBudgetTokens:120000,
        maxBaselineBytes:2000000})
      const handle=await createReaderDurableRunV1({scope,frozen,maxInputTokens:160000})
      // Only the P5 database seam is exercised here. This harness does NOT
      // claim a model-approved candidate or live V3 acceptance.
      const candidate={
        runId:handle.snapshot.run.id,sessionId:sid,
        expectedRevision:intent.expectedRevision,headTurnId:auth.headTurnId,
        finalProse:content,candidateHash:'a'.repeat(64),
        contextManifestHash:frozen.contextManifestHash,
        v3:{receiptHash:'b'.repeat(64)},
        choices:{choices:[{choiceKey:'continue',kind:'continue',text:'Đọc tiếp',sourceQuote:null}]},
      }
      const prepared=await prepareReaderCommitV1({
        scope,intent,requestFingerprint:await readerIntentFingerprintV1(scope,intent),
        expectedHeadTurnId:auth.headTurnId,turnOrdinal:auth.turnOrdinal,candidate,
      })
      const receipt=await commitReaderPublicationV1(prepared)
      receipts.push(receipt);intents.push(intent)
      return receipt
    }
    const first=await commit({kind:'opening',sessionId:sid,
      requestKey:'browser-opening',expectedRevision:0},
      'Cao Minh nghe tiếng đèn rền giữa hành lang vàng.')
    const second=await commit({kind:'choice',sessionId:sid,
      sourceTurnId:first.resultTurnId,choiceId:first.choices[0].id,
      requestKey:'browser-choice',expectedRevision:1},
      'Cao Minh bước tới cánh cửa và nhìn vào khoảng tối.')
    return {scope,sid,receipts,intents,second}
  })
  await page.reload()
  const restored=await page.evaluate(async(state)=>{
    const {db}=await import('/src/lib/db/schema.ts')
    const {recoverReaderPublicationV1}=await import('/src/lib/reader/recovery.ts')
    const first=await recoverReaderPublicationV1({workspace:state.scope,intent:state.intents[0]})
    const second=await recoverReaderPublicationV1({workspace:state.scope,intent:state.intents[1]})
    const session=await db.readerSessions.get(state.sid)
    const runs=await db.readerPublicationRuns.where('sessionId').equals(state.sid).count()
    return {
      firstReceipt:first?.receipt,secondReceipt:second?.receipt,
      firstText:first?.turn.content,secondText:second?.turn.content,
      firstChoiceId:first?.choices[0].id,secondChoiceId:second?.choices[0].id,
      decisionSource:second?.decision?.sourceTurnId,
      decisionChoiceId:second?.decision?.choiceId,
      head:session?.headTurnId,revision:session?.revision,runs,
    }
  },expected)
  expect(restored.firstReceipt).toEqual(expected.receipts[0])
  expect(restored.secondReceipt).toEqual(expected.receipts[1])
  expect(restored.firstText).toContain('Cao Minh')
  expect(restored.secondText).toContain('cánh cửa')
  expect(restored.firstChoiceId).toBe(expected.receipts[0].choices[0].id)
  expect(restored.secondChoiceId).toBe(expected.receipts[1].choices[0].id)
  expect(restored.decisionSource).toBe(expected.receipts[0].resultTurnId)
  expect(restored.decisionChoiceId).toBe(expected.receipts[0].choices[0].id)
  expect(restored.head).toBe(expected.second.resultTurnId)
  expect(restored.revision).toBe(2)
  expect(restored.runs).toBe(2)
})
