/** P7 P11: real browser refresh across incomplete Reader provider stages.
 * Only HTTP is mocked. Reader model client, Dexie, publication and UI are real.
 */
import {test,expect,type Page} from '@playwright/test'

const prose='Cao Minh đứng trước cánh cửa khép hờ. Tiếng đèn rền phía trên, và những vệt ẩm trên tường vàng kéo dài về cuối hành lang.'
const branch=JSON.stringify({choices:[{
  choiceKey:'look-door',text:'Quan sát cánh cửa khép hờ',sourceQuote:'cánh cửa khép hờ',
}]})
const responses:Record<string,string>={
  'reader-prose':prose,
  'reader-v3-review':'{"issues":[]}',
  'reader-choices':branch,
  'reader-choice-verifier':'{"issues":[]}',
}
function stageFor(payload:{messages?:Array<{content:string}>}):string{
  const system=payload.messages?.[0]?.content??''
  if(system.includes('Bạn là người viết tiểu thuyết'))return 'reader-prose'
  if(system.includes('bộ đánh giá ngữ nghĩa V3'))return 'reader-v3-review'
  if(system.includes('Bạn tạo LỰA CHỌN ĐỌC TIẾP'))return 'reader-choices'
  if(system.includes('bộ kiểm tra CHỈ-ĐỌC'))return 'reader-choice-verifier'
  throw Error('unexpected prompt sent to P7 provider mock')
}
async function seed(page:Page){
  await page.goto('./')
  return page.evaluate(async()=>{
    const {db}=await import('/storyforge/src/lib/db/schema.ts')
    const {seedCurrentWorkspace}=await import('/storyforge/tests/helpers/current-workspace.ts')
    const {useAIConfigStore}=await import('/storyforge/src/stores/ai-config.ts')
    await db.delete();await db.open()
    const {scope}=await seedCurrentWorkspace('P7 khôi phục request dở dang')
    useAIConfigStore.getState().setConfig({
      provider:'custom',model:'p7-provider-mock',apiKey:'mock-only',
      baseUrl:'/reader-p7-mock/v1',temperature:0.8,maxTokens:1400,contextWindow:150000,
    })
    return scope
  })
}

for(const interrupted of ['reader-prose','reader-v3-review','reader-choices','reader-choice-verifier']){
  test('P11: reload during '+interrupted+' never publishes candidate or retries provider',async({page})=>{
    const scope=await seed(page)
    let reached!:()=>void,release!:()=>void
    const reachedPromise=new Promise<void>(resolve=>{reached=resolve})
    const hold=new Promise<void>(resolve=>{release=resolve})
    const stages:string[]=[]
    await page.route('**/reader-p7-mock/v1/chat/completions',async route=>{
      const stage=stageFor(route.request().postDataJSON())
      stages.push(stage)
      if(stage===interrupted){
        reached()
        await hold
        try{await route.abort('failed')}catch{/* navigation already aborted the request */}
        return
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        id:'p7',object:'chat.completion',created:1,model:'mock-provider',
        choices:[{index:0,message:{role:'assistant',content:responses[stage]},finish_reason:'stop'}],
        usage:{prompt_tokens:80,completion_tokens:50,total_tokens:130},
      })})
    })
    await page.goto('./reader/'+scope.projectId+'/'+scope.workId)
    await page.getByRole('button',{name:/Phiên đọc/}).click()
    await page.getByRole('button',{name:'+ Tạo mới'}).click()
    await reachedPromise
    const countBefore=stages.length
    await page.reload({waitUntil:'domcontentloaded'})
    release()
    await expect(page.getByText('Trạng thái lượt trước chưa được xác nhận.',{exact:false})).toBeVisible()
    await expect(page.locator('.ebr-reader-turn')).toHaveCount(0)
    const snapshot=await page.evaluate(async()=>{
      const {db}=await import('/storyforge/src/lib/db/schema.ts')
      return {turns:await db.readerTurns.count(),receipts:await db.readerPublicationRuns.count()}
    })
    expect(snapshot).toEqual({turns:0,receipts:0})
    await page.getByRole('button',{name:'Kiểm tra biên nhận'}).click()
    await expect(page.getByText('Chưa có biên nhận xuất bản.',{exact:false})).toBeVisible()
    expect(stages).toHaveLength(countBefore)
  })
}

test('P11: pending request with existing atomic receipt recovers after refresh without model calls',async({page})=>{
  const scope=await seed(page)
  let calls=0
  await page.route('**/reader-p7-mock/v1/chat/completions',async route=>{
    const stage=stageFor(route.request().postDataJSON())
    calls++
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      id:'p7',object:'chat.completion',created:1,model:'mock-provider',
      choices:[{index:0,message:{role:'assistant',content:responses[stage]},finish_reason:'stop'}],
      usage:{prompt_tokens:80,completion_tokens:50,total_tokens:130},
    })})
  })
  await page.goto('./reader/'+scope.projectId+'/'+scope.workId)
  await page.getByRole('button',{name:/Phiên đọc/}).click()
  await page.getByRole('button',{name:'+ Tạo mới'}).click()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1,{timeout:45_000})
  await expect(page.getByRole('button',{name:'Quan sát cánh cửa khép hờ'})).toBeEnabled()
  const pending=await page.evaluate(async scope=>{
    const {db}=await import('/storyforge/src/lib/db/schema.ts')
    const run=await db.readerPublicationRuns.orderBy('id').last()
    if(!run)throw Error('missing committed receipt')
    const intent={kind:'opening',sessionId:run.sessionId,
      requestKey:run.requestKey,expectedRevision:run.expectedSessionRevision}
    const key='evobr-reader-pending-v1:'+scope.projectId+':'+scope.workId
    sessionStorage.setItem(key,JSON.stringify({intent,workId:scope.workId}))
    return {key,receiptId:run.resultTurnId}
  },scope)
  const before=calls
  await page.reload()
  await expect(page.locator('.ebr-reader-turn')).toHaveCount(1)
  await expect(page.locator('.ebr-reader-turn')).toHaveAttribute('data-turn-id',String(pending.receiptId))
  await expect.poll(()=>page.evaluate(key=>sessionStorage.getItem(key),pending.key)).toBeNull()
  expect(calls).toBe(before)
})
